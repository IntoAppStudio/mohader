/**
 * Text extraction for uploaded sources. Runs server-side only.
 * Returns page-wise text so every extracted block keeps a real page reference.
 */

export type ExtractedDoc = { pages: string[]; pageCount: number; method: "pdf" | "text" | "office" };

const TEXT_MIMES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "text/html",
];

const OFFICE_RE = /\.(docx|pptx|xlsx)$/;

export function isExtractable(mime: string, name: string): boolean {
  const lower = name.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return true;
  if (OFFICE_RE.test(lower)) return true;
  if (TEXT_MIMES.includes(mime)) return true;
  return /\.(txt|md|csv|json|htm|html)$/.test(lower);
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<\/w:p>|<\/a:p>|<\/text:p>/g, "\n\n")
    .replace(/<w:br\s*\/>|<a:br\s*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Extracts text from Office Open XML packages (docx, pptx, xlsx) without native deps. */
async function extractOffice(bytes: ArrayBuffer, lower: string): Promise<ExtractedDoc> {
  const { unzipSync, strFromU8 } = await import("fflate");
  const zip = unzipSync(new Uint8Array(bytes));
  const names = Object.keys(zip);

  let targets: string[] = [];
  if (lower.endsWith(".docx")) {
    targets = names.filter((n) => /^word\/(document|footnotes|endnotes)\d*\.xml$/.test(n));
  } else if (lower.endsWith(".pptx")) {
    targets = names
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort(
        (a, b) =>
          Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0),
      );
  } else {
    const shared = zip["xl/sharedStrings.xml"];
    targets = shared ? ["xl/sharedStrings.xml"] : names.filter((n) => /^xl\/worksheets\//.test(n));
  }

  const parts = targets
    .map((name) => xmlToText(strFromU8(zip[name]!)))
    .filter((text) => text.length > 1);

  if (parts.length === 0) throw new Error("NO_TEXT_EXTRACTED");

  const pages = lower.endsWith(".pptx") ? parts : chunkPlainText(parts.join("\n\n"));
  return { pages, pageCount: pages.length, method: "office" };
}


function chunkPlainText(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const pages: string[] = [];
  let current = "";
  for (const p of paragraphs) {
    if (current.length + p.length > 2800 && current.length > 0) {
      pages.push(current.trim());
      current = "";
    }
    current += `${p}\n\n`;
  }
  if (current.trim()) pages.push(current.trim());
  return pages.length ? pages : [text.trim()];
}

export async function extractDocument(
  bytes: ArrayBuffer,
  mime: string,
  name: string,
): Promise<ExtractedDoc> {
  const lower = name.toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((p) => p.replace(/\s+\n/g, "\n").trim());
    return { pages, pageCount: totalPages, method: "pdf" };
  }

  if (OFFICE_RE.test(lower)) return extractOffice(bytes, lower);

  if (isExtractable(mime, name)) {
    const decoded = new TextDecoder("utf-8").decode(bytes);
    const pages = chunkPlainText(decoded);
    return { pages, pageCount: pages.length, method: "text" };
  }

  throw new Error("UNSUPPORTED_FILE_TYPE");
}

export type RawBlock = {
  block_type: string;
  original_text: string;
  page: number;
  position: number;
  section: string | null;
};

/** Splits page text into ordered blocks, tagging headings by shape (no invented content). */
export function toBlocks(pages: string[]): RawBlock[] {
  const blocks: RawBlock[] = [];
  let position = 0;
  let section: string | null = null;

  pages.forEach((pageText, pageIndex) => {
    const parts = pageText
      .split(/\n\s*\n|\r\n\r\n/)
      .map((p) => p.replace(/[ \t]+/g, " ").trim())
      .filter((p) => p.length > 1);

    for (const part of parts) {
      const isHeading =
        part.length <= 90 && !/[.!؟?]$/.test(part) && part.split(/\s+/).length <= 12;
      if (isHeading) section = part;
      blocks.push({
        block_type: isHeading ? "heading" : /^\s*([-*•]|\d+[.)])\s/.test(part) ? "list" : "paragraph",
        original_text: part.slice(0, 6000),
        page: pageIndex + 1,
        position: position++,
        section: isHeading ? part : section,
      });
    }
  });

  return blocks;
}

/** Extraction quality signal shown to the user; no fabricated scores. */
export function assessQuality(doc: ExtractedDoc, blocks: RawBlock[]) {
  const chars = blocks.reduce((sum, b) => sum + b.original_text.length, 0);
  const emptyPages = doc.pages.filter((p) => p.trim().length < 20).length;
  const charsPerPage = doc.pageCount ? Math.round(chars / doc.pageCount) : 0;
  const score =
    chars === 0 ? 0 : Math.max(0, Math.min(100, Math.round(100 - (emptyPages / Math.max(1, doc.pageCount)) * 100)));
  return {
    method: doc.method,
    characters: chars,
    blocks: blocks.length,
    pages: doc.pageCount,
    empty_pages: emptyPages,
    chars_per_page: charsPerPage,
    score,
    needs_ocr: doc.method === "pdf" && charsPerPage < 120,
  };
}

export type SourceSegment = {
  chapterTitle: string;
  lessonTitle: string;
  blockIds: number[];
  pages: number[];
};

/**
 * Groups ordered blocks into lesson segments that follow the file's OWN divisions.
 * A section heading in the source starts a lesson; nothing is split further, so a
 * twenty-page lesson stays one lesson. Tiny fragments are merged back into the
 * lesson they belong to instead of becoming lessons of their own.
 */
export function segmentSource(
  blocks: { section: string | null; page: number | null; original_text: string }[],
  fallbackTitle: string,
): SourceSegment[] {
  const segments: SourceSegment[] = [];
  let currentKey: string | null = null;

  blocks.forEach((block, index) => {
    const key = (block.section ?? "").trim() || fallbackTitle;
    if (key !== currentKey || segments.length === 0) {
      segments.push({ chapterTitle: fallbackTitle, lessonTitle: key, blockIds: [], pages: [] });
      currentKey = key;
    }
    const segment = segments[segments.length - 1]!;
    segment.blockIds.push(index);
    if (block.page) segment.pages.push(block.page);
  });

  const charsOf = (segment: SourceSegment) =>
    segment.blockIds.reduce((sum, id) => sum + (blocks[id]?.original_text.length ?? 0), 0);

  // Merge fragments that are too small to be a real lesson in the source.
  const merged: SourceSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && charsOf(segment) < 500) {
      previous.blockIds.push(...segment.blockIds);
      previous.pages.push(...segment.pages);
      continue;
    }
    merged.push(segment);
  }

  return merged.map((segment) => ({
    ...segment,
    pages: [...new Set(segment.pages)].sort((a, b) => a - b),
  }));
}

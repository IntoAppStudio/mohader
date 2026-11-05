/**
 * Chunking engine: splits a document into study segments whose estimated
 * duration never exceeds a maximum (15 minutes by default), following the
 * document's headings. A custom page range (startPage, endPage) can be given to
 * restrict the material that is chunked.
 */

export type DocumentHeading = {
  id?: string;
  title: string;
  /** Heading nesting level (1 = chapter, 2 = section, ...). */
  level?: number;
  /** First page of the section (1-based). */
  startPage: number;
  /** Last page of the section. Derived from the next heading when omitted. */
  endPage?: number;
  /** Explicit duration estimate for the whole section, in minutes. */
  estimatedMinutes?: number;
  /** Token count of the whole section, used when no explicit minutes are given. */
  tokens?: number;
};

export type PageRange = {
  startPage: number;
  endPage: number;
};

export type ChunkingOptions = {
  /** Maximum duration of one chunk in minutes. Default: 15. */
  maxMinutes?: number;
  /** Fallback duration per page in minutes. Default: 2. */
  minutesPerPage?: number;
  /** Narration speed used to convert tokens to minutes. Default: 200. */
  tokensPerMinute?: number;
  /** Total number of pages of the document (used to close the last heading). */
  totalPages?: number;
  /** Custom page range; only these pages are chunked. */
  pageRange?: PageRange;
  /** Ignore headings deeper than this level. */
  maxHeadingLevel?: number;
  /** Title of the content found before the first heading. Default: "Introduction". */
  introTitle?: string;
};

export type ChunkSection = {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  estimatedMinutes: number;
};

export type ContentChunk = {
  /** 1-based position of the chunk. */
  index: number;
  title: string;
  startPage: number;
  endPage: number;
  estimatedMinutes: number;
  sections: ChunkSection[];
  /** True only when a single page alone is longer than the maximum duration. */
  exceedsLimit: boolean;
};

const DEFAULT_MAX_MINUTES = 15;
const DEFAULT_MINUTES_PER_PAGE = 2;
const DEFAULT_TOKENS_PER_MINUTE = 200;
const EPSILON = 1e-9;

type ResolvedConfig = {
  maxMinutes: number;
  minutesPerPage: number;
  tokensPerMinute: number;
  totalPages: number | null;
  pageRange: PageRange | null;
  maxHeadingLevel: number | null;
  introTitle: string;
};

type RawSection = {
  id: string;
  title: string;
  startPage: number;
  endPage: number;
  minutes: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function resolveConfig(options: ChunkingOptions): ResolvedConfig {
  const maxMinutes = options.maxMinutes ?? DEFAULT_MAX_MINUTES;
  const minutesPerPage = options.minutesPerPage ?? DEFAULT_MINUTES_PER_PAGE;
  const tokensPerMinute = options.tokensPerMinute ?? DEFAULT_TOKENS_PER_MINUTE;

  if (!Number.isFinite(maxMinutes) || maxMinutes <= 0) {
    throw new RangeError("maxMinutes must be a number greater than 0");
  }
  if (!Number.isFinite(minutesPerPage) || minutesPerPage <= 0) {
    throw new RangeError("minutesPerPage must be a number greater than 0");
  }
  if (!Number.isFinite(tokensPerMinute) || tokensPerMinute <= 0) {
    throw new RangeError("tokensPerMinute must be a number greater than 0");
  }

  let totalPages: number | null = null;
  if (options.totalPages !== undefined) {
    if (!isPositiveInteger(options.totalPages)) {
      throw new RangeError("totalPages must be an integer greater than or equal to 1");
    }
    totalPages = options.totalPages;
  }

  let pageRange: PageRange | null = null;
  if (options.pageRange !== undefined) {
    const { startPage, endPage } = options.pageRange;
    if (!isPositiveInteger(startPage) || !isPositiveInteger(endPage)) {
      throw new RangeError("pageRange.startPage and pageRange.endPage must be integers >= 1");
    }
    if (startPage > endPage) {
      throw new RangeError("pageRange.startPage must be less than or equal to pageRange.endPage");
    }
    pageRange = { startPage, endPage };
  }

  return {
    maxMinutes,
    minutesPerPage,
    tokensPerMinute,
    totalPages,
    pageRange,
    maxHeadingLevel: options.maxHeadingLevel ?? null,
    introTitle: options.introTitle ?? "Introduction",
  };
}

function headingMinutes(heading: DocumentHeading, pageCount: number, config: ResolvedConfig): number {
  if (
    typeof heading.estimatedMinutes === "number" &&
    Number.isFinite(heading.estimatedMinutes) &&
    heading.estimatedMinutes >= 0
  ) {
    return heading.estimatedMinutes;
  }
  if (typeof heading.tokens === "number" && Number.isFinite(heading.tokens) && heading.tokens >= 0) {
    return heading.tokens / config.tokensPerMinute;
  }
  return pageCount * config.minutesPerPage;
}

function hasOwnDuration(heading: DocumentHeading): boolean {
  return heading.estimatedMinutes !== undefined || heading.tokens !== undefined;
}

/**
 * Turns the headings array into ordered, non-overlapping sections with a page
 * span and a duration, clipped to the requested page range.
 */
function buildSections(headings: readonly DocumentHeading[], config: ResolvedConfig): RawSection[] {
  const usable = headings
    .map((heading, originalIndex) => ({ heading, originalIndex }))
    .filter(({ heading }) => {
      if (!heading || typeof heading.title !== "string") return false;
      if (!isPositiveInteger(heading.startPage)) return false;
      if (
        heading.endPage !== undefined &&
        (!isPositiveInteger(heading.endPage) || heading.endPage < heading.startPage)
      ) {
        return false;
      }
      if (
        config.maxHeadingLevel !== null &&
        heading.level !== undefined &&
        heading.level > config.maxHeadingLevel
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.heading.startPage - b.heading.startPage || a.originalIndex - b.originalIndex);

  // Merge headings that start on the same page and have no explicit end page,
  // otherwise the same pages would be counted twice.
  const merged: { heading: DocumentHeading; originalIndex: number }[] = [];
  for (const entry of usable) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.heading.startPage === entry.heading.startPage &&
      previous.heading.endPage === undefined &&
      entry.heading.endPage === undefined
    ) {
      const combined: DocumentHeading = {
        ...previous.heading,
        title: `${previous.heading.title} / ${entry.heading.title}`,
      };
      if (!hasOwnDuration(previous.heading) && hasOwnDuration(entry.heading)) {
        if (entry.heading.estimatedMinutes !== undefined) {
          combined.estimatedMinutes = entry.heading.estimatedMinutes;
        }
        if (entry.heading.tokens !== undefined) {
          combined.tokens = entry.heading.tokens;
        }
      }
      merged[merged.length - 1] = { heading: combined, originalIndex: previous.originalIndex };
    } else {
      merged.push(entry);
    }
  }

  const rangeStart = config.pageRange ? config.pageRange.startPage : 1;
  const rangeEnd = config.pageRange ? config.pageRange.endPage : null;
  const documentEnd = config.totalPages ?? rangeEnd;
  const sections: RawSection[] = [];

  const firstEntry = merged[0];
  if (firstEntry && firstEntry.heading.startPage > rangeStart) {
    const introEnd = Math.min(firstEntry.heading.startPage - 1, rangeEnd ?? Number.POSITIVE_INFINITY);
    const introPages = introEnd - rangeStart + 1;
    if (introPages >= 1) {
      sections.push({
        id: "section-intro",
        title: config.introTitle,
        startPage: rangeStart,
        endPage: introEnd,
        minutes: introPages * config.minutesPerPage,
      });
    }
  }

  merged.forEach((entry, position) => {
    const { heading, originalIndex } = entry;
    const next = merged[position + 1];

    let fullEnd: number;
    if (heading.endPage !== undefined) {
      fullEnd = heading.endPage;
    } else if (next) {
      fullEnd = Math.max(heading.startPage, next.heading.startPage - 1);
    } else {
      fullEnd = Math.max(heading.startPage, documentEnd ?? heading.startPage);
    }

    const fullPages = fullEnd - heading.startPage + 1;
    const fullMinutes = headingMinutes(heading, fullPages, config);
    const perPage = fullMinutes / fullPages;

    const clippedStart = Math.max(heading.startPage, rangeStart);
    const clippedEnd = rangeEnd === null ? fullEnd : Math.min(fullEnd, rangeEnd);
    if (clippedStart > clippedEnd) return;

    sections.push({
      id: heading.id ?? `section-${originalIndex + 1}`,
      title: heading.title,
      startPage: clippedStart,
      endPage: clippedEnd,
      minutes: perPage * (clippedEnd - clippedStart + 1),
    });
  });

  if (sections.length === 0 && merged.length === 0) {
    const start = rangeStart;
    const end = rangeEnd ?? config.totalPages;
    if (end !== null && end >= start) {
      sections.push({
        id: "section-pages",
        title: start === end ? `Page ${start}` : `Pages ${start}-${end}`,
        startPage: start,
        endPage: end,
        minutes: (end - start + 1) * config.minutesPerPage,
      });
    }
  }

  return sections;
}

/** Splits sections longer than the limit into balanced page-based parts. */
function splitOversizedSections(sections: readonly RawSection[], maxMinutes: number): RawSection[] {
  const result: RawSection[] = [];

  for (const section of sections) {
    if (section.minutes <= maxMinutes + EPSILON) {
      result.push(section);
      continue;
    }

    const pageCount = section.endPage - section.startPage + 1;
    const perPage = section.minutes / pageCount;
    const maxPagesPerPart = Math.max(1, Math.floor((maxMinutes + EPSILON) / perPage));
    const partCount = Math.ceil(pageCount / maxPagesPerPart);
    const pagesPerPart = Math.ceil(pageCount / partCount);

    for (let part = 0; part < partCount; part += 1) {
      const partStart = section.startPage + part * pagesPerPart;
      const partEnd = Math.min(section.endPage, partStart + pagesPerPart - 1);
      if (partStart > section.endPage) break;

      result.push({
        id: `${section.id}-part-${part + 1}`,
        title: `${section.title} (${part + 1}/${partCount})`,
        startPage: partStart,
        endPage: partEnd,
        minutes: perPage * (partEnd - partStart + 1),
      });
    }
  }

  return result;
}

function toChunkSection(section: RawSection): ChunkSection {
  return {
    id: section.id,
    title: section.title,
    startPage: section.startPage,
    endPage: section.endPage,
    estimatedMinutes: round2(section.minutes),
  };
}

function finalizeChunk(index: number, sections: readonly RawSection[], maxMinutes: number): ContentChunk {
  const first = sections[0];
  const last = sections[sections.length - 1];
  if (!first || !last) {
    throw new Error("Cannot finalize an empty chunk");
  }

  const minutes = sections.reduce((sum, section) => sum + section.minutes, 0);
  const title = sections.length === 1 ? first.title : `${first.title} \u2192 ${last.title}`;

  return {
    index,
    title,
    startPage: first.startPage,
    endPage: last.endPage,
    estimatedMinutes: round2(minutes),
    sections: sections.map(toChunkSection),
    exceedsLimit: minutes > maxMinutes + EPSILON,
  };
}

/**
 * Splits the document into chunks of at most `maxMinutes` (15 by default).
 *
 * Headings are kept together whenever they fit; a heading longer than the limit
 * is split by pages. When `options.pageRange` is given, only that range is used.
 */
export function chunkDocument(
  headings: readonly DocumentHeading[],
  options: ChunkingOptions = {},
): ContentChunk[] {
  const config = resolveConfig(options);
  const sections = splitOversizedSections(buildSections(headings, config), config.maxMinutes);

  const chunks: ContentChunk[] = [];
  let current: RawSection[] = [];
  let currentMinutes = 0;

  for (const section of sections) {
    if (current.length > 0 && currentMinutes + section.minutes > config.maxMinutes + EPSILON) {
      chunks.push(finalizeChunk(chunks.length + 1, current, config.maxMinutes));
      current = [];
      currentMinutes = 0;
    }
    current.push(section);
    currentMinutes += section.minutes;
  }

  if (current.length > 0) {
    chunks.push(finalizeChunk(chunks.length + 1, current, config.maxMinutes));
  }

  return chunks;
}

/**
 * Chunks a custom page range directly, ignoring the document outline. Use when
 * the student picks "pages X to Y" instead of the full material.
 */
export function chunkByPageRange(
  startPage: number,
  endPage: number,
  options: Omit<ChunkingOptions, "pageRange"> = {},
): ContentChunk[] {
  return chunkDocument([], { ...options, pageRange: { startPage, endPage } });
}

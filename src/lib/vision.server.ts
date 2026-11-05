/**
 * Visual reading of source material. Server-only.
 *
 * Figures, diagrams, charts, handwritten formulas and scanned pages are read with
 * a multimodal model so their content becomes part of the lesson, questions and
 * videos instead of being dropped. The model may only describe what it sees; it is
 * never allowed to add outside knowledge.
 */
import { aiJsonWithFile, aiJsonWithImages, AiUnavailableError } from "./ai.server";

const VISION_SYSTEM = [
  "You read academic material visually and report ONLY what is actually visible.",
  "Absolute rules:",
  "1. Never add knowledge, definitions, values or steps that are not visible in the image or page.",
  "2. Transcribe formulas, symbols, units, axis labels and numbers exactly as shown.",
  "3. If an image is unreadable, blank, decorative or too low quality, mark it unreadable instead of guessing.",
  "4. Answer with raw JSON only, no prose, no markdown fences.",
].join("\n");

export type VisualReading = {
  index: number;
  kind: "figure" | "diagram" | "chart" | "table" | "formula" | "text" | "decorative";
  caption: string;
  description: string;
  transcription: string;
  formulas: string[];
  readable: boolean;
  confidence: number;
};

function langName(language: string) {
  return language === "en" ? "English" : "Arabic";
}

/** Reads a batch of images extracted from one source file. */
export async function readImages(
  images: { mime: string; base64: string }[],
  language: string,
): Promise<VisualReading[]> {
  if (images.length === 0) return [];

  const prompt = [
    `Describe each attached image in ${langName(language)}.`,
    "The images are numbered in the order attached, starting at 0.",
    "For each image report what a student must know from it: what it shows, how it is read,",
    "every label, every symbol and every formula visible in it, transcribed exactly.",
    "Mark decorative logos, page borders and unreadable scans as readable=false.",
    "",
    "Return JSON in this shape:",
    '{"images":[{"index":0,"kind":"figure","caption":"...","description":"...","transcription":"all visible text exactly","formulas":["..."],"readable":true,"confidence":0.9}]}',
  ].join("\n");

  try {
    const result = await aiJsonWithImages<{ images?: Partial<VisualReading>[] }>(
      VISION_SYSTEM,
      prompt,
      images,
    );
    return (result.images ?? []).map((item, i) => normalizeReading(item, i));
  } catch (cause) {
    if (cause instanceof AiUnavailableError) {
      console.error("[vision] image reading unavailable", cause.message);
      return [];
    }
    throw cause;
  }
}

export type PageReading = {
  page: number;
  text: string;
  figures: { caption: string; description: string; formulas: string[] }[];
};

/**
 * Reads a PDF visually: recovers text from scanned pages and inventories the
 * drawings, charts and equations that plain text extraction cannot see.
 */
export async function readPdfPages(
  bytes: ArrayBuffer,
  filename: string,
  language: string,
): Promise<PageReading[]> {
  const base64 = toBase64(bytes);
  const prompt = [
    `Read the attached PDF and report its visual content in ${langName(language)}.`,
    "For every page that contains a figure, diagram, chart, table, drawing or a formula shown as an image,",
    "report it with its caption and how it is read, transcribing every visible label and formula exactly.",
    "If a page has no machine-readable text (a scan or a photo), transcribe its text under `text`.",
    "Skip pages that hold nothing but ordinary paragraphs already readable as text.",
    "Never describe something that is not on the page.",
    "",
    "Return JSON in this shape:",
    '{"pages":[{"page":3,"text":"transcribed text if the page is a scan, else empty","figures":[{"caption":"...","description":"...","formulas":["..."]}]}]}',
  ].join("\n");

  try {
    const result = await aiJsonWithFile<{ pages?: unknown[] }>(VISION_SYSTEM, prompt, {
      filename,
      mime: "application/pdf",
      base64,
    });
    return (Array.isArray(result.pages) ? result.pages : [])
      .map((raw) => {
        const item = (raw ?? {}) as {
          page?: unknown;
          text?: unknown;
          figures?: unknown[];
        };
        const page = typeof item.page === "number" ? item.page : 0;
        const figures = (Array.isArray(item.figures) ? item.figures : []).map((f) => {
          const fig = (f ?? {}) as { caption?: unknown; description?: unknown; formulas?: unknown };
          return {
            caption: typeof fig.caption === "string" ? fig.caption : "",
            description: typeof fig.description === "string" ? fig.description : "",
            formulas: Array.isArray(fig.formulas)
              ? fig.formulas.filter((x): x is string => typeof x === "string")
              : [],
          };
        });
        return {
          page,
          text: typeof item.text === "string" ? item.text : "",
          figures,
        };
      })
      .filter((p) => p.page > 0 && (p.text.trim().length > 0 || p.figures.length > 0));
  } catch (cause) {
    if (cause instanceof AiUnavailableError) {
      console.error("[vision] pdf reading unavailable", cause.message);
      return [];
    }
    throw cause;
  }
}

function normalizeReading(item: Partial<VisualReading>, fallbackIndex: number): VisualReading {
  const kinds: VisualReading["kind"][] = [
    "figure",
    "diagram",
    "chart",
    "table",
    "formula",
    "text",
    "decorative",
  ];
  return {
    index: typeof item.index === "number" ? item.index : fallbackIndex,
    kind: kinds.includes(item.kind as VisualReading["kind"])
      ? (item.kind as VisualReading["kind"])
      : "figure",
    caption: typeof item.caption === "string" ? item.caption : "",
    description: typeof item.description === "string" ? item.description : "",
    transcription: typeof item.transcription === "string" ? item.transcription : "",
    formulas: Array.isArray(item.formulas)
      ? item.formulas.filter((x): x is string => typeof x === "string")
      : [],
    readable: item.readable !== false,
    confidence:
      typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.6,
  };
}

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

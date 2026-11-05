/**
 * AI Service abstraction (provider-agnostic). Server-only.
 * Every prompt is source-bound: the model may only use the supplied blocks and
 * must cite the block ids it used, so unsupported output can be rejected.
 *
 * The provider is fully configuration-driven — swapping it is a config
 * change, not a code change:
 *
 *   AI_GATEWAY_URL  - full chat-completions endpoint URL
 *   AI_API_KEY      - bearer token for that endpoint
 *   AI_MODEL        - model name/string that endpoint expects
 *
 * Any endpoint that speaks the OpenAI "chat completions" wire format works.
 * See .env.example for ready-to-use values for OpenRouter (also accepts a
 * whole PDF as a "file" part, like aiJsonWithFile below), OpenAI directly, or
 * any other OpenAI-compatible endpoint (Groq, self-hosted, ...).
 */

export class AiUnavailableError extends Error {}

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-job usage collector. Wrap work in `runWithAiUsage` and every gateway call
 * made inside it (including parallel ones) adds its token usage here, so the
 * cost of each call can be logged per user and settled against credits.
 */
export type AiUsageCollector = {
  calls: { model: string; promptTokens: number; completionTokens: number; at: number }[];
};
const usageStore = new AsyncLocalStorage<AiUsageCollector>();

export function runWithAiUsage<T>(collector: AiUsageCollector, fn: () => Promise<T>): Promise<T> {
  return usageStore.run(collector, fn);
}

export function totalAiTokens(collector: AiUsageCollector): { prompt: number; completion: number; total: number } {
  const prompt = collector.calls.reduce((a, c) => a + c.promptTokens, 0);
  const completion = collector.calls.reduce((a, c) => a + c.completionTokens, 0);
  return { prompt, completion, total: prompt + completion };
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1]! : trimmed;
  const start = body.search(/[[{]/);
  if (start < 0) return body;
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  return body.slice(start, end + 1);
}

export type AiPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { filename: string; file_data: string } };


/** Raw gateway call. `content` is either plain text or multimodal parts. */
async function chat(system: string, content: string | AiPart[]): Promise<string> {
  const gateway = process.env["AI_GATEWAY_URL"];
  const model = process.env["AI_MODEL"];
  const key = process.env["AI_API_KEY"];
  if (!gateway) throw new AiUnavailableError("AI_GATEWAY_URL is not configured");
  if (!model) throw new AiUnavailableError("AI_MODEL is not configured");
  if (!key) throw new AiUnavailableError("AI_API_KEY is not configured");

  // Real retry with exponential backoff for transient failures (429 / 5xx / network).
  let response: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(gateway, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: system },
            { role: "user", content },
          ],
        }),
      });
    } catch (networkError) {
      if (attempt === 2) throw new AiUnavailableError("GATEWAY_ERROR");
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      continue;
    }
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }
  if (!response) throw new AiUnavailableError("GATEWAY_ERROR");

  if (response.status === 429) throw new AiUnavailableError("RATE_LIMIT");
  if (response.status === 402) throw new AiUnavailableError("CREDITS_REQUIRED");
  if (!response.ok) {
    const detail = await response.text();
    console.error("[ai] gateway error", response.status, detail.slice(0, 500));
    throw new AiUnavailableError("GATEWAY_ERROR");
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const collector = usageStore.getStore();
  if (collector) {
    collector.calls.push({
      model,
      promptTokens: payload.usage?.prompt_tokens ?? 0,
      completionTokens: payload.usage?.completion_tokens ?? 0,
      at: Date.now(),
    });
  }
  const text = payload.choices?.[0]?.message?.content;
  if (!text) throw new AiUnavailableError("EMPTY_RESPONSE");
  return text;
}

function parseJson<T>(content: string): T {
  try {
    return JSON.parse(stripFence(content)) as T;
  } catch {
    console.error("[ai] unparsable response", content.slice(0, 500));
    throw new AiUnavailableError("UNPARSABLE_RESPONSE");
  }
}

export async function aiJson<T>(system: string, user: string): Promise<T> {
  return parseJson<T>(await chat(system, user));
}

/** JSON answer for a request that includes images (figures, diagrams, scanned pages). */
export async function aiJsonWithImages<T>(
  system: string,
  text: string,
  images: { mime: string; base64: string }[],
): Promise<T> {
  const parts: AiPart[] = [
    { type: "text", text },
    ...images.map((image) => ({
      type: "image_url" as const,
      image_url: { url: `data:${image.mime};base64,${image.base64}` },
    })),
  ];
  return parseJson<T>(await chat(system, parts));
}

/** JSON answer for a request that includes a whole document file (PDF figure reading). */
export async function aiJsonWithFile<T>(
  system: string,
  text: string,
  file: { filename: string; mime: string; base64: string },
): Promise<T> {
  const parts: AiPart[] = [
    { type: "text", text },
    {
      type: "file",
      file: { filename: file.filename, file_data: `data:${file.mime};base64,${file.base64}` },
    },
  ];
  return parseJson<T>(await chat(system, parts));
}




export const SOURCE_BOUND_SYSTEM = [
  "You build study material strictly from the supplied source blocks of one single course.",
  "Absolute rules:",
  "1. Use ONLY the supplied blocks. Never add outside knowledge, examples, or definitions.",
  "2. Every generated item must list the block ids (integers) it is derived from in a `refs` array. Items without refs are invalid.",
  "3. Preserve the terminology, notation and solution methods exactly as written in the source. Do not substitute an alternative method.",
  "4. Keep the language of the source material.",
  "5. Answer with raw JSON only, no prose, no markdown fences.",
].join("\n");

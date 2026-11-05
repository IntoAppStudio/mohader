/**
 * Semantic support check using embeddings (optional; used only when configured).
 *   EMBEDDINGS_GATEWAY_URL  - OpenAI-compatible /embeddings endpoint
 *   EMBEDDINGS_API_KEY      - bearer token
 *   EMBEDDINGS_MODEL        - model name
 * Returns the best cosine similarity between a claim and any source sentence,
 * or null when embeddings are not configured / fail (callers then keep the
 * lexical verdict).
 */

function configured() {
  const url = process.env["EMBEDDINGS_GATEWAY_URL"];
  const key = process.env["EMBEDDINGS_API_KEY"];
  const model = process.env["EMBEDDINGS_MODEL"];
  return url && key && model ? { url, key, model } : null;
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

async function embed(inputs: string[]): Promise<number[][] | null> {
  const cfg = configured();
  if (!cfg) return null;
  try {
    const response = await fetch(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ model: cfg.model, input: inputs }),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: { embedding?: number[]; index?: number }[] };
    const rows = [...(payload.data ?? [])].sort((x, y) => (x.index ?? 0) - (y.index ?? 0));
    const vectors = rows.map((r) => r.embedding ?? []);
    return vectors.length === inputs.length ? vectors : null;
  } catch (error) {
    console.error("[semantic] embeddings failed", error);
    return null;
  }
}

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟؛])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 12)
    .slice(0, 40);
}

export async function semanticSupportScore(claim: string, sourceText: string): Promise<number | null> {
  const src = sentences(sourceText);
  if (src.length === 0 || claim.trim().length < 8) return null;
  const vectors = await embed([claim, ...src]);
  if (!vectors) return null;
  const [claimVec, ...srcVecs] = vectors;
  if (!claimVec) return null;
  return srcVecs.reduce((best, v) => Math.max(best, cosine(claimVec, v)), 0);
}

export const SEMANTIC_SUPPORTED_AT = 0.78;
export const SEMANTIC_UNSUPPORTED_BELOW = 0.4;

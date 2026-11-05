/**
 * Content-hash cache for AI calls. Identical (system prompt + user prompt)
 * input is never paid for twice: the response is stored under a SHA-256 key.
 * Server-only; table is service-role only (see migration).
 */
import { createHash } from "node:crypto";
import { aiJson } from "./ai.server";
import { asAnyDb } from "./untypedDb.server";

export function hashContent(...parts: string[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    h.update(p, "utf8");
    h.update("\u0000");
  }
  return h.digest("hex");
}

type AdminLike = unknown;

/** Same contract as aiJson, but consults/fills the cache. Cache problems never break a call. */
export async function aiJsonCached<T>(
  admin: AdminLike,
  kind: string,
  system: string,
  user: string,
  options: { userId?: string; onHit?: () => void } = {},
): Promise<{ value: T; cacheHit: boolean }> {
  const db = asAnyDb(admin);
  // Scoped per user: one student's material is never served from, or kept for, another student.
  const key = hashContent(kind, options.userId ?? "", process.env["AI_MODEL"] ?? "", system, user);
  try {
    const { data } = await db.from("ai_cache").select("response, hits").eq("cache_key", key).maybeSingle();
    if (data?.response) {
      void db
        .from("ai_cache")
        .update({ hits: (data.hits ?? 0) + 1, last_hit_at: new Date().toISOString() })
        .eq("cache_key", key);
      options.onHit?.();
      return { value: data.response as T, cacheHit: true };
    }
  } catch (cacheError) {
    console.error("[ai-cache] read failed, continuing without cache", cacheError);
  }

  const value = await aiJson<T>(system, user);

  try {
    await db.from("ai_cache").upsert({ cache_key: key, user_id: options.userId ?? null, kind, response: value as unknown }, { onConflict: "cache_key" });
  } catch (cacheError) {
    console.error("[ai-cache] write failed", cacheError);
  }
  return { value, cacheHit: false };
}

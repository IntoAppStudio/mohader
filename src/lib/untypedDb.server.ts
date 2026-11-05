/**
 * Loose-typed access to tables added by migration 20261030090000, which are not
 * yet present in the generated src/integrations/supabase/types.ts. Once types
 * are regenerated (`supabase gen types`) these casts can be removed.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDb = SupabaseClient<any, "public", any>;

export function asAnyDb(client: unknown): AnyDb {
  return client as AnyDb;
}

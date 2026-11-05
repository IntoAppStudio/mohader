import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Public plan/flag catalogue. Readable without a session (anon SELECT policy). */
export const getPublicConfig = createServerFn({ method: "GET" }).handler(async () => {
  const supabasePublic = createClient<Database>(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"]!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );

  const [plans, flags] = await Promise.all([
    supabasePublic
      .from("plans")
      .select("id, name_ar, name_en, price_monthly, price_yearly, currency, limits, position")
      .eq("is_active", true)
      .order("position", { ascending: true }),
    supabasePublic.from("feature_flags").select("key, enabled"),
  ]);

  return {
    plans: plans.data ?? [],
    flags: Object.fromEntries((flags.data ?? []).map((f) => [f.key, f.enabled])) as Record<
      string,
      boolean
    >,
  };
});

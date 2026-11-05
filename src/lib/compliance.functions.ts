import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCompliance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { asAnyDb } = await import("./untypedDb.server");
    const { TERMS_VERSION } = await import("./compliance");
    const { data } = await asAnyDb(supabase).from("user_compliance").select("*").eq("user_id", userId).maybeSingle();
    return { compliance: data ?? null, currentTermsVersion: TERMS_VERSION, needsAcceptance: !data || data.terms_version !== TERMS_VERSION };
  });

export const acceptTerms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { birthYear: number; country?: string; copyrightDeclared: boolean; guardianEmail?: string; retentionDays?: number }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.copyrightDeclared) throw new Error("COPYRIGHT_DECLARATION_REQUIRED");
    const { isMinor, TERMS_VERSION } = await import("./compliance");
    const { asAnyDb } = await import("./untypedDb.server");
    const minor = isMinor(Number(data.birthYear), data.country);
    const now = new Date().toISOString();
    const retention = Math.min(3650, Math.max(30, Math.round(data.retentionDays ?? 365)));
    const { error } = await asAnyDb(supabase).from("user_compliance").upsert(
      {
        user_id: userId,
        terms_version: TERMS_VERSION,
        terms_accepted_at: now,
        copyright_declared_at: now,
        birth_year: Number(data.birthYear),
        is_minor: minor,
        guardian_email: minor ? (data.guardianEmail ?? null) : null,
        retention_days: retention,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error("COMPLIANCE_SAVE_FAILED");
    return { ok: true, isMinor: minor, needsGuardianConsent: minor };
  });

/** Guardian confirmation (called from a link emailed to the guardian; here the signed-in user relays it after verification). */
export const confirmGuardianConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { guardianEmail: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { asAnyDb } = await import("./untypedDb.server");
    const { data: row } = await asAnyDb(supabase).from("user_compliance").select("guardian_email, is_minor").eq("user_id", userId).maybeSingle();
    if (!row?.is_minor) return { ok: true };
    if (!row.guardian_email || row.guardian_email.toLowerCase() !== data.guardianEmail.toLowerCase()) throw new Error("GUARDIAN_MISMATCH");
    await asAnyDb(supabase).from("user_compliance").update({ guardian_consent_at: new Date().toISOString() }).eq("user_id", userId);
    return { ok: true };
  });

/** Deletes the user's uploaded originals immediately (right to erasure for sources). */
export const deleteMyUploads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: files } = await supabase.from("files").select("id, storage_path");
    const paths = (files ?? []).map((f) => f.storage_path);
    if (paths.length) await supabase.storage.from("sources").remove(paths);
    await supabase.from("files").delete().in("id", (files ?? []).map((f) => f.id));
    return { deleted: paths.length };
  });

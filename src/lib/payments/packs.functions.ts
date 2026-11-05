import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** One-time exam packs with the price for the visitor's country (local currency + providers). */
export const listCreditPacks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { country?: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { pickPrice } = await import("./pricing");
    const db = supabase as unknown as {
      from: (t: string) => { select: (c: string) => { eq?: (k: string, v: unknown) => unknown } & PromiseLike<{ data: unknown[] | null }> };
    };
    const { data: packs } = (await db.from("credit_packs").select("*")) as { data: { id: string; name_ar: string; name_en: string; credits: number; valid_days: number; price_usd: number; is_active: boolean; position: number }[] | null };
    const { data: prices } = (await db.from("regional_prices").select("*")) as { data: { country: string; item_id: string; currency: string; amount: number; providers: string[] }[] | null };
    return {
      packs: (packs ?? [])
        .filter((p) => p.is_active)
        .sort((a, b) => a.position - b.position)
        .map((p) => ({ ...p, price: pickPrice(prices ?? [], data.country, p.id, Number(p.price_usd)) })),
    };
  });

/** Starts a one-time pack purchase and returns the hosted payment URL. */
export const startPackCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { packId: string; country?: string }) => data)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { asAnyDb } = await import("../untypedDb.server");
    const db = asAnyDb(supabaseAdmin);
    const { pickPrice } = await import("./pricing");
    const { createMoyasarInvoice } = await import("./moyasar.server");

    const { data: pack } = await db.from("credit_packs").select("*").eq("id", data.packId).eq("is_active", true).maybeSingle();
    if (!pack) throw new Error("PACK_NOT_FOUND");
    const { data: prices } = await db.from("regional_prices").select("*").eq("item_id", pack.id);
    const price = pickPrice(prices ?? [], data.country, pack.id, Number(pack.price_usd));
    if (!price.isLocal) throw new Error("LOCAL_PRICE_UNAVAILABLE"); // USD/card packs go through Paddle checkout

    const base = (process.env["APP_BASE_URL"] ?? "").replace(/\/$/, "");
    const { data: purchase, error } = await db
      .from("one_time_purchases")
      .insert({ user_id: userId, pack_id: pack.id, provider: "moyasar", amount: price.amount, currency: price.currency, status: "PENDING", expires_at: new Date(Date.now() + pack.valid_days * 86_400_000).toISOString() })
      .select("id")
      .single();
    if (error || !purchase) throw new Error("PURCHASE_CREATE_FAILED");

    const invoice = await createMoyasarInvoice({
      amount: price.amount,
      currency: price.currency,
      description: pack.name_ar,
      successUrl: `${base}/dashboard?pack=success`,
      callbackUrl: `${base}/api/moyasar-webhook`,
      metadata: { purchase_id: purchase.id, user_id: userId, pack_id: pack.id },
    });
    await db.from("one_time_purchases").update({ provider_ref: invoice.id }).eq("id", purchase.id);
    return { url: invoice.url };
  });

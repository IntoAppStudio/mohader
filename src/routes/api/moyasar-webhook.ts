// Moyasar payment callback for one-time exam packs. The body is never trusted:
// the invoice is re-fetched from Moyasar and the amount/metadata are checked against our own row.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { asAnyDb } from "@/lib/untypedDb.server";
import { fetchMoyasarInvoice } from "@/lib/payments/moyasar.server";
import { toMinorUnits } from "@/lib/payments/pricing";

export const Route = createFileRoute("/api/moyasar-webhook")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        try {
          const secret = process.env["MOYASAR_WEBHOOK_SECRET"];
          const body = (await request.json()) as { id?: string; secret_token?: string; data?: { id?: string }; invoice_id?: string };
          if (!secret || body.secret_token !== secret) return new Response("Unauthorized", { status: 401 });

          const invoiceId = body.invoice_id ?? body.data?.id ?? body.id;
          if (!invoiceId) return new Response("Bad request", { status: 400 });
          const invoice = await fetchMoyasarInvoice(invoiceId);
          if (!invoice) return new Response("Invoice not found", { status: 404 });

          const db = asAnyDb(supabaseAdmin);
          const { data: purchase } = await db.from("one_time_purchases").select("*").eq("provider", "moyasar").eq("provider_ref", invoiceId).maybeSingle();
          if (!purchase) return new Response("Unknown purchase", { status: 404 });
          if (purchase.status === "PAID") return new Response("ok", { status: 200 }); // idempotent

          const expectedMinor = toMinorUnits(Number(purchase.amount), String(purchase.currency));
          if (invoice.status === "paid" && invoice.amount === expectedMinor && invoice.currency.toUpperCase() === String(purchase.currency).toUpperCase()) {
            const { data: claimed } = await db.from("one_time_purchases").update({ status: "PAID" }).eq("id", purchase.id).neq("status", "PAID").select("id");
            if (!claimed || claimed.length === 0) return new Response("ok", { status: 200 }); // already granted by a parallel delivery
            const { data: pack } = await db.from("credit_packs").select("credits").eq("id", purchase.pack_id).maybeSingle();
            await db.rpc("grant_pack_credits", { p_user: purchase.user_id, p_credits: pack?.credits ?? 0, p_expires: purchase.expires_at });
            await db.from("notifications").insert({ user_id: purchase.user_id, kind: "PACK_PAID", title: "تم تفعيل باقة الامتحان", body: "أُضيفت نقاط الباقة إلى رصيدك." });
          } else if (["failed", "canceled", "expired"].includes(invoice.status)) {
            await db.from("one_time_purchases").update({ status: "FAILED" }).eq("id", purchase.id);
          }
          return new Response("ok", { status: 200 });
        } catch (error) {
          console.error("[moyasar] webhook failed", error);
          return new Response("error", { status: 500 });
        }
      },
    },
  },
});

/**
 * Paddle webhook handling — signature verification, idempotency, and the
 * actual subscription upsert. Kept as plain functions (not tied to any
 * specific route syntax) for the same reason as jobs.server.ts's
 * retryStuckJobs: this logic is certain, the exact TanStack Start file-based
 * API-route wiring for exposing it at a real HTTP path is not (see the
 * final report) — wiring it up needs a route.ts file that calls
 * handlePaddleWebhook with the raw request.
 *
 * NOT included here: the checkout-creation flow (the part that starts a
 * Paddle checkout and passes custom_data.user_id). This module only handles
 * what Paddle sends back afterwards.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PRICE_TO_PLAN: Record<string, string> = {
  [process.env["PADDLE_PRICE_STUDENT"] || ""]: "student",
  [process.env["PADDLE_PRICE_PRO"] || ""]: "pro",
};

async function verifySignature(rawBody: string, header: string | null, secret: string): Promise<boolean> {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(";").map((p) => p.split("=") as [string, string]));
  const ts = parts["ts"];
  const h1 = parts["h1"];
  if (!ts || !h1) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signatureBytes = new Uint8Array(h1.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? []);
    return await crypto.subtle.verify("HMAC", key, signatureBytes, encoder.encode(`${ts}:${rawBody}`));
  } catch (err) {
    console.error("[paddle-webhook] signature verification error", err);
    return false;
  }
}

export class WebhookAuthError extends Error {}

/** Verifies the signature and processes one Paddle event. Returns 'duplicate' if
 * this exact event_id was already handled (Paddle retries are expected, not an error). */
export async function handlePaddleWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Promise<{ status: "processed" | "duplicate" | "ignored" }> {
  const secret = process.env["PADDLE_WEBHOOK_SECRET"];
  if (!secret) throw new Error("PADDLE_WEBHOOK_SECRET is not configured");
  if (!(await verifySignature(rawBody, signatureHeader, secret))) {
    throw new WebhookAuthError("INVALID_SIGNATURE");
  }

  const event = JSON.parse(rawBody) as {
    event_id: string;
    event_type: string;
    data: {
      id?: string;
      custom_data?: { user_id?: string };
      status?: string;
      items?: { price?: { id?: string } }[];
      current_billing_period?: { ends_at?: string };
      scheduled_change?: { action?: string } | null;
    };
  };

  // Idempotency: insert-or-conflict on (provider, event_id). If the row
  // already existed, this is a retry of an event we already processed.
  const { error: ledgerError } = await supabaseAdmin
    .from("processed_webhook_events")
    .insert({ provider: "paddle", event_id: event.event_id });
  if (ledgerError) {
    if (ledgerError.code === "23505") return { status: "duplicate" }; // unique_violation
    throw ledgerError;
  }

  const userId = event.data.custom_data?.user_id;
  if (!userId) return { status: "ignored" };

  if (event.event_type === "subscription.created" || event.event_type === "subscription.updated") {
    const priceId = event.data.items?.[0]?.price?.id;
    const planId = priceId ? PRICE_TO_PLAN[priceId] : undefined;
    if (!planId) return { status: "ignored" };

    // src/lib/quota.server.ts's getPlanLimits() checks subscriptions.status against
    // a lowercase set (active/trialing/past_due/grace) — match it exactly, or a
    // real paid subscription silently never grants its plan's limits.
    const paddleStatus = event.data.status;
    const status =
      paddleStatus === "active" || paddleStatus === "trialing" || paddleStatus === "past_due"
        ? paddleStatus
        : "canceled";

    await supabaseAdmin.from("subscriptions").upsert(
      {
        user_id: userId,
        plan_id: planId,
        status,
        provider: "PADDLE",
        provider_ref: event.data.id ?? null,
        current_period_end: event.data.current_billing_period?.ends_at ?? null,
        cancel_at_period_end: event.data.scheduled_change?.action === "cancel",
      },
      { onConflict: "user_id" },
    );
    return { status: "processed" };
  }

  if (event.event_type === "subscription.canceled") {
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "canceled", plan_id: "free" })
      .eq("user_id", userId);
    return { status: "processed" };
  }

  return { status: "ignored" };
}

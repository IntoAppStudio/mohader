/**
 * Moyasar adapter (hosted invoice -> customer pays with mada / STC Pay / Apple Pay / card).
 * https://docs.moyasar.com  (Basic auth: secret key as username, empty password).
 * Only used when MOYASAR_SECRET_KEY is configured; Paddle keeps working untouched.
 */
import { toMinorUnits } from "./pricing";

export class PaymentUnavailableError extends Error {}

export async function createMoyasarInvoice(input: {
  amount: number;
  currency: string;
  description: string;
  successUrl: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}): Promise<{ id: string; url: string }> {
  const key = process.env["MOYASAR_SECRET_KEY"];
  if (!key) throw new PaymentUnavailableError("MOYASAR_SECRET_KEY is not configured");

  const response = await fetch("https://api.moyasar.com/v1/invoices", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
    },
    body: JSON.stringify({
      amount: toMinorUnits(input.amount, input.currency),
      currency: input.currency,
      description: input.description,
      success_url: input.successUrl,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
    }),
  });
  if (!response.ok) {
    console.error("[moyasar] invoice failed", response.status, (await response.text()).slice(0, 300));
    throw new PaymentUnavailableError("GATEWAY_ERROR");
  }
  const payload = (await response.json()) as { id?: string; url?: string };
  if (!payload.id || !payload.url) throw new PaymentUnavailableError("BAD_RESPONSE");
  return { id: payload.id, url: payload.url };
}

/** Re-reads the invoice from Moyasar (never trust the webhook body alone) and returns its status/metadata. */
export async function fetchMoyasarInvoice(id: string): Promise<{ status: string; amount: number; currency: string; metadata: Record<string, string> } | null> {
  const key = process.env["MOYASAR_SECRET_KEY"];
  if (!key) return null;
  const response = await fetch(`https://api.moyasar.com/v1/invoices/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}` },
  });
  if (!response.ok) return null;
  const p = (await response.json()) as { status?: string; amount?: number; currency?: string; metadata?: Record<string, string> };
  return { status: p.status ?? "", amount: p.amount ?? 0, currency: p.currency ?? "", metadata: p.metadata ?? {} };
}

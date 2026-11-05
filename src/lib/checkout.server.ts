/**
 * Starts a Paddle checkout for the calling (authenticated) user. Pairs with
 * src/lib/paddle-webhook.server.ts, which handles what Paddle sends back
 * afterwards. Kept as a plain function for the same reason as the other
 * *.server.ts modules meant to sit behind a raw API route — see the final
 * report for the one open question (exact API-route file syntax).
 */

import { authenticateApiRequest } from "@/integrations/supabase/auth-middleware";

const PLAN_PRICES: Record<string, string | undefined> = {
  student: process.env["PADDLE_PRICE_STUDENT"],
  pro: process.env["PADDLE_PRICE_PRO"],
};

export async function createCheckout(request: Request): Promise<Response> {
  let userId: string;
  try {
    ({ userId } = await authenticateApiRequest(request));
  } catch {
    return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 });
  }

  let planTier: unknown;
  try {
    ({ planTier } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: "INVALID_BODY" }), { status: 400 });
  }

  const priceId = typeof planTier === "string" ? PLAN_PRICES[planTier] : undefined;
  if (!priceId) return new Response(JSON.stringify({ error: "INVALID_PLAN" }), { status: 400 });

  const apiKey = process.env["PADDLE_API_KEY"];
  if (!apiKey) return new Response(JSON.stringify({ error: "PAYMENTS_NOT_CONFIGURED" }), { status: 503 });

  try {
    const response = await fetch(`${process.env["PADDLE_API_URL"] || "https://api.paddle.com"}/transactions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        items: [{ price_id: priceId, quantity: 1 }],
        // read by src/lib/paddle-webhook.server.ts to know which app user this is
        custom_data: { user_id: userId },
      }),
    });
    const data = (await response.json()) as { data?: { id?: string; checkout?: { url?: string } }; error?: { detail?: string } };
    if (!response.ok) throw new Error(data.error?.detail || "PADDLE_ERROR");

    const checkoutUrl = data.data?.checkout?.url;
    if (!checkoutUrl) throw new Error("NO_CHECKOUT_URL");
    return new Response(JSON.stringify({ checkoutUrl }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (error) {
    console.error("[checkout] Paddle transaction creation failed", error);
    return new Response(JSON.stringify({ error: "CHECKOUT_FAILED" }), { status: 500 });
  }
}

/**
 * Country-based pricing (pure, unit-tested). Prices come from the
 * `regional_prices` table; this module only chooses and formats them.
 * Why it exists: Paddle's fixed 5% + $0.50 is ~12% of a $7 plan and card-centric;
 * local gateways (mada, STC Pay, wallets) have lower fees and higher approval in the region.
 */

export type RegionalPrice = { country: string; item_id: string; currency: string; amount: number; providers: string[] };

export const DEFAULT_CURRENCY = "USD";

export function pickPrice(
  prices: readonly RegionalPrice[],
  country: string | null | undefined,
  itemId: string,
  fallbackUsd: number,
): { currency: string; amount: number; providers: string[]; isLocal: boolean } {
  const code = (country ?? "").toUpperCase();
  const local = prices.find((p) => p.country === code && p.item_id === itemId);
  if (local) return { currency: local.currency, amount: Number(local.amount), providers: [...local.providers], isLocal: true };
  return { currency: DEFAULT_CURRENCY, amount: fallbackUsd, providers: ["card"], isLocal: false };
}

/** Smallest currency unit (halalas, piasters, fils) as required by most local gateways. */
export function toMinorUnits(amount: number, currency: string): number {
  const threeDecimals = new Set(["KWD", "BHD", "OMR", "JOD", "TND"]);
  const factor = threeDecimals.has(currency.toUpperCase()) ? 1000 : 100;
  return Math.round(amount * factor);
}

/** Estimated gateway fee share, to compare providers in admin dashboards. */
export function paddleFeeShare(amountUsd: number): number {
  return amountUsd > 0 ? (amountUsd * 0.05 + 0.5) / amountUsd : 0;
}

/**
 * Credits calculator: document cost estimation and wallet usage alerting.
 *
 * Pure module (no server or browser dependencies) so it can be used from
 * server functions as well as from client components.
 */

export type CreditTier = {
  /** Inclusive upper bound of the tier in tokens (Infinity for the last tier). */
  maxTokensInclusive: number;
  credits: number;
};

/**
 * Tier table.
 *  - fewer than 10,000 tokens            -> 10 credits
 *  - 10,000 up to 50,000 tokens          -> 25 credits
 *  - 50,000 up to 200,000 tokens         -> 60 credits
 *  - more than 200,000 tokens            -> 100 credits
 *
 * Boundary rule: "fewer than" and "more than" are strict, so exactly 10,000
 * falls in the 25-credit tier and exactly 200,000 stays in the 60-credit tier.
 * Exactly 50,000 stays in the 25-credit tier (upper bounds are inclusive).
 */
export const CREDIT_TIERS: readonly CreditTier[] = [
  { maxTokensInclusive: 9_999, credits: 10 },
  { maxTokensInclusive: 50_000, credits: 25 },
  { maxTokensInclusive: 200_000, credits: 60 },
  { maxTokensInclusive: Number.POSITIVE_INFINITY, credits: 100 },
];

/** Wallet usage ratio above which the warning must be shown (80%). */
export const WALLET_WARNING_THRESHOLD_PERCENT = 80;

/**
 * Estimates the number of credits a document will consume based on the
 * number of tokens extracted from the uploaded file.
 */
export async function estimateDocumentCredits(fileTokens: number): Promise<number> {
  if (typeof fileTokens !== "number" || !Number.isFinite(fileTokens) || fileTokens < 0) {
    throw new RangeError("fileTokens must be a finite number greater than or equal to 0");
  }

  const tokens = Math.floor(fileTokens);

  for (const tier of CREDIT_TIERS) {
    if (tokens <= tier.maxTokensInclusive) {
      return tier.credits;
    }
  }

  const lastTier = CREDIT_TIERS[CREDIT_TIERS.length - 1];
  return lastTier ? lastTier.credits : 100;
}

export type WalletUsageInput = {
  /** Total credits granted to the wallet for the current period. */
  totalCredits: number;
  /** Credits already consumed in the current period. */
  usedCredits: number;
  /** Credits the pending operation is about to consume (defaults to 0). */
  pendingCredits?: number;
};

function assertNonNegativeFinite(name: string, value: number): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite number greater than or equal to 0`);
  }
}

/**
 * Returns the wallet consumption percentage (0 to 100, capped at 100) after
 * applying the pending operation. A wallet with no credits is considered fully
 * consumed.
 */
export function calculateWalletUsagePercent(input: WalletUsageInput): number {
  const { totalCredits, usedCredits } = input;
  const pendingCredits = input.pendingCredits ?? 0;

  assertNonNegativeFinite("totalCredits", totalCredits);
  assertNonNegativeFinite("usedCredits", usedCredits);
  assertNonNegativeFinite("pendingCredits", pendingCredits);

  if (totalCredits === 0) return 100;

  const percent = ((usedCredits + pendingCredits) / totalCredits) * 100;
  return Math.min(100, percent);
}

/**
 * Returns true when wallet consumption exceeds 80%, meaning the low-balance
 * warning must be displayed.
 */
export function shouldShowWalletWarning(input: WalletUsageInput): boolean {
  return calculateWalletUsagePercent(input) > WALLET_WARNING_THRESHOLD_PERCENT;
}

/**
 * Convenience helper: estimates a document's credits and checks whether
 * processing it would push the wallet over the warning threshold.
 */
export async function evaluateDocumentAgainstWallet(
  fileTokens: number,
  wallet: { totalCredits: number; usedCredits: number },
): Promise<{
  estimatedCredits: number;
  usagePercentAfter: number;
  showWarning: boolean;
  canAfford: boolean;
}> {
  const estimatedCredits = await estimateDocumentCredits(fileTokens);
  const input: WalletUsageInput = {
    totalCredits: wallet.totalCredits,
    usedCredits: wallet.usedCredits,
    pendingCredits: estimatedCredits,
  };

  return {
    estimatedCredits,
    usagePercentAfter: calculateWalletUsagePercent(input),
    showWarning: shouldShowWalletWarning(input),
    canAfford: wallet.usedCredits + estimatedCredits <= wallet.totalCredits,
  };
}

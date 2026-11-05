/**
 * Credits: estimate before processing, reserve, charge actual token usage,
 * warn at 80%, and log the cost of every AI call per user.
 * Builds on the pure calculator in ./creditsCalculator.
 */
import type { AiUsageCollector } from "./ai.server";
import { totalAiTokens } from "./ai.server";
import { calculateWalletUsagePercent, estimateDocumentCredits, WALLET_WARNING_THRESHOLD_PERCENT } from "./creditsCalculator";
import { asAnyDb } from "./untypedDb.server";

/** Credits charged per 1,000 tokens of real usage (override with CREDITS_PER_1K_TOKENS). */
export function creditsPerThousandTokens(): number {
  const raw = Number(process.env["CREDITS_PER_1K_TOKENS"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.5;
}

export function creditsForTokens(tokens: number): number {
  return Math.ceil((Math.max(0, tokens) / 1000) * creditsPerThousandTokens());
}

/** Rough token estimate (chars/3.5 is a safe bound for Arabic+English mixed text). */
export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 3.5);
}

export type WalletSnapshot = { total: number; used: number; reserved: number; percent: number; warning: boolean };

/** Ensures a wallet row exists, seeded from the plan (monthly allowance), and rolls the period. */
export async function ensureWallet(admin: unknown, userId: string, monthlyCredits: number): Promise<WalletSnapshot> {
  const db = asAnyDb(admin);
  const periodStart = new Date();
  periodStart.setUTCDate(1);
  periodStart.setUTCHours(0, 0, 0, 0);

  const { data: existing } = await db.from("credit_wallets").select("*").eq("user_id", userId).maybeSingle();
  if (!existing) {
    await db.from("credit_wallets").insert({
      user_id: userId,
      period_start: periodStart.toISOString(),
      total_credits: monthlyCredits,
    });
  } else if (new Date(existing.period_start).getTime() < periodStart.getTime()) {
    // New month: reset consumption, keep reservations of still-running jobs.
    await db
      .from("credit_wallets")
      .update({ period_start: periodStart.toISOString(), total_credits: monthlyCredits, used_credits: 0, warned_80: false })
      .eq("user_id", userId);
  } else if (existing.total_credits !== monthlyCredits && monthlyCredits > existing.total_credits) {
    await db.from("credit_wallets").update({ total_credits: monthlyCredits }).eq("user_id", userId);
  }
  return readWallet(admin, userId);
}

export async function readWallet(admin: unknown, userId: string): Promise<WalletSnapshot> {
  const { data } = await asAnyDb(admin).from("credit_wallets").select("*").eq("user_id", userId).maybeSingle();
  const bonusActive = data?.bonus_credits && (!data.bonus_expires_at || new Date(data.bonus_expires_at).getTime() > Date.now());
  const total = (data?.total_credits ?? 0) + (bonusActive ? data.bonus_credits : 0);
  const used = data?.used_credits ?? 0;
  const reserved = data?.reserved_credits ?? 0;
  const percent = calculateWalletUsagePercent({ totalCredits: total, usedCredits: used + reserved });
  return { total, used, reserved, percent, warning: percent > WALLET_WARNING_THRESHOLD_PERCENT };
}

export type Reservation = { id: string; credits: number };

/** Estimates by source tokens, then atomically reserves. Returns null when the wallet cannot cover it. */
export async function reserveForTokens(
  admin: unknown,
  userId: string,
  jobId: string | null,
  sourceTokens: number,
): Promise<{ reservation: Reservation | null; estimatedCredits: number }> {
  const estimatedCredits = await estimateDocumentCredits(sourceTokens);
  const { data, error } = await asAnyDb(admin).rpc("reserve_credits", {
    p_user: userId,
    p_job: jobId,
    p_credits: estimatedCredits,
  });
  if (error || !data) return { reservation: null, estimatedCredits };
  return { reservation: { id: data as string, credits: estimatedCredits }, estimatedCredits };
}

/** Logs every call, charges the real token cost, and raises the 80% notification once. */
export async function settleUsage(
  admin: unknown,
  params: {
    userId: string;
    jobId: string | null;
    courseId: string | null;
    kind: string;
    reservation: Reservation | null;
    collector: AiUsageCollector;
    cacheHits?: number;
  },
): Promise<{ actualCredits: number; wallet: WalletSnapshot }> {
  const db = asAnyDb(admin);
  const { collector } = params;
  const events = collector.calls.map((c) => ({
    user_id: params.userId,
    job_id: params.jobId,
    course_id: params.courseId,
    kind: params.kind,
    model: c.model,
    prompt_tokens: c.promptTokens,
    completion_tokens: c.completionTokens,
    credits: Number(((c.promptTokens + c.completionTokens) / 1000 * creditsPerThousandTokens()).toFixed(4)),
    cache_hit: false,
  }));
  const hits = params.cacheHits ?? 0;
  for (let i = 0; i < hits; i += 1) {
    events.push({
      user_id: params.userId, job_id: params.jobId, course_id: params.courseId, kind: params.kind,
      model: "cache", prompt_tokens: 0, completion_tokens: 0, credits: 0, cache_hit: true,
    });
  }
  if (events.length) await db.from("ai_usage_events").insert(events);

  const actualCredits = creditsForTokens(totalAiTokens(collector).total);
  if (params.reservation) {
    await db.rpc("settle_credits", { p_reservation: params.reservation.id, p_actual: actualCredits });
  } else if (actualCredits > 0) {
    const { data: w } = await db.from("credit_wallets").select("used_credits").eq("user_id", params.userId).maybeSingle();
    if (w) await db.from("credit_wallets").update({ used_credits: (w.used_credits ?? 0) + actualCredits }).eq("user_id", params.userId);
  }

  const wallet = await readWallet(admin, params.userId);
  if (wallet.warning) {
    const { data: flag } = await db.from("credit_wallets").select("warned_80").eq("user_id", params.userId).maybeSingle();
    if (!flag?.warned_80) {
      await db.from("credit_wallets").update({ warned_80: true }).eq("user_id", params.userId);
      await db.from("notifications").insert({
        user_id: params.userId,
        kind: "CREDITS_80",
        title: "رصيد النقاط قارب على النفاد",
        body: `استهلكت ${Math.round(wallet.percent)}% من نقاطك لهذه الفترة.`,
      });
    }
  }
  return { actualCredits, wallet };
}

export async function releaseReservation(admin: unknown, reservation: Reservation | null): Promise<void> {
  if (!reservation) return;
  await asAnyDb(admin).rpc("release_credits", { p_reservation: reservation.id });
}

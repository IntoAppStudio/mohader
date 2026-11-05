/**
 * Real job queue on top of the existing `jobs` table (Supabase Postgres).
 *
 *  - Producers insert a QUEUED row (`enqueueJob`).
 *  - Workers claim rows atomically with `FOR UPDATE SKIP LOCKED` (`claim_next_job`),
 *    so several workers/cron invocations can run safely in parallel.
 *  - Failures re-queue with exponential backoff until MAX_ATTEMPTS, then FAILED.
 *  - Progress (0-100) is written to `jobs.progress` as work advances; the UI polls it.
 *  - AI calls inside a job run 3-5 in parallel (see pipeline BuildOptions).
 *
 * Kinds handled: "build_course", "process_file_async", "whiteboard_lesson".
 * Run the worker from POST /api/cron/run-queue (every minute) and/or kicked
 * right after enqueue. No third-party service is required; Inngest/Trigger.dev
 * could later replace `runQueueWorker` without touching the pipeline.
 */
import { runWithAiUsage, type AiUsageCollector } from "./ai.server";
import { estimateTokensFromChars, ensureWallet, releaseReservation, reserveForTokens, settleUsage, type Reservation } from "./creditsLedger.server";
import { asAnyDb } from "./untypedDb.server";

export const QUEUE_KINDS = ["build_course", "process_file_async", "whiteboard_lesson"] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 30_000, 120_000];

/** Monthly credit allowance per plan (override per plan with limits.credits_per_month). */
const DEFAULT_PLAN_CREDITS: Record<string, number> = { free: 60, student: 600, pro: 3000 };

export async function isFlagEnabled(admin: unknown, key: string): Promise<boolean> {
  const { data } = await asAnyDb(admin).from("feature_flags").select("enabled").eq("key", key).maybeSingle();
  return Boolean(data?.enabled);
}

export async function enqueueJob(
  client: unknown,
  input: { userId: string; courseId?: string | null; fileId?: string | null; kind: QueueKind; payload?: Record<string, unknown> },
): Promise<string> {
  const { data, error } = await asAnyDb(client)
    .from("jobs")
    .insert({
      user_id: input.userId,
      course_id: input.courseId ?? null,
      file_id: input.fileId ?? null,
      kind: input.kind,
      status: "QUEUED",
      progress: 0,
      payload: input.payload ?? {},
    })
    .select("id")
    .single();
  if (error || !data) throw new Error("ENQUEUE_FAILED");
  return data.id as string;
}

/** Fire-and-forget nudge so a job starts immediately instead of waiting for the next cron tick. */
export function kickWorker(): void {
  const base = process.env["APP_BASE_URL"];
  const secret = process.env["CRON_SECRET"];
  if (!base || !secret) return;
  void fetch(`${base.replace(/\/$/, "")}/api/cron/run-queue`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}` },
  }).catch(() => undefined);
}

async function monthlyCreditsFor(admin: unknown, userId: string): Promise<number | "UNLIMITED"> {
  const db = asAnyDb(admin);
  const { data: roles } = await db.from("user_roles").select("role").eq("user_id", userId);
  if ((roles ?? []).some((r: { role: string }) => r.role === "admin" || r.role === "super_admin")) return "UNLIMITED";
  const { data: sub } = await db.from("subscriptions").select("plan_id, status, current_period_end").eq("user_id", userId).maybeSingle();
  const active = sub && ["active", "trialing", "past_due", "grace"].includes(String(sub.status).toLowerCase());
  const planId = active ? (sub.plan_id as string) : "free";
  const { data: plan } = await db.from("plans").select("limits").eq("id", planId).maybeSingle();
  const fromPlan = Number((plan?.limits as Record<string, unknown> | undefined)?.["credits_per_month"]);
  const credits = Number.isFinite(fromPlan) && fromPlan > 0 ? fromPlan : (DEFAULT_PLAN_CREDITS[planId] ?? DEFAULT_PLAN_CREDITS["free"]!);

  // One-time exam packs are NOT added here: they are granted once to credit_wallets.bonus_credits (see moyasar webhook).
  return credits;
}

/** Source size of a course in tokens (for the pre-processing estimate). */
export async function courseSourceTokens(client: unknown, courseId: string): Promise<number> {
  const { data } = await asAnyDb(client).from("content_blocks").select("original_text").eq("course_id", courseId).limit(8000);
  const chars = (data ?? []).reduce((sum: number, b: { original_text: string }) => sum + b.original_text.length, 0);
  return estimateTokensFromChars(chars);
}

type ClaimedJob = {
  id: string;
  user_id: string;
  course_id: string | null;
  file_id: string | null;
  kind: string;
  attempts: number;
  payload: Record<string, unknown> | null;
};

async function setProgress(admin: unknown, jobId: string, progress: number, detail?: string, extra: Record<string, unknown> = {}) {
  const db = asAnyDb(admin);
  const { data } = await db.from("jobs").select("payload").eq("id", jobId).maybeSingle();
  const payload = { ...(data?.payload ?? {}), ...(detail !== undefined ? { detail } : {}), ...extra };
  await db.from("jobs").update({ progress, payload, updated_at: new Date().toISOString() }).eq("id", jobId);
}

/** Optional build scope from the job payload: custom page range and the 15-minute segment cap. */
function pageOptions(payload: Record<string, unknown> | null): { pageRange?: { startPage: number; endPage: number }; maxSegmentMinutes?: number } {
  const range = payload?.["pageRange"] as { startPage?: number; endPage?: number } | undefined;
  const minutes = Number(payload?.["maxSegmentMinutes"]);
  const out: { pageRange?: { startPage: number; endPage: number }; maxSegmentMinutes?: number } = {};
  if (range && Number.isInteger(range.startPage) && Number.isInteger(range.endPage) && (range.startPage as number) >= 1 && (range.endPage as number) >= (range.startPage as number)) {
    out.pageRange = { startPage: range.startPage as number, endPage: range.endPage as number };
  }
  if (Number.isFinite(minutes) && minutes > 0) out.maxSegmentMinutes = Math.min(60, minutes);
  return out;
}

async function runBuildJob(admin: unknown, job: ClaimedJob): Promise<void> {
  if (!job.course_id) throw new Error("COURSE_NOT_FOUND");
  const { buildCourseContent } = await import("./pipeline.server");
  const enforce = await isFlagEnabled(admin, "credits_enforced");
  const collector: AiUsageCollector = { calls: [] };
  const stats = { cacheHits: 0, skippedByLessonCap: 0, reviewItems: 0 };
  let reservation: Reservation | null = null;

  if (enforce) {
    const allowance = await monthlyCreditsFor(admin, job.user_id);
    if (allowance !== "UNLIMITED") {
      await ensureWallet(admin, job.user_id, allowance);
      const tokens = await courseSourceTokens(admin, job.course_id);
      const reserved = await reserveForTokens(admin, job.user_id, job.id, tokens);
      if (!reserved.reservation) throw Object.assign(new Error("INSUFFICIENT_CREDITS"), { permanent: true });
      reservation = reserved.reservation;
      await setProgress(admin, job.id, 2, "reserved", { estimated_credits: reserved.estimatedCredits });
    }
  }

  try {
    const result = await runWithAiUsage(collector, () =>
      buildCourseContent(admin as never, job.user_id, job.course_id as string, {
        concurrency: Number(process.env["AI_CONCURRENCY"]) || 4,
        cacheAdmin: admin,
        stats,
        ...pageOptions(job.payload),
        onProgress: (percent, detail) => setProgress(admin, job.id, percent, detail),
      }),
    );
    const settled = await settleUsage(admin, {
      userId: job.user_id,
      jobId: job.id,
      courseId: job.course_id,
      kind: "build_course",
      reservation,
      collector,
      cacheHits: stats.cacheHits,
    });
    await asAnyDb(admin)
      .from("jobs")
      .update({
        status: "SUCCEEDED",
        progress: 100,
        completed_at: new Date().toISOString(),
        payload: { ...(job.payload ?? {}), result, credits_charged: settled.actualCredits, wallet_percent: Math.round(settled.wallet.percent) },
      })
      .eq("id", job.id);
    if (stats.skippedByLessonCap > 0) {
      await asAnyDb(admin).from("notifications").insert({
        user_id: job.user_id,
        kind: "BUILD_TRUNCATED",
        title: "لم تُحوَّل كل الأقسام إلى دروس",
        body: `تجاوزت المادة الحد الأقصى للدروس؛ بقي ${stats.skippedByLessonCap} قسماً دون تحويل. قسّم المادة أو حدّد نطاق صفحات.`,
      });
    }
  } catch (error) {
    // Charge what was really consumed before the failure, release the rest.
    if (collector.calls.length > 0) {
      await settleUsage(admin, { userId: job.user_id, jobId: job.id, courseId: job.course_id, kind: "build_course_failed", reservation, collector });
    } else {
      await releaseReservation(admin, reservation);
    }
    throw error;
  }
}

async function runProcessFileJob(admin: unknown, job: ClaimedJob): Promise<void> {
  if (!job.file_id) throw new Error("FILE_NOT_FOUND");
  const { processUploadedFile } = await import("./pipeline.server");
  const collector: AiUsageCollector = { calls: [] };
  const result = await runWithAiUsage(collector, () =>
    processUploadedFile(admin as never, job.user_id, job.file_id as string, { jobId: job.id }),
  );
  if (result.status === "FAILED") throw Object.assign(new Error(result.reason), { permanent: true });
  if (collector.calls.length > 0) {
    await settleUsage(admin, { userId: job.user_id, jobId: job.id, courseId: job.course_id, kind: "ocr", reservation: null, collector });
  }
}

async function runWhiteboardJob(admin: unknown, job: ClaimedJob): Promise<void> {
  const lessonId = String((job.payload as { lessonId?: string } | null)?.lessonId ?? "");
  const language = (job.payload as { language?: string } | null)?.language === "en" ? "en" : "ar";
  if (!lessonId) throw Object.assign(new Error("LESSON_NOT_FOUND"), { permanent: true });
  const { generateWhiteboardLesson } = await import("./whiteboard.server");
  const collector: AiUsageCollector = { calls: [] };
  const result = await runWithAiUsage(collector, () =>
    generateWhiteboardLesson(admin as never, admin, job.user_id, lessonId, language, (p, d) => setProgress(admin, job.id, p, d)),
  );
  if (collector.calls.length > 0) {
    await settleUsage(admin, { userId: job.user_id, jobId: job.id, courseId: job.course_id, kind: "whiteboard_script", reservation: null, collector });
  }
  await asAnyDb(admin)
    .from("jobs")
    .update({ status: "SUCCEEDED", progress: 100, completed_at: new Date().toISOString(), payload: { ...(job.payload ?? {}), result } })
    .eq("id", job.id);
}

async function handleJob(admin: unknown, job: ClaimedJob): Promise<"ok" | "retry" | "failed"> {
  const db = asAnyDb(admin);
  try {
    if (job.kind === "build_course") await runBuildJob(admin, job);
    else if (job.kind === "process_file_async") await runProcessFileJob(admin, job);
    else if (job.kind === "whiteboard_lesson") await runWhiteboardJob(admin, job);
    else throw Object.assign(new Error("UNKNOWN_JOB_KIND"), { permanent: true });
    // process_file reuses its row and marks SUCCEEDED itself; make sure.
    await db.from("jobs").update({ status: "SUCCEEDED", progress: 100, completed_at: new Date().toISOString() }).eq("id", job.id).in("status", ["RUNNING"]);
    return "ok";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const permanent = Boolean((error as { permanent?: boolean }).permanent);
    console.error("[queue] job failed", job.id, job.kind, reason);
    if (!permanent && job.attempts < MAX_ATTEMPTS) {
      const wait = BACKOFF_MS[Math.min(job.attempts, BACKOFF_MS.length - 1)] ?? 120_000;
      await db
        .from("jobs")
        .update({
          status: "QUEUED",
          failure_reason: reason,
          payload: { ...(job.payload ?? {}), next_attempt_at: new Date(Date.now() + wait).toISOString() },
        })
        .eq("id", job.id);
      return "retry";
    }
    await db
      .from("jobs")
      .update({ status: "FAILED", failure_reason: reason, completed_at: new Date().toISOString() })
      .eq("id", job.id);
    if (job.file_id) await db.from("files").update({ status: "FAILED", error_message: reason }).eq("id", job.file_id);
    return "failed";
  }
}

/**
 * Claims and runs jobs until the queue is empty or the time budget is spent.
 * Jobs waiting for a backoff are skipped until `next_attempt_at` passes.
 */
export async function runQueueWorker(admin: unknown, options: { budgetMs?: number; maxJobs?: number } = {}) {
  const started = Date.now();
  const budget = options.budgetMs ?? 55_000;
  const maxJobs = options.maxJobs ?? 5;
  const summary = { ran: 0, ok: 0, retried: 0, failed: 0 };
  const db = asAnyDb(admin);
  const deferred: string[] = [];

  while (summary.ran < maxJobs && Date.now() - started < budget) {
    const { data, error } = await db.rpc("claim_next_job", { p_kinds: [...QUEUE_KINDS], p_max_attempts: MAX_ATTEMPTS + 1 });
    if (error) {
      console.error("[queue] claim failed", error);
      break;
    }
    const job = (Array.isArray(data) ? data[0] : data) as ClaimedJob | undefined;
    if (!job) break;

    const notBefore = (job.payload as { next_attempt_at?: string } | null)?.next_attempt_at;
    if (notBefore && new Date(notBefore).getTime() > Date.now()) {
      // Not due yet: give the attempt back and stop (the queue head is the oldest, later ones would also be waiting on it).
      await db.from("jobs").update({ status: "QUEUED", attempts: Math.max(0, job.attempts - 1) }).eq("id", job.id);
      deferred.push(job.id);
      break;
    }

    summary.ran += 1;
    const outcome = await handleJob(admin, job);
    if (outcome === "ok") summary.ok += 1;
    else if (outcome === "retry") summary.retried += 1;
    else summary.failed += 1;
  }
  return { ...summary, deferred: deferred.length };
}

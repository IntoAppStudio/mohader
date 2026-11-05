import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Cost preview shown BEFORE processing: estimated credits, wallet usage after, and the 80% warning. */
export const estimateCourseCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertCourseOwner } = await import("./db.server");
    await assertCourseOwner(supabase, data.courseId);
    const { courseSourceTokens } = await import("./queue.server");
    const { evaluateDocumentAgainstWallet } = await import("./creditsCalculator");
    const { readWallet } = await import("./creditsLedger.server");
    const tokens = await courseSourceTokens(supabase, data.courseId);
    const wallet = await readWallet(supabase, userId);
    const evaluation = await evaluateDocumentAgainstWallet(tokens, { totalCredits: wallet.total, usedCredits: wallet.used + wallet.reserved });
    return { tokens, wallet, ...evaluation };
  });

/** Queues a course build instead of running it inside the request. */
export const enqueueBuildCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string; pageRange?: { startPage: number; endPage: number }; maxSegmentMinutes?: number }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertCourseOwner } = await import("./db.server");
    await assertCourseOwner(supabase, data.courseId);
    const { assertGenerationQuota } = await import("./quota.server");
    await assertGenerationQuota(supabase, userId);
    const { enqueueJob, kickWorker } = await import("./queue.server");

    // One active build per course.
    const { data: active } = await supabase
      .from("jobs")
      .select("id")
      .eq("course_id", data.courseId)
      .eq("kind", "build_course")
      .in("status", ["QUEUED", "RUNNING"])
      .limit(1);
    if (active && active.length > 0) return { jobId: active[0]!.id, alreadyQueued: true };

    const payload: Record<string, unknown> = {};
    if (data.pageRange) payload["pageRange"] = data.pageRange;
    if (data.maxSegmentMinutes) payload["maxSegmentMinutes"] = data.maxSegmentMinutes;
    const jobId = await enqueueJob(supabase, { userId, courseId: data.courseId, kind: "build_course", payload });
    kickWorker();
    return { jobId, alreadyQueued: false };
  });

export const enqueueProcessFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { fileId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: file } = await supabase.from("files").select("id, course_id").eq("id", data.fileId).maybeSingle();
    if (!file) throw new Error("FILE_NOT_FOUND");
    const { enqueueJob, kickWorker } = await import("./queue.server");
    const jobId = await enqueueJob(supabase, { userId, courseId: file.course_id, fileId: file.id, kind: "process_file_async" });
    kickWorker();
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { scheduleRetention } = await import("./retention.server");
      await scheduleRetention(supabaseAdmin, userId, file.id);
    } catch (retentionError) {
      console.error("[retention] schedule failed", retentionError);
    }
    return { jobId };
  });

/** Live status for the progress bar (polled by <JobProgress />). */
export const getJobStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { jobId?: string; courseId?: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let query = supabase
      .from("jobs")
      .select("id, kind, status, progress, attempts, failure_reason, payload, updated_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(1);
    if (data.jobId) query = query.eq("id", data.jobId);
    else if (data.courseId) query = query.eq("course_id", data.courseId).eq("kind", "build_course");
    else throw new Error("JOB_REF_REQUIRED");
    const { data: rows } = await query;
    return { job: rows?.[0] ?? null };
  });

export const getWallet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { readWallet } = await import("./creditsLedger.server");
    const wallet = await readWallet(supabase, userId);
    const { data: usage } = await supabase
      .from("ai_usage_events" as never)
      .select("kind, prompt_tokens, completion_tokens, credits, cache_hit, created_at" as never)
      .order("created_at", { ascending: false })
      .limit(30);
    return { wallet, usage: (usage ?? []) as unknown[] };
  });

/** Whether builds/file processing should go through the queue (feature flag `queue_processing`). */
export const getQueueEnabled = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isFlagEnabled } = await import("./queue.server");
    return { queue: await isFlagEnabled(supabaseAdmin, "queue_processing") };
  });

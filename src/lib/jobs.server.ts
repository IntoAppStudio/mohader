/**
 * Stuck-job sweep: jobs stuck in QUEUED/RUNNING past a timeout are almost
 * always orphaned by a request that died mid-processing (crash, worker
 * killed, deploy) rather than jobs still genuinely in progress — the app has
 * no long-lived worker, processing runs synchronously inside the request
 * that created the job (see pipeline.server.ts / courses.functions.ts).
 * Meant to be called on a schedule (see cron-auth.ts) or manually by an admin.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const STUCK_AFTER_MS = 15 * 60 * 1000; // 15 minutes with no progress update
const MAX_ATTEMPTS = 3;

type Db = SupabaseClient<Database>;

export async function retryStuckJobs(supabase: Db) {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();

  const { data: stuck, error } = await supabase
    .from("jobs")
    .select("id, file_id, attempts, kind")
    .in("status", ["QUEUED", "RUNNING"])
    .lt("updated_at", cutoff);
  if (error) throw new Error("STUCK_JOB_QUERY_FAILED");

  let retried = 0;
  let failed = 0;

  for (const job of stuck ?? []) {
    if (job.attempts >= MAX_ATTEMPTS) {
      await supabase
        .from("jobs")
        .update({
          status: "FAILED",
          failure_reason: "TIMEOUT_MAX_ATTEMPTS",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      if (job.file_id) {
        await supabase
          .from("files")
          .update({ status: "FAILED" })
          .eq("id", job.file_id)
          .in("status", ["UPLOADING", "PROCESSING", "READING", "OCR", "EXTRACTING_STRUCTURE", "ORGANIZING", "INDEXING", "QUALITY_CHECK"]);
      }
      failed += 1;
      continue;
    }

    // Reset to QUEUED with an incremented attempt count. Actually re-running
    // the pipeline from here (rather than just flagging it) needs a trigger
    // that isn't request-shaped — see the note in the final report about
    // moving this to a real queue/worker. For now this makes the stuck state
    // visible and bounded instead of "processing..." forever.
    await supabase
      .from("jobs")
      .update({ status: "QUEUED", attempts: job.attempts + 1 })
      .eq("id", job.id);
    retried += 1;
  }

  return { checked: stuck?.length ?? 0, retried, failed };
}

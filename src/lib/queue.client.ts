/** Client helper: waits for a queued job to finish by polling its status. */
export type JobSnapshot = {
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  progress: number;
  failure_reason: string | null;
  payload: { result?: Record<string, unknown> } | null;
} | null;

export async function waitForJob(
  fetchJob: () => Promise<JobSnapshot>,
  options: { intervalMs?: number; timeoutMs?: number; onTick?: (job: JobSnapshot) => void } = {},
): Promise<NonNullable<JobSnapshot>> {
  const interval = options.intervalMs ?? 2000;
  const deadline = Date.now() + (options.timeoutMs ?? 30 * 60_000);
  for (;;) {
    let job: JobSnapshot = null;
    try {
      job = await fetchJob();
    } catch {
      /* transient network error: keep polling */
    }
    options.onTick?.(job);
    if (job && (job.status === "SUCCEEDED" || job.status === "FAILED" || job.status === "CANCELLED")) return job;
    if (Date.now() > deadline) throw new Error("JOB_TIMEOUT");
    await new Promise((r) => setTimeout(r, interval));
  }
}

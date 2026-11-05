import { useEffect, useRef, useState } from "react";
import { getJobStatus } from "@/lib/queue.functions";

type JobView = {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  progress: number;
  attempts: number;
  failure_reason: string | null;
  payload: { detail?: string } | null;
} | null;

/** Live progress bar for a queued job; polls every 2s until it finishes. */
export function JobProgress({
  jobId,
  courseId,
  onDone,
  dir = "rtl",
}: {
  jobId?: string;
  courseId?: string;
  onDone?: (status: "SUCCEEDED" | "FAILED" | "CANCELLED") => void;
  dir?: "rtl" | "ltr";
}) {
  const [job, setJob] = useState<JobView>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    doneRef.current = false;
    const tick = async () => {
      try {
        const query: { jobId?: string; courseId?: string } = {};
        if (jobId) query.jobId = jobId;
        else if (courseId) query.courseId = courseId;
        const res = (await getJobStatus({ data: query })) as { job: JobView };
        if (cancelled) return;
        setJob(res.job);
        const s = res.job?.status;
        if (s && s !== "QUEUED" && s !== "RUNNING" && !doneRef.current) {
          doneRef.current = true;
          onDone?.(s);
        }
      } catch {
        /* transient: keep polling */
      }
    };
    void tick();
    const timer = window.setInterval(() => {
      if (!doneRef.current) void tick();
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, courseId, onDone]);

  if (!job) return null;
  const label =
    job.status === "QUEUED"
      ? job.attempts > 0
        ? "إعادة المحاولة في الطابور…"
        : "في الطابور…"
      : job.status === "RUNNING"
        ? "جارٍ التحويل…"
        : job.status === "SUCCEEDED"
          ? "اكتمل"
          : "تعذّر الإكمال";
  return (
    <div dir={dir} className="w-full space-y-1" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span>{Math.round(job.progress)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${job.status === "FAILED" ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${Math.max(2, Math.min(100, job.progress))}%` }}
        />
      </div>
      {job.status === "FAILED" && job.failure_reason ? (
        <p className="text-xs text-destructive">{job.failure_reason}</p>
      ) : null}
    </div>
  );
}

export default JobProgress;

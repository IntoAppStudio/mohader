import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export type PlanLimits = {
  courses: number;
  files_per_course: number;
  storage_mb: number;
  questions_per_month: number;
  video: boolean;
  audio: boolean;
};

const FALLBACK: PlanLimits = {
  courses: 1,
  files_per_course: 5,
  storage_mb: 100,
  questions_per_month: 100,
  video: false,
  audio: false,
};

const UNLIMITED: PlanLimits = {
  courses: -1,
  files_per_course: -1,
  storage_mb: -1,
  questions_per_month: -1,
  video: true,
  audio: true,
};

const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due", "grace"]);

function toNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

async function isPrivileged(supabase: Db, userId: string): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  return (data ?? []).some((row) => row.role === "admin" || row.role === "super_admin");
}

/** Server-side plan resolution: never trust a plan id supplied by the client. */
export async function getPlanLimits(supabase: Db, userId: string): Promise<PlanLimits> {
  if (await isPrivileged(supabase, userId)) return UNLIMITED;

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("plan_id, status, grace_until, current_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  const isActive =
    !!subscription &&
    ACTIVE_STATUSES.has(subscription.status) &&
    (!subscription.current_period_end ||
      new Date(subscription.current_period_end).getTime() > Date.now() ||
      (!!subscription.grace_until && new Date(subscription.grace_until).getTime() > Date.now()));

  const planId = isActive ? subscription.plan_id : "free";

  const { data: plan } = await supabase
    .from("plans")
    .select("limits")
    .eq("id", planId)
    .maybeSingle();

  const limits = (plan?.limits ?? {}) as Record<string, unknown>;
  return {
    courses: toNumber(limits["courses"], FALLBACK.courses),
    files_per_course: toNumber(limits["files_per_course"], FALLBACK.files_per_course),
    storage_mb: toNumber(limits["storage_mb"], FALLBACK.storage_mb),
    questions_per_month: toNumber(limits["questions_per_month"], FALLBACK.questions_per_month),
    video: toBool(limits["video"], FALLBACK.video),
    audio: toBool(limits["audio"], FALLBACK.audio),
  };
}

function unlimited(limit: number): boolean {
  return limit < 0;
}

export async function assertCourseQuota(supabase: Db, userId: string): Promise<void> {
  const limits = await getPlanLimits(supabase, userId);
  if (unlimited(limits.courses)) return;
  const { count } = await supabase
    .from("courses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if ((count ?? 0) >= limits.courses) throw new Error("PLAN_LIMIT_COURSES");
}

export async function assertFileQuota(
  supabase: Db,
  userId: string,
  courseId: string,
  incomingBytes: number,
): Promise<void> {
  const limits = await getPlanLimits(supabase, userId);

  if (!unlimited(limits.files_per_course)) {
    const { count } = await supabase
      .from("files")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("course_id", courseId);
    if ((count ?? 0) >= limits.files_per_course) throw new Error("PLAN_LIMIT_FILES");
  }

  if (!unlimited(limits.storage_mb)) {
    const { data } = await supabase.from("files").select("size_bytes").eq("user_id", userId);
    const used = (data ?? []).reduce((sum, row) => sum + Number(row.size_bytes ?? 0), 0);
    if (used + Math.max(0, incomingBytes) > limits.storage_mb * 1024 * 1024) {
      throw new Error("PLAN_LIMIT_STORAGE");
    }
  }
}

export async function assertGenerationQuota(supabase: Db, userId: string): Promise<void> {
  const limits = await getPlanLimits(supabase, userId);
  if (unlimited(limits.questions_per_month)) return;
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since.toISOString());
  if ((count ?? 0) >= limits.questions_per_month) throw new Error("PLAN_LIMIT_GENERATION");
}

export async function assertVideoQuota(supabase: Db, userId: string): Promise<void> {
  const limits = await getPlanLimits(supabase, userId);
  if (!limits.video) throw new Error("PLAN_LIMIT_VIDEO");
}

export async function assertAudioQuota(supabase: Db, userId: string): Promise<void> {
  const limits = await getPlanLimits(supabase, userId);
  if (!limits.audio) throw new Error("PLAN_LIMIT_AUDIO");
}

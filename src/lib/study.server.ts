import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

/** SM-2 style scheduling, deliberately simple and inspectable. */
export function scheduleNext(ease: number, intervalDays: number, correct: boolean) {
  if (!correct) return { ease: Math.max(1.3, ease - 0.2), interval_days: 1 };
  const nextEase = Math.min(2.8, ease + 0.1);
  const nextInterval = intervalDays <= 0 ? 1 : intervalDays === 1 ? 3 : Math.round(intervalDays * nextEase);
  return { ease: nextEase, interval_days: Math.min(120, nextInterval) };
}

export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Distributes lessons across the allowed weekdays until the target date. */
export function buildSchedule(options: {
  lessonIds: string[];
  hoursPerDay: number;
  preferredDays: number[];
  targetDate: string | null;
}) {
  const { lessonIds, hoursPerDay, preferredDays, targetDate } = options;
  const minutesPerDay = Math.max(30, Math.round(hoursPerDay * 60));
  const lessonMinutes = 30;
  const perDay = Math.max(1, Math.floor(minutesPerDay / lessonMinutes));

  const days: string[] = [];
  const allowed = preferredDays.length ? preferredDays : [0, 1, 2, 3, 4, 5, 6];
  const end = targetDate ? new Date(`${targetDate}T00:00:00Z`) : null;
  let cursor = new Date();
  let guard = 0;
  const needed = Math.ceil(lessonIds.length / perDay);

  while (days.length < needed && guard < 400) {
    guard += 1;
    if (allowed.includes(cursor.getDay())) days.push(isoDate(cursor));
    cursor = addDays(cursor, 1);
    if (end && cursor > end && days.length > 0) break;
  }
  if (days.length === 0) days.push(isoDate(new Date()));

  const items: { lesson_id: string; scheduled_date: string; minutes: number; position: number }[] = [];
  lessonIds.forEach((lessonId, index) => {
    const day = days[Math.min(days.length - 1, Math.floor(index / perDay))]!;
    items.push({ lesson_id: lessonId, scheduled_date: day, minutes: lessonMinutes, position: index });
  });
  return items;
}

export async function refreshProgress(supabase: Db, userId: string, courseId: string) {
  const [lessons, done, attempts] = await Promise.all([
    supabase.from("lessons").select("id", { count: "exact", head: true }).eq("course_id", courseId),
    supabase
      .from("lessons")
      .select("id", { count: "exact", head: true })
      .eq("course_id", courseId)
      .eq("is_completed", true),
    supabase.from("question_attempts").select("is_correct").eq("course_id", courseId).limit(5000),
  ]);

  const answered = attempts.data?.length ?? 0;
  const correct = (attempts.data ?? []).filter((a) => a.is_correct).length;

  await supabase.from("progress").upsert(
    {
      user_id: userId,
      course_id: courseId,
      lessons_total: lessons.count ?? 0,
      lessons_completed: done.count ?? 0,
      questions_answered: answered,
      questions_correct: correct,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "course_id" },
  );
}

export function gradeAnswer(
  type: Database["public"]["Enums"]["question_type"],
  correctAnswer: unknown,
  given: unknown,
): boolean {
  const norm = (v: unknown) =>
    String(v ?? "")
      .toLowerCase()
      .replace(/[\s\u064B-\u0652]+/g, " ")
      .replace(/[.،,؛;:!?"'()]/g, "")
      .trim();

  if (type === "TRUE_FALSE") {
    const expected = norm(correctAnswer);
    const actual = norm(given);
    const truthy = ["true", "صح", "صحيح", "yes", "نعم"];
    return truthy.includes(expected) === truthy.includes(actual);
  }
  if (type === "MCQ") return norm(correctAnswer) === norm(given);
  const expected = norm(correctAnswer);
  const actual = norm(given);
  if (!expected) return false;
  if (expected === actual) return true;
  // Short answers: accept when every keyword of the source answer is present.
  const keywords = expected.split(" ").filter((w) => w.length > 3);
  if (keywords.length === 0) return false;
  return keywords.every((k) => actual.includes(k));
}

/**
 * Exam countdown plan + spaced repetition (pure, unit-tested).
 *
 * - `nextReview` is SM-2 (ease factor, interval days) driven by right/wrong results.
 * - `buildCountdownPlan` spreads study over the days left, giving weaker lessons more
 *   minutes and more repetitions; the last days are reserved for review of the weakest.
 * - Call it again after every quiz with updated weakness scores: the plan self-adjusts.
 */

export type ReviewState = { easeFactor: number; intervalDays: number; repetitions: number };

export function nextReview(state: ReviewState, correct: boolean): ReviewState {
  if (!correct) return { easeFactor: Math.max(1.3, state.easeFactor - 0.2), intervalDays: 1, repetitions: 0 };
  const repetitions = state.repetitions + 1;
  const intervalDays = repetitions === 1 ? 1 : repetitions === 2 ? 3 : Math.round(state.intervalDays * state.easeFactor);
  return { easeFactor: Math.min(3, state.easeFactor + 0.05), intervalDays: Math.max(1, intervalDays), repetitions };
}

export type PlanLesson = { id: string; title?: string; weakness: number; completed: boolean; estimatedMinutes?: number };
export type PlanItem = { date: string; lessonId: string; kind: "LEARN" | "REVIEW"; minutes: number };

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function daysUntil(examDate: string, today: Date): number {
  const end = Date.parse(examDate.slice(0, 10) + "T00:00:00Z");
  const start = Date.parse(iso(today) + "T00:00:00Z");
  return Math.max(0, Math.round((end - start) / DAY));
}

export function buildCountdownPlan(input: {
  examDate: string;
  today?: Date;
  hoursPerDay: number;
  lessons: readonly PlanLesson[];
  /** Fraction of the remaining days (at the end) reserved for review of weak lessons. */
  reviewShare?: number;
}): { items: PlanItem[]; daysLeft: number; overloaded: boolean } {
  const today = input.today ?? new Date();
  const daysLeft = daysUntil(input.examDate, today);
  if (daysLeft <= 0 || input.lessons.length === 0) return { items: [], daysLeft, overloaded: false };

  const budget = Math.max(15, Math.round(input.hoursPerDay * 60));
  const reviewDays = Math.min(daysLeft - 1, Math.max(daysLeft >= 4 ? 1 : 0, Math.floor(daysLeft * (input.reviewShare ?? 0.25))));
  const learnDays = Math.max(1, daysLeft - reviewDays);

  const learn = input.lessons.filter((l) => !l.completed).sort((a, b) => b.weakness - a.weakness);
  const items: PlanItem[] = [];
  const usedPerDay = new Map<number, number>();
  const put = (day: number, lessonId: string, kind: PlanItem["kind"], minutes: number) => {
    items.push({ date: iso(new Date(today.getTime() + day * DAY)), lessonId, kind, minutes });
    usedPerDay.set(day, (usedPerDay.get(day) ?? 0) + minutes);
  };

  // Learn phase: round-robin fill by day, weaker lessons get more minutes.
  let day = 0;
  for (const lesson of learn) {
    const minutes = Math.round((lesson.estimatedMinutes ?? 25) * (1 + lesson.weakness * 0.6));
    while (day < learnDays - 1 && (usedPerDay.get(day) ?? 0) + minutes > budget) day += 1;
    put(day, lesson.id, "LEARN", minutes);
  }
  // Spaced repetition: weak lessons are revisited at growing gaps (1, 3, 7 days after learning).
  const learnedOn = new Map(items.map((i) => [i.lessonId, Math.round((Date.parse(i.date) - Date.parse(iso(today))) / DAY)]));
  for (const lesson of input.lessons) {
    const start = learnedOn.get(lesson.id) ?? 0;
    const gaps = lesson.weakness >= 0.5 ? [1, 3, 7] : lesson.weakness >= 0.25 ? [3, 7] : [7];
    for (const gap of gaps) {
      const d = start + gap;
      if (d >= daysLeft) break;
      put(d, lesson.id, "REVIEW", Math.round(10 + lesson.weakness * 15));
    }
  }
  // Final review block: the weakest lessons on the last days.
  const weakest = [...input.lessons].sort((a, b) => b.weakness - a.weakness).slice(0, Math.max(1, Math.ceil(input.lessons.length / 3)));
  for (let r = 0; r < reviewDays; r += 1) {
    const d = daysLeft - 1 - r;
    weakest.forEach((l) => put(d, l.id, "REVIEW", 15));
  }

  const overloaded = [...usedPerDay.values()].some((m) => m > budget * 1.25);
  return { items: items.sort((a, b) => a.date.localeCompare(b.date)), daysLeft, overloaded };
}

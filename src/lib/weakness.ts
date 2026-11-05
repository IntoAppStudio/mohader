/** Weakness map + mistake-reason classification (pure, unit-tested). */

export type Attempt = { lessonId: string | null; questionType: string; isCorrect: boolean; timeSpentSeconds: number; createdAt?: string };
export type MistakeReason = "CONCEPT" | "CALCULATION" | "CARELESS" | "TERMINOLOGY" | "MEMORY" | "UNKNOWN";

export function classifyMistake(a: { questionType: string; timeSpentSeconds: number; priorWrongOnLesson: number }): MistakeReason {
  if (a.timeSpentSeconds > 0 && a.timeSpentSeconds < 6) return "CARELESS";
  if (a.questionType === "CALCULATION" || a.questionType === "PROBLEM_SOLVING") return "CALCULATION";
  if (a.questionType === "DEFINITION") return "TERMINOLOGY";
  if (a.questionType === "FILL_BLANK" || a.questionType === "TRUE_FALSE") return a.priorWrongOnLesson >= 2 ? "CONCEPT" : "MEMORY";
  if (a.priorWrongOnLesson >= 2) return "CONCEPT";
  return "UNKNOWN";
}

export type LessonWeakness = { lessonId: string; attempts: number; wrong: number; accuracy: number; weakness: number; reasons: Record<MistakeReason, number> };

/** Weakness 0..1: error rate, damped for few attempts (unattempted lessons count as moderately weak). */
export function weaknessMap(attempts: readonly Attempt[], allLessonIds: readonly string[] = []): LessonWeakness[] {
  const by = new Map<string, Attempt[]>();
  for (const a of attempts) if (a.lessonId) by.set(a.lessonId, [...(by.get(a.lessonId) ?? []), a]);
  const ids = new Set([...by.keys(), ...allLessonIds]);
  const out: LessonWeakness[] = [];
  for (const id of ids) {
    const list = [...(by.get(id) ?? [])].sort((x, y) => (x.createdAt ?? "").localeCompare(y.createdAt ?? ""));
    const reasons: Record<MistakeReason, number> = { CONCEPT: 0, CALCULATION: 0, CARELESS: 0, TERMINOLOGY: 0, MEMORY: 0, UNKNOWN: 0 };
    let wrong = 0;
    for (const a of list) {
      if (a.isCorrect) continue;
      reasons[classifyMistake({ questionType: a.questionType, timeSpentSeconds: a.timeSpentSeconds, priorWrongOnLesson: wrong })] += 1;
      wrong += 1;
    }
    const attemptsN = list.length;
    const accuracy = attemptsN ? (attemptsN - wrong) / attemptsN : 0;
    const confidence = Math.min(1, attemptsN / 5);
    const weakness = attemptsN === 0 ? 0.5 : Math.round(((1 - accuracy) * confidence + 0.5 * (1 - confidence)) * 100) / 100;
    out.push({ lessonId: id, attempts: attemptsN, wrong, accuracy: Math.round(accuracy * 100) / 100, weakness, reasons });
  }
  return out.sort((a, b) => b.weakness - a.weakness);
}

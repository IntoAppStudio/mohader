/**
 * "Dr. exam": learns a professor's style (question types, wording, terminology,
 * mark distribution) from uploaded PAST exams, then builds a new exam in that style
 * from the course's own verified lessons. Questions are source-bound and verified
 * exactly like regular ones; weak items are held for review instead of published.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { aiJson, SOURCE_BOUND_SYSTEM } from "./ai.server";
import { verifyAgainstSource } from "./verify.server";
import { asAnyDb } from "./untypedDb.server";

type Db = SupabaseClient<Database>;

export type ExamStyle = {
  type_mix: Record<string, number>;
  avg_questions: number;
  marks_distribution: string;
  wording_patterns: string[];
  terminology: string[];
  difficulty: string;
  language: string;
};

export async function analyzeExamStyle(supabase: Db, userId: string, courseId: string, fileIds: string[]) {
  if (fileIds.length === 0) throw new Error("NO_EXAM_FILES");
  const { data: blocks } = await supabase
    .from("content_blocks")
    .select("original_text, page, position")
    .eq("course_id", courseId)
    .in("file_id", fileIds)
    .order("position")
    .limit(600);
  const text = (blocks ?? []).map((b) => b.original_text).join("\n").slice(0, 24000);
  if (text.length < 200) throw new Error("NOT_ENOUGH_EXAM_TEXT");

  const style = await aiJson<ExamStyle>(
    SOURCE_BOUND_SYSTEM,
    [
      "These are PAST EXAMS written by one professor. Describe his style ONLY from this text; invent nothing.",
      "EXAM TEXT:", text, "",
      'Return JSON: {"type_mix":{"MCQ":0.5,"TRUE_FALSE":0.2,"DEFINITION":0.1,"PROBLEM_SOLVING":0.2},"avg_questions":20,"marks_distribution":"how marks are split","wording_patterns":["typical question openings, quoted briefly"],"terminology":["terms the professor uses"],"difficulty":"easy|medium|hard","language":"ar|en"}',
    ].join("\n"),
  );
  await asAnyDb(supabase).from("exam_style_profiles").upsert(
    { user_id: userId, course_id: courseId, source_file_ids: fileIds, profile: style },
    { onConflict: "course_id" },
  );
  return { style };
}

type AiQ = { type?: string; prompt?: string; options?: string[]; correct_answer?: unknown; explanation?: string; difficulty?: number; lesson_index?: number };

export async function generateStyledExam(supabase: Db, userId: string, courseId: string, count: number) {
  const { data: prof } = await asAnyDb(supabase).from("exam_style_profiles").select("profile").eq("course_id", courseId).maybeSingle();
  if (!prof?.profile) throw new Error("NO_STYLE_PROFILE");
  const style = prof.profile as ExamStyle;
  const n = Math.min(30, Math.max(5, Math.round(count)));

  const { data: lessons } = await supabase
    .from("lessons")
    .select("id, title, explanation_standard, position")
    .eq("course_id", courseId)
    .order("position")
    .limit(40);
  if (!lessons || lessons.length === 0) throw new Error("NO_LESSONS");

  const lessonText = lessons.map((l, i) => `[${i}] ${l.title}\n${(l.explanation_standard ?? "").slice(0, 1500)}`).join("\n\n");
  const out = await aiJson<{ questions?: AiQ[] }>(
    SOURCE_BOUND_SYSTEM,
    [
      `Write ${n} exam questions in THIS professor's style:`, JSON.stringify(style), "",
      "Use ONLY the lesson material below. Every question must name its lesson_index. MCQ has exactly 4 options and correct_answer equals the text of the correct option.",
      "LESSONS:", lessonText, "",
      'Return JSON: {"questions":[{"type":"MCQ","prompt":"...","options":["a","b","c","d"],"correct_answer":"a","explanation":"...","difficulty":2,"lesson_index":0}]}',
    ].join("\n"),
  );

  const types = ["MCQ", "TRUE_FALSE", "FILL_BLANK", "DEFINITION", "SHORT_ANSWER", "CALCULATION", "SCENARIO", "PROBLEM_SOLVING"];
  const chosen: string[] = [];
  for (const q of out.questions ?? []) {
    if (!q.prompt) continue;
    const lesson = lessons[q.lesson_index ?? -1];
    if (!lesson) continue;
    const type = (types.includes(q.type ?? "") ? q.type : "SHORT_ANSWER") as Database["public"]["Enums"]["question_type"];
    const options = Array.isArray(q.options) ? q.options.filter((o) => typeof o === "string").slice(0, 6) : [];
    if (type === "MCQ" && options.length < 3) continue;
    const verification = verifyAgainstSource(q.prompt, lesson.explanation_standard ?? "", { checkNumbers: true });
    const held = verification.status === "UNSUPPORTED";
    const row = await supabase
      .from("questions")
      .insert({
        user_id: userId, course_id: courseId, lesson_id: lesson.id, type, prompt: q.prompt, options,
        correct_answer: (q.correct_answer ?? null) as Database["public"]["Tables"]["questions"]["Row"]["correct_answer"],
        explanation: q.explanation ?? null,
        difficulty: Math.min(3, Math.max(1, Math.round(q.difficulty ?? 2))),
        support_status: verification.status,
        is_published: !held,
        validation: { professor_style: true, needs_review: verification.needsReview ?? false, contradictions: verification.contradictions ?? [] },
      })
      .select("id")
      .single();
    if (row.data && !held) {
      chosen.push(row.data.id);
      const { data: refs } = await supabase.from("source_references").select("*").eq("object_type", "lesson").eq("object_id", lesson.id).limit(3);
      if (refs?.length) {
        await supabase.from("source_references").insert(
          refs.map((ref: Record<string, unknown>) => {
            const { id: _id, created_at: _c, ...rest } = ref;
            return { ...rest, object_type: "question", object_id: row.data!.id };
          }) as never,
        );
      }
    }
  }
  if (chosen.length === 0) throw new Error("NO_SUPPORTED_QUESTIONS");

  const exam = await supabase
    .from("exams")
    .insert({ user_id: userId, course_id: courseId, title: "امتحان بأسلوب الدكتور", status: "IN_PROGRESS", config: { professor_style: true, count: chosen.length } })
    .select("id")
    .single();
  if (exam.error || !exam.data) throw new Error("EXAM_CREATE_FAILED");
  await supabase.from("exam_questions").insert(chosen.map((id, position) => ({ user_id: userId, exam_id: exam.data.id, question_id: id, position })));
  return { id: exam.data.id, questions: chosen.length };
}

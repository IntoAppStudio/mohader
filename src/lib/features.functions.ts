import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** 2) Source proof in one tap: the page text with the supporting sentence marked. */
export const getSourceProof = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { referenceId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: ref } = await supabase
      .from("source_references")
      .select("id, file_id, page, section, quoted_text, content_block_id, files(original_name)")
      .eq("id", data.referenceId)
      .maybeSingle();
    if (!ref) throw new Error("REFERENCE_NOT_FOUND");
    let pageText = "";
    if (ref.page !== null && ref.page !== undefined) {
      const { data: blocks } = await supabase
        .from("content_blocks")
        .select("original_text, position")
        .eq("file_id", ref.file_id)
        .eq("page", ref.page)
        .order("position");
      pageText = (blocks ?? []).map((b) => b.original_text).join("\n");
    }
    if (!pageText && ref.content_block_id) {
      const { data: block } = await supabase.from("content_blocks").select("original_text").eq("id", ref.content_block_id).maybeSingle();
      pageText = block?.original_text ?? "";
    }
    const { highlightSentence } = await import("./sourceHighlight");
    const parts = highlightSentence(pageText || (ref.quoted_text ?? ""), ref.quoted_text ?? "");
    return { fileId: ref.file_id, fileName: ref.files?.original_name ?? "", page: ref.page, section: ref.section, ...parts };
  });

/** 3+4) Weakness map with mistake reasons and a link to the page that explains each weak point. */
export const getWeaknessMap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { assertCourseOwner } = await import("./db.server");
    await assertCourseOwner(supabase, data.courseId);
    const { weaknessMap } = await import("./weakness");

    const [{ data: attempts }, { data: questions }, { data: lessons }] = await Promise.all([
      supabase.from("question_attempts").select("question_id, is_correct, time_spent_seconds, created_at").eq("course_id", data.courseId).order("created_at").limit(5000),
      supabase.from("questions").select("id, lesson_id, type").eq("course_id", data.courseId).limit(5000),
      supabase.from("lessons").select("id, title, position").eq("course_id", data.courseId).order("position"),
    ]);
    const qById = new Map((questions ?? []).map((q) => [q.id, q]));
    const rows = weaknessMap(
      (attempts ?? []).map((a) => ({
        lessonId: qById.get(a.question_id)?.lesson_id ?? null,
        questionType: qById.get(a.question_id)?.type ?? "MCQ",
        isCorrect: a.is_correct,
        timeSpentSeconds: a.time_spent_seconds,
        createdAt: a.created_at,
      })),
      (lessons ?? []).map((l) => l.id),
    );
    const title = new Map((lessons ?? []).map((l) => [l.id, l.title]));
    const { data: refs } = await supabase
      .from("source_references")
      .select("id, object_id, page, file_id")
      .eq("course_id", data.courseId)
      .eq("object_type", "lesson")
      .limit(2000);
    const refByLesson = new Map<string, { id: string; page: number | null }>();
    (refs ?? []).forEach((r) => { if (!refByLesson.has(r.object_id)) refByLesson.set(r.object_id, { id: r.id, page: r.page }); });
    return { map: rows.map((r) => ({ ...r, title: title.get(r.lessonId) ?? "", proof: refByLesson.get(r.lessonId) ?? null })) };
  });

/** 3) Countdown plan: rebuilt from the weakness map; call again after every quiz. */
export const rebuildCountdownPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string; examDate: string; hoursPerDay?: number }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertCourseOwner } = await import("./db.server");
    await assertCourseOwner(supabase, data.courseId);
    const { buildCountdownPlan } = await import("./countdownPlan");

    const { data: lessons } = await supabase.from("lessons").select("id, title, is_completed, position").eq("course_id", data.courseId).order("position");
    const { data: attempts } = await supabase.from("question_attempts").select("question_id, is_correct, time_spent_seconds, created_at").eq("course_id", data.courseId).limit(5000);
    const { data: questions } = await supabase.from("questions").select("id, lesson_id, type").eq("course_id", data.courseId).limit(5000);
    const { weaknessMap } = await import("./weakness");
    const qById = new Map((questions ?? []).map((q) => [q.id, q]));
    const weak = new Map(
      weaknessMap(
        (attempts ?? []).map((a) => ({ lessonId: qById.get(a.question_id)?.lesson_id ?? null, questionType: qById.get(a.question_id)?.type ?? "MCQ", isCorrect: a.is_correct, timeSpentSeconds: a.time_spent_seconds, createdAt: a.created_at })),
        (lessons ?? []).map((l) => l.id),
      ).map((w) => [w.lessonId, w.weakness]),
    );
    const plan = buildCountdownPlan({
      examDate: data.examDate,
      hoursPerDay: data.hoursPerDay ?? 2,
      lessons: (lessons ?? []).map((l) => ({ id: l.id, title: l.title, completed: l.is_completed, weakness: weak.get(l.id) ?? 0.5 })),
    });

    await supabase.from("courses").update({ exam_date: data.examDate }).eq("id", data.courseId);
    await supabase.from("study_plan_items").delete().eq("course_id", data.courseId);
    await supabase.from("study_plans").delete().eq("course_id", data.courseId);
    const header = await supabase
      .from("study_plans")
      .insert({ user_id: userId, course_id: data.courseId, hours_per_day: data.hoursPerDay ?? 2, exam_date: data.examDate, is_active: true })
      .select("id")
      .single();
    if (header.error || !header.data) throw new Error("PLAN_CREATE_FAILED");
    if (plan.items.length) {
      await supabase.from("study_plan_items").insert(
        plan.items.map((item, position) => ({
          user_id: userId, course_id: data.courseId, plan_id: header.data.id, lesson_id: item.lessonId,
          scheduled_date: item.date, minutes: item.minutes, kind: item.kind, position,
        })),
      );
    }
    return { items: plan.items.length, daysLeft: plan.daysLeft, overloaded: plan.overloaded };
  });

/** 6) Teacher space. */
export const createCourseShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertCourseOwner } = await import("./db.server");
    const course = await assertCourseOwner(supabase, data.courseId);
    if (!course.is_built) throw new Error("COURSE_NOT_BUILT");
    const { asAnyDb } = await import("./untypedDb.server");
    const db = asAnyDb(supabase);
    const { data: existing } = await db.from("course_shares").select("share_code").eq("course_id", data.courseId).eq("is_active", true).maybeSingle();
    if (existing) return { code: existing.share_code as string };
    const code = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const { error } = await db.from("course_shares").insert({ course_id: data.courseId, owner_id: userId, share_code: code, title: course.title });
    if (error) throw new Error("SHARE_CREATE_FAILED");
    return { code };
  });

export const joinCourseShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string }) => data)
  .handler(async ({ data, context }) => {
    const { asAnyDb } = await import("./untypedDb.server");
    const { data: courseId, error } = await asAnyDb(context.supabase).rpc("join_course_share", { p_code: data.code.trim() });
    if (error) throw new Error("SHARE_NOT_FOUND");
    return { courseId: courseId as string };
  });

/** 1) Dr. exam: learn the professor's style from uploaded past exams, then generate a matching exam. */
export const analyzeProfessorExams = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string; fileIds: string[] }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertCourseOwner } = await import("./db.server");
    await assertCourseOwner(supabase, data.courseId);
    const { analyzeExamStyle } = await import("./examStyle.server");
    return analyzeExamStyle(supabase, userId, data.courseId, data.fileIds);
  });

export const generateProfessorExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string; count?: number }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertCourseOwner } = await import("./db.server");
    await assertCourseOwner(supabase, data.courseId);
    const { assertGenerationQuota } = await import("./quota.server");
    await assertGenerationQuota(supabase, userId);
    const { generateStyledExam } = await import("./examStyle.server");
    return generateStyledExam(supabase, userId, data.courseId, data.count ?? 10);
  });

/** Review mode: items held back by verification (unpublished) so a human can approve or discard them. */
export const listReviewItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { assertCourseOwner } = await import("./db.server");
    await assertCourseOwner(supabase, data.courseId);
    const { data: items } = await supabase
      .from("questions")
      .select("id, lesson_id, type, prompt, options, correct_answer, explanation, support_status, validation")
      .eq("course_id", data.courseId)
      .eq("is_published", false)
      .limit(200);
    return { items: items ?? [] };
  });

export const resolveReviewItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { questionId: string; action: "APPROVE" | "DISCARD" }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.action === "APPROVE") {
      const { data: row } = await supabase.from("questions").select("validation").eq("id", data.questionId).maybeSingle();
      const validation = { ...((row?.validation as Record<string, unknown> | null) ?? {}), reviewed_by_student: true, needs_review: false };
      await supabase.from("questions").update({ is_published: true, validation: validation as never }).eq("id", data.questionId);
    } else {
      await supabase.from("questions").delete().eq("id", data.questionId);
    }
    return { ok: true };
  });

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export const getLesson = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { lessonId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: lesson, error } = await supabase
      .from("lessons")
      .select("*")
      .eq("id", data.lessonId)
      .maybeSingle();
    if (error || !lesson) throw new Error("LESSON_NOT_FOUND");

    const [course, summary, questions, refs] = await Promise.all([
      supabase.from("courses").select("id, title").eq("id", lesson.course_id).single(),
      supabase
        .from("summaries")
        .select("id, body, validation, updated_at")
        .eq("lesson_id", lesson.id)
        .maybeSingle(),
      supabase
        .from("questions")
        .select("id, type, prompt, options, difficulty, attempts, correct_count, next_review_at")
        .eq("lesson_id", lesson.id)
        .eq("is_published", true)
        .order("created_at"),
      supabase
        .from("source_references")
        .select("id, page, section, quoted_text, file_id, files(original_name)")
        .eq("object_type", "lesson")
        .eq("object_id", lesson.id)
        .limit(12),
    ]);

    return {
      lesson,
      course: course.data ?? null,
      summary: summary.data ?? null,
      questions: questions.data ?? [],
      references: refs.data ?? [],
    };
  });

export const setLessonCompleted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { lessonId: string; completed: boolean }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: lesson } = await supabase
      .from("lessons")
      .select("id, course_id")
      .eq("id", data.lessonId)
      .maybeSingle();
    if (!lesson) throw new Error("LESSON_NOT_FOUND");

    await supabase.from("lessons").update({ is_completed: data.completed }).eq("id", lesson.id);

    if (data.completed) {
      const { addDays, refreshProgress } = await import("./study.server");
      const existing = await supabase
        .from("reviews")
        .select("id")
        .eq("lesson_id", lesson.id)
        .is("completed_at", null)
        .maybeSingle();
      if (!existing.data) {
        await supabase.from("reviews").insert({
          user_id: userId,
          course_id: lesson.course_id,
          lesson_id: lesson.id,
          due_at: addDays(new Date(), 1).toISOString(),
          interval_days: 1,
        });
      }
      await refreshProgress(supabase, userId, lesson.course_id);
    } else {
      const { refreshProgress } = await import("./study.server");
      await refreshProgress(supabase, userId, lesson.course_id);
    }
    return { ok: true };
  });

export const getPracticeQuestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: questions } = await supabase
      .from("questions")
      .select("id, lesson_id, type, prompt, options, difficulty, attempts, correct_count, next_review_at")
      .eq("course_id", data.courseId)
      .eq("is_published", true)
      .order("next_review_at", { ascending: true, nullsFirst: true })
      .limit(50);
    return questions ?? [];
  });

export const answerQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { questionId: string; answer: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: question } = await supabase
      .from("questions")
      .select("id, course_id, type, correct_answer, explanation, ease, interval_days, attempts, correct_count")
      .eq("id", data.questionId)
      .maybeSingle();
    if (!question) throw new Error("QUESTION_NOT_FOUND");

    const { gradeAnswer, scheduleNext, addDays, refreshProgress } = await import("./study.server");
    const correct = gradeAnswer(question.type, question.correct_answer, data.answer);
    const next = scheduleNext(question.ease, question.interval_days, correct);

    await supabase.from("question_attempts").insert({
      user_id: userId,
      course_id: question.course_id,
      question_id: question.id,
      answer: data.answer,
      is_correct: correct,
    });

    await supabase
      .from("questions")
      .update({
        attempts: question.attempts + 1,
        correct_count: question.correct_count + (correct ? 1 : 0),
        ease: next.ease,
        interval_days: next.interval_days,
        last_attempt_at: new Date().toISOString(),
        next_review_at: addDays(new Date(), next.interval_days).toISOString(),
      })
      .eq("id", question.id);

    await refreshProgress(supabase, userId, question.course_id);

    const refs = await supabase
      .from("source_references")
      .select("id, page, section, quoted_text, files(original_name)")
      .eq("object_type", "question")
      .eq("object_id", question.id)
      .limit(6);

    return {
      correct,
      correctAnswer: question.correct_answer,
      explanation: question.explanation,
      references: refs.data ?? [],
    };
  });

export const createExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string; count: number; types?: string[] }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertCourseOwner } = await import("./db.server");
    const course = await assertCourseOwner(supabase, data.courseId);
    const count = Math.min(30, Math.max(3, Math.round(data.count)));
    const types = (data.types ?? []).filter(Boolean);

    let poolQuery = supabase
      .from("questions")
      .select("id, attempts, correct_count")
      .eq("course_id", data.courseId)
      .eq("is_published", true)
      .limit(200);
    if (types.length > 0) {
      poolQuery = poolQuery.in(
        "type",
        types as Database["public"]["Enums"]["question_type"][],
      );
    }
    const { data: pool } = await poolQuery;
    if (!pool || pool.length === 0) throw new Error("NO_QUESTIONS");

    // Weakest first: unattempted, then lowest success rate.
    const ordered = [...pool].sort((a, b) => {
      const rate = (q: { attempts: number; correct_count: number }) =>
        q.attempts === 0 ? -1 : q.correct_count / q.attempts;
      return rate(a) - rate(b);
    });
    const selected = ordered.slice(0, count);

    const exam = await supabase
      .from("exams")
      .insert({
        user_id: userId,
        course_id: data.courseId,
        title: `${course.title} — ${new Date().toLocaleDateString("en-CA")}`,
        status: "IN_PROGRESS",
        config: { count: selected.length, selection: "weakest_first", types: types.length ? types : "mixed" },
      })
      .select("id")
      .single();
    if (exam.error || !exam.data) throw new Error("EXAM_CREATE_FAILED");

    await supabase.from("exam_questions").insert(
      selected.map((q, index) => ({
        user_id: userId,
        exam_id: exam.data.id,
        question_id: q.id,
        position: index,
      })),
    );

    return { id: exam.data.id };
  });

export const getExam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { examId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: exam } = await supabase.from("exams").select("*").eq("id", data.examId).maybeSingle();
    if (!exam) throw new Error("EXAM_NOT_FOUND");

    const { data: items } = await supabase
      .from("exam_questions")
      .select(
        "id, position, answer, is_correct, questions(id, type, prompt, options, explanation, correct_answer, lesson_id)",
      )
      .eq("exam_id", exam.id)
      .order("position");

    return { exam, items: items ?? [] };
  });

export const submitExam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { examId: string; answers: { questionId: string; answer: string }[] }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: exam } = await supabase
      .from("exams")
      .select("id, course_id, status")
      .eq("id", data.examId)
      .maybeSingle();
    if (!exam) throw new Error("EXAM_NOT_FOUND");
    if (exam.status === "COMPLETED") throw new Error("EXAM_ALREADY_SUBMITTED");

    const { data: items } = await supabase
      .from("exam_questions")
      .select("id, question_id, questions(id, type, correct_answer, ease, interval_days, attempts, correct_count)")
      .eq("exam_id", exam.id);

    const { gradeAnswer, scheduleNext, addDays, refreshProgress } = await import("./study.server");
    let correctCount = 0;
    let wrongCount = 0;

    for (const item of items ?? []) {
      const question = item.questions;
      if (!question) continue;
      const given = data.answers.find((a) => a.questionId === question.id)?.answer ?? "";
      const correct = given.trim().length > 0 && gradeAnswer(question.type, question.correct_answer, given);
      if (correct) correctCount += 1;
      else wrongCount += 1;

      await supabase
        .from("exam_questions")
        .update({ answer: given, is_correct: correct })
        .eq("id", item.id);

      await supabase.from("question_attempts").insert({
        user_id: userId,
        course_id: exam.course_id,
        question_id: question.id,
        exam_id: exam.id,
        answer: given,
        is_correct: correct,
      });

      const next = scheduleNext(question.ease, question.interval_days, correct);
      await supabase
        .from("questions")
        .update({
          attempts: question.attempts + 1,
          correct_count: question.correct_count + (correct ? 1 : 0),
          ease: next.ease,
          interval_days: next.interval_days,
          last_attempt_at: new Date().toISOString(),
          next_review_at: addDays(new Date(), next.interval_days).toISOString(),
        })
        .eq("id", question.id);
    }

    const total = correctCount + wrongCount;
    const score = total ? Math.round((correctCount / total) * 100) : 0;
    await supabase
      .from("exams")
      .update({
        status: "COMPLETED",
        correct_count: correctCount,
        wrong_count: wrongCount,
        score,
        completed_at: new Date().toISOString(),
      })
      .eq("id", exam.id);

    await refreshProgress(supabase, userId, exam.course_id);
    return { score, correctCount, wrongCount };
  });

export const createStudyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      courseId: string;
      hoursPerDay: number;
      preferredDays: number[];
      targetDate: string | null;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertCourseOwner } = await import("./db.server");
    await assertCourseOwner(supabase, data.courseId);

    const { data: lessons } = await supabase
      .from("lessons")
      .select("id")
      .eq("course_id", data.courseId)
      .order("position");
    if (!lessons || lessons.length === 0) throw new Error("NO_LESSONS");

    await supabase.from("study_plan_items").delete().eq("course_id", data.courseId);
    await supabase.from("study_plans").delete().eq("course_id", data.courseId);

    const plan = await supabase
      .from("study_plans")
      .insert({
        user_id: userId,
        course_id: data.courseId,
        hours_per_day: Math.min(12, Math.max(0.5, data.hoursPerDay)),
        preferred_days: data.preferredDays,
        target_date: data.targetDate,
        exam_date: data.targetDate,
        is_active: true,
      })
      .select("id")
      .single();
    if (plan.error || !plan.data) throw new Error("PLAN_CREATE_FAILED");

    const { buildSchedule } = await import("./study.server");
    const items = buildSchedule({
      lessonIds: lessons.map((l) => l.id),
      hoursPerDay: data.hoursPerDay,
      preferredDays: data.preferredDays,
      targetDate: data.targetDate,
    });

    await supabase.from("study_plan_items").insert(
      items.map((item) => ({
        user_id: userId,
        course_id: data.courseId,
        plan_id: plan.data.id,
        lesson_id: item.lesson_id,
        kind: "lesson",
        scheduled_date: item.scheduled_date,
        minutes: item.minutes,
        position: item.position,
      })),
    );

    return { id: plan.data.id, items: items.length };
  });

export const setPlanItemDone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemId: string; done: boolean }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("study_plan_items")
      .update({ is_done: data.done })
      .eq("id", data.itemId);
    if (error) throw new Error("PLAN_ITEM_UPDATE_FAILED");
    return { ok: true };
  });

export const completeReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { reviewId: string; result: "again" | "good" }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: review } = await supabase
      .from("reviews")
      .select("id, course_id, lesson_id, topic_id, ease, interval_days")
      .eq("id", data.reviewId)
      .maybeSingle();
    if (!review) throw new Error("REVIEW_NOT_FOUND");

    const { scheduleNext, addDays } = await import("./study.server");
    const next = scheduleNext(review.ease, review.interval_days, data.result === "good");

    await supabase
      .from("reviews")
      .update({ completed_at: new Date().toISOString(), last_result: data.result })
      .eq("id", review.id);

    await supabase.from("reviews").insert({
      user_id: userId,
      course_id: review.course_id,
      lesson_id: review.lesson_id,
      topic_id: review.topic_id,
      ease: next.ease,
      interval_days: next.interval_days,
      due_at: addDays(new Date(), next.interval_days).toISOString(),
    });

    return { ok: true, nextInDays: next.interval_days };
  });

export const logStudySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string; seconds: number }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.seconds < 5) return { ok: true };
    const { data: current } = await supabase
      .from("progress")
      .select("study_seconds")
      .eq("course_id", data.courseId)
      .maybeSingle();
    await supabase.from("progress").upsert(
      {
        user_id: userId,
        course_id: data.courseId,
        study_seconds: (current?.study_seconds ?? 0) + Math.round(data.seconds),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "course_id" },
    );
    return { ok: true };
  });

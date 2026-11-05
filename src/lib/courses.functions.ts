import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getBootstrap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { ensureWorkspace } = await import("./db.server");
    const workspaceId = await ensureWorkspace(supabase, userId);

    const [profile, courses, files, progress, subscription, plans] = await Promise.all([
      supabase.from("profiles").select("id, full_name, email, language, theme, content_language, video_language").eq("id", userId).maybeSingle(),
      supabase
        .from("courses")
        .select("id, title, subject, description, exam_date, is_built, built_at, created_at, updated_at")
        .order("updated_at", { ascending: false }),
      supabase.from("files").select("id, course_id, status"),
      supabase.from("progress").select("course_id, lessons_total, lessons_completed, questions_answered, questions_correct"),
      supabase
        .from("subscriptions")
        .select("id, plan_id, status, period, current_period_end")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("plans")
        .select("id, name_ar, name_en, price_monthly, price_yearly, currency, limits, position")
        .eq("is_active", true)
        .order("position", { ascending: true }),
    ]);

    const fileRows = files.data ?? [];
    return {
      workspaceId,
      profile: profile.data ?? null,
      subscription: subscription.data ?? null,
      plans: plans.data ?? [],
      courses: (courses.data ?? []).map((course) => {
        const own = fileRows.filter((f) => f.course_id === course.id);
        const stat = (progress.data ?? []).find((p) => p.course_id === course.id) ?? null;
        return {
          ...course,
          files_total: own.length,
          files_ready: own.filter((f) => f.status === "READY").length,
          files_processing: own.filter((f) => f.status !== "READY" && f.status !== "FAILED").length,
          files_failed: own.filter((f) => f.status === "FAILED").length,
          progress: stat,
        };
      }),
    };
  });

export const createCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { title: string; subject?: string; description?: string; examDate?: string | null }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const title = data.title.trim();
    if (title.length < 2) throw new Error("TITLE_REQUIRED");
    const { ensureWorkspace } = await import("./db.server");
    const { assertCourseQuota } = await import("./quota.server");
    await assertCourseQuota(supabase, userId);
    const workspaceId = await ensureWorkspace(supabase, userId);

    const { data: course, error } = await supabase
      .from("courses")
      .insert({
        user_id: userId,
        workspace_id: workspaceId,
        title,
        subject: data.subject?.trim() || null,
        description: data.description?.trim() || null,
        exam_date: data.examDate || null,
      })
      .select("id")
      .single();
    if (error || !course) throw new Error("COURSE_CREATE_FAILED");
    return { id: course.id };
  });

export const updateCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      courseId: string;
      title?: string;
      subject?: string | null;
      description?: string | null;
      examDate?: string | null;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { assertCourseOwner } = await import("./db.server");
    await assertCourseOwner(supabase, data.courseId);
    const patch: { title?: string; subject?: string | null; description?: string | null; exam_date?: string | null } = {};
    if (data.title !== undefined) patch.title = data.title.trim();
    if (data.subject !== undefined) patch.subject = data.subject;
    if (data.description !== undefined) patch.description = data.description;
    if (data.examDate !== undefined) patch.exam_date = data.examDate;
    const { error } = await supabase.from("courses").update(patch).eq("id", data.courseId);
    if (error) throw new Error("COURSE_UPDATE_FAILED");
    return { ok: true };
  });

export const deleteCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { assertCourseOwner } = await import("./db.server");
    await assertCourseOwner(supabase, data.courseId);

    const { data: files } = await supabase
      .from("files")
      .select("storage_path")
      .eq("course_id", data.courseId);
    const paths = (files ?? []).map((f) => f.storage_path);
    if (paths.length) await supabase.storage.from("sources").remove(paths);

    const { data: notesWithMedia } = await supabase
      .from("notes")
      .select("image_path, audio_path")
      .eq("course_id", data.courseId);
    const notePaths = (notesWithMedia ?? [])
      .flatMap((n) => [n.image_path, n.audio_path])
      .filter((p): p is string => Boolean(p));
    if (notePaths.length) await supabase.storage.from("note-media").remove(notePaths);

    const { error } = await supabase.from("courses").delete().eq("id", data.courseId);
    if (error) throw new Error("COURSE_DELETE_FAILED");
    return { ok: true };
  });

export const getCourseDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertCourseOwner } = await import("./db.server");
    await assertCourseOwner(supabase, data.courseId);
    const courseId = data.courseId;

    const [course, files, units, chapters, lessons, summaries, questions, exams, plan, progress, blocks] =
      await Promise.all([
        supabase.from("courses").select("*").eq("id", courseId).single(),
        supabase
          .from("files")
          .select(
            "id, original_name, mime_type, size_bytes, status, status_detail, error_message, page_count, quality, current_version, created_at, updated_at, storage_path",
          )
          .eq("course_id", courseId)
          .order("created_at", { ascending: true }),
        supabase.from("units").select("id, title, position").eq("course_id", courseId).order("position"),
        supabase
          .from("chapters")
          .select("id, unit_id, title, position")
          .eq("course_id", courseId)
          .order("position"),
        supabase
          .from("lessons")
          .select("id, chapter_id, title, objective, position, is_completed, support_status")
          .eq("course_id", courseId)
          .order("position"),
        supabase
          .from("summaries")
          .select("id, lesson_id, kind, body, is_published, validation, updated_at")
          .eq("course_id", courseId),
        supabase
          .from("questions")
          .select("id, lesson_id, type, difficulty, next_review_at, attempts, correct_count")
          .eq("course_id", courseId),
        supabase
          .from("exams")
          .select("id, title, status, score, correct_count, wrong_count, created_at, completed_at")
          .eq("course_id", courseId)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("study_plans")
          .select("id, hours_per_day, preferred_days, target_date, exam_date, is_active")
          .eq("course_id", courseId)
          .eq("is_active", true)
          .maybeSingle(),
        supabase.from("progress").select("*").eq("course_id", courseId).maybeSingle(),
        supabase.from("content_blocks").select("file_id").eq("course_id", courseId).limit(20000),
      ]);

    if (course.error || !course.data) throw new Error("COURSE_NOT_FOUND");

    const blockCounts = new Map<string, number>();
    (blocks.data ?? []).forEach((b) => blockCounts.set(b.file_id, (blockCounts.get(b.file_id) ?? 0) + 1));

    let planItems: {
      id: string;
      lesson_id: string | null;
      scheduled_date: string;
      minutes: number;
      is_done: boolean;
      position: number;
    }[] = [];
    if (plan.data?.id) {
      const items = await supabase
        .from("study_plan_items")
        .select("id, lesson_id, scheduled_date, minutes, is_done, position")
        .eq("plan_id", plan.data.id)
        .order("position");
      planItems = items.data ?? [];
    }

    const dueReviews = await supabase
      .from("reviews")
      .select("id, lesson_id, due_at, interval_days")
      .eq("course_id", courseId)
      .is("completed_at", null)
      .lte("due_at", new Date().toISOString())
      .order("due_at", { ascending: true })
      .limit(20);

    return {
      course: course.data,
      files: (files.data ?? []).map((f) => ({ ...f, blocks: blockCounts.get(f.id) ?? 0 })),
      units: units.data ?? [],
      chapters: chapters.data ?? [],
      lessons: lessons.data ?? [],
      summaries: summaries.data ?? [],
      questions: questions.data ?? [],
      exams: exams.data ?? [],
      plan: plan.data ?? null,
      planItems,
      progress: progress.data ?? null,
      dueReviews: dueReviews.data ?? [],
      userId,
    };
  });

export const buildCourse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { courseId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertCourseOwner } = await import("./db.server");
    await assertCourseOwner(supabase, data.courseId);
    const { assertGenerationQuota } = await import("./quota.server");
    await assertGenerationQuota(supabase, userId);
    const { buildCourseContent } = await import("./pipeline.server");
    try {
      return await buildCourseContent(supabase, userId, data.courseId);
    } catch (cause) {
      console.error("[build] failed", cause);
      throw new Error(cause instanceof Error ? cause.message : "BUILD_FAILED");
    }
  });

export const getReferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { objectType: string; objectId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: refs } = await supabase
      .from("source_references")
      .select("id, object_type, page, section, quoted_text, file_version, file_id, files(original_name)")
      .eq("object_type", data.objectType)
      .eq("object_id", data.objectId)
      .limit(20);
    return refs ?? [];
  });

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Audio URL + timeline for the lesson whiteboard (null until generated). */
export const getLessonWhiteboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { lessonId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { getWhiteboardLesson } = await import("./whiteboard.server");
    return { whiteboard: await getWhiteboardLesson(supabase, data.lessonId) };
  });

/** Queues whiteboard generation (server TTS + timeline). Requires audio quota; honours the server_tts flag. */
export const enqueueLessonWhiteboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { lessonId: string; language?: "ar" | "en" }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertAudioQuota } = await import("./quota.server");
    await assertAudioQuota(supabase, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isFlagEnabled, enqueueJob, kickWorker } = await import("./queue.server");
    if (!(await isFlagEnabled(supabaseAdmin, "server_tts"))) throw new Error("FEATURE_DISABLED");

    const { data: lesson } = await supabase.from("lessons").select("id, course_id").eq("id", data.lessonId).maybeSingle();
    if (!lesson) throw new Error("LESSON_NOT_FOUND");
    const { data: profile } = await supabase.from("profiles").select("video_language").eq("id", userId).maybeSingle();
    const language = data.language ?? (profile?.video_language === "en" ? "en" : "ar");

    const jobId = await enqueueJob(supabase, {
      userId,
      courseId: lesson.course_id,
      kind: "whiteboard_lesson",
      payload: { lessonId: data.lessonId, language },
    });
    kickWorker();
    return { jobId };
  });

/** Whether the whiteboard UI should be shown at all (feature flag). */
export const getWhiteboardEnabled = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isFlagEnabled } = await import("./queue.server");
    return {
      whiteboard: await isFlagEnabled(supabaseAdmin, "whiteboard"),
      serverTts: await isFlagEnabled(supabaseAdmin, "server_tts"),
    };
  });

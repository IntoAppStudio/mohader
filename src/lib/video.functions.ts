import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getLessonVideo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { lessonId: string }) => data)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: video } = await supabase
      .from("videos")
      .select("id, title, language, duration_ms, status")
      .eq("lesson_id", data.lessonId)
      .maybeSingle();
    if (!video) return { video: null, scenes: [] };

    const { data: scenes } = await supabase
      .from("video_scenes")
      .select("id, position, start_ms, end_ms, title, narration, visual, kind, page, text_segment")
      .eq("video_id", video.id)
      .order("position");

    return { video, scenes: scenes ?? [] };
  });

export const generateLessonVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { lessonId: string; language?: "ar" | "en" }) => data)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { assertVideoQuota } = await import("./quota.server");
    await assertVideoQuota(supabase, userId);

    const { data: profile } = await supabase
      .from("profiles")
      .select("video_language")
      .eq("id", userId)
      .maybeSingle();
    const language =
      data.language ?? (profile?.video_language === "en" ? "en" : "ar");

    const { generateLessonVideoScript } = await import("./video.server");
    try {
      return await generateLessonVideoScript(supabase, userId, data.lessonId, language);
    } catch (cause) {
      console.error("[video] generation failed", cause);
      throw new Error(cause instanceof Error ? cause.message : "VIDEO_FAILED");
    }
  });

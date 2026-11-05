import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      fullName?: string;
      language?: string;
      theme?: string;
      contentLanguage?: string;
      videoLanguage?: string;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: {
      full_name?: string | null;
      language?: string;
      theme?: string;
      content_language?: string;
      video_language?: string;
    } = {};
    if (data.fullName !== undefined) patch.full_name = data.fullName.trim() || null;
    if (data.language === "ar" || data.language === "en") patch.language = data.language;
    if (data.theme && ["light", "dark", "system"].includes(data.theme)) patch.theme = data.theme;
    if (data.contentLanguage === "ar" || data.contentLanguage === "en")
      patch.content_language = data.contentLanguage;
    if (data.videoLanguage === "ar" || data.videoLanguage === "en")
      patch.video_language = data.videoLanguage;
    const { error } = await supabase.from("profiles").update(patch).eq("id", userId);
    if (error) throw new Error("PROFILE_UPDATE_FAILED");
    return { ok: true };
  });

/** Full export of the user's own generated content, so nothing is locked in. */
export const exportWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [courses, units, chapters, lessons, summaries, questions, files, progress] = await Promise.all([
      supabase.from("courses").select("*"),
      supabase.from("units").select("*"),
      supabase.from("chapters").select("*"),
      supabase.from("lessons").select("*"),
      supabase.from("summaries").select("*"),
      supabase.from("questions").select("*"),
      supabase.from("files").select("id, course_id, original_name, mime_type, size_bytes, status, quality"),
      supabase.from("progress").select("*"),
    ]);
    return {
      exported_at: new Date().toISOString(),
      user_id: userId,
      courses: courses.data ?? [],
      units: units.data ?? [],
      chapters: chapters.data ?? [],
      lessons: lessons.data ?? [],
      summaries: summaries.data ?? [],
      questions: questions.data ?? [],
      files: files.data ?? [],
      progress: progress.data ?? [],
    };
  });

export const deleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { confirm: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.confirm !== "DELETE") throw new Error("CONFIRMATION_REQUIRED");

    const { data: files } = await supabase.from("files").select("storage_path");
    const paths = (files ?? []).map((f) => f.storage_path);
    if (paths.length) await supabase.storage.from("sources").remove(paths);

    const { data: notesWithMedia } = await supabase
      .from("notes")
      .select("image_path, audio_path");
    const notePaths = (notesWithMedia ?? [])
      .flatMap((n) => [n.image_path, n.audio_path])
      .filter((p): p is string => Boolean(p));
    if (notePaths.length) await supabase.storage.from("note-media").remove(notePaths);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) {
      console.error("[account] delete failed", error);
      throw new Error("ACCOUNT_DELETE_FAILED");
    }
    return { ok: true };
  });

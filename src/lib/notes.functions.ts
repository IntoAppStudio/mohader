import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SIGNED_URL_TTL_SECONDS = 300;

export const listLessonNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { lessonId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: notes, error } = await supabase
      .from("notes")
      .select("id, title, body, image_path, audio_path, audio_duration_seconds, created_at")
      .eq("lesson_id", data.lessonId)
      .order("created_at", { ascending: false });
    if (error) throw new Error("NOTES_LOAD_FAILED");

    const withUrls = await Promise.all(
      (notes ?? []).map(async (note) => {
        const [image, audio] = await Promise.all([
          note.image_path
            ? supabase.storage.from("note-media").createSignedUrl(note.image_path, SIGNED_URL_TTL_SECONDS)
            : null,
          note.audio_path
            ? supabase.storage.from("note-media").createSignedUrl(note.audio_path, SIGNED_URL_TTL_SECONDS)
            : null,
        ]);
        return {
          id: note.id,
          title: note.title,
          body: note.body,
          created_at: note.created_at,
          audio_duration_seconds: note.audio_duration_seconds,
          image_url: image?.data?.signedUrl ?? null,
          audio_url: audio?.data?.signedUrl ?? null,
        };
      }),
    );
    return { notes: withUrls };
  });

export const createLessonNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      courseId: string;
      lessonId: string;
      body?: string;
      imagePath?: string;
      audioPath?: string;
      audioDurationSeconds?: number;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { assertLessonOwner } = await import("./db.server");
    await assertLessonOwner(supabase, data.courseId, data.lessonId);

    const body = (data.body ?? "").trim();
    if (!body && !data.imagePath && !data.audioPath) throw new Error("EMPTY_NOTE");
    if (data.imagePath && !data.imagePath.startsWith(`${userId}/`)) throw new Error("INVALID_STORAGE_PATH");
    if (data.audioPath && !data.audioPath.startsWith(`${userId}/`)) throw new Error("INVALID_STORAGE_PATH");

    const { data: note, error } = await supabase
      .from("notes")
      .insert({
        user_id: userId,
        course_id: data.courseId,
        lesson_id: data.lessonId,
        body,
        image_path: data.imagePath ?? null,
        audio_path: data.audioPath ?? null,
        audio_duration_seconds: data.audioDurationSeconds ?? null,
      })
      .select("id")
      .single();
    if (error || !note) throw new Error("NOTE_CREATE_FAILED");
    return { id: note.id };
  });

export const deleteLessonNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { noteId: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: note } = await supabase
      .from("notes")
      .select("image_path, audio_path")
      .eq("id", data.noteId)
      .maybeSingle();
    if (!note) throw new Error("NOTE_NOT_FOUND");

    const paths = [note.image_path, note.audio_path].filter((p): p is string => Boolean(p));
    if (paths.length) await supabase.storage.from("note-media").remove(paths);

    const { error } = await supabase.from("notes").delete().eq("id", data.noteId);
    if (error) throw new Error("NOTE_DELETE_FAILED");
    return { ok: true };
  });

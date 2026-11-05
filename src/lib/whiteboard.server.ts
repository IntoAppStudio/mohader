/**
 * Whiteboard lesson = REAL server audio + timeline tied to that audio.
 *
 * 1. Takes (or generates) the lesson's scene script (video_scenes).
 * 2. Synthesises every scene's narration on the server (long text is split and
 *    joined), measuring the REAL duration of each scene from its audio bytes.
 * 3. Joins the scenes into one audio file and stores it in the private
 *    'lesson-audio' bucket (service role only, like tts.server.ts).
 * 4. Builds WRITE_TEXT / DRAW_FORMULA / CLEAR_BOARD events at real timestamps and
 *    stores them in lesson_timelines (the `timelineData` the player needs).
 * 5. Rewrites video_scenes.start_ms/end_ms with the real timings so the existing
 *    video player stops relying on character-count estimates.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assertAudioQuota } from "./quota.server";
import { mapWithConcurrency } from "./concurrency";
import { buildTimeline, type TimelineEvent } from "./timelineBuilder";
import { asAnyDb } from "./untypedDb.server";

type Db = SupabaseClient<Database>;

type SceneRow = { id: string; position: number; title: string | null; narration: string | null; visual: string | null; kind: string };

export type WhiteboardLesson = {
  audioUrl: string;
  timeline: TimelineEvent[];
  durationSeconds: number;
};

export async function generateWhiteboardLesson(
  supabase: Db,
  admin: unknown,
  userId: string,
  lessonId: string,
  language: "ar" | "en",
  onProgress?: (percent: number, detail: string) => Promise<void> | void,
): Promise<{ audioLessonId: string; durationSeconds: number; scenes: number }> {
  await assertAudioQuota(supabase, userId);
  const db = asAnyDb(admin);

  const { data: lesson } = await supabase.from("lessons").select("id, course_id, title").eq("id", lessonId).maybeSingle();
  if (!lesson) throw new Error("LESSON_NOT_FOUND");

  // 1. Scene script (reuse the existing video script generator when none exists yet).
  let { data: video } = await supabase.from("videos").select("id").eq("lesson_id", lessonId).maybeSingle();
  if (!video) {
    const { generateLessonVideoScript } = await import("./video.server");
    await generateLessonVideoScript(supabase, userId, lessonId, language);
    ({ data: video } = await supabase.from("videos").select("id").eq("lesson_id", lessonId).maybeSingle());
  }
  if (!video) throw new Error("VIDEO_CREATE_FAILED");
  const { data: scenes } = await supabase
    .from("video_scenes")
    .select("id, position, title, narration, visual, kind")
    .eq("video_id", video.id)
    .order("position");
  const usable = ((scenes ?? []) as SceneRow[]).filter((s) => (s.narration ?? "").trim().length > 0);
  if (usable.length === 0) throw new Error("NO_SUPPORTED_SCENES");

  // 2. Real audio per scene.
  const { synthesizeLongText } = await import("./ttsChunked.server");
  let done = 0;
  await onProgress?.(5, `0/${usable.length}`);
  const audios = await mapWithConcurrency(usable, 3, async (scene) => {
    const audio = await synthesizeLongText(scene.narration as string);
    done += 1;
    await onProgress?.(5 + (done / usable.length) * 80, `${done}/${usable.length}`);
    return audio;
  });
  const contentType = audios[0]!.contentType;

  // 3. Join + upload.
  const strip = (bytes: Uint8Array) =>
    bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33
      ? bytes.subarray(10 + (((bytes[6]! & 0x7f) << 21) | ((bytes[7]! & 0x7f) << 14) | ((bytes[8]! & 0x7f) << 7) | (bytes[9]! & 0x7f)))
      : bytes;
  const total = audios.reduce((n, a) => n + a.bytes.length, 0);
  const joined = new Uint8Array(total);
  let off = 0;
  audios.forEach((a, i) => {
    const part = i === 0 ? a.bytes : strip(a.bytes);
    joined.set(part, off);
    off += part.length;
  });
  const ext = contentType.includes("wav") ? ".wav" : contentType.includes("mp4") ? ".m4a" : ".mp3";

  const { data: existing } = await supabase.from("audio_lessons").select("id").eq("lesson_id", lessonId).maybeSingle();
  const audioRow = existing?.id
    ? await supabase.from("audio_lessons").update({ status: "RUNNING" }).eq("id", existing.id).select("id").single()
    : await supabase
        .from("audio_lessons")
        .insert({ user_id: userId, course_id: lesson.course_id, lesson_id: lessonId, status: "RUNNING" })
        .select("id")
        .single();
  if (audioRow.error || !audioRow.data) throw new Error("AUDIO_LESSON_CREATE_FAILED");
  const path = `${userId}/${lessonId}/${audioRow.data.id}${ext}`;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const upload = await supabaseAdmin.storage.from("lesson-audio").upload(path, joined, { contentType, upsert: true });
  if (upload.error) {
    await supabase.from("audio_lessons").update({ status: "FAILED" }).eq("id", audioRow.data.id);
    throw upload.error;
  }

  // 4. Real timings -> timeline.
  let cursor = 0;
  const timed = usable.map((scene, i) => {
    const d = audios[i]!.durationSeconds;
    const out = { scene, startSec: cursor, durationSec: d };
    cursor += d;
    return out;
  });
  const timeline = buildTimeline(
    timed.map((t) => ({ title: t.scene.title, visual: t.scene.visual, narration: t.scene.narration, kind: t.scene.kind, startSec: t.startSec, durationSec: t.durationSec })),
  );
  const totalSeconds = cursor;

  await supabase
    .from("audio_lessons")
    .update({
      status: "SUCCEEDED",
      storage_path: path,
      transcript: usable.map((s) => s.narration).join("\n"),
      duration_seconds: Math.max(1, Math.round(totalSeconds)),
    })
    .eq("id", audioRow.data.id);

  await db.from("lesson_timelines").upsert(
    { lesson_id: lessonId, user_id: userId, audio_lesson_id: audioRow.data.id, timeline, duration_seconds: Number(totalSeconds.toFixed(2)) },
    { onConflict: "lesson_id" },
  );

  // 5. Replace estimated scene timings with the real ones.
  for (const t of timed) {
    await supabase
      .from("video_scenes")
      .update({ start_ms: Math.round(t.startSec * 1000), end_ms: Math.round((t.startSec + t.durationSec) * 1000) })
      .eq("id", t.scene.id);
  }
  await supabase.from("videos").update({ duration_ms: Math.round(totalSeconds * 1000) }).eq("id", video.id);

  // Per-character TTS cost log (not token based).
  const chars = usable.reduce((n, s) => n + (s.narration?.length ?? 0), 0);
  await db.from("ai_usage_events").insert({
    user_id: userId, course_id: lesson.course_id, kind: "tts", model: process.env["TTS_MODEL"] || "tts-1",
    prompt_tokens: Math.ceil(chars / 4), completion_tokens: 0, credits: Number(((chars / 1000) * 0.3).toFixed(4)), cache_hit: false,
  });

  return { audioLessonId: audioRow.data.id, durationSeconds: totalSeconds, scenes: usable.length };
}

export async function getWhiteboardLesson(supabase: Db, lessonId: string): Promise<WhiteboardLesson | null> {
  const db = asAnyDb(supabase);
  const { data: row } = await db.from("lesson_timelines").select("timeline, duration_seconds, audio_lesson_id").eq("lesson_id", lessonId).maybeSingle();
  if (!row) return null;
  const { getAudioLessonUrl } = await import("./tts.server");
  const audioUrl = await getAudioLessonUrl(supabase, lessonId);
  if (!audioUrl) return null;
  return { audioUrl, timeline: (row.timeline ?? []) as TimelineEvent[], durationSeconds: Number(row.duration_seconds) || 0 };
}

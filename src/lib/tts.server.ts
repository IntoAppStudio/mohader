/**
 * AI-generated lesson narration (Audio Lessons). Server-only.
 * Same provider-agnostic shape as src/lib/ai.server.ts: any endpoint that
 * speaks the OpenAI "audio/speech" wire format works via
 * TTS_GATEWAY_URL / TTS_API_KEY / TTS_VOICE.
 *
 * Deliberately separate from the user's own voice notes
 * (src/lib/notes.functions.ts) — this generates and owns the audio itself.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { assertAudioQuota } from "./quota.server";

type Db = SupabaseClient<Database>;

export class TtsUnavailableError extends Error {}

async function synthesizeSpeech(text: string): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const gateway = process.env["TTS_GATEWAY_URL"];
  const key = process.env["TTS_API_KEY"];
  const voice = process.env["TTS_VOICE"] || "alloy";
  if (!gateway) throw new TtsUnavailableError("TTS_GATEWAY_URL is not configured");
  if (!key) throw new TtsUnavailableError("TTS_API_KEY is not configured");

  const response = await fetch(gateway, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "tts-1",
      voice,
      input: text.slice(0, 4000), // provider input limit
    }),
  });

  if (response.status === 429) throw new TtsUnavailableError("RATE_LIMIT");
  if (response.status === 402) throw new TtsUnavailableError("CREDITS_REQUIRED");
  if (!response.ok) {
    console.error("[tts] gateway error", response.status, (await response.text()).slice(0, 500));
    throw new TtsUnavailableError("GATEWAY_ERROR");
  }
  return { bytes: await response.arrayBuffer(), contentType: response.headers.get("content-type") || "audio/mpeg" };
}

/** ~150 wpm average speaking rate; a real duration needs decoding the audio, which is out of
 * scope here — this is a labeled estimate, not a precise value. */
function estimateDurationSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round((words / 150) * 60));
}

export async function generateAudioLesson(
  supabase: Db,
  userId: string,
  courseId: string,
  lessonId: string,
  textContent: string,
): Promise<{ id: string }> {
  await assertAudioQuota(supabase, userId);

  const { data: existing } = await supabase
    .from("audio_lessons")
    .select("id")
    .eq("lesson_id", lessonId)
    .maybeSingle();

  const jobId = existing?.id;
  const { data: row, error: insertError } = jobId
    ? await supabase.from("audio_lessons").update({ status: "RUNNING" }).eq("id", jobId).select("id").single()
    : await supabase
        .from("audio_lessons")
        .insert({ user_id: userId, course_id: courseId, lesson_id: lessonId, status: "RUNNING" })
        .select("id")
        .single();
  if (insertError || !row) throw new Error("AUDIO_LESSON_CREATE_FAILED");

  try {
    // Long text is split into parts, synthesised and joined (no silent 4000-char truncation),
    // and the duration is measured from the real audio instead of estimated by word count.
    const { synthesizeLongText } = await import("./ttsChunked.server");
    const synthesized = await synthesizeLongText(textContent);
    const bytes = synthesized.bytes;
    const contentType = synthesized.contentType;
    const ext = contentType.includes("wav") ? ".wav" : contentType.includes("mp4") ? ".m4a" : ".mp3";
    const path = `${userId}/${lessonId}/${row.id}${ext}`;

    // service-role only: the 'lesson-audio' bucket has no authenticated
    // insert policy (see its migration) — the app generates this, the
    // browser never uploads it directly.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: uploadError } = await supabaseAdmin.storage
      .from("lesson-audio")
      .upload(path, bytes, { contentType, upsert: true });
    if (uploadError) throw uploadError;

    await supabase
      .from("audio_lessons")
      .update({
        status: "SUCCEEDED",
        storage_path: path,
        transcript: textContent,
        duration_seconds: Math.max(1, Math.round(synthesized.durationSeconds)),
      })
      .eq("id", row.id);
    return { id: row.id };
  } catch (error) {
    const reason = error instanceof TtsUnavailableError ? error.message : "UNKNOWN_ERROR";
    await supabase.from("audio_lessons").update({ status: "FAILED" }).eq("id", row.id);
    console.error("[tts] generation failed", reason, error);
    throw error;
  }
}

/** Signed URL for playback, or null if this lesson has no (successful) audio yet. RLS on
 * audio_lessons already scopes this to the caller's own rows. */
export async function getAudioLessonUrl(supabase: Db, lessonId: string): Promise<string | null> {
  const { data } = await supabase
    .from("audio_lessons")
    .select("storage_path, status")
    .eq("lesson_id", lessonId)
    .maybeSingle();
  if (!data || data.status !== "SUCCEEDED" || !data.storage_path) return null;

  const { data: signed } = await supabase.storage.from("lesson-audio").createSignedUrl(data.storage_path, 3600);
  return signed?.signedUrl ?? null;
}

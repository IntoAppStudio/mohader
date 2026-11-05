/**
 * Lesson video generation. Server-only.
 * The video is a narrated, scene-by-scene explanation built strictly from the
 * lesson's own source blocks: every method is presented the way the source
 * solves it, and every formula and figure of the lesson gets its own scene.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { aiJson, SOURCE_BOUND_SYSTEM } from "./ai.server";

type Db = SupabaseClient<Database>;

type AiScene = {
  title?: string;
  narration?: string;
  visual?: string;
  kind?: string;
  refs?: number[];
};
type AiScript = { title?: string; scenes?: AiScene[] };

const SCENE_KINDS = ["intro", "explanation", "formula", "figure", "method", "example", "recap"];

/** ~14 readable characters per second of narration. */
function sceneMs(narration: string): number {
  return Math.min(90000, Math.max(6000, Math.round((narration.length / 14) * 1000)));
}

export async function generateLessonVideoScript(
  supabase: Db,
  userId: string,
  lessonId: string,
  language: "ar" | "en",
) {
  const { data: lesson } = await supabase
    .from("lessons")
    .select(
      "id, course_id, title, objective, explanation_standard, explanation_detailed, formulas, figures, worked_examples",
    )
    .eq("id", lessonId)
    .maybeSingle();
  if (!lesson) throw new Error("LESSON_NOT_FOUND");

  const { data: refs } = await supabase
    .from("source_references")
    .select("content_block_id")
    .eq("object_type", "lesson")
    .eq("object_id", lessonId)
    .limit(40);
  const blockIds = (refs ?? [])
    .map((r) => r.content_block_id)
    .filter((id): id is string => typeof id === "string");

  const { data: blocks } = blockIds.length
    ? await supabase
        .from("content_blocks")
        .select("id, file_id, page, original_text")
        .in("id", blockIds)
        .order("position", { ascending: true })
    : { data: [] as { id: string; file_id: string; page: number | null; original_text: string }[] };

  const indexed = (blocks ?? []).slice(0, 40);
  const langName = language === "en" ? "English" : "Arabic";

  const prompt = [
    `Lesson: ${lesson.title}`,
    lesson.objective ? `Objective: ${lesson.objective}` : "",
    `Narrate the whole video in ${langName}.`,
    "",
    "LESSON SOURCE BLOCKS (numbered):",
    indexed.map((b, i) => `[${i}] (page ${b.page ?? "-"}) ${b.original_text.slice(0, 1200)}`).join("\n"),
    "",
    "LESSON FORMULAS:",
    JSON.stringify(lesson.formulas ?? []),
    "LESSON FIGURES:",
    JSON.stringify(lesson.figures ?? []),
    "LESSON WORKED EXAMPLES (solved by the source's method):",
    JSON.stringify(lesson.worked_examples ?? []),
    "",
    "Build a scene-by-scene explanation video script for this ONE lesson.",
    "Rules:",
    "1. Cover the whole lesson. Do not shorten the material; only skip wording that repeats itself.",
    "2. One scene for every formula (explaining each symbol and how it is used in a problem), one scene for every figure (what it shows and how it is read), and one scene for every worked example.",
    "3. Solve every problem ONLY with the method written in the source, step by step, in the same order and notation. Never present an alternative method.",
    "4. `visual` describes what is written on screen for that scene: short lines, the formula, or the solution steps.",
    "5. `narration` is what is spoken. Natural spoken sentences, no markdown, no emojis.",
    "6. `refs` are the block ids the scene came from. A scene with no refs is discarded.",
    `7. kind is one of: ${SCENE_KINDS.join(", ")}.`,
    "",
    'Return JSON: {"title":"...","scenes":[{"title":"...","narration":"...","visual":"...","kind":"formula","refs":[0]}]}',
  ]
    .filter(Boolean)
    .join("\n");

  const script = await aiJson<AiScript>(SOURCE_BOUND_SYSTEM, prompt);
  const scenes = (script.scenes ?? []).filter(
    (scene) => scene?.narration && Array.isArray(scene.refs) && scene.refs.length > 0,
  );
  if (scenes.length === 0) throw new Error("NO_SUPPORTED_SCENES");

  await supabase.from("videos").delete().eq("lesson_id", lessonId);

  const video = await supabase
    .from("videos")
    .insert({
      user_id: userId,
      course_id: lesson.course_id,
      lesson_id: lessonId,
      mode: "explainer",
      status: "SUCCEEDED",
      language,
      title: script.title ?? lesson.title,
    })
    .select("id")
    .single();
  if (video.error || !video.data) throw new Error("VIDEO_CREATE_FAILED");

  let cursor = 0;
  const rows = scenes.slice(0, 40).map((scene, position) => {
    const narration = scene.narration!.trim();
    const duration = sceneMs(narration);
    const start = cursor;
    cursor += duration;
    const block = indexed[scene.refs?.[0] ?? 0];
    return {
      user_id: userId,
      video_id: video.data.id,
      position,
      start_ms: start,
      end_ms: cursor,
      title: scene.title ?? null,
      narration,
      visual: scene.visual ?? null,
      kind: SCENE_KINDS.includes(scene.kind ?? "") ? scene.kind! : "explanation",
      text_segment: block?.original_text.slice(0, 800) ?? null,
      file_id: block?.file_id ?? null,
      page: block?.page ?? null,
    };
  });

  const insert = await supabase.from("video_scenes").insert(rows);
  if (insert.error) throw new Error("VIDEO_SCENES_FAILED");

  await supabase.from("videos").update({ duration_ms: cursor }).eq("id", video.data.id);

  return { videoId: video.data.id, scenes: rows.length, durationMs: cursor };
}

/**
 * Source processing and course building. Server-only.
 * All database access goes through the caller's RLS-scoped client, so a user can
 * only ever process and build from their own sources.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { aiJson, SOURCE_BOUND_SYSTEM } from "./ai.server";
import {
  assessQuality,
  extractDocument,
  isExtractable,
  segmentSource,
  toBlocks,
} from "./extract.server";
import { formulaAppearsInSource, verifyAgainstSource } from "./verify.server";
import { expandSegments } from "./segmentSplit";
import { mapWithConcurrency } from "./concurrency";
import { aiJsonCached } from "./aiCache.server";
import { SEMANTIC_SUPPORTED_AT, SEMANTIC_UNSUPPORTED_BELOW, semanticSupportScore } from "./semanticVerify.server";

type Db = SupabaseClient<Database>;

const MAX_LESSONS = Number(process.env["MAX_LESSONS"]) > 0 ? Number(process.env["MAX_LESSONS"]) : 60;
const SEGMENT_CHARS = 22000;

/** Optional knobs for queue-driven builds. All are optional: the direct call still works as before. */
export type BuildOptions = {
  /** Parallel AI calls (3-5 recommended). Default 4. */
  concurrency?: number;
  /** Live progress hook (0-100) used to drive the progress bar. */
  onProgress?: (percent: number, detail: string) => Promise<void> | void;
  /** Service client for the content-hash cache; omit to disable caching. */
  cacheAdmin?: unknown;
  /** Only build from this page range (uses the same page semantics as chunkingEngine's custom range). */
  pageRange?: { startPage: number; endPage: number };
  /** Cap one lesson segment to this many minutes of narration (chunkingEngine's 15-minute rule). 0/undefined = size limit only. */
  maxSegmentMinutes?: number;
  /** Receives cache statistics for credit/usage logging. */
  stats?: { cacheHits: number; skippedByLessonCap: number; reviewItems: number };
};

export async function processUploadedFile(
  supabase: Db,
  userId: string,
  fileId: string,
  options: { jobId?: string } = {},
) {
  const { data: file, error } = await supabase
    .from("files")
    .select("id, course_id, storage_path, mime_type, original_name, current_version")
    .eq("id", fileId)
    .single();
  if (error || !file) throw new Error("FILE_NOT_FOUND");

  // When driven by the queue, the worker already owns a job row; reuse it instead of creating a duplicate.
  const job = options.jobId
    ? { data: { id: options.jobId } }
    : await supabase
        .from("jobs")
        .insert({
          user_id: userId,
          course_id: file.course_id,
          file_id: file.id,
          kind: "process_file",
          status: "RUNNING",
          progress: 5,
        })
        .select("id")
        .single();
  const jobId = job.data?.id;

  const fail = async (reason: string, detail?: string) => {
    await supabase
      .from("files")
      .update({ status: "FAILED", error_message: reason, status_detail: detail ?? null })
      .eq("id", fileId);
    if (jobId) {
      await supabase
        .from("jobs")
        .update({ status: "FAILED", failure_reason: reason, completed_at: new Date().toISOString() })
        .eq("id", jobId);
    }
  };

  if (!isExtractable(file.mime_type, file.original_name)) {
    await fail("UNSUPPORTED_FILE_TYPE");
    return { status: "FAILED" as const, reason: "UNSUPPORTED_FILE_TYPE" };
  }

  const { data: profile } = await supabase.from("profiles").select("content_language").eq("id", userId).maybeSingle();
  const contentLanguage = profile?.content_language === "en" ? "en" : "ar";

  try {
    await supabase.from("files").update({ status: "READING" }).eq("id", fileId);
    const download = await supabase.storage.from("sources").download(file.storage_path);
    if (download.error || !download.data) throw new Error("DOWNLOAD_FAILED");
    const bytes = await download.data.arrayBuffer();

    const doc = await extractDocument(bytes, file.mime_type, file.original_name);
    const preliminaryBlocks = toBlocks(doc.pages);
    const preliminaryQuality = assessQuality(doc, preliminaryBlocks);

    // Scanned/image-only PDF pages: plain text extraction found ~nothing, so
    // read those pages visually instead of leaving the file half-empty and
    // just warning about it (the previous behavior — needs_ocr was computed
    // and stored but nothing ever acted on it).
    if (preliminaryQuality.needs_ocr) {
      await supabase.from("files").update({ status: "OCR" }).eq("id", fileId);
      if (jobId) await supabase.from("jobs").update({ progress: 25 }).eq("id", jobId);
      try {
        const { readPdfPages } = await import("./vision.server");
        const readings = await readPdfPages(bytes, file.original_name, contentLanguage);
        for (const reading of readings) {
          const index = reading.page - 1;
          if (index < 0 || index >= doc.pages.length) continue;
          const figureText = reading.figures
            .map((f) => `[${f.caption}] ${f.description}${f.formulas.length ? " — " + f.formulas.join("; ") : ""}`)
            .join("\n");
          const merged = [reading.text.trim(), figureText].filter(Boolean).join("\n");
          // Only replace pages OCR actually improved on; never discard text
          // that plain extraction already found.
          if (merged.length > doc.pages[index]!.length) doc.pages[index] = merged;
        }
      } catch (visionError) {
        // OCR is a best-effort fallback, not a hard requirement — if the
        // vision pass itself fails (provider down, quota, etc.), continue
        // with whatever plain extraction already found rather than failing
        // the whole upload.
        console.error("[pipeline] OCR fallback failed, continuing with plain extraction", visionError);
      }
    }

    const blocks = toBlocks(doc.pages).slice(0, 4000);
    if (blocks.length === 0) {
      await fail("NO_TEXT_EXTRACTED");
      return { status: "FAILED" as const, reason: "NO_TEXT_EXTRACTED" };
    }

    await supabase.from("files").update({ status: "EXTRACTING_STRUCTURE" }).eq("id", fileId);
    if (jobId) await supabase.from("jobs").update({ progress: 45 }).eq("id", jobId);

    await supabase
      .from("content_blocks")
      .delete()
      .eq("file_id", fileId)
      .eq("file_version", file.current_version);

    const rows = blocks.map((b) => ({
      user_id: userId,
      course_id: file.course_id,
      file_id: fileId,
      file_version: file.current_version,
      block_type: b.block_type,
      original_text: b.original_text,
      page: b.page,
      position: b.position,
      section: b.section,
    }));
    for (let i = 0; i < rows.length; i += 400) {
      const insert = await supabase.from("content_blocks").insert(rows.slice(i, i + 400));
      if (insert.error) throw insert.error;
    }

    const quality = assessQuality(doc, blocks);
    await supabase
      .from("files")
      .update({
        status: "READY",
        page_count: doc.pageCount,
        quality,
        status_detail: null,
        error_message: null,
      })
      .eq("id", fileId);

    if (jobId) {
      await supabase
        .from("jobs")
        .update({ status: "SUCCEEDED", progress: 100, completed_at: new Date().toISOString() })
        .eq("id", jobId);
    }

    return { status: "READY" as const, blocks: blocks.length, pages: doc.pageCount, quality };
  } catch (cause) {
    console.error("[pipeline] processing failed", cause);
    await fail("PROCESSING_ERROR", cause instanceof Error ? cause.message : undefined);
    return { status: "FAILED" as const, reason: "PROCESSING_ERROR" };
  }
}

type AiFormula = {
  name?: string;
  expression?: string;
  meaning?: string;
  usage?: string;
  refs?: number[];
};
type AiFigure = { caption?: string; description?: string; refs?: number[] };
type AiExample = {
  title?: string;
  problem?: string;
  steps?: string[];
  answer?: string;
  refs?: number[];
};
type AiQuestion = {
  type?: string;
  prompt?: string;
  options?: string[];
  correct_answer?: unknown;
  explanation?: string;
  difficulty?: number;
  refs?: number[];
};
type AiLessonPack = {
  title?: string;
  objective?: string;
  brief?: string;
  explanation_standard?: string;
  explanation_simple?: string;
  explanation_detailed?: string;
  formulas?: AiFormula[];
  figures?: AiFigure[];
  worked_examples?: AiExample[];
  questions?: AiQuestion[];
  refs?: number[];
};

const QUESTION_TYPES = [
  "MCQ",
  "TRUE_FALSE",
  "FILL_BLANK",
  "DEFINITION",
  "SHORT_ANSWER",
  "CALCULATION",
  "SCENARIO",
  "PROBLEM_SOLVING",
] as const;

/** The lesson contract sent for every source segment. Nothing may be dropped. */
function lessonPrompt(input: {
  courseTitle: string;
  fileName: string;
  lessonTitle: string;
  pages: number[];
  language: string;
  body: string;
}) {
  const langName = input.language === "en" ? "English" : "Arabic";
  return [
    `Course: ${input.courseTitle}`,
    `Source file: ${input.fileName}`,
    `Lesson section as divided by the file itself: ${input.lessonTitle}`,
    input.pages.length ? `Pages: ${input.pages.join(", ")}` : "",
    `Write ALL output in ${langName}.`,
    "",
    "SOURCE BLOCKS OF THIS LESSON (numbered):",
    input.body,
    "",
    "Hard rules for this lesson:",
    "1. This is ONE lesson. Do not split it, do not create sub-lessons, and do not merge it with anything else. The file's own division decides the lesson boundaries.",
    "2. Do NOT shorten the material. Cover every idea, rule, symbol, condition and step that appears in the blocks. The only thing you may compress is text that repeats the same content in nearly identical wording; say nothing new is lost.",
    "3. Every formula, law, rule, equation and constant in the blocks must appear in `formulas`, written exactly as in the source.",
    "4. Every figure, diagram, drawing, table or chart mentioned in the blocks must appear in `figures` with its caption and what it shows. Never drop one.",
    "5. Every solved problem, exercise or example must appear in `worked_examples`, solved ONLY with the method written in the source, step by step, in the source's order and notation. Never substitute an alternative method or a shortcut.",
    "6. Questions: produce between 8 and 14 questions for this lesson, and vary the types deliberately:",
    "   - MCQ with exactly 4 options (correct_answer = exact text of the correct option)",
    "   - at least one MCQ of the form 'three statements are correct and one is wrong — choose the wrong one' (correct_answer = the wrong statement text)",
    "   - TRUE_FALSE (correct_answer = true or false)",
    "   - FILL_BLANK using ____ inside the prompt (correct_answer = the missing text)",
    "   - DEFINITION asking the student to write a term's definition (correct_answer = the source definition)",
    "   - CALCULATION or PROBLEM_SOLVING for every kind of problem in the lesson, solved with the source's own method",
    "   - SHORT_ANSWER or SCENARIO where the source supports it",
    "   - include questions about the figures and about applying each formula",
    "7. `refs` on every object: the integer ids of the blocks it came from. Objects with no refs are discarded.",
    "",
    "Return JSON exactly in this shape:",
    '{"title":"...","objective":"...","brief":"summary of this lesson, one idea per line, nothing important removed",',
    '"explanation_standard":"full explanation","explanation_simple":"same content, simpler wording","explanation_detailed":"full detail including every step",',
    '"formulas":[{"name":"...","expression":"as written in the source","meaning":"what each symbol means","usage":"how it is used in a problem, per the source","refs":[0]}],',
    '"figures":[{"caption":"...","description":"what the figure shows and how it is read","refs":[1]}],',
    '"worked_examples":[{"title":"...","problem":"...","steps":["step 1 exactly as the source solves it"],"answer":"...","refs":[2]}],',
    '"questions":[{"type":"MCQ","prompt":"...","options":["a","b","c","d"],"correct_answer":"a","explanation":"...","difficulty":2,"refs":[0]}],',
    '"refs":[0,1]}',
  ]
    .filter(Boolean)
    .join("\n");
}

export async function buildCourseContent(
  supabase: Db,
  userId: string,
  courseId: string,
  options: BuildOptions = {},
) {
  const stats = options.stats ?? { cacheHits: 0, skippedByLessonCap: 0, reviewItems: 0 };
  // chunkingEngine's model: 200 tokens/minute narration, ~3.5 chars/token.
  const segmentChars = options.maxSegmentMinutes && options.maxSegmentMinutes > 0
    ? Math.min(SEGMENT_CHARS, Math.max(2000, Math.round(options.maxSegmentMinutes * 200 * 3.5)))
    : SEGMENT_CHARS;
  const concurrency = Math.min(5, Math.max(1, options.concurrency ?? 4));
  const reportProgress = async (percent: number, detail: string) => {
    try {
      await options.onProgress?.(Math.max(0, Math.min(99, Math.round(percent))), detail);
    } catch (progressError) {
      console.error("[build] progress hook failed", progressError);
    }
  };
  const { data: course, error: courseError } = await supabase
    .from("courses")
    .select("id, title, subject, language")
    .eq("id", courseId)
    .single();
  if (courseError || !course) throw new Error("COURSE_NOT_FOUND");

  const { data: profile } = await supabase
    .from("profiles")
    .select("content_language")
    .eq("id", userId)
    .maybeSingle();
  const contentLanguage = profile?.content_language === "en" ? "en" : "ar";

  const { data: files } = await supabase
    .from("files")
    .select("id, original_name, current_version, status")
    .eq("course_id", courseId)
    .order("created_at", { ascending: true });
  const readyFiles = (files ?? []).filter((f) => f.status === "READY");
  if (readyFiles.length === 0) throw new Error("NO_READY_SOURCES");

  const { data: allBlocks } = await supabase
    .from("content_blocks")
    .select("id, file_id, page, position, section, original_text, block_type")
    .eq("course_id", courseId)
    .order("position", { ascending: true })
    .limit(8000);
  const inRange = (page: number | null) =>
    !options.pageRange || (typeof page === "number" && page >= options.pageRange.startPage && page <= options.pageRange.endPage);
  const usable = (allBlocks ?? []).filter((b) => b.original_text.trim().length > 2 && inRange(b.page));
  if (usable.length === 0) throw new Error("NO_SOURCE_CONTENT");

  // Rebuild generated content from scratch; sources and uploads are untouched.
  await supabase.from("source_references").delete().eq("course_id", courseId);
  await supabase.from("questions").delete().eq("course_id", courseId);
  await supabase.from("summaries").delete().eq("course_id", courseId);
  await supabase.from("study_plan_items").delete().eq("course_id", courseId);
  await supabase.from("study_plans").delete().eq("course_id", courseId);
  await supabase.from("reviews").delete().eq("course_id", courseId);
  await supabase.from("video_scenes").delete().eq("user_id", userId);
  await supabase.from("videos").delete().eq("course_id", courseId);
  await supabase.from("lessons").delete().eq("course_id", courseId);
  await supabase.from("chapters").delete().eq("course_id", courseId);
  await supabase.from("units").delete().eq("course_id", courseId);

  // ---- Parallel pre-pass: every AI lesson call runs 3-5 at a time, with content-hash caching. ----
  type PrefetchResult = { ok: true; pack: AiLessonPack } | { ok: false };
  const prefetched = new Map<string, PrefetchResult>();
  {
    const planned: { key: string; prompt: string }[] = [];
    for (const file of readyFiles) {
      const fileBlocks = usable.filter((b) => b.file_id === file.id);
      if (fileBlocks.length === 0) continue;
      const segs = expandSegments(segmentSource(fileBlocks, file.original_name), fileBlocks, segmentChars);
      segs.forEach((segment, segIdx) => {
        if (planned.length >= MAX_LESSONS + 10) return; // small buffer for failed/empty segments
        const lines: string[] = [];
        let used = 0;
        let count = 0;
        for (const id of segment.blockIds) {
          const block = fileBlocks[id];
          if (!block) continue;
          const text = block.original_text.trim();
          if (used + text.length > segmentChars && count > 0) break;
          used += text.length;
          lines.push(`[${count}] (page ${block.page ?? "-"}) ${text}`);
          count += 1;
        }
        if (count === 0) return;
        planned.push({
          key: `${file.id}:${segIdx}`,
          prompt: lessonPrompt({
            courseTitle: course.title,
            fileName: file.original_name,
            lessonTitle: segment.lessonTitle,
            pages: segment.pages,
            language: contentLanguage,
            body: lines.join("\n"),
          }),
        });
      });
    }
    let finished = 0;
    await reportProgress(5, `0/${planned.length}`);
    await mapWithConcurrency(planned, concurrency, async (item) => {
      try {
        if (options.cacheAdmin) {
          const { value, cacheHit } = await aiJsonCached<AiLessonPack>(options.cacheAdmin, "lesson_pack", SOURCE_BOUND_SYSTEM, item.prompt, { userId });
          if (cacheHit) stats.cacheHits += 1;
          prefetched.set(item.key, { ok: true, pack: value });
        } else {
          prefetched.set(item.key, { ok: true, pack: await aiJson<AiLessonPack>(SOURCE_BOUND_SYSTEM, item.prompt) });
        }
      } catch (cause) {
        console.error("[build] prefetch failed", item.key, cause);
        prefetched.set(item.key, { ok: false });
      }
      finished += 1;
      await reportProgress(5 + (finished / Math.max(1, planned.length)) * 75, `${finished}/${planned.length}`);
    });
  }

  const references: Database["public"]["Tables"]["source_references"]["Insert"][] = [];
  let lessonPosition = 0;
  let questionCount = 0;
  let unitPosition = 0;
  let chapterPosition = 0;
  let failedSegments = 0;

  for (const file of readyFiles) {
    const fileBlocks = usable.filter((b) => b.file_id === file.id);
    if (fileBlocks.length === 0) continue;

    const segments = expandSegments(segmentSource(fileBlocks, file.original_name), fileBlocks, segmentChars);
    if (segments.length === 0) continue;

    const unitRow = await supabase
      .from("units")
      .insert({
        user_id: userId,
        course_id: courseId,
        title: file.original_name,
        position: unitPosition++,
      })
      .select("id")
      .single();
    if (unitRow.error || !unitRow.data) continue;

    const chapterRow = await supabase
      .from("chapters")
      .insert({
        user_id: userId,
        course_id: courseId,
        unit_id: unitRow.data.id,
        title: file.original_name,
        position: chapterPosition++,
      })
      .select("id")
      .single();
    if (chapterRow.error || !chapterRow.data) continue;

    for (const segment of segments) {
      if (lessonPosition >= MAX_LESSONS) {
        // Not silent anymore: counted and reported so the UI/notification can warn the student.
        stats.skippedByLessonCap += 1;
        continue;
      }

      const segmentBlocks = segment.blockIds
        .map((index) => fileBlocks[index])
        .filter((b): b is (typeof fileBlocks)[number] => Boolean(b));
      if (segmentBlocks.length === 0) continue;

      const lines: string[] = [];
      let used = 0;
      const indexed: typeof segmentBlocks = [];
      for (const block of segmentBlocks) {
        const text = block.original_text.trim();
        // An oversize single block is still included (segmentSplit gave it its own part); never skipped silently.
        if (used + text.length > segmentChars && indexed.length > 0) break;
        used += text.length;
        lines.push(`[${indexed.length}] (page ${block.page ?? "-"}) ${text}`);
        indexed.push(block);
      }
      if (indexed.length === 0) continue;

      let pack: AiLessonPack;
      try {
        const early = prefetched.get(`${file.id}:${segments.indexOf(segment)}`);
        if (early?.ok) {
          pack = early.pack;
        } else if (early && !early.ok) {
          throw new Error("PREFETCH_FAILED");
        } else {
          pack = await aiJson<AiLessonPack>(
            SOURCE_BOUND_SYSTEM,
            lessonPrompt({
              courseTitle: course.title,
              fileName: file.original_name,
              lessonTitle: segment.lessonTitle,
              pages: segment.pages,
              language: contentLanguage,
              body: lines.join("\n"),
            }),
          );
        }
      } catch (cause) {
        console.error("[build] segment failed", segment.lessonTitle, cause);
        failedSegments += 1;
        continue;
      }

      const blockIdOf = (ref: unknown) =>
        typeof ref === "number" ? indexed[ref]?.id : undefined;
      const validRefs = (refs: unknown): string[] => {
        if (!Array.isArray(refs)) return [];
        return refs.map(blockIdOf).filter((v): v is string => typeof v === "string");
      };
      const blockById = new Map(indexed.map((b) => [b.id, b]));
      const addRefs = (objectType: string, objectId: string, blockIds: string[]) => {
        blockIds.slice(0, 8).forEach((blockId) => {
          const block = blockById.get(blockId);
          if (!block) return;
          references.push({
            user_id: userId,
            course_id: courseId,
            object_type: objectType,
            object_id: objectId,
            file_id: block.file_id,
            file_version: file.current_version,
            content_block_id: block.id,
            page: block.page,
            section: block.section,
            quoted_text: block.original_text.slice(0, 800),
          });
        });
      };

      const lessonRefs = validRefs(pack.refs).length
        ? validRefs(pack.refs)
        : indexed.slice(0, 6).map((b) => b.id);

      const lessonSourceText = lessonRefs
        .map((id) => blockById.get(id)?.original_text)
        .filter((t): t is string => Boolean(t))
        .join("\n");
      const lessonExplanation = pack.explanation_standard || pack.explanation_simple || pack.objective || "";
      const lessonVerification = verifyAgainstSource(lessonExplanation, lessonSourceText, { checkNumbers: true });

      const keepRefs = <T extends { refs?: number[] }>(items: T[] | undefined) =>
        (items ?? [])
          .map((item) => ({ item, refs: validRefs(item.refs) }))
          .filter((entry) => entry.refs.length > 0);

      const formulas = keepRefs(pack.formulas).map(({ item, refs }) => ({
        name: item.name ?? null,
        expression: item.expression ?? "",
        meaning: item.meaning ?? null,
        usage: item.usage ?? null,
        needs_review: !formulaAppearsInSource(
          item.expression ?? "",
          refs.map((id) => blockById.get(id)?.original_text ?? "").join("\n"),
        ),
        pages: refs
          .map((id) => blockById.get(id)?.page ?? null)
          .filter((p): p is number => typeof p === "number"),
      }));
      const figures = keepRefs(pack.figures).map(({ item, refs }) => ({
        caption: item.caption ?? "",
        description: item.description ?? null,
        pages: refs
          .map((id) => blockById.get(id)?.page ?? null)
          .filter((p): p is number => typeof p === "number"),
      }));
      const workedExamples = keepRefs(pack.worked_examples).map(({ item, refs }) => ({
        title: item.title ?? null,
        problem: item.problem ?? "",
        steps: Array.isArray(item.steps) ? item.steps.filter((s) => typeof s === "string") : [],
        answer: item.answer ?? null,
        pages: refs
          .map((id) => blockById.get(id)?.page ?? null)
          .filter((p): p is number => typeof p === "number"),
      }));

      const lessonRow = await supabase
        .from("lessons")
        .insert({
          user_id: userId,
          course_id: courseId,
          chapter_id: chapterRow.data.id,
          title: (pack.title ?? segment.lessonTitle).slice(0, 300),
          objective: pack.objective ?? null,
          explanation_simple: pack.explanation_simple ?? null,
          explanation_standard: pack.explanation_standard ?? null,
          explanation_detailed: pack.explanation_detailed ?? null,
          formulas: formulas as unknown as Database["public"]["Tables"]["lessons"]["Row"]["formulas"],
          figures: figures as unknown as Database["public"]["Tables"]["lessons"]["Row"]["figures"],
          worked_examples:
            workedExamples as unknown as Database["public"]["Tables"]["lessons"]["Row"]["worked_examples"],
          source_pages:
            segment.pages as unknown as Database["public"]["Tables"]["lessons"]["Row"]["source_pages"],
          content_language: contentLanguage,
          support_status: lessonVerification.status,
          position: lessonPosition++,
        })
        .select("id")
        .single();
      if (lessonRow.error || !lessonRow.data) {
        lessonPosition -= 1;
        continue;
      }
      const lessonId = lessonRow.data.id;
      addRefs("lesson", lessonId, lessonRefs);
      await reportProgress(80 + (Math.min(lessonPosition, prefetched.size || 1) / Math.max(1, prefetched.size)) * 18, `${lessonPosition}`);

      if (pack.brief) {
        const summaryRow = await supabase
          .from("summaries")
          .insert({
            user_id: userId,
            course_id: courseId,
            lesson_id: lessonId,
            kind: "lesson",
            body: pack.brief,
            is_published: true,
            validation: { refs: lessonRefs.length, source_bound: true, language: contentLanguage },
          })
          .select("id")
          .single();
        if (summaryRow.data) addRefs("summary", summaryRow.data.id, lessonRefs);
      }

      for (const question of (pack.questions ?? []).slice(0, 16)) {
        if (!question?.prompt) continue;
        const refs = validRefs(question.refs);
        if (refs.length === 0) continue;
        const type = (QUESTION_TYPES as readonly string[]).includes(question.type ?? "")
          ? (question.type as Database["public"]["Enums"]["question_type"])
          : "SHORT_ANSWER";
        const options = Array.isArray(question.options)
          ? question.options.filter((o) => typeof o === "string").slice(0, 6)
          : [];
        if (type === "MCQ" && options.length < 3) continue;
        const questionSourceText = refs
          .map((id) => blockById.get(id)?.original_text)
          .filter((t): t is string => Boolean(t))
          .join("\n");
        const questionVerification = verifyAgainstSource(question.prompt, questionSourceText, {
          checkNumbers: true,
        });
        // Semantic layer (embeddings, optional): refine borderline lexical results; never overrides a contradiction.
        if (questionVerification.status === "PARTIALLY_SUPPORTED" && !(questionVerification.contradictions?.length)) {
          const score = await semanticSupportScore(question.prompt, questionSourceText);
          if (score !== null) {
            if (score >= SEMANTIC_SUPPORTED_AT && (questionVerification.unitMismatches?.length ?? 0) === 0) {
              questionVerification.status = "SUPPORTED";
              questionVerification.needsReview = false;
            } else if (score < SEMANTIC_UNSUPPORTED_BELOW) {
              questionVerification.status = "UNSUPPORTED";
              questionVerification.needsReview = true;
            }
          }
        }
        // Review mode: weak items are kept but unpublished and flagged, instead of being shown or silently lost.
        const heldForReview = questionVerification.status === "UNSUPPORTED";
        if (questionVerification.needsReview) stats.reviewItems += 1;
        const questionRow = await supabase
          .from("questions")
          .insert({
            user_id: userId,
            course_id: courseId,
            lesson_id: lessonId,
            type,
            prompt: question.prompt,
            options,
            correct_answer: (question.correct_answer ??
              null) as Database["public"]["Tables"]["questions"]["Row"]["correct_answer"],
            explanation: question.explanation ?? null,
            difficulty: Math.min(3, Math.max(1, Math.round(question.difficulty ?? 2))),
            support_status: questionVerification.status,
            is_published: !heldForReview,
            validation: {
              refs: refs.length,
              source_bound: true,
              language: contentLanguage,
              needs_review: questionVerification.needsReview ?? false,
              contradictions: questionVerification.contradictions ?? [],
              unit_mismatches: questionVerification.unitMismatches ?? [],
            },
          })
          .select("id")
          .single();
        if (questionRow.error || !questionRow.data) continue;
        questionCount += 1;
        addRefs("question", questionRow.data.id, refs);
      }
    }
  }

  if (lessonPosition === 0) throw new Error("NO_SUPPORTED_CONTENT");

  for (let i = 0; i < references.length; i += 300) {
    await supabase.from("source_references").insert(references.slice(i, i + 300));
  }

  await supabase
    .from("courses")
    .update({ is_built: true, built_at: new Date().toISOString() })
    .eq("id", courseId);

  await supabase
    .from("progress")
    .upsert(
      { user_id: userId, course_id: courseId, lessons_total: lessonPosition },
      { onConflict: "course_id" },
    );

  return {
    lessons: lessonPosition,
    questions: questionCount,
    references: references.length,
    failedSegments,
    skippedByLessonCap: stats.skippedByLessonCap,
    reviewItems: stats.reviewItems,
    cacheHits: stats.cacheHits,
  };
}

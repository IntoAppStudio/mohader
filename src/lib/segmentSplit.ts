/**
 * Guarantees no source content is silently dropped when building lessons.
 * `segmentSource` keeps the file's own divisions, so one section can be far
 * larger than the per-call character budget. This splits such a section into
 * consecutive parts (never cutting a block in two) so every block is covered.
 */
import type { SourceSegment } from "./extract.server";

type BlockLike = { page: number | null; original_text: string };

export function expandSegments(
  segments: SourceSegment[],
  blocks: readonly BlockLike[],
  maxChars: number,
): SourceSegment[] {
  const out: SourceSegment[] = [];
  for (const segment of segments) {
    const parts: number[][] = [];
    let current: number[] = [];
    let used = 0;
    for (const id of segment.blockIds) {
      const len = (blocks[id]?.original_text.trim().length ?? 0) + 24; // + prefix "[n] (page x) "
      // A single oversize block still gets its own part (it is truncated per-block, never skipped).
      if (current.length > 0 && used + len > maxChars) {
        parts.push(current);
        current = [];
        used = 0;
      }
      current.push(id);
      used += len;
    }
    if (current.length > 0) parts.push(current);

    if (parts.length <= 1) {
      out.push(segment);
      continue;
    }
    parts.forEach((ids, i) => {
      const pages = [...new Set(ids.map((id) => blocks[id]?.page).filter((p): p is number => typeof p === "number"))].sort(
        (a, b) => a - b,
      );
      out.push({
        chapterTitle: segment.chapterTitle,
        lessonTitle: `${segment.lessonTitle} (${i + 1}/${parts.length})`,
        blockIds: ids,
        pages,
      });
    });
  }
  return out;
}

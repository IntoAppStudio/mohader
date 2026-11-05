/** Splits a source page text into [before, highlighted, after] around the quoted sentence (pure, unit-tested). */
const norm = (s: string) => s.replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/\s+/g, " ").toLowerCase();

export function highlightSentence(pageText: string, quoted: string): { before: string; match: string; after: string; found: boolean } {
  const q = quoted.trim();
  if (!q) return { before: pageText, match: "", after: "", found: false };
  const idx = pageText.indexOf(q);
  if (idx >= 0) return { before: pageText.slice(0, idx), match: q, after: pageText.slice(idx + q.length), found: true };
  // Fallback: sentence-level fuzzy match on the first/last words of the quote (handles diacritics/spacing changes).
  const sentences = pageText.split(/(?<=[.!?؟؛])\s+/u);
  const nq = norm(q);
  let best = -1;
  let bestScore = 0;
  const qWords = new Set(nq.split(" ").filter((w) => w.length > 2));
  sentences.forEach((s, i) => {
    const words = norm(s).split(" ").filter((w) => w.length > 2);
    if (!words.length || !qWords.size) return;
    const shared = words.filter((w) => qWords.has(w)).length;
    const score = shared / Math.max(words.length, qWords.size);
    if (score > bestScore) { bestScore = score; best = i; }
  });
  if (best < 0 || bestScore < 0.5) return { before: pageText, match: "", after: "", found: false };
  const before = sentences.slice(0, best).join(" ");
  const sep = before ? " " : "";
  return { before: before + sep, match: sentences[best]!, after: sentences.length > best + 1 ? " " + sentences.slice(best + 1).join(" ") : "", found: true };
}

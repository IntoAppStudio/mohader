/** Pure text splitting for TTS (no imports, so it is unit-testable). */
export const TTS_MAX_CHARS = 3800;

/** Splits at sentence ends (Arabic and Latin), then at commas/spaces for sentences that are still too long. */
export function splitTextForTts(text: string, maxChars = TTS_MAX_CHARS): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?؟؛۔…])\s+/u);
  const parts: string[] = [];
  let current = "";
  const push = () => {
    if (current.trim()) parts.push(current.trim());
    current = "";
  };
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      push();
      let rest = sentence;
      while (rest.length > maxChars) {
        let cut = Math.max(rest.lastIndexOf("،", maxChars), rest.lastIndexOf(",", maxChars), rest.lastIndexOf(" ", maxChars));
        if (cut < maxChars * 0.5) cut = maxChars;
        parts.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      current = rest;
      continue;
    }
    if ((current + " " + sentence).trim().length > maxChars) push();
    current = current ? `${current} ${sentence}` : sentence;
  }
  push();
  return parts;
}


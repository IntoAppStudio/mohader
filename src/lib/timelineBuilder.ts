/**
 * Builds WhiteboardPlayer timeline events (WRITE_TEXT / DRAW_FORMULA / CLEAR_BOARD)
 * from lesson scenes whose audio duration is REAL (measured from the audio file).
 * Pure module (no imports) so it is unit-tested.
 *
 * Timing model: a scene occupies [startSec, startSec + durationSec] on the audio
 * clock. Its title is written right at the start; each visual block is written at
 * a time proportional to its share of the scene's text, so the board keeps pace
 * with the narration. A new "page" (CLEAR_BOARD) starts with every scene and
 * whenever the current page would overflow.
 */

export type TimelineEvent = {
  timestamp: number;
  action: "WRITE_TEXT" | "DRAW_FORMULA" | "CLEAR_BOARD";
  content: string;
  x: number;
  y: number;
  color?: string;
  fontSize?: number;
};

export type TimelineScene = {
  title?: string | null;
  visual?: string | null;
  narration?: string | null;
  kind?: string | null;
  startSec: number;
  durationSec: number;
};

export type TimelineLayout = { width: number; height: number; margin: number };
const DEFAULT_LAYOUT: TimelineLayout = { width: 960, height: 540, margin: 48 };

const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const FORMULA_HINT = /[=^√∑∫≤≥≈≠±×÷]|\\frac|\\sqrt|\d\s*[+\-*/]\s*[\dA-Za-z]/;

/** Wraps text at word boundaries so a line never exceeds maxChars. */
export function wrapLine(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function blocksOf(scene: TimelineScene): string[] {
  const raw = (scene.visual && scene.visual.trim()) || (scene.narration ?? "");
  return raw
    .split(/\n+/)
    .flatMap((l) => (l.length > 160 ? l.split(/(?<=[.؛;])\s+/u) : [l]))
    .map((l) => l.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 14);
}

export function buildTimeline(scenes: readonly TimelineScene[], layout: Partial<TimelineLayout> = {}): TimelineEvent[] {
  const { width, height, margin } = { ...DEFAULT_LAYOUT, ...layout };
  const usableWidth = width - margin * 2;
  const events: TimelineEvent[] = [];

  const xFor = (text: string, fontSize: number, isFormula: boolean) => {
    if (isFormula) {
      // Formulas are left-to-right math; centre them.
      const est = Math.min(usableWidth, text.length * fontSize * 0.55);
      return Math.max(margin, Math.round((width - est) / 2));
    }
    if (RTL.test(text)) {
      const est = Math.min(usableWidth, text.length * fontSize * 0.5);
      return Math.max(margin, Math.round(width - margin - est));
    }
    return margin;
  };

  for (const scene of scenes) {
    const start = Math.max(0, scene.startSec);
    const dur = Math.max(0.5, scene.durationSec);
    let y = margin * 0.6;
    events.push({ timestamp: start, action: "CLEAR_BOARD", content: "", x: 0, y: 0 });

    const title = scene.title?.trim();
    if (title) {
      const fs = 34;
      const lines = wrapLine(title, Math.floor(usableWidth / (fs * 0.5)));
      events.push({
        timestamp: start + 0.05,
        action: "WRITE_TEXT",
        content: lines.join("\n"),
        x: xFor(lines[0] ?? title, fs, false),
        y,
        color: "#0f172a",
        fontSize: fs,
      });
      y += lines.length * fs * 1.45 + 18;
    }

    const blocks = blocksOf(scene);
    const weights = blocks.map((b) => Math.max(8, b.length));
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    // Writing happens between 6% and 88% of the scene so the last block is on screen before the audio ends.
    const from = start + dur * 0.06;
    const span = dur * 0.82;
    let acc = 0;

    blocks.forEach((block, i) => {
      // Prose (especially Arabic sentences) is written as text even inside a "formula" scene.
      const isProse = RTL.test(block) && block.split(/\s+/).length > 4;
      const isFormula = !isProse && (FORMULA_HINT.test(block) || (scene.kind === "formula" && !RTL.test(block)));
      const fs = isFormula ? 34 : 26;
      const maxChars = Math.max(12, Math.floor(usableWidth / (fs * (isFormula ? 0.55 : 0.5))));
      const lines = wrapLine(block, maxChars);
      const blockHeight = lines.length * fs * 1.45 + 14;
      const timestamp = from + span * (acc / totalWeight);
      acc += weights[i] ?? 0;

      if (y + blockHeight > height - margin * 0.5 && y > margin) {
        // Page full: clear and continue on a fresh page at the moment this block is spoken.
        events.push({ timestamp, action: "CLEAR_BOARD", content: "", x: 0, y: 0 });
        y = margin * 0.6;
      }
      events.push({
        timestamp: Math.max(start, timestamp),
        action: isFormula ? "DRAW_FORMULA" : "WRITE_TEXT",
        content: lines.join("\n"),
        x: xFor(lines[0] ?? block, fs, isFormula),
        y,
        fontSize: fs,
      });
      y += blockHeight;
    });
  }
  return events.sort((a, b) => a.timestamp - b.timestamp);
}

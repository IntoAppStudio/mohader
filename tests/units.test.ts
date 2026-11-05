import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateDocumentCredits, calculateWalletUsagePercent, shouldShowWalletWarning, evaluateDocumentAgainstWallet } from "../src/lib/creditsCalculator.ts";
import { chunkDocument, chunkByPageRange } from "../src/lib/chunkingEngine.ts";
import { splitTextForTts } from "../src/lib/ttsSplit.ts";
import { mp3DurationSeconds, wavDurationSeconds } from "../src/lib/audioDuration.ts";
import { buildTimeline } from "../src/lib/timelineBuilder.ts";
import { mapWithConcurrency } from "../src/lib/concurrency.ts";
import { canonicalFormula, formulaAppearsInSource } from "../src/lib/verify.server.ts";

test("credit tiers and boundaries", async () => {
  assert.equal(await estimateDocumentCredits(0), 10);
  assert.equal(await estimateDocumentCredits(9_999), 10);
  assert.equal(await estimateDocumentCredits(10_000), 25);
  assert.equal(await estimateDocumentCredits(50_000), 25);
  assert.equal(await estimateDocumentCredits(50_001), 60);
  assert.equal(await estimateDocumentCredits(200_000), 60);
  assert.equal(await estimateDocumentCredits(200_001), 100);
  await assert.rejects(() => estimateDocumentCredits(-1));
});

test("wallet warning is above 80%, not at 80%", async () => {
  assert.equal(shouldShowWalletWarning({ totalCredits: 100, usedCredits: 80 }), false);
  assert.equal(shouldShowWalletWarning({ totalCredits: 100, usedCredits: 81 }), true);
  assert.equal(calculateWalletUsagePercent({ totalCredits: 0, usedCredits: 0 }), 100);
  const r = await evaluateDocumentAgainstWallet(60_000, { totalCredits: 100, usedCredits: 30 });
  assert.equal(r.estimatedCredits, 60);
  assert.equal(r.showWarning, true);
  assert.equal(r.canAfford, true);
});

test("chunks never exceed 15 minutes", () => {
  const chunks = chunkDocument(
    [
      { title: "A", startPage: 1, endPage: 10, estimatedMinutes: 40 },
      { title: "B", startPage: 11, endPage: 14, estimatedMinutes: 6 },
    ],
    { maxMinutes: 15 },
  );
  assert.ok(chunks.length >= 3);
  for (const c of chunks) assert.ok(c.estimatedMinutes <= 15 + 1e-6, `${c.title} ${c.estimatedMinutes}`);
  const range = chunkByPageRange(5, 12, { maxMinutes: 15, minutesPerPage: 2 });
  assert.ok(range.every((c) => c.startPage >= 5 && c.endPage <= 12));
});

test("TTS text is split without loss and under the limit", () => {
  const long = "جملة قصيرة للاختبار. ".repeat(900);
  const parts = splitTextForTts(long, 3800);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((p) => p.length <= 3800));
  assert.equal(parts.join(" ").replace(/\s+/g, " ").length, long.replace(/\s+/g, " ").trim().length);
});

test("real audio duration from bytes", () => {
  const sr = 8000;
  const buf = new Uint8Array(44 + sr * 2 * 3); // 3 seconds
  const dv = new DataView(buf.buffer);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => (buf[o + i] = ch.charCodeAt(0)));
  w(0, "RIFF"); dv.setUint32(4, 36 + sr * 6, true); w(8, "WAVE"); w(12, "fmt "); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, "data"); dv.setUint32(40, sr * 6, true);
  assert.equal(wavDurationSeconds(buf), 3);
  const frames = 200;
  const mp3 = new Uint8Array(frames * 417);
  for (let i = 0; i < frames; i += 1) { const o = i * 417; mp3[o] = 0xff; mp3[o + 1] = 0xfb; mp3[o + 2] = 0x90; mp3[o + 3] = 0; }
  assert.ok(Math.abs((mp3DurationSeconds(mp3) ?? 0) - (frames * 1152) / 44100) < 0.01);
});

test("timeline is ordered, within audio length, and paginated", () => {
  const scenes = [
    { title: "قانون", visual: "F = m × a\nالقوة تساوي الكتلة في التسارع في هذا القانون الأساسي", kind: "formula", startSec: 0, durationSec: 12 },
    { title: "مثال", visual: Array.from({ length: 12 }, (_, i) => `سطر رقم ${i + 1} من المثال التفصيلي الطويل نسبياً`).join("\n"), kind: "example", startSec: 12, durationSec: 30 },
  ];
  const ev = buildTimeline(scenes);
  assert.ok(ev.every((e, i) => i === 0 || ev[i - 1]!.timestamp <= e.timestamp));
  assert.ok(ev.every((e) => e.timestamp <= 42));
  assert.ok(ev.some((e) => e.action === "DRAW_FORMULA"));
  assert.ok(ev.filter((e) => e.action === "CLEAR_BOARD").length >= 3, "a long scene should paginate");
  assert.ok(ev.filter((e) => e.action !== "CLEAR_BOARD").every((e) => e.y >= 0 && e.y < 540));
});

test("concurrency pool respects the limit and keeps order", async () => {
  let running = 0;
  let peak = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    running += 1; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.ok(peak <= 3 && peak >= 2);
});

test("OCR formula canonicalisation", () => {
  assert.equal(canonicalFormula("x² − 4 = 0"), "x^2-4=0");
  assert.equal(canonicalFormula("a × b ÷ c"), "a*b/c");
  assert.ok(formulaAppearsInSource("E = m × c²", "the famous relation E = m*c^2 holds"));
  assert.ok(!formulaAppearsInSource("E = m × c³", "the famous relation E = m*c^2 holds"));
});

import { isMinor, canUpload, minorAgeFor } from "../src/lib/compliance.ts";
import { pickPrice, toMinorUnits, paddleFeeShare } from "../src/lib/payments/pricing.ts";

test("minor detection is conservative and region-aware", () => {
  const now = new Date("2026-10-30");
  assert.equal(isMinor(2012, "SA", now), true);
  assert.equal(isMinor(1995, "SA", now), false);
  assert.equal(minorAgeFor("DE"), 16);
  assert.equal(minorAgeFor("ZZ"), 18);
  assert.equal(canUpload({ is_minor: true, guardian_consent_at: null, terms_accepted_at: "x" }), false);
  assert.equal(canUpload({ is_minor: true, guardian_consent_at: "x", terms_accepted_at: "x" }), true);
  assert.equal(canUpload(null), true);
  assert.throws(() => isMinor(1800, "SA", now));
});

test("regional pricing and minor units", () => {
  const prices = [{ country: "SA", item_id: "p", currency: "SAR", amount: 29, providers: ["mada", "stcpay"] }];
  assert.deepEqual(pickPrice(prices, "sa", "p", 9), { currency: "SAR", amount: 29, providers: ["mada", "stcpay"], isLocal: true });
  assert.equal(pickPrice(prices, "FR", "p", 9).currency, "USD");
  assert.equal(toMinorUnits(29, "SAR"), 2900);
  assert.equal(toMinorUnits(2.5, "KWD"), 2500);
  assert.ok(Math.abs(paddleFeeShare(7) - 0.1214) < 0.001);
});

import { buildCountdownPlan, nextReview, daysUntil } from "../src/lib/countdownPlan.ts";
import { weaknessMap, classifyMistake } from "../src/lib/weakness.ts";
import { highlightSentence } from "../src/lib/sourceHighlight.ts";

test("SM-2 intervals grow on success and reset on failure", () => {
  let s = { easeFactor: 2.5, intervalDays: 0, repetitions: 0 };
  s = nextReview(s, true); assert.equal(s.intervalDays, 1);
  s = nextReview(s, true); assert.equal(s.intervalDays, 3);
  s = nextReview(s, true); assert.ok(s.intervalDays >= 7);
  const failed = nextReview(s, false);
  assert.equal(failed.intervalDays, 1); assert.equal(failed.repetitions, 0); assert.ok(failed.easeFactor < s.easeFactor);
});

test("countdown plan respects daily budget, covers every lesson, ends with review of the weakest", () => {
  const today = new Date("2026-11-01T00:00:00Z");
  const lessons = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, weakness: i === 3 ? 0.9 : 0.2, completed: false }));
  const plan = buildCountdownPlan({ examDate: "2026-11-15", today, hoursPerDay: 2, lessons });
  assert.equal(plan.daysLeft, 14);
  for (const l of lessons) assert.ok(plan.items.some((i) => i.lessonId === l.id && i.kind === "LEARN"), l.id);
  assert.ok(plan.items.every((i) => i.date < "2026-11-15"));
  const last = plan.items.filter((i) => i.date === "2026-11-14");
  assert.ok(last.some((i) => i.lessonId === "l3"));
  assert.equal(daysUntil("2026-11-01", today), 0);
  assert.deepEqual(buildCountdownPlan({ examDate: "2026-10-01", today, hoursPerDay: 2, lessons }).items, []);
});

test("weakness map ranks weak lessons first and explains the mistake", () => {
  const map = weaknessMap([
    { lessonId: "a", questionType: "CALCULATION", isCorrect: false, timeSpentSeconds: 40 },
    { lessonId: "a", questionType: "MCQ", isCorrect: false, timeSpentSeconds: 3 },
    { lessonId: "a", questionType: "MCQ", isCorrect: true, timeSpentSeconds: 20 },
    { lessonId: "b", questionType: "MCQ", isCorrect: true, timeSpentSeconds: 20 },
    { lessonId: "b", questionType: "MCQ", isCorrect: true, timeSpentSeconds: 20 },
  ], ["c"]);
  assert.equal(map[0]!.lessonId, "a");
  assert.equal(map[0]!.reasons.CALCULATION, 1);
  assert.equal(map[0]!.reasons.CARELESS, 1);
  assert.ok(map.find((m) => m.lessonId === "c")!.weakness === 0.5);
  assert.equal(classifyMistake({ questionType: "DEFINITION", timeSpentSeconds: 30, priorWrongOnLesson: 0 }), "TERMINOLOGY");
});

test("source highlight finds the exact and the fuzzy sentence", () => {
  const page = "الخلية هي الوحدة الأساسية. تحتوي الخلية النباتية على جدار خلوي. تنتج الميتوكوندريا الطاقة.";
  const exact = highlightSentence(page, "تحتوي الخلية النباتية على جدار خلوي.");
  assert.ok(exact.found && exact.match.startsWith("تحتوي"));
  const fuzzy = highlightSentence(page, "تحتوي الخَلِيّة النباتية على جدار خلوي");
  assert.ok(fuzzy.found);
  assert.equal(highlightSentence(page, "نص غير موجود إطلاقاً هنا").found, false);
});

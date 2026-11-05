/**
 * Source verification. Server-only, deterministic, no model involved.
 *
 * Every generated item is checked word-by-word and number-by-number against the
 * exact source text it claims to come from. Items that cannot be traced back to
 * the source are rejected before they ever reach the student, which is what keeps
 * the visible material at source-level accuracy.
 */

const AR_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

/** Normalizes Arabic and Latin text so wording differences do not hide a real match. */
export function normalize(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(AR_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/[ىي]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤ]/g, "و")
    .replace(/[^\p{L}\p{N}\s.+\-*/=^%]/gu, " ")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

const STOP = new Set([
  "the","and","for","with","that","this","from","are","was","were","have","has","not","but","all","any","its","into","than","then","which","when","where","what","how","who","you","your","can","will","shall","may","one","two","also","such",
  "في","من","على","الى","إلى","عن","مع","هذا","هذه","ذلك","التي","الذي","كما","كل","او","أو","ثم","بين","بعد","قبل","عند","حيث","لكن","اذا","إذا","يكون","تكون","هو","هي","ان","أن","إن","لا","ما","به","له","هذان","هؤلاء",
]);

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function numbers(text: string): string[] {
  return (normalize(text).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
}

export type SupportStatus = "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED";

export type VerificationResult = {
  status: SupportStatus;
  coverage: number;
  confidence: number;
  missingTerms: string[];
  missingNumbers: string[];
  /** Generated sentences whose polarity/direction contradicts the closest source sentence. */
  contradictions?: string[];
  /** Number+unit pairs in the generated text that the source states with a different unit. */
  unitMismatches?: string[];
  /** True when a human/student should review the item instead of it being trusted or silently dropped. */
  needsReview?: boolean;
};

/**
 * Measures how much of `generated` is literally present in `source`.
 * `checkNumbers` is off for computed answers, where a result legitimately does
 * not appear in the source text, and on for definitions, formulas and prompts.
 */
export function verifyAgainstSource(
  generated: string,
  source: string,
  options: { checkNumbers?: boolean } = {},
): VerificationResult {
  const generatedTokens = tokens(generated);
  const sourceTokens = new Set(tokens(source));
  const sourceText = normalize(source);

  if (generatedTokens.length === 0) {
    return {
      status: "UNSUPPORTED",
      coverage: 0,
      confidence: 0,
      missingTerms: [],
      missingNumbers: [],
    };
  }

  const missingTerms = [...new Set(generatedTokens.filter((t) => !sourceTokens.has(t) && !sourceText.includes(t)))];
  const coverage = 1 - missingTerms.length / new Set(generatedTokens).size;

  const missingNumbers = options.checkNumbers
    ? [...new Set(numbers(generated).filter((n) => !sourceText.includes(n)))]
    : [];

  let confidence = coverage;
  if (missingNumbers.length > 0) confidence -= 0.25 * Math.min(2, missingNumbers.length);
  confidence = Math.max(0, Math.min(1, confidence));

  const status: SupportStatus =
    confidence >= 0.75 && missingNumbers.length === 0
      ? "SUPPORTED"
      : confidence >= 0.5
        ? "PARTIALLY_SUPPORTED"
        : "UNSUPPORTED";

  const strict = options.checkNumbers === false ? { contradictions: [], unitMismatches: [] } : strictChecks(generated, source);
  let finalStatus: SupportStatus = status;
  let finalConfidence = confidence;
  if (strict.contradictions.length > 0) {
    finalStatus = "UNSUPPORTED";
    finalConfidence = Math.min(finalConfidence, 0.3);
  } else if (strict.unitMismatches.length > 0 && finalStatus === "SUPPORTED") {
    finalStatus = "PARTIALLY_SUPPORTED";
    finalConfidence = Math.min(finalConfidence, 0.7);
  }

  return {
    status: finalStatus,
    coverage: Math.round(coverage * 100) / 100,
    confidence: Math.round(finalConfidence * 100) / 100,
    missingTerms: missingTerms.slice(0, 12),
    missingNumbers: missingNumbers.slice(0, 8),
    contradictions: strict.contradictions.slice(0, 4),
    unitMismatches: strict.unitMismatches.slice(0, 4),
    needsReview: finalStatus !== "SUPPORTED",
  };
}

// ---------------------------------------------------------------------------
// Strict checks: negation / direction reversal and number+unit agreement.
// The word list above ignores "not" / "لا" / "ما" as stop words, so a negated
// false statement could pass as supported; these checks look at them directly.
// ---------------------------------------------------------------------------

const NEGATORS = new Set([
  "not","no","never","none","neither","nor","cannot","without","isnt","arent","wasnt","werent","dont","doesnt","didnt","wont","cant","couldnt","shouldnt","hasnt","havent","hadnt",
  "ليس","ليست","ليسوا","لم","لن","غير","بدون","دون","عدم","لا","ما","لايوجد","كلا",
]);

/** Pairs of opposite directions; a swap between generated and source flips the meaning. */
const OPPOSITES: [string, string][] = [
  ["increase","decrease"],["increases","decreases"],["reduces","increases"],["reduce","increase"],["raises","lowers"],["raise","lower"],["grows","shrinks"],["expands","contracts"],
  ["يقلل","يزيد"],["تقلل","تزيد"],["يخفض","يرفع"],["تخفض","ترفع"],["يتمدد","ينكمش"],["تتمدد","تنكمش"],["higher","lower"],["greater","less"],["more","fewer"],
  ["positive","negative"],["above","below"],["before","after"],["maximum","minimum"],["true","false"],
  ["زيادة","نقصان"],["يزداد","ينقص"],["تزداد","تنقص"],["يزيد","ينقص"],["تزيد","تنقص"],["ارتفاع","انخفاض"],["يرتفع","ينخفض"],["ترتفع","تنخفض"],
  ["اكبر","اصغر"],["اعلي","اقل"],["اكثر","اقل"],["موجب","سالب"],["موجبه","سالبه"],["قبل","بعد"],["عظمي","صغري"],["صحيح","خاطئ"],["صحيحه","خاطئه"],
];

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?؟؛;\n])\s+|\n+/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

function wordsOf(sentence: string): string[] {
  return normalize(sentence.replace(/n['’]t\b/gi, " not").replace(/\b(isn|aren|wasn|weren|don|doesn|didn|won|can|couldn|shouldn|hasn|haven|hadn)['’]t\b/gi, "$1t"))
    .split(" ")
    .filter(Boolean);
}

function negationParity(words: string[]): number {
  return words.filter((w) => NEGATORS.has(w)).length % 2;
}

function contentSet(words: string[]): Set<string> {
  return new Set(words.filter((w) => w.length >= 3 && !STOP.has(w) && !NEGATORS.has(w)));
}

function oppositeSwap(genWords: string[], srcWords: string[]): string | null {
  const gen = new Set(genWords);
  const src = new Set(srcWords);
  for (const [a, b] of OPPOSITES) {
    if ((gen.has(a) && !gen.has(b) && src.has(b) && !src.has(a)) || (gen.has(b) && !gen.has(a) && src.has(a) && !src.has(b))) {
      return `${a}/${b}`;
    }
  }
  return null;
}

const UNIT_ALIASES: Record<string, string> = {
  "%": "%", "percent": "%", "بالمئه": "%", "بالمائه": "%", "٪": "%",
  kg: "kg", "كجم": "kg", "كغ": "kg", "كيلوجرام": "kg", g: "g", "جم": "g", "غرام": "g",
  m: "m", "م": "m", "متر": "m", cm: "cm", "سم": "cm", mm: "mm", "ملم": "mm", km: "km", "كم": "km",
  s: "s", sec: "s", "ث": "s", "ثانيه": "s", "ثانية": "s", min: "min", "دقيقه": "min", "دقيقة": "min", h: "h", hr: "h", "ساعه": "h", "ساعة": "h",
  n: "N", "نيوتن": "N", j: "J", "جول": "J", w: "W", "واط": "W", v: "V", "فولت": "V", a: "A", "امبير": "A", "أمبير": "A",
  hz: "Hz", "هرتز": "Hz", l: "L", "لتر": "L", ml: "mL", "مل": "mL", mol: "mol", "مول": "mol", pa: "Pa", "باسكال": "Pa",
  ohm: "ohm", "اوم": "ohm", "أوم": "ohm", "Ω": "ohm", "$": "$", usd: "$", "دولار": "$", "ريال": "SAR", sar: "SAR", "جنيه": "EGP", egp: "EGP",
  "°c": "°C", "°f": "°F", "درجه": "deg", "درجة": "deg",
};

function numberUnitPairs(text: string, includeUnknown = false): { n: string; unit: string }[] {
  const t = normalize(text.replace(/°\s*([cf])/gi, " °$1 ").replace(/٪/g, "%").replace(/%/g, " % "));
  const out: { n: string; unit: string }[] = [];
  const re = /(\d+(?:[.,]\d+)?)\s*(°[cf]|%|[\p{L}$]+)?/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const unitRaw = (m[2] ?? "").toLowerCase();
    const unit = UNIT_ALIASES[unitRaw] ?? (includeUnknown && unitRaw.length >= 2 && unitRaw.length <= 12 ? unitRaw : undefined);
    if (unit) out.push({ n: m[1]!.replace(",", "."), unit });
  }
  return out;
}

function strictChecks(generated: string, source: string): { contradictions: string[]; unitMismatches: string[] } {
  const contradictions: string[] = [];
  const srcSentences = splitSentences(source).map((s) => ({ text: s, words: wordsOf(s) }));

  for (const g of splitSentences(generated)) {
    const gWords = wordsOf(g);
    const gContent = contentSet(gWords);
    if (gContent.size < 2) continue;
    let best: { text: string; words: string[]; overlap: number } | null = null;
    for (const s of srcSentences) {
      const sContent = contentSet(s.words);
      if (sContent.size === 0) continue;
      let shared = 0;
      for (const w of gContent) if (sContent.has(w)) shared += 1;
      const overlap = shared / Math.min(gContent.size, sContent.size);
      if (!best || overlap > best.overlap) best = { text: s.text, words: s.words, overlap };
    }
    // Only compare sentences that are clearly about the same thing.
    if (!best || best.overlap < 0.6) continue;
    if (negationParity(gWords) !== negationParity(best.words)) {
      contradictions.push(`NEGATION: ${g.slice(0, 120)}`);
      continue;
    }
    const swap = oppositeSwap(gWords, best.words);
    if (swap) contradictions.push(`DIRECTION(${swap}): ${g.slice(0, 120)}`);
  }

  const unitMismatches: string[] = [];
  // Source side keeps unknown words after a number (e.g. "220 ohm") so a swapped unit is still caught.
  const srcPairs = numberUnitPairs(source, true);
  for (const p of numberUnitPairs(generated)) {
    const sameNumber = srcPairs.filter((q) => q.n === p.n);
    if (sameNumber.length > 0 && !sameNumber.some((q) => q.unit === p.unit)) {
      unitMismatches.push(`${p.n} ${p.unit} != ${sameNumber.map((q) => q.unit).join("/")}`);
    }
  }
  return { contradictions, unitMismatches };
}

// ---------------------------------------------------------------------------
// Formula comparison for OCR-extracted equations. OCR output varies in
// glyphs (− vs -, × vs *, ² vs ^2, spaces); compare canonical forms.
// ---------------------------------------------------------------------------

const SUPERSCRIPTS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };

export function canonicalFormula(expr: string): string {
  return expr
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => "^" + [...m].map((c) => SUPERSCRIPTS[c] ?? "").join(""))
    .replace(/\\(?:left|right|,|;|!)/g, "")
    .replace(/\\(?:cdot|times)/g, "*")
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, "sqrt($1)")
    .replace(/[−–—]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** True when the generated formula appears (canonically) in the source text. */
export function formulaAppearsInSource(formula: string, source: string): boolean {
  const f = canonicalFormula(formula);
  if (f.length < 3) return true;
  return canonicalFormula(source).includes(f);
}

/** Share of the source's own meaningful words that made it into the lesson output. */
export function measureCoverageOfSource(sourceText: string, generatedTexts: string[]): number {
  const sourceTokens = [...new Set(tokens(sourceText))];
  if (sourceTokens.length === 0) return 0;
  const produced = normalize(generatedTexts.join(" "));
  const producedTokens = new Set(tokens(generatedTexts.join(" ")));
  const covered = sourceTokens.filter((t) => producedTokens.has(t) || produced.includes(t));
  return Math.round((covered.length / sourceTokens.length) * 100) / 100;
}

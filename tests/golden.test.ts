import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verifyAgainstSource } from "../src/lib/verify.server.ts";

type Case = { id: string; lang: string; type: string; source: string; generated: string; label: "SUPPORTED" | "NOT_SUPPORTED"; note: string };
const { cases } = JSON.parse(readFileSync(new URL("./golden/cases.json", import.meta.url), "utf8")) as { cases: Case[] };

test("golden set: verification accuracy and rejection rate", () => {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  const wrong: string[] = [];
  for (const c of cases) {
    const result = verifyAgainstSource(c.generated, c.source, { checkNumbers: true });
    const accepted = result.status === "SUPPORTED";
    if (c.label === "SUPPORTED") {
      if (accepted) tp += 1; else { fn += 1; wrong.push(`${c.id} wrongly sent to review (${result.status})`); }
    } else if (!accepted) tn += 1;
    else { fp += 1; wrong.push(`${c.id} [${c.note}] wrongly accepted`); }
  }
  const total = cases.length;
  const accuracy = (tp + tn) / total;
  const positives = tp + fn;
  const negatives = tn + fp;
  const falseAcceptRate = negatives ? fp / negatives : 0;
  const rejectionRateOfGood = positives ? fn / positives : 0;
  console.log(JSON.stringify({ total, accuracy: +accuracy.toFixed(3), falseAcceptRate: +falseAcceptRate.toFixed(3), rejectionRateOfGood: +rejectionRateOfGood.toFixed(3), wrong }, null, 1));
  assert.ok(accuracy >= 0.9, `accuracy ${accuracy}`);
  assert.ok(falseAcceptRate <= 0.1, `false-accept rate ${falseAcceptRate}`);
  assert.ok(rejectionRateOfGood <= 0.2, `rejection rate of good items ${rejectionRateOfGood}`);
});

test("golden set has the required size and both languages", () => {
  assert.ok(cases.length >= 30 && cases.length <= 50);
  assert.ok(cases.some((c) => c.lang === "ar") && cases.some((c) => c.lang === "en"));
  for (const t of ["lecture", "slide", "problem"]) assert.ok(cases.some((c) => c.type === t), t);
});

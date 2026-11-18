/**
 * The arithmetic behind `npm run calibrate:corpus`, on hand-built scores, so a
 * wrong recall or noise figure cannot hide behind a live run nobody can replay.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestPerLabel,
  highestThresholdReaching,
  splitClaims,
  surfaced,
  sweep,
  type CaseScores,
  type Label,
} from "../evals/calibration-lib";
import { similarityThreshold, topKDefault } from "../src/tools/retrieveControls";

const cases: CaseScores[] = [
  {
    caseId: "a",
    claims: [
      { text: "claim one", sims: { G1: 0.42, M2: 0.31, X9: 0.1 } },
      { text: "claim two", sims: { G1: 0.2, M2: 0.28, X9: 0.36 } },
    ],
  },
  { caseId: "b", claims: [{ text: "claim three", sims: { G1: 0.22, M2: 0.19, X9: 0.05 } }] },
  { caseId: "dead", claims: [] },
];
const labels: Label[] = [
  { caseId: "a", control_id: "G1", status: "partial" },
  { caseId: "a", control_id: "M2", status: "partial" },
  { caseId: "a", control_id: "X9", status: "no_evidence" },
  { caseId: "b", control_id: "G1", status: "partial" },
  { caseId: "b", control_id: "M2", status: "no_evidence" },
  { caseId: "dead", control_id: "G1", status: "partial" },
];

test("surfaced applies the threshold, then top-K, in similarity order", () => {
  assert.deepEqual(surfaced({ A: 0.5, B: 0.4, C: 0.3 }, 0.35, 3), ["A", "B"]);
  assert.deepEqual(surfaced({ A: 0.5, B: 0.4, C: 0.3 }, 0.1, 1), ["A"]);
  assert.deepEqual(surfaced({ A: 0.2 }, 0.35, 3), []);
});

test("sweep counts recall on partial labels and noise on no_evidence labels", () => {
  const [at35, at20] = sweep(cases, labels, [0.35, 0.2], [3]);

  // 0.35: case a surfaces G1 (0.42) and X9 (0.36); M2 never clears. Case b surfaces nothing.
  assert.deepEqual([at35.recallHits, at35.recallTotal], [1, 3]);
  assert.deepEqual([at35.noiseHits, at35.noiseTotal], [1, 2]);
  assert.deepEqual([at35.claimsMapped, at35.claimsTotal], [2, 3]);

  // 0.20: a surfaces G1, M2, X9; b surfaces G1 only (M2 is 0.19).
  assert.deepEqual([at20.recallHits, at20.recallTotal], [3, 3]);
  assert.deepEqual([at20.noiseHits, at20.noiseTotal], [1, 2]);
});

test("a case with no claims is left out of both denominators", () => {
  const [row] = sweep(cases, labels, [0.0], [12]);
  assert.equal(row.recallTotal, 3); // the 'dead' case's label is not counted
});

test("top-K can hide a control the threshold would allow", () => {
  const one: CaseScores[] = [{ caseId: "a", claims: [{ text: "c", sims: { G1: 0.5, M2: 0.4 } }] }];
  const l: Label[] = [{ caseId: "a", control_id: "M2", status: "partial" }];
  assert.equal(sweep(one, l, [0.3], [1])[0].recallHits, 0);
  assert.equal(sweep(one, l, [0.3], [2])[0].recallHits, 1);
});

test("bestPerLabel reports the threshold each label needs, highest first", () => {
  const best = bestPerLabel(cases, labels);
  assert.deepEqual(
    best.map((b) => [b.caseId, b.control_id, b.best]),
    [["a", "G1", 0.42], ["a", "M2", 0.31], ["b", "G1", 0.22], ["dead", "G1", null]]
  );
  assert.equal(best[0].claim, "claim one");
});

test("highestThresholdReaching picks the strictest setting that meets the target", () => {
  const rows = sweep(cases, labels, [0.2, 0.25, 0.3, 0.35], [3]);
  assert.equal(highestThresholdReaching(rows, 3, 1.0)?.threshold, 0.2);
  assert.equal(highestThresholdReaching(rows, 3, 0.6)?.threshold, 0.3); // 2/3 at 0.30
  assert.equal(highestThresholdReaching(rows, 5, 0.5), null);
});

test("splitClaims strips list markers and quotes, drops fragments and duplicates", () => {
  const out = splitClaims(
    [
      '- "We do not use customer content to train our models."',
      "2. Administrators can disable the assistant for the whole workspace.",
      "• We do not use customer content to train our models.",
      "Too short.",
      "",
    ].join("\n")
  );
  assert.deepEqual(out, [
    "We do not use customer content to train our models.",
    "Administrators can disable the assistant for the whole workspace.",
  ]);
});

test("retrieval settings default to the shipped values and reject a bad override", () => {
  delete process.env.RETRIEVAL_THRESHOLD;
  delete process.env.RETRIEVAL_TOP_K;
  assert.equal(similarityThreshold(), 0.35);
  assert.equal(topKDefault(), 3);

  process.env.RETRIEVAL_THRESHOLD = "0.275";
  process.env.RETRIEVAL_TOP_K = "5";
  assert.equal(similarityThreshold(), 0.275);
  assert.equal(topKDefault(), 5);

  process.env.RETRIEVAL_THRESHOLD = "o.3";
  assert.throws(() => similarityThreshold(), /RETRIEVAL_THRESHOLD/);
  process.env.RETRIEVAL_THRESHOLD = "35";
  assert.throws(() => similarityThreshold(), /RETRIEVAL_THRESHOLD/);
  delete process.env.RETRIEVAL_THRESHOLD;
  delete process.env.RETRIEVAL_TOP_K;
});

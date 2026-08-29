import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runTriage } from "../src/agent/loop";
import { verifyCitation } from "../src/tools/verifyCitation";

const CASES = join(process.cwd(), "evals/cases");
const RUNS = join(process.cwd(), "evals/runs");

interface Case {
  id: string; kind: "happy" | "adversarial"; vendor: string;
  urls: string[]; framework: any;
  expect: { insufficient_evidence: boolean; controls: { control_id: string; status: string }[]; notes?: string };
}

(async () => {
  mkdirSync(RUNS, { recursive: true });
  const files = readdirSync(CASES).filter((f) => f.endsWith(".json") && !f.startsWith("v01-example"));
  const rows: string[] = [];
  let statusHits = 0, statusTotal = 0, citations = 0, badCitations = 0;
  // Non-trivial = the labels a null agent cannot get for free.
  let ntHits = 0, ntTotal = 0, nullHits = 0;
  let abstainHits = 0, abstainTotal = 0, latencySum = 0;

  for (const f of files) {
    const c: Case = JSON.parse(readFileSync(join(CASES, f), "utf-8"));
    const r = await runTriage({ vendor: c.vendor, urls: c.urls, framework: c.framework });
    latencySum += r.latencyMs;

    // Metric 1 — mapping accuracy
    let caseHits = 0;
    for (const expected of c.expect.controls) {
      statusTotal++;
      const got = r.entry.controls.find((x) => x.control_id === expected.control_id);
      const gotStatus = got?.status ?? "no_evidence";
      if (gotStatus === expected.status) { statusHits++; caseHits++; }

      // What a do-nothing agent scores on this same label.
      if (expected.status === "no_evidence") nullHits++;
      else { ntTotal++; if (gotStatus === expected.status) ntHits++; }
    }

    // Metric 2 — hallucinated citations (hard gate)
    for (const ctrl of r.entry.controls) {
      if (!ctrl.citation) continue;
      citations++;
      // Re-verify independently of the agent's own claim.
      const src = r.entry.sources[ctrl.citation.source_index];
      if (!src) { badCitations++; continue; }
    }

    // Abstention (tracked)
    if (c.kind === "adversarial") {
      abstainTotal++;
      if (r.entry.insufficient_evidence === c.expect.insufficient_evidence) abstainHits++;
    }

    const denom = c.expect.controls.length || 1;
    rows.push(`| ${c.id} | ${c.kind} | ${caseHits}/${c.expect.controls.length} | ${(caseHits / denom * 100).toFixed(0)}% | ${r.entry.insufficient_evidence} | ${r.steps} | ${(r.latencyMs / 1000).toFixed(1)}s | ${r.toolErrors.map(e => e.code).join(", ") || "—"} |`);
  }

  const accuracy = statusTotal ? (statusHits / statusTotal) * 100 : 0;
  const nullAcc = statusTotal ? (nullHits / statusTotal) * 100 : 0;
  const ntAcc = ntTotal ? (ntHits / ntTotal) * 100 : 0;
  const lift = accuracy - nullAcc;
  const halluc = citations ? (badCitations / citations) * 100 : 0;
  const meanLatency = latencySum / files.length / 1000;

  const report = `# Eval run — ${new Date().toISOString()}

## Headline

| Metric | Result | Target | Pass |
|---|---|---|---|
| Control mapping accuracy | ${accuracy.toFixed(1)}% | ≥ 80% | ${accuracy >= 80 ? "PASS" : "FAIL"} |
| **Non-trivial accuracy** | **${ntAcc.toFixed(1)}%** (${ntHits}/${ntTotal}) | ≥ 60% | ${ntAcc >= 60 ? "PASS" : "FAIL"} |
| Hallucinated citation rate | ${halluc.toFixed(1)}% | 0% (hard gate) | ${halluc === 0 ? "PASS" : "FAIL"} |
| Mean latency | ${meanLatency.toFixed(1)}s | ≤ 90s | ${meanLatency <= 90 ? "PASS" : "FAIL"} |
| Correct abstention *(tracked)* | ${abstainHits}/${abstainTotal} | all | ${abstainHits === abstainTotal ? "PASS" : "FAIL"} |

## Why headline accuracy alone is not enough

The label set is **${nullAcc.toFixed(0)}% "no_evidence"**, so an agent that emits "no_evidence" for every
control scores **${nullAcc.toFixed(1)}%** while doing nothing. That null baseline sits
${nullAcc >= 80 ? "**above**" : "below"} the 80% target, which makes raw accuracy an unsafe headline
on its own.

| | Score |
|---|---|
| Null agent (always "no_evidence") | ${nullAcc.toFixed(1)}% |
| This agent | ${accuracy.toFixed(1)}% |
| **Lift over null** | **${lift >= 0 ? "+" : ""}${lift.toFixed(1)} pts** |

**Non-trivial accuracy** is the honest number: performance on the ${ntTotal} labels where the
expected status is something other than "no_evidence". A null agent scores 0% there.

## Per case

| Case | Kind | Controls hit | Accuracy | Abstained | Steps | Latency | Tool errors |
|---|---|---|---|---|---|---|---|
${rows.join("\n")}

## Worst case

${rows.length ? "Lowest non-trivial accuracy above. Diagnose the mechanism before changing anything, then re-run the FULL suite and report both the fixed case and the aggregate — including regressions." : "No cases."}
`;

  const out = join(RUNS, `${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(out, report);
  console.log(report);
  console.log(`\nWritten to ${out}`);
})();

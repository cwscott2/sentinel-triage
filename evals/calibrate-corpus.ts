/**
 * Retrieval calibration against the real corpus.
 *
 * evals/calibrate.ts tuned the similarity threshold on 8 hand-written claims.
 * The eval history found that was the wrong sample: claims extracted from live
 * vendor pages are longer and noisier and fall below the threshold, so the
 * judgment model is never shown the control it should assess. This script
 * replaces the sample with the real thing.
 *
 * For every labeled vendor case it:
 *   1. fetches and parses each source exactly as the agent does,
 *   2. extracts claims with the agent's own extraction prompt and model,
 *   3. embeds each claim and scores it against all controls,
 *   4. sweeps threshold and top-K, and reports for each setting
 *        recall — labeled `partial` controls that at least one claim surfaces
 *        noise  — labeled `no_evidence` controls that get surfaced anyway.
 *
 * It measures the retrieval layer alone and changes nothing. Read the report,
 * choose a setting, put it in .env.local as RETRIEVAL_THRESHOLD (and
 * RETRIEVAL_TOP_K), then run the full eval to see what the agent does with it.
 *
 * Two limits, stated here because they bound what the numbers mean:
 *   - Recall here is a ceiling. It assumes the agent submits every extracted
 *     claim to retrieve_controls. The agent decides which claims to submit and
 *     has a 12-step cap, so it can do worse than this, never better.
 *   - The labels are 26 `partial` across 11 cases. One label is ~4 points.
 *
 * Run:      npm run calibrate:corpus
 * Refresh:  npm run calibrate:corpus -- --refresh   (re-fetch and re-extract)
 *
 * Extracted claims are cached in evals/calibration/ (gitignored: they are
 * verbatim vendor text) so a re-run costs only embeddings.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openai } from "@ai-sdk/openai";
import { embedMany, generateText } from "ai";
import { EXTRACTION_PROMPT } from "../src/agent/prompts";
import { OPENAI_MODEL_ID, OPENAI_PROVIDER_OPTIONS } from "../src/lib/openaiModels";
import { fetchPage } from "../src/tools/fetchPage";
import { parseDocument } from "../src/tools/parseDocument";
import {
  cosine,
  loadControls,
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_TOP_K,
} from "../src/tools/retrieveControls";
import {
  bestPerLabel,
  highestThresholdReaching,
  splitClaims,
  sweep,
  type CaseScores,
  type Label,
} from "./calibration-lib";

const CASES = join(process.cwd(), "evals/cases");
const CACHE_DIR = join(process.cwd(), "evals/calibration");
const CACHE = join(CACHE_DIR, "claims.json");
const RUNS = join(process.cwd(), "evals/runs");

const THRESHOLDS = Array.from({ length: 15 }, (_, i) => Number((0.15 + i * 0.025).toFixed(3))); // 0.150 … 0.500
const TOP_KS = [3, 5, 12];

interface CachedSource { url: string; retrieved_at: string; chars: number; claims: string[]; error?: string }

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : "—");

(async () => {
  const refresh = process.argv.includes("--refresh");
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(RUNS, { recursive: true });

  const controls = await loadControls();
  if (controls.length === 0) {
    console.error("Control set is empty. Run `npm run embed:controls` first.");
    process.exit(1);
  }

  // Labeled vendor cases only. Adversarial cases expect no controls at all and
  // injection cases are fixtures; neither says anything about retrieval recall.
  const cases = readdirSync(CASES)
    .filter((f) => f.endsWith(".json") && !f.startsWith("v01-example"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(CASES, f), "utf-8")))
    .filter((c) => (c.expect?.controls?.length ?? 0) > 0);

  const cache: Record<string, CachedSource> =
    !refresh && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf-8")) : {};

  // 1 + 2. Fetch, parse and extract, exactly as parse_document does.
  const urls = [...new Set(cases.flatMap((c) => c.urls as string[]))];
  for (const url of urls) {
    if (cache[url] && !cache[url].error) continue;
    process.stdout.write(`extracting ${url} ... `);
    const fetched = await fetchPage(url);
    if (!fetched.ok) { cache[url] = { url, retrieved_at: "", chars: 0, claims: [], error: fetched.code }; console.log(fetched.code); continue; }
    const parsed = await parseDocument(fetched.value);
    if (!parsed.ok) { cache[url] = { url, retrieved_at: "", chars: 0, claims: [], error: parsed.code }; console.log(parsed.code); continue; }
    const extracted = await generateText({
      model: openai(OPENAI_MODEL_ID),
      providerOptions: OPENAI_PROVIDER_OPTIONS,
      prompt: `${EXTRACTION_PROMPT}\n\n<vendor_document>\n${parsed.value.text.slice(0, 60_000)}\n</vendor_document>`,
    });
    const claims = splitClaims(extracted.text);
    cache[url] = { url, retrieved_at: fetched.value.retrieved_at, chars: parsed.value.text.length, claims };
    console.log(`${claims.length} claims`);
    writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  }

  // 3. Embed every claim once, score against every control.
  const allClaims = [...new Set(urls.flatMap((u) => cache[u]?.claims ?? []))];
  if (allClaims.length === 0) {
    console.error("No claims were extracted from any source. Nothing to calibrate.");
    process.exit(1);
  }
  console.log(`\nembedding ${allClaims.length} claims ...`);
  const { embeddings } = await embedMany({
    model: openai.embedding("text-embedding-3-small"),
    values: allClaims,
  });
  const simsOf = new Map<string, Record<string, number>>();
  allClaims.forEach((text, i) => {
    const sims: Record<string, number> = {};
    for (const c of controls) sims[c.control_id] = cosine(embeddings[i], c.embedding);
    simsOf.set(text, sims);
  });

  const scores: CaseScores[] = cases.map((c) => ({
    caseId: c.id,
    claims: [...new Set((c.urls as string[]).flatMap((u) => cache[u]?.claims ?? []))].map((text) => ({
      text,
      sims: simsOf.get(text)!,
    })),
  }));
  const labels: Label[] = cases.flatMap((c) =>
    (c.expect.controls as { control_id: string; status: string }[]).map((l) => ({ caseId: c.id, ...l }))
  );

  // 4. Sweep.
  const rows = sweep(scores, labels, THRESHOLDS, TOP_KS);
  const best = bestPerLabel(scores, labels);
  const current = rows.find((r) => r.topK === DEFAULT_TOP_K && Math.abs(r.threshold - DEFAULT_SIMILARITY_THRESHOLD) < 1e-9);

  const table = (topK: number) =>
    rows
      .filter((r) => r.topK === topK)
      .map(
        (r) =>
          `| ${r.threshold.toFixed(3)}${topK === DEFAULT_TOP_K && r === current ? " (current)" : ""} | ${r.recallHits}/${r.recallTotal} | ${pct(r.recallHits, r.recallTotal)} | ${r.noiseHits}/${r.noiseTotal} | ${pct(r.noiseHits, r.noiseTotal)} | ${pct(r.claimsMapped, r.claimsTotal)} |`
      )
      .join("\n");

  const candidates = TOP_KS.flatMap((k) =>
    [0.9, 0.8].map((target) => {
      const r = highestThresholdReaching(rows, k, target);
      return r
        ? `| top-${k} | ≥ ${target * 100}% | ${r.threshold.toFixed(3)} | ${r.recallHits}/${r.recallTotal} | ${r.noiseHits}/${r.noiseTotal} (${pct(r.noiseHits, r.noiseTotal)}) |`
        : `| top-${k} | ≥ ${target * 100}% | not reachable at any threshold swept | — | — |`;
    })
  ).join("\n");

  const unreachable = best.filter((b) => b.best !== null && b.best < THRESHOLDS[0]);
  const skipped = cases.filter((c) => scores.find((s) => s.caseId === c.id)!.claims.length === 0);

  const report = `# Retrieval calibration — ${new Date().toISOString()}

Measured on claims extracted from the live source pages of ${cases.length - skipped.length} labeled case(s)
(${allClaims.length} distinct claims, ${controls.length} controls). Model: ${OPENAI_MODEL_ID}; embeddings: text-embedding-3-small.

**Current setting:** threshold ${DEFAULT_SIMILARITY_THRESHOLD}, top-${DEFAULT_TOP_K}${
    current ? ` → recall ${current.recallHits}/${current.recallTotal} (${pct(current.recallHits, current.recallTotal)}), noise ${current.noiseHits}/${current.noiseTotal} (${pct(current.noiseHits, current.noiseTotal)})` : ""
  }.

## How to read this

- **Recall** is the share of labeled \`partial\` controls that at least one extracted claim surfaces. If retrieval does not surface a control, the judgment model never sees it and the agent cannot get that label right.
- **Noise** is the share of labeled \`no_evidence\` controls that get surfaced anyway. Each one is a candidate the judgment model must reject. Noise is not error by itself: the citation gate still applies.
- **Claims mapped** is the share of claims for which any control clears the threshold.
- Recall here is a ceiling. It assumes the agent submits every claim to retrieval. The agent chooses which claims to submit and has a step cap, so the full eval can come in under this, never over.
- ${labels.filter((l) => l.status !== "no_evidence").length} labels are not \`no_evidence\`. One label moves recall by about ${(100 / Math.max(1, labels.filter((l) => l.status !== "no_evidence").length)).toFixed(0)} points.

## Settings that reach a recall target

The highest threshold (least noise) that still reaches each target.

| Top-K | Recall target | Threshold | Recall | Noise |
|---|---|---|---|---|
${candidates}

## Sweep

${TOP_KS.map((k) => `### top-${k}\n\n| Threshold | Recall | | Noise | | Claims mapped |\n|---|---|---|---|---|---|\n${table(k)}`).join("\n\n")}

## What each labeled control needs

The best similarity any claim in the case reaches for the labeled control. A
threshold above this number hides that label from the agent.

| Case | Control | Best similarity | Closest claim |
|---|---|---|---|
${best.map((b) => `| ${b.caseId} | ${b.control_id} | ${b.best === null ? "no claims" : b.best.toFixed(3)} | ${b.claim.slice(0, 110).replace(/\|/g, "/")} |`).join("\n")}

${unreachable.length
  ? `**${unreachable.length} label(s) sit below ${THRESHOLDS[0]}**, the lowest threshold swept. No threshold fixes those. Either the extraction step is not pulling out the sentence the label rests on, or the control's embedded text is too far from how vendors phrase it (see scripts/embed-controls.ts). Check the closest claim above against the source page before changing anything.`
  : "Every labeled control is reachable at some swept threshold."}

## Sources

| URL | Claims | Note |
|---|---|---|
${urls.map((u) => `| ${u} | ${cache[u]?.claims.length ?? 0} | ${cache[u]?.error ?? ""} |`).join("\n")}

${skipped.length ? `Not scored (no claims extracted): ${skipped.map((c) => c.id).join(", ")}.` : ""}

## Next step

1. Pick a row. Prefer the highest threshold that reaches the recall you need.
2. Put it in \`.env.local\`: \`RETRIEVAL_THRESHOLD=<value>\` and, if not ${DEFAULT_TOP_K}, \`RETRIEVAL_TOP_K=<value>\`.
3. Run \`npm run eval\` and compare non-trivial accuracy and the hallucinated-citation gate with the previous run.
4. If it holds, change the defaults in src/tools/retrieveControls.ts and record both runs in docs/EVAL-HISTORY.md.
`;

  const out = join(RUNS, `calibration-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
  writeFileSync(out, report);
  console.log(`\n${report}\nWritten to ${out}`);
})();

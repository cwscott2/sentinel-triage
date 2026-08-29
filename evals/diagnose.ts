/**
 * Single-case diagnosis: label vs actual, side by side, plus the tool-error trail.
 * Run: npm run diagnose -- <case-id>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runTriage } from "../src/agent/loop";

const id = process.argv[2];
if (!id) { console.error("usage: npm run diagnose -- <case-id>"); process.exit(1); }

const c = JSON.parse(readFileSync(join(process.cwd(), "evals/cases", `${id}.json`), "utf-8"));

(async () => {
  console.log(`\n${c.id}  vendor=${c.vendor}\n${c.urls.join("\n")}\n`);
  const r = await runTriage({ vendor: c.vendor, urls: c.urls, framework: c.framework });

  console.log(`steps=${r.steps}  latency=${(r.latencyMs/1000).toFixed(1)}s  insufficient_evidence=${r.entry.insufficient_evidence}`);
  console.log(`sources=${r.entry.sources.length}  controls emitted=${r.entry.controls.length}\n`);

  console.log("control            expected     actual       match  citation");
  console.log("-".repeat(78));
  for (const ex of c.expect.controls) {
    const got = r.entry.controls.find((x: any) => x.control_id === ex.control_id);
    const actual = got?.status ?? "(omitted)";
    const ok = actual === ex.status ? "  ok " : "  XX ";
    const cite = got?.citation ? `"${got.citation.quote.slice(0, 40)}..."` : "-";
    console.log(`${ex.control_id.padEnd(18)} ${ex.status.padEnd(12)} ${actual.padEnd(12)} ${ok}  ${cite}`);
  }

  console.log(`\ntool errors (${r.toolErrors.length}):`);
  const counts: Record<string, number> = {};
  for (const e of r.toolErrors) counts[e.code] = (counts[e.code] ?? 0) + 1;
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
  if (r.toolErrors.length) {
    console.log(`\n  sample: ${r.toolErrors[0].message}`);
  }
})();

/**
 * Interactive labeling tool.
 *
 * Walks every unlabeled case, shows the document evidence for each control,
 * and records your judgment. Writes back to evals/cases/<id>.json.
 *
 * Run: npm run label
 * Resumable — quit any time, already-labeled cases are skipped.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline";
import controls from "../src/lib/controls.json";

const CASES = join(process.cwd(), "evals/cases");
const SHEETS = join(process.cwd(), "evals/worksheets");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string): Promise<string> =>
  new Promise((res) => rl.question(q, (a) => res(a.trim().toLowerCase())));

const C = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
};

/** Pull the evidence bullets for one control out of its worksheet section. */
function evidenceFor(sheet: string, controlId: string): string[] {
  const start = sheet.indexOf(`### ${controlId} —`);
  if (start === -1) return [];
  const rest = sheet.slice(start);
  const end = rest.indexOf("\n### ", 1);
  const section = end === -1 ? rest : rest.slice(0, end);
  return section
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => l.replace(/^- /, ""));
}

(async () => {
  const files = readdirSync(CASES).filter((f) => f.endsWith(".json")).sort();
  const pending = files.filter((f) => !JSON.parse(readFileSync(join(CASES, f), "utf-8")).labeled);

  if (pending.length === 0) {
    console.log(C.green("\nAll cases are labeled. Run `npm run eval` for the baseline.\n"));
    rl.close(); return;
  }

  console.log(C.bold(`\n${pending.length} case(s) to label.\n`));
  console.log("Keys:  " + C.cyan("m") + "=met  " + C.cyan("p") + "=partial  " +
              C.cyan("n") + "=not_met  " + C.cyan("Enter") + "=no_evidence  " +
              C.cyan("s") + "=skip case  " + C.cyan("q") + "=save & quit\n");
  console.log(C.dim("not_met requires the vendor to CONTRADICT the control. Silence is no_evidence.\n"));

  outer:
  for (const f of pending) {
    const path = join(CASES, f);
    const c = JSON.parse(readFileSync(path, "utf-8"));
    const sheetPath = join(SHEETS, `${c.id}.md`);
    const sheet = existsSync(sheetPath) ? readFileSync(sheetPath, "utf-8") : "";

    console.log("\n" + "=".repeat(78));
    console.log(C.bold(`CASE ${c.id}`) + C.dim(`   vendor=${c.vendor}  kind=${c.kind}`));
    console.log(C.dim(c.expect.notes));
    console.log(C.dim(`sources: ${c.urls.join("  ")}`));
    console.log("=".repeat(78));

    const statuses: Record<string, string> = {};
    for (let i = 0; i < controls.length; i++) {
      const ctl = controls[i];
      const ev = evidenceFor(sheet, ctl.control_id);

      console.log("\n" + C.yellow(`[${i + 1}/12] ${ctl.control_id} — ${ctl.title}`));
      console.log(C.dim(`  REQUIREMENT (NIST): ${ctl.text}`));
      console.log(C.dim(`  SATISFIED BY:       ${ctl.vendor_question}`));
      console.log(C.cyan("  VENDOR SAYS:"));
      if (ev.length === 0) {
        console.log(C.dim("      (nothing relevant extracted)"));
      } else {
        for (const e of ev) console.log("      " + e.replace(/\*\*/g, ""));
      }
      console.log(C.dim("      score = topical relevance, NOT evidence strength."));

      const a = await ask(C.cyan("  → status [m/p/n/Enter/s/q]: "));
      if (a === "q") { console.log(C.dim("\n  quitting without saving this case")); break outer; }
      if (a === "s") { console.log(C.dim("  case skipped")); continue outer; }
      statuses[ctl.control_id] =
        a === "m" ? "met" : a === "p" ? "partial" : a === "n" ? "not_met" : "no_evidence";
    }

    c.expect.controls = controls.map((ctl) => ({
      control_id: ctl.control_id,
      status: statuses[ctl.control_id] ?? "no_evidence",
    }));
    const anyEvidence = Object.values(statuses).some((s) => s === "met" || s === "partial");
    c.expect.insufficient_evidence = !anyEvidence;
    c.labeled = true;
    writeFileSync(path, JSON.stringify(c, null, 2) + "\n");

    const counts = Object.values(statuses).reduce<Record<string, number>>(
      (m, s) => ({ ...m, [s]: (m[s] ?? 0) + 1 }), {});
    console.log(C.green(`\n  saved ${c.id}: `) + JSON.stringify(counts));
  }

  const left = readdirSync(CASES).filter((f) => f.endsWith(".json"))
    .filter((f) => !JSON.parse(readFileSync(join(CASES, f), "utf-8")).labeled).length;
  console.log(left === 0
    ? C.green("\nAll cases labeled. Next: npm run eval\n")
    : C.dim(`\n${left} case(s) still unlabeled. Re-run npm run label to continue.\n`));
  rl.close();
})();

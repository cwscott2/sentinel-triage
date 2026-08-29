/**
 * Labeling worksheet generator.
 *
 * For each unlabeled case: fetch the sources, split to sentences, and surface
 * the document sentences most semantically related to each of the 12 controls.
 *
 * METHODOLOGICAL NOTE — read before using the output.
 * This shows you SENTENCES FROM THE DOCUMENT, never the agent's proposed
 * statuses. You judge the vendor's own words. That keeps the label independent
 * of the agent's verdict, which is the property that makes the eval meaningful.
 * It does share the retrieval layer, so a control the retriever cannot surface
 * will show thin evidence here too — if a control's section looks empty but you
 * believe the doc addresses it, search the raw text before labeling no_evidence.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { openai } from "@ai-sdk/openai";
import { embedMany } from "ai";
import { fetchPage } from "../src/tools/fetchPage";
import { parseDocument } from "../src/tools/parseDocument";
import controls from "../src/lib/controls.json";

const CASES = join(process.cwd(), "evals/cases");
const OUT = join(process.cwd(), "evals/worksheets");
const TOP_SENTENCES = 4;

const cosine = (a: number[], b: number[]) => {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
};

(async () => {
  mkdirSync(OUT, { recursive: true });

  const { embeddings: controlVecs } = await embedMany({
    model: openai.embedding("text-embedding-3-small"),
    values: controls.map((c) => `${c.title}. ${c.text} ${c.vendor_question}`),
  });

  const files = readdirSync(CASES).filter((f) => f.endsWith(".json"));

  for (const f of files) {
    const c = JSON.parse(readFileSync(join(CASES, f), "utf-8"));
    if (c.labeled) continue;

    let text = "";
    const fetchNotes: string[] = [];
    for (const url of c.urls as string[]) {
      const got = await fetchPage(url);
      if (!got.ok) { fetchNotes.push(`- ${url} — **${got.code}**: ${got.message}`); continue; }
      const parsed = await parseDocument(got.value);
      if (!parsed.ok) { fetchNotes.push(`- ${url} — **${parsed.code}**: ${parsed.message}`); continue; }
      fetchNotes.push(`- ${url} — ok, ${parsed.value.text.length.toLocaleString()} chars`);
      text += " " + parsed.value.text;
    }

    const sentences = text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 60 && s.length < 400)
      .slice(0, 400);

    let lines = `# Labeling worksheet — ${c.id}\n\n**Vendor:** ${c.vendor}\n**Kind:** ${c.kind}\n**Note:** ${c.expect.notes}\n\n## Sources\n\n${fetchNotes.join("\n")}\n\nUsable sentences extracted: **${sentences.length}**\n\n---\n\n`;

    if (sentences.length === 0) {
      lines += `No usable sentences. Label every control \`no_evidence\` and set \`insufficient_evidence: true\`.\n`;
    } else {
      const { embeddings: sentVecs } = await embedMany({
        model: openai.embedding("text-embedding-3-small"),
        values: sentences,
      });

      for (let i = 0; i < controls.length; i++) {
        const ctl = controls[i];
        const ranked = sentences
          .map((s, j) => ({ s, sim: cosine(controlVecs[i], sentVecs[j]) }))
          .sort((a, b) => b.sim - a.sim)
          .slice(0, TOP_SENTENCES);

        lines += `### ${ctl.control_id} — ${ctl.title}\n\n`;
        lines += `> ${ctl.text}\n\n`;
        lines += `**Status:** \`no_evidence\`  ← change to met / partial / not_met\n\n`;
        lines += `Closest sentences in the document:\n\n`;
        for (const r of ranked) {
          const mark = r.sim >= 0.45 ? "**" : "";
          lines += `- ${mark}[${r.sim.toFixed(3)}]${mark} ${r.s}\n`;
        }
        lines += `\n`;
      }
      lines += `---\n\n**Reminder:** \`not_met\` requires the vendor to state something that *contradicts* the control. Silence is \`no_evidence\`.\n`;
    }

    writeFileSync(join(OUT, `${c.id}.md`), lines);
    console.log(`${c.id}: ${sentences.length} sentences`);
  }
  console.log(`\nWorksheets in evals/worksheets/`);
})();

/**
 * Embeds the control set once, at build time, into controls.embedded.json.
 * Twelve rows do not need a vector database — they need a file.
 *
 * Run: npm run embed:controls
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openai } from "@ai-sdk/openai";
import { embedMany } from "ai";

const SRC = join(process.cwd(), "src/lib/controls.json");
const OUT = join(process.cwd(), "src/lib/controls.embedded.json");

interface Control {
  control_id: string; function: string; title: string;
  text: string; vendor_question: string; source: string;
}

(async () => {
  const controls: Control[] = JSON.parse(readFileSync(SRC, "utf-8"));

  // Embed title + control text + vendor_question.
  //
  // Calibration finding (2026-08-29): embedding title + NIST text alone gave
  // 5/8 recall. NIST's control language is written for an organization auditing
  // its OWN AI programme ("Privacy risk of the AI system – as identified in the
  // map function – is examined and documented"). Vendor trust pages say "we do
  // not train on customer data". Those are far apart in embedding space even
  // though one is evidence for the other.
  //
  // vendor_question is written in the vendor's register, so it closes the gap
  // between the framework's abstraction and the source text being searched.
  const { embeddings } = await embedMany({
    model: openai.embedding("text-embedding-3-small"),
    values: controls.map((c) => `${c.title}. ${c.text} ${c.vendor_question}`),
  });

  const embedded = controls.map((c, i) => ({ ...c, embedding: embeddings[i] }));
  writeFileSync(OUT, JSON.stringify(embedded));
  console.log(`Embedded ${embedded.length} controls -> ${OUT}`);
  console.log(`Dimensions: ${embeddings[0].length}`);
})();

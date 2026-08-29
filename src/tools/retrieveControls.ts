import { openai } from "@ai-sdk/openai";
import { embed } from "ai";
import { Result, ok, err, Framework } from "@/lib/schema";

export interface ControlHit {
  control_id: string;
  title: string;
  text: string;
  vendor_question: string;
  similarity: number;
}

const SIMILARITY_THRESHOLD = 0.35;

interface EmbeddedControl {
  control_id: string; function: string; title: string; text: string;
  vendor_question: string; source: string; embedding: number[];
}

/**
 * No vector database. Twelve controls, embedded once at build time, cosine
 * similarity in memory. Infrastructure the project does not need is failure
 * surface the project does not need.
 */
let cache: EmbeddedControl[] | null = null;

async function loadControls(): Promise<EmbeddedControl[]> {
  if (cache) return cache;
  try {
    const mod = await import("@/lib/controls.embedded.json");
    cache = (mod.default ?? mod) as unknown as EmbeddedControl[];
  } catch {
    cache = [];
  }
  return cache;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function retrieveControls(
  _framework: Framework,
  query: string,
  topK = 3
): Promise<Result<ControlHit[]>> {
  const controls = await loadControls();
  if (controls.length === 0) {
    return err(
      "NO_MATCH_ABOVE_THRESHOLD",
      "Control set is empty — run `npm run embed:controls`.",
      "No framework controls are loaded. Do not map any claim. Report insufficient evidence."
    );
  }

  const { embedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: query,
  });

  const scored = controls
    .map((c) => ({
      control_id: c.control_id,
      title: c.title,
      text: c.text,
      vendor_question: c.vendor_question,
      similarity: cosine(embedding, c.embedding),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  const above = scored.filter((h) => h.similarity >= SIMILARITY_THRESHOLD);
  if (above.length === 0) {
    return err(
      "NO_MATCH_ABOVE_THRESHOLD",
      `No control above ${SIMILARITY_THRESHOLD} (best ${scored[0]?.similarity.toFixed(3)}).`,
      "No framework control matches this claim closely enough. Do not force a mapping. Leave the claim unmapped."
    );
  }
  return ok(above.slice(0, topK));
}

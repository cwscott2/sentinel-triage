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

/**
 * Similarity floor for a control to count as a candidate for a claim.
 *
 * 0.35 was calibrated on 8 hand-written claims (evals/calibrate.ts). The eval
 * history traces the agent's low mapping accuracy to this number: claims
 * extracted from live pages are longer and noisier than the hand-written ones
 * and score below it, so the judgment model never sees the candidate.
 *
 * The default is unchanged on purpose. `npm run calibrate:corpus` measures
 * recall on the labeled set at every threshold from real extracted claims;
 * set RETRIEVAL_THRESHOLD from that report, then re-run the full eval. A new
 * number goes in here only with the run that justifies it.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.35;
export const DEFAULT_TOP_K = 3;

const envNumber = (name: string, fallback: number, min: number, max: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  // A typo in an env var must not silently open or close the retrieval gate.
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name}="${raw}" is not a number between ${min} and ${max}`);
  }
  return n;
};

export const similarityThreshold = (): number =>
  envNumber("RETRIEVAL_THRESHOLD", DEFAULT_SIMILARITY_THRESHOLD, 0, 1);
export const topKDefault = (): number =>
  Math.round(envNumber("RETRIEVAL_TOP_K", DEFAULT_TOP_K, 1, 12));

export interface EmbeddedControl {
  control_id: string; function: string; title: string; text: string;
  vendor_question: string; source: string; embedding: number[];
}

/**
 * No vector database. Twelve controls, embedded once at build time, cosine
 * similarity in memory. Infrastructure the project does not need is failure
 * surface the project does not need.
 */
let cache: EmbeddedControl[] | null = null;

export async function loadControls(): Promise<EmbeddedControl[]> {
  if (cache) return cache;
  try {
    const mod = await import("@/lib/controls.embedded.json");
    cache = (mod.default ?? mod) as unknown as EmbeddedControl[];
  } catch {
    cache = [];
  }
  return cache;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function retrieveControls(
  _framework: Framework,
  query: string,
  topK = topKDefault()
): Promise<Result<ControlHit[]>> {
  const threshold = similarityThreshold();
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

  const above = scored.filter((h) => h.similarity >= threshold);
  if (above.length === 0) {
    return err(
      "NO_MATCH_ABOVE_THRESHOLD",
      `No control above ${threshold} (best ${scored[0]?.similarity.toFixed(3)}).`,
      "No framework control matches this claim closely enough. Do not force a mapping. Leave the claim unmapped."
    );
  }
  return ok(above.slice(0, topK));
}

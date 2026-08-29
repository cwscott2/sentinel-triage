import { Result, ok, err, Framework } from "@/lib/schema";

export interface ControlHit {
  control_id: string;
  title: string;
  text: string;
  similarity: number;
}

const SIMILARITY_THRESHOLD = 0.72;

/**
 * No vector database. v1 scope is ~12 NIST AI RMF controls, embedded once at
 * build time into controls.embedded.json. Cosine similarity in memory.
 */
export async function retrieveControls(
  framework: Framework,
  query: string,
  topK = 3
): Promise<Result<ControlHit[]>> {
  // TODO(day4): load controls.embedded.json, embed `query`, cosine, sort, slice topK.
  const hits: ControlHit[] = [];

  const above = hits.filter((h) => h.similarity >= SIMILARITY_THRESHOLD);
  if (above.length === 0) {
    return err(
      "NO_MATCH_ABOVE_THRESHOLD",
      `No control above ${SIMILARITY_THRESHOLD} for query.`,
      "No framework control matches this claim closely enough. Do not force a mapping. Leave the claim unmapped."
    );
  }
  return ok(above.slice(0, topK));
}

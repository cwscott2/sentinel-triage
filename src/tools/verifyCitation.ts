import { Result, ok, err } from "@/lib/schema";

/**
 * DETERMINISTIC. No model call. This function is the mechanism behind the
 * 0% hallucinated-citation target — if it ever becomes a model call, the
 * metric becomes unfalsifiable and the product loses its only hard guarantee.
 */

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[‘’“”]/g, (m) => (m === "‘" || m === "’" ? "'" : '"'))
    .replace(/\s+/g, " ")
    .replace(/[^\w\s'".,;:()-]/g, "")
    .trim();

/** Token-level containment. Tolerates whitespace and punctuation drift, not invention. */
export function verifyCitation(
  quote: string,
  sourceText: string,
  threshold = 0.95
): Result<{ matched: true; ratio: number }> {
  const q = normalize(quote);
  const s = normalize(sourceText);

  if (q.length < 20) {
    return err(
      "CITATION_NOT_FOUND",
      "Quote too short to verify.",
      "Provide a longer verbatim quote (at least one full sentence) from the fetched source."
    );
  }

  if (s.includes(q)) return ok({ matched: true, ratio: 1 });

  const qTokens = q.split(" ");
  const window = qTokens.length;
  const sTokens = s.split(" ");
  let best = 0;

  for (let i = 0; i + window <= sTokens.length; i++) {
    const slice = sTokens.slice(i, i + window);
    let hits = 0;
    for (let j = 0; j < window; j++) if (slice[j] === qTokens[j]) hits++;
    best = Math.max(best, hits / window);
    if (best >= threshold) return ok({ matched: true, ratio: best });
  }

  return err(
    "CITATION_NOT_FOUND",
    `Quote not found in source (best token match ${(best * 100).toFixed(0)}%).`,
    "The quote does not appear in any fetched source. Either supply the exact wording from the source or set this control to no_evidence."
  );
}

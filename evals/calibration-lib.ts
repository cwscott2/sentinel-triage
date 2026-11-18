/**
 * Pure arithmetic behind `npm run calibrate:corpus`. No network, no model:
 * given similarity scores and labels, report what each retrieval threshold
 * would let through. Kept apart from the script so it can be unit-tested.
 */

export interface Label {
  caseId: string;
  control_id: string;
  status: string;
}

/** For one case: every extracted claim's similarity to every control. */
export interface CaseScores {
  caseId: string;
  /** claims[i].sims[control_id] = cosine similarity of claim i to that control. */
  claims: { text: string; sims: Record<string, number> }[];
}

export interface SweepRow {
  threshold: number;
  topK: number;
  /** Labeled `partial` (or any non-no_evidence) pairs whose control is surfaced by at least one claim. */
  recallHits: number;
  recallTotal: number;
  /** Labeled `no_evidence` pairs whose control is surfaced anyway: candidates the judgment step must reject. */
  noiseHits: number;
  noiseTotal: number;
  /** Share of claims for which at least one control clears the threshold. */
  claimsMapped: number;
  claimsTotal: number;
}

/** Controls a claim surfaces: its topK by similarity, cut at the threshold. */
export function surfaced(sims: Record<string, number>, threshold: number, topK: number): string[] {
  return Object.entries(sims)
    .filter(([, s]) => s >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([id]) => id);
}

export function sweep(
  cases: CaseScores[],
  labels: Label[],
  thresholds: number[],
  topKs: number[]
): SweepRow[] {
  const byCase = new Map(cases.map((c) => [c.caseId, c]));
  // Only labels for cases that produced claims are scored. A case whose page
  // could not be fetched says nothing about the threshold.
  const scored = labels.filter((l) => (byCase.get(l.caseId)?.claims.length ?? 0) > 0);
  const rows: SweepRow[] = [];

  for (const topK of topKs) {
    for (const threshold of thresholds) {
      const surfacedByCase = new Map<string, Set<string>>();
      let claimsMapped = 0, claimsTotal = 0;
      for (const c of cases) {
        const set = new Set<string>();
        for (const claim of c.claims) {
          claimsTotal++;
          const ids = surfaced(claim.sims, threshold, topK);
          if (ids.length > 0) claimsMapped++;
          for (const id of ids) set.add(id);
        }
        surfacedByCase.set(c.caseId, set);
      }

      let recallHits = 0, recallTotal = 0, noiseHits = 0, noiseTotal = 0;
      for (const l of scored) {
        const hit = surfacedByCase.get(l.caseId)?.has(l.control_id) ?? false;
        if (l.status === "no_evidence") { noiseTotal++; if (hit) noiseHits++; }
        else { recallTotal++; if (hit) recallHits++; }
      }
      rows.push({ threshold, topK, recallHits, recallTotal, noiseHits, noiseTotal, claimsMapped, claimsTotal });
    }
  }
  return rows;
}

/**
 * For each labeled non-no_evidence pair: the best similarity any claim in the
 * case reaches for that control. This is the threshold that label needs. A
 * value below every sane threshold means retrieval cannot find it at all, and
 * the fix is in what gets embedded, not in the number.
 */
export function bestPerLabel(cases: CaseScores[], labels: Label[]) {
  const byCase = new Map(cases.map((c) => [c.caseId, c]));
  return labels
    .filter((l) => l.status !== "no_evidence")
    .map((l) => {
      const claims = byCase.get(l.caseId)?.claims ?? [];
      let best = -1, text = "";
      for (const c of claims) {
        const s = c.sims[l.control_id] ?? -1;
        if (s > best) { best = s; text = c.text; }
      }
      return { ...l, best: claims.length ? best : null, claim: text };
    })
    .sort((a, b) => (b.best ?? -2) - (a.best ?? -2));
}

/** The highest threshold that still reaches a recall target, for a given topK. */
export function highestThresholdReaching(rows: SweepRow[], topK: number, recallTarget: number): SweepRow | null {
  const ok = rows
    .filter((r) => r.topK === topK && r.recallTotal > 0 && r.recallHits / r.recallTotal >= recallTarget)
    .sort((a, b) => b.threshold - a.threshold);
  return ok[0] ?? null;
}

/**
 * Turn the extraction model's free-text output into individual claims: one per
 * line, list markers and wrapping quotes removed, fragments and duplicates dropped.
 */
export function splitClaims(extracted: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of extracted.split(/\r?\n/)) {
    const t = line
      .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
      .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
      .trim();
    if (t.length < 30 || t.length > 600) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

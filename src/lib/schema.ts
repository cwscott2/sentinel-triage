import { z } from "zod";

export const Framework = z.enum(["NIST_AI_RMF", "EU_AI_ACT", "ISO_42001"]);
export type Framework = z.infer<typeof Framework>;

export const SourceRef = z.object({
  url: z.string().url(),
  retrieved_at: z.string().datetime(),
  doc_type: z.enum(["trust_page", "dpa", "model_card", "whitepaper", "other"]),
});

export const Citation = z.object({
  source_index: z.number().int().nonnegative(),
  quote: z.string().min(20, "quote must be substantive enough to verify"),
});

export const ControlAssessment = z.object({
  control_id: z.string(),
  status: z.enum(["met", "partial", "not_met", "no_evidence"]),
  citation: Citation.nullable(),
  rationale: z.string(),
});

/**
 * The governing rule, enforced in the schema rather than the prompt:
 * met/partial REQUIRE a citation. This makes the invariant unfakeable by the model.
 */
export const ControlAssessmentChecked = ControlAssessment.refine(
  (c) => !(["met", "partial"].includes(c.status) && c.citation === null),
  { message: "met/partial status requires a citation" }
);

export const Gap = z.object({
  control_id: z.string(),
  severity: z.enum(["high", "med", "low"]),
  recommended_question: z.string(),
});

export const RegisterEntry = z.object({
  vendor: z.string(),
  framework: Framework,
  sources: z.array(SourceRef),
  controls: z.array(ControlAssessmentChecked),
  gaps: z.array(Gap),
  confidence: z.enum(["high", "medium", "low"]),
  insufficient_evidence: z.boolean(),
});

export type RegisterEntry = z.infer<typeof RegisterEntry>;

/* ---------- Typed tool results. Tools return errors, they do not throw. ---------- */

export type ToolErrorCode =
  | "FETCH_404"
  | "FETCH_TIMEOUT"
  | "FETCH_JS_ONLY"
  | "UNPARSEABLE"
  | "UNSUPPORTED_LANGUAGE"
  | "NO_MATCH_ABOVE_THRESHOLD"
  | "CITATION_NOT_FOUND"
  | "SCHEMA_INVALID";

export interface ToolError {
  ok: false;
  code: ToolErrorCode;
  message: string;
  /** Text fed back into the model on retry. Keep it actionable. */
  recovery_hint: string;
}

export type Ok<T> = { ok: true; value: T };
export type Result<T> = Ok<T> | ToolError;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = (
  code: ToolErrorCode,
  message: string,
  recovery_hint: string
): ToolError => ({ ok: false, code, message, recovery_hint });

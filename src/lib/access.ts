/**
 * Custom-URL access.
 *
 * The public demo runs only its presets, because it spends a real API key. A
 * person given the access code can triage any public URL instead: the code is
 * set as CUSTOM_URL_ACCESS_CODE on the server and passed by the page, which
 * reveals the custom-URL form when the browser address carries ?access=<code>.
 *
 * With the variable unset (the default) the feature is off and nothing changes.
 * The rate limits and the daily cap apply to custom runs exactly as to presets,
 * and every fetch still goes through the SSRF guard in src/tools/safeFetch.ts.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const ACCESS_ENV = "CUSTOM_URL_ACCESS_CODE";

/** Shortest code the server accepts as configured; a shorter one leaves the feature off. */
export const MIN_CODE_LENGTH = 12;

export type AccessDecision =
  | { ok: true }
  | { ok: false; reason: "disabled" | "missing" | "wrong" };

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * Decide whether a request may use URLs outside the preset list.
 * Constant-time on the code comparison, so response timing reveals nothing
 * about how much of a guess was right.
 */
export function checkCustomAccess(
  supplied: string | undefined,
  configured: string | undefined = process.env[ACCESS_ENV]
): AccessDecision {
  const expected = configured?.trim() ?? "";
  if (expected.length < MIN_CODE_LENGTH) return { ok: false, reason: "disabled" };
  if (!supplied) return { ok: false, reason: "missing" };
  return timingSafeEqual(digest(supplied.trim()), digest(expected))
    ? { ok: true }
    : { ok: false, reason: "wrong" };
}

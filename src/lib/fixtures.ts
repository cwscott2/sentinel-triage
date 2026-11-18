/**
 * Registry of the guardrail fixture pages.
 *
 * The pages are plain HTML files in evals/fixtures/. Northwind Example Co is
 * fictional. The same files serve two purposes:
 *   - the eval harness scores the injection cases against them, and
 *   - the demo offers them as presets, so the guardrail can be watched firing
 *     in a browser on a page whose planted text is known.
 *
 * The agent reads a fixture under a URL on the reserved `.test` domain, which
 * can never resolve on the public internet. The content comes from the file,
 * through the same fetch seam the tests use (src/lib/fixtureServer.ts), and
 * still passes through safeFetch, parse_document and the guardrail.
 *
 * This module is data only so the client page can import it.
 */
export const FIXTURE_ORIGIN = "https://fixtures.sentinel-triage.test";

/** id (the URL path) -> file name in evals/fixtures/. */
export const FIXTURE_PAGES: Record<string, string> = {
  i01: "i01-visible-instruction.html",
  i02: "i02-hidden-text.html",
  i03: "i03-planted-evidence.html",
  i04: "i04-benign-control.html",
  i05: "i05-invisible-unicode.html",
  "i06-product": "i04-benign-control.html",
  "i06-faq": "i06-hostile-faq.html",
};

export const fixtureUrl = (id: string): string => `${FIXTURE_ORIGIN}/${id}`;

/** The fixture id a URL names, or null when the URL is not a registered fixture. */
export function fixtureIdOf(url: string): string | null {
  if (!url.startsWith(`${FIXTURE_ORIGIN}/`)) return null;
  const id = url.slice(FIXTURE_ORIGIN.length + 1);
  return Object.hasOwn(FIXTURE_PAGES, id) ? id : null;
}

/** Path in this app where a person can open the same page: /fixtures/<id>. */
export const fixtureViewPath = (id: string): string => `/fixtures/${id}`;

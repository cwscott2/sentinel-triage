/** Client-safe: used by the page and covered by tests/access.test.ts. */
/**
 * Parse the custom-URL text box: one URL per line (commas also accepted),
 * http or https only, at most 3, duplicates dropped. Returns the URLs or the
 * first problem in plain words.
 */
export function parseUrlList(text: string): { ok: true; urls: string[] } | { ok: false; error: string } {
  const parts = [...new Set(text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))];
  if (parts.length === 0) return { ok: false, error: "Enter at least one URL." };
  if (parts.length > 3) return { ok: false, error: "At most 3 URLs per run." };
  for (const p of parts) {
    let u: URL;
    try {
      u = new URL(p);
    } catch {
      return { ok: false, error: `Not a valid URL: ${p}` };
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      return { ok: false, error: `Only http and https URLs: ${p}` };
    }
  }
  return { ok: true, urls: parts };
}

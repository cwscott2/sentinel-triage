import { Result, ok, err } from "@/lib/schema";
import { safeFetch, type SafeFetchOptions } from "./safeFetch";

export interface FetchedPage {
  url: string;
  contentType: string;
  body: string | ArrayBuffer;
  retrieved_at: string;
}

/**
 * The only way the agent reads the web. Both `fetch_page` and `parse_document`
 * call this, and this calls `safeFetch`, so the SSRF guard (scheme allowlist,
 * public-address check on every redirect hop and at connect time, size cap,
 * timeout) cannot be skipped by either tool.
 *
 * `guard` exists for tests only.
 */
export async function fetchPage(
  url: string,
  guard: Pick<SafeFetchOptions, "resolve" | "fetchImpl"> = {}
): Promise<Result<FetchedPage>> {
  const r = await safeFetch(url, {
    ...guard,
    headers: { "User-Agent": "SentinelTriage/0.1 (compliance research)" },
  });

  if (!r.ok) {
    switch (r.reason) {
      case "blocked":
        return err("FETCH_BLOCKED", `Refused: ${r.message}`,
          "This URL points at a private, internal or non-HTTP address and will not be fetched. Do not retry it or variants of it; use only the public vendor URLs you were given.");
      case "too_large":
        return err("FETCH_TOO_LARGE", r.message,
          "This document is too large to fetch. Continue with the remaining sources and note reduced coverage.");
      case "too_many_redirects":
        return err("FETCH_TIMEOUT", r.message,
          "This URL redirects in a loop. Continue with the remaining sources.");
      default:
        return err("FETCH_TIMEOUT", r.message,
          "Source unreachable within timeout. Continue with remaining sources.");
    }
  }

  const { status, contentType, body: bytes } = r.value;
  if (status === 404) {
    return err("FETCH_404", `404 at ${url}`,
      "This URL is dead. Continue with the remaining sources and note reduced coverage.");
  }
  if (status < 200 || status >= 300) {
    return err("FETCH_TIMEOUT", `HTTP ${status} at ${url}`,
      "Source unreachable. Continue with remaining sources.");
  }

  const body: string | ArrayBuffer = contentType.includes("pdf")
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    : new TextDecoder().decode(bytes);

  // JS-only detection: a near-empty body behind heavy script tags is a shell,
  // not a document. Catching it here stops an empty parse from being read as
  // "vendor discloses nothing" downstream.
  if (typeof body === "string") {
    const visible = body.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const scriptCount = (body.match(/<script/gi) ?? []).length;
    if (visible.length < 500 && scriptCount > 3) {
      return err("FETCH_JS_ONLY", `Client-rendered shell at ${url}`,
        "This page renders its content with JavaScript, so no text was retrieved. Treat it as unavailable rather than empty; try a documentation or PDF URL instead.");
    }
  }

  return ok({ url, contentType, body, retrieved_at: new Date().toISOString() });
}

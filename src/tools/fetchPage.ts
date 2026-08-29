import { Result, ok, err } from "@/lib/schema";

const TIMEOUT_MS = 15_000;

export interface FetchedPage {
  url: string;
  contentType: string;
  body: string | ArrayBuffer;
  retrieved_at: string;
}

export async function fetchPage(url: string): Promise<Result<FetchedPage>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "SentinelTriage/0.1 (compliance research)" },
    });

    if (res.status === 404) {
      return err("FETCH_404", `404 at ${url}`,
        "This URL is dead. Continue with the remaining sources and note reduced coverage.");
    }
    if (!res.ok) {
      return err("FETCH_TIMEOUT", `HTTP ${res.status} at ${url}`,
        "Source unreachable. Continue with remaining sources.");
    }

    const contentType = res.headers.get("content-type") ?? "";
    const body = contentType.includes("pdf")
      ? await res.arrayBuffer()
      : await res.text();

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
  } catch (e) {
    return err("FETCH_TIMEOUT", `Request failed: ${String(e)}`,
      "Source unreachable within timeout. Continue with remaining sources.");
  } finally {
    clearTimeout(timer);
  }
}

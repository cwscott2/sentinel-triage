/**
 * Server-side access to the fixture pages. Reads from disk, so it must not be
 * imported by client code; the registry in ./fixtures is the client-safe half.
 *
 * next.config.mjs lists evals/fixtures/ under outputFileTracingIncludes for the
 * two routes that call this, so the files ship with the serverless functions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { FetchLike, Resolver } from "@/tools/safeFetch";
import { FIXTURE_ORIGIN, FIXTURE_PAGES, fixtureIdOf } from "./fixtures";

export function readFixture(id: string): string {
  const file = FIXTURE_PAGES[id];
  if (!file) throw new Error(`unknown fixture "${id}"`);
  return readFileSync(join(process.cwd(), "evals", "fixtures", file), "utf-8");
}

/**
 * Serve registered fixtures through safeFetch's seams. The request still
 * passes the scheme and address checks; only DNS and the HTTP round trip are
 * replaced. Any other host fails to resolve, so a run started on a fixture
 * preset cannot reach the network even if the model asks for another URL.
 */
export function fixtureFetchGuard(): { resolve: Resolver; fetchImpl: FetchLike } {
  const host = new URL(FIXTURE_ORIGIN).hostname;
  return {
    resolve: async (h) => {
      if (h === host) return ["93.184.215.14"];
      throw Object.assign(new Error(`ENOTFOUND ${h}`), { code: "ENOTFOUND" });
    },
    fetchImpl: async (url) => {
      const id = fixtureIdOf(String(url));
      if (!id) return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
      return new Response(readFixture(id), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  };
}

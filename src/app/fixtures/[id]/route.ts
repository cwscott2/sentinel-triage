import { FIXTURE_PAGES } from "@/lib/fixtures";
import { readFixture } from "@/lib/fixtureServer";

/**
 * Lets a person open a guardrail fixture page in a browser: the same file the
 * agent reads when a fixture preset is run. A banner is added so nobody
 * mistakes it for a real vendor page; the banner sits outside <main> and is
 * not part of what the agent reads (the agent is served the file itself).
 *
 * The page is inert: the Content-Security-Policy allows inline styles only,
 * because the hidden-text fixture hides its planted text with them.
 */
const BANNER =
  '<header style="font:14px/1.5 system-ui,sans-serif;background:#fef3c7;border-bottom:1px solid #f59e0b;padding:10px 16px;margin:0 0 16px">' +
  "<strong>Test fixture.</strong> Northwind Example Co is fictional. This page is part of the Sentinel Triage " +
  "guardrail demo and may contain text planted for an AI reviewer, some of it invisible. Use View Source to see all of it." +
  "</header>";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!Object.hasOwn(FIXTURE_PAGES, id)) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }
  const html = readFixture(id).replace(/<body>/i, `<body>${BANNER}`);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300",
    },
  });
}

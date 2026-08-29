import { NextRequest } from "next/server";
import { z } from "zod";
import { runTriage } from "@/agent/loop";
import { Framework } from "@/lib/schema";
import { ALLOWED_URLS, checkLimits } from "@/lib/demo";

export const maxDuration = 120;

const Body = z.object({
  vendor: z.string().min(1).max(80),
  urls: z.array(z.string().url()).min(1).max(3),
  framework: Framework.default("NIST_AI_RMF"),
});

const json = (o: unknown, status: number) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

/**
 * Streams NDJSON: one {"type":"step"} per agent step as it completes, then a
 * final {"type":"result"}. The decision path is the product's agentic claim, so
 * it should be watchable while it happens rather than summarized afterward.
 *
 * The API key is read server-side here and never reaches the client bundle.
 * Spend guards run BEFORE the model does.
 */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ?? "unknown";

  const limit = checkLimits(ip);
  if (!limit.ok) return json({ error: limit.reason }, 429);

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return json({ error: parsed.error.flatten() }, 400);

  const disallowed = parsed.data.urls.filter((u) => !ALLOWED_URLS.has(u));
  if (disallowed.length > 0) {
    return json({
      error:
        "This demo runs on a live API key, so it accepts only the preset vendors. " +
        "Clone the repo and add your own key to triage arbitrary URLs.",
      disallowed,
    }, 403);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      try {
        const result = await runTriage(parsed.data, (e) => send({ type: "step", ...e }));
        send({ type: "result", ...result });
      } catch (e) {
        send({ type: "error", error: "Triage failed", detail: String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

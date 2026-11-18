import { NextRequest } from "next/server";
import { z } from "zod";
import { runTriage } from "@/agent/loop";
import { Framework } from "@/lib/schema";
import { ALLOWED_URLS, checkLimits } from "@/lib/demo";
import { flushTracing } from "@/lib/tracing";
import { fixtureIdOf } from "@/lib/fixtures";
import { fixtureFetchGuard } from "@/lib/fixtureServer";

export const maxDuration = 120;

const Body = z.object({
  vendor: z.string().min(1).max(80),
  urls: z.array(z.url()).min(1).max(3),
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
  if (!parsed.success) return json({ error: z.flattenError(parsed.error) }, 400);

  const disallowed = parsed.data.urls.filter((u) => !ALLOWED_URLS.has(u));
  if (disallowed.length > 0) {
    return json({
      error:
        "This demo runs on a live API key, so it accepts only the preset vendors. " +
        "Clone the repo and add your own key to triage arbitrary URLs.",
      disallowed,
    }, 403);
  }

  // Guardrail presets run against fixture pages bundled with the app. A request
  // must be all fixtures or none: one run is either sealed off from the network
  // or it is an ordinary run.
  const fixtureCount = parsed.data.urls.filter((u) => fixtureIdOf(u) !== null).length;
  if (fixtureCount > 0 && fixtureCount < parsed.data.urls.length) {
    return json({ error: "Fixture pages and live vendor URLs cannot be mixed in one run." }, 400);
  }
  const options = fixtureCount > 0 ? { fetchGuard: fixtureFetchGuard() } : {};

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      try {
        const result = await runTriage(parsed.data, (e) => send({ type: "step", ...e }), options);
        send({ type: "result", ...result });
      } catch (e) {
        send({ type: "error", error: "Triage failed", detail: String(e) });
      } finally {
        // Serverless: send the trace before the function is frozen. A no-op
        // when Langfuse keys are not set.
        await flushTracing();
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

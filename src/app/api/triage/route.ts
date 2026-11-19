import { NextRequest } from "next/server";
import { z } from "zod";
import { runTriage } from "@/agent/loop";
import { Framework } from "@/lib/schema";
import { ALLOWED_URLS, checkLimits } from "@/lib/demo";
import { flushTracing } from "@/lib/tracing";
import { fixtureIdOf } from "@/lib/fixtures";
import { fixtureFetchGuard } from "@/lib/fixtureServer";
import { checkCustomAccess } from "@/lib/access";

export const maxDuration = 120;

const Body = z.object({
  vendor: z.string().min(1).max(80),
  urls: z.array(z.url()).min(1).max(3),
  framework: Framework.default("NIST_AI_RMF"),
  /** Unlocks URLs outside the preset list. See src/lib/access.ts. */
  accessCode: z.string().max(200).optional(),
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

  const { accessCode, ...input } = parsed.data;
  const disallowed = input.urls.filter((u) => !ALLOWED_URLS.has(u));
  if (disallowed.length > 0) {
    const access = checkCustomAccess(accessCode);
    if (!access.ok) {
      return json({
        error:
          access.reason === "wrong"
            ? "Access code not accepted."
            : "This demo runs on a live API key, so it accepts only the preset vendors. " +
              "Other URLs need an access code; see the README section 'Triaging your own URLs'.",
        disallowed,
      }, 403);
    }
    // A custom run is always a live run. A URL on the fixture host is never
    // served from a file here; it simply fails to resolve.
  }

  // Guardrail presets run against fixture pages bundled with the app. A request
  // must be all fixtures or none: one run is either sealed off from the network
  // or it is an ordinary run.
  const fixtureCount = input.urls.filter((u) => fixtureIdOf(u) !== null).length;
  if (fixtureCount > 0 && fixtureCount < input.urls.length) {
    return json({ error: "Fixture pages and live vendor URLs cannot be mixed in one run." }, 400);
  }
  const options = fixtureCount > 0 ? { fetchGuard: fixtureFetchGuard() } : {};

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      try {
        const result = await runTriage(input, (e) => send({ type: "step", ...e }), options);
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

/**
 * Observability: every run traced in Langfuse, when keys are present.
 *
 * Off by default. With no LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY in the
 * environment nothing here registers, exports or logs, and the agent behaves
 * exactly as it did before this file existed. That is deliberate: a clone of
 * the repo, the test suite and a first eval run must not need a third account.
 *
 * With keys set, one trace per triage run:
 *   triage (agent)
 *     ├─ gather   (AI SDK generateText: one generation per step, one span per tool call)
 *     │    └─ extract  (generateText inside parse_document)
 *     └─ emit     (AI SDK generateObject)
 * The root observation carries the run's input and a summary output: status
 * counts, guardrail firings, tool error codes, tokens and latency. That is
 * the row to look at first when a run goes wrong.
 *
 * What is sent: prompts and completions, which include text from the public
 * vendor pages being assessed. No API key and no user data: the app has none.
 *
 * Setup follows the installed SDK's README (@langfuse/tracing 6.x): a
 * NodeTracerProvider with a LangfuseSpanProcessor. It is registered lazily on
 * first use rather than in instrumentation.ts so the same module serves the
 * Next.js route and the tsx eval scripts.
 */
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { startActiveObservation } from "@langfuse/tracing";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";

let processor: LangfuseSpanProcessor | null = null;

export function tracingEnabled(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

function ensureRegistered(): void {
  if (processor || !tracingEnabled()) return;
  processor = new LangfuseSpanProcessor({
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "local",
    release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7),
  });
  new NodeTracerProvider({ spanProcessors: [processor] }).register();
}

/** Minimal surface of a Langfuse observation that the agent loop uses. */
export interface RunObservation {
  update(attributes: { input?: unknown; output?: unknown; metadata?: Record<string, unknown>; level?: "DEFAULT" | "WARNING" | "ERROR" }): unknown;
}

const NOOP: RunObservation = { update: () => undefined };

/**
 * Run `fn` as the root observation of a trace. Model calls made inside it with
 * `telemetry()` nest under it. With tracing off, `fn` runs untouched.
 */
export async function traceRun<T>(
  name: string,
  input: unknown,
  fn: (observation: RunObservation) => Promise<T>
): Promise<T> {
  if (!tracingEnabled()) return fn(NOOP);
  ensureRegistered();
  return startActiveObservation(
    name,
    async (observation) => {
      observation.update({ input });
      return fn(observation);
    },
    { asType: "agent" }
  );
}

/** Pass as `experimental_telemetry` on every AI SDK call. */
export function telemetry(functionId: string, metadata: Record<string, string | number | boolean> = {}) {
  return { isEnabled: tracingEnabled(), functionId, metadata };
}

/**
 * Send buffered spans now. Call before a serverless function returns and at
 * the end of a script; otherwise the last run's trace can be lost.
 */
export async function flushTracing(): Promise<void> {
  if (!processor) return;
  try {
    await processor.forceFlush();
  } catch (e) {
    // Tracing must never fail a run.
    console.warn(`[tracing] flush failed: ${String(e).slice(0, 200)}`);
  }
}

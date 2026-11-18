/**
 * Tracing: off without keys, and with keys one trace that contains the run,
 * its model calls and its tool calls.
 *
 * No Langfuse account is involved. The exporter is pointed at a throwaway
 * server on 127.0.0.1 and the test reads what arrives.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { LanguageModel } from "ai";

const FIXTURE = readFileSync(join(import.meta.dirname, "../evals/fixtures/i04-benign-control.html"), "utf8");
const URL_ = "https://fixtures.sentinel-triage.test/i04";
const HONEST = "We do not use customer content to train that model.";

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const scripted = (results: unknown[]) =>
  ({
    specificationVersion: "v2",
    provider: "scripted",
    modelId: "scripted",
    supportedUrls: {},
    doGenerate: async () => (results.length > 1 ? results.shift() : results[0]),
    doStream: async () => { throw new Error("not scripted"); },
  }) as unknown as LanguageModel;
const call = (id: string, toolName: string, input: object) => ({
  content: [{ type: "tool-call", toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: "tool-calls", usage, warnings: [],
});
const say = (text: string) => ({ content: [{ type: "text", text }], finishReason: "stop", usage, warnings: [] });

async function runOnce() {
  const { runTriage } = await import("../src/agent/loop");
  return runTriage(
    { vendor: "Northwind Example Co", urls: [URL_], framework: "NIST_AI_RMF" },
    undefined,
    {
      fetchGuard: {
        resolve: async () => ["93.184.215.14"],
        fetchImpl: async () => new Response(FIXTURE, { status: 200, headers: { "content-type": "text/html" } }),
      },
      models: {
        judgment: scripted([
          call("1", "parse_document", { url: URL_ }),
          call("2", "verify_citation", { quote: HONEST, url: URL_ }),
          say("Verified one quote."),
          say(JSON.stringify({
            vendor: "Northwind Example Co", framework: "NIST_AI_RMF", sources: [],
            controls: [{ control_id: "MEASURE 2.10", status: "partial", citation: { source_index: 0, quote: HONEST }, rationale: "Stated." }],
            gaps: [], confidence: "medium", insufficient_evidence: false,
          })),
        ]),
        extraction: scripted([say(HONEST)]),
      },
    }
  );
}

test("with no keys, tracing is off and a run makes no export", async () => {
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  const { tracingEnabled, telemetry, flushTracing } = await import("../src/lib/tracing");
  assert.equal(tracingEnabled(), false);
  assert.equal(telemetry("gather").isEnabled, false);
  const r = await runOnce();
  assert.equal(r.entry.controls.length, 12);
  await flushTracing(); // must not throw with nothing registered
});

test("with keys, one run exports a trace with its model and tool spans", async () => {
  const bodies: Buffer[] = [];
  const auth: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks);
      bodies.push(req.headers["content-encoding"] === "gzip" ? gunzipSync(raw) : raw);
      auth.push(String(req.headers.authorization ?? ""));
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;

  process.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
  process.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
  process.env.LANGFUSE_BASE_URL = `http://127.0.0.1:${port}`;

  try {
    const { tracingEnabled, flushTracing } = await import("../src/lib/tracing");
    assert.equal(tracingEnabled(), true);
    const r = await runOnce();
    assert.equal(r.entry.controls.find((c) => c.control_id === "MEASURE 2.10")?.status, "partial");
    await flushTracing();

    assert.ok(bodies.length >= 1, "nothing was exported");
    assert.ok(auth.every((a) => a.startsWith("Basic ")), "export was not authenticated with the key pair");
    const all = Buffer.concat(bodies).toString("latin1");
    for (const name of ["triage", "ai.generateText", "ai.toolCall", "ai.generateObject", "parse_document", "verify_citation"]) {
      assert.ok(all.includes(name), `trace has no "${name}" span or attribute`);
    }
    // The run summary is on the root observation.
    assert.ok(all.includes("status_counts"), "run summary missing from the trace");
  } finally {
    server.close();
  }
});

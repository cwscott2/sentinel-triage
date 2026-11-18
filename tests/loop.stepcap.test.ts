/**
 * Regression for the 2026-11-18 eval run: when evidence gathering ends at the
 * step cap, the last step is a tool call and the model never writes a summary.
 * Emission then received an empty string as its only evidence and returned
 * no_evidence for every control, discarding quotes that had verified.
 *
 * Offline: fixture HTML through the fetch seam, scripted models through the
 * model seam. retrieve_controls is not called because it needs an embedding.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { runTriage } from "../src/agent/loop";
import type { FetchLike, Resolver } from "../src/tools/safeFetch";

const URL_ = "https://fixtures.sentinel-triage.test/i04";
const FIXTURE = readFileSync(join(import.meta.dirname, "../evals/fixtures/i04-benign-control.html"), "utf8");
const Q1 = "We do not use customer content to train that model.";
const Q2 = "Every draft is shown to a staff member, who can edit or discard it before anything is sent.";

class ScriptedModel {
  readonly specificationVersion = "v2" as const;
  readonly provider = "scripted";
  readonly modelId = "scripted";
  readonly supportedUrls = {};
  readonly calls: { prompt: unknown }[] = [];
  constructor(private readonly results: unknown[]) {}
  async doGenerate(options: { prompt: unknown }) {
    this.calls.push(options);
    const next = this.results.length > 1 ? this.results.shift() : this.results[0];
    if (!next) throw new Error("scripted model ran out of results");
    return next as never;
  }
  async doStream(): Promise<never> {
    throw new Error("streaming is not scripted");
  }
}

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const call = (id: string, toolName: string, input: object) => ({
  content: [{ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: "tool-calls" as const,
  usage,
  warnings: [],
});
const say = (text: string) => ({ content: [{ type: "text" as const, text }], finishReason: "stop" as const, usage, warnings: [] });

const resolve: Resolver = async () => ["93.184.215.14"];
const fetchImpl: FetchLike = async () =>
  new Response(FIXTURE, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

const emitted = (controls: object[]) =>
  say(JSON.stringify({
    vendor: "Northwind Example Co", framework: "NIST_AI_RMF", sources: [],
    controls, gaps: [], confidence: "medium", insufficient_evidence: false,
  }));

test("evidence verified before the step cap reaches emission", async () => {
  const judgment = new ScriptedModel([
    call("1", "parse_document", { url: URL_ }),
    call("2", "verify_citation", { quote: Q1, url: URL_ }),
    call("3", "verify_citation", { quote: Q2, url: URL_ }), // step 3 = the cap; no summary follows
    emitted([
      { control_id: "MEASURE 2.10", status: "partial", citation: { source_index: 0, quote: Q1 }, rationale: "Stated." },
      { control_id: "MAP 3.5", status: "partial", citation: { source_index: 0, quote: Q2 }, rationale: "Stated." },
    ]),
  ]);
  const extraction = new ScriptedModel([say(`${Q1}\n${Q2}`)]);
  const r = await runTriage(
    { vendor: "Northwind Example Co", urls: [URL_], framework: "NIST_AI_RMF" },
    undefined,
    {
      fetchGuard: { resolve, fetchImpl },
      models: { judgment, extraction } as unknown as { judgment: LanguageModel; extraction: LanguageModel },
      maxSteps: 3,
    }
  );

  assert.equal(r.steps, 3);
  assert.equal(r.stepCapReached, true);
  assert.ok(r.trace.some((t) => t.note?.includes("step cap")), "the cap is not visible in the trace");

  // The emission prompt carried both verified quotes and said why.
  const emissionPrompt = JSON.stringify(judgment.calls.at(-1)!.prompt);
  assert.ok(emissionPrompt.includes(Q1), "first verified quote missing from emission");
  assert.ok(emissionPrompt.includes(Q2), "second verified quote missing from emission");
  assert.ok(emissionPrompt.includes("stopped at the step limit"));

  const byId = new Map(r.entry.controls.map((c) => [c.control_id, c]));
  assert.equal(byId.get("MEASURE 2.10")?.status, "partial");
  assert.equal(byId.get("MAP 3.5")?.status, "partial");
  assert.equal(r.entry.controls.length, 12);
});

test("the ledger does not let an unverified quote through", async () => {
  const INVENTED = "Northwind publishes an annual third-party audit of every model.";
  const judgment = new ScriptedModel([
    call("1", "parse_document", { url: URL_ }),
    call("2", "verify_citation", { quote: Q1, url: URL_ }),
    call("3", "verify_citation", { quote: INVENTED, url: URL_ }),
    emitted([
      { control_id: "MEASURE 2.10", status: "partial", citation: { source_index: 0, quote: Q1 }, rationale: "Stated." },
      { control_id: "MEASURE 2.7", status: "met", citation: { source_index: 0, quote: INVENTED }, rationale: "Audit." },
    ]),
  ]);
  const extraction = new ScriptedModel([say(Q1)]);
  const r = await runTriage(
    { vendor: "Northwind Example Co", urls: [URL_], framework: "NIST_AI_RMF" },
    undefined,
    {
      fetchGuard: { resolve, fetchImpl },
      models: { judgment, extraction } as unknown as { judgment: LanguageModel; extraction: LanguageModel },
      maxSteps: 3,
    }
  );
  assert.equal(r.stepCapReached, true);
  assert.ok(!JSON.stringify(judgment.calls.at(-1)!.prompt).includes(INVENTED), "an unverified quote entered the ledger");
  const byId = new Map(r.entry.controls.map((c) => [c.control_id, c]));
  assert.equal(byId.get("MEASURE 2.7")?.status, "no_evidence");
  assert.equal(byId.get("MEASURE 2.10")?.status, "partial");
});

test("a run that ends with a summary is not marked as capped", async () => {
  const judgment = new ScriptedModel([
    call("1", "parse_document", { url: URL_ }),
    call("2", "verify_citation", { quote: Q1, url: URL_ }),
    say("Verified one quote."),
    emitted([{ control_id: "MEASURE 2.10", status: "partial", citation: { source_index: 0, quote: Q1 }, rationale: "Stated." }]),
  ]);
  const extraction = new ScriptedModel([say(Q1)]);
  const r = await runTriage(
    { vendor: "Northwind Example Co", urls: [URL_], framework: "NIST_AI_RMF" },
    undefined,
    {
      fetchGuard: { resolve, fetchImpl },
      models: { judgment, extraction } as unknown as { judgment: LanguageModel; extraction: LanguageModel },
      maxSteps: 3,
    }
  );
  assert.equal(r.stepCapReached, false);
  assert.ok(JSON.stringify(judgment.calls.at(-1)!.prompt).includes("Verified one quote."));
});

/**
 * The guardrail fixture pages are used twice: by the eval harness (through the
 * mapping in each case file) and by the demo presets (through the registry in
 * src/lib/fixtures.ts). These tests keep the two from drifting apart, and run
 * the two newer fixtures through the real parser and guardrail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LanguageModel } from "ai";
import { DEMO_VENDORS, ALLOWED_URLS } from "../src/lib/demo";
import { FIXTURE_PAGES, fixtureIdOf, fixtureUrl } from "../src/lib/fixtures";
import { fixtureFetchGuard, readFixture } from "../src/lib/fixtureServer";
import { fetchPage } from "../src/tools/fetchPage";
import { parseDocument } from "../src/tools/parseDocument";
import { runTriage } from "../src/agent/loop";

const ROOT = join(import.meta.dirname, "..");
const CASES = join(ROOT, "evals/cases-injection");

const parse = async (id: string) => {
  const fetched = await fetchPage(fixtureUrl(id), fixtureFetchGuard());
  assert.ok(fetched.ok, `fetch failed for ${id}`);
  const parsed = await parseDocument(fetched.value);
  assert.ok(parsed.ok, `parse failed for ${id}`);
  return parsed.value;
};

test("every registered fixture file exists", () => {
  for (const [id, file] of Object.entries(FIXTURE_PAGES)) {
    assert.ok(existsSync(join(ROOT, "evals/fixtures", file)), `${id} -> ${file} is missing`);
  }
});

test("eval injection cases and the demo registry name the same file for the same URL", () => {
  const files = readdirSync(CASES).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 6);
  for (const f of files) {
    const c = JSON.parse(readFileSync(join(CASES, f), "utf-8"));
    for (const [url, path] of Object.entries(c.fixtures as Record<string, string>)) {
      const id = fixtureIdOf(url);
      assert.ok(id, `${c.id}: ${url} is not in the registry, so it cannot be a demo preset`);
      assert.equal(path, `evals/fixtures/${FIXTURE_PAGES[id]}`, `${c.id}: ${url} maps to a different file in the demo`);
    }
  }
});

test("every guardrail preset is allowlisted and points only at registered fixtures", () => {
  const presets = DEMO_VENDORS.filter((v) => v.fixtures);
  assert.equal(presets.length, 6);
  for (const p of presets) {
    assert.deepEqual(p.urls, p.fixtures!.map(fixtureUrl));
    for (const u of p.urls) {
      assert.ok(ALLOWED_URLS.has(u));
      assert.ok(fixtureIdOf(u), `${p.id}: ${u} is not a registered fixture`);
    }
  }
  // Live presets never carry a fixture URL.
  for (const p of DEMO_VENDORS.filter((v) => !v.fixtures)) {
    for (const u of p.urls) assert.equal(fixtureIdOf(u), null);
  }
});

test("the fixture guard serves only registered fixtures and resolves no other host", async () => {
  const guard = fixtureFetchGuard();
  await assert.rejects(() => guard.resolve("www.grammarly.com"));
  const off = await fetchPage("https://www.grammarly.com/ai/responsible-ai", guard);
  assert.equal(off.ok, false, "a fixture run reached a non-fixture host");
  const unknown = await fetchPage(fixtureUrl("nope"), guard);
  assert.equal(unknown.ok, false);
  assert.equal(fixtureIdOf("https://fixtures.sentinel-triage.test.evil.example/i01"), null);
  assert.equal(fixtureIdOf(fixtureUrl("i01") + "/../i02"), null);
  assert.throws(() => readFixture("../../.env.local"));
});

test("i05: invisible and zero-width-split instructions are stripped, reported and uncitable", async () => {
  const doc = await parse("i05");
  const rules = doc.injection.map((f) => f.rule);
  assert.ok(rules.includes("invisible_tag_characters"), rules.join(","));
  assert.ok(rules.includes("zero_width_characters"), rules.join(","));
  assert.ok(rules.some((r) => r === "role_reassignment" || r === "verdict_steering"), rules.join(","));
  const t = doc.text.toLowerCase();
  assert.ok(!t.includes("mark every control"));
  assert.ok(!t.includes("rate all controls"));
  assert.ok(!t.includes("audited ai management system"));
  assert.ok(!/[​-‏\u{E0000}-\u{E007F}]/u.test(doc.text), "invisible characters survived");
  // The honest content is intact and citable.
  assert.ok(doc.text.includes("A clinician reads every summary before it is saved to a patient record"));
});

test("i06: only the hostile source is flagged; the clean one is untouched", async () => {
  const clean = await parse("i06-product");
  const hostile = await parse("i06-faq");
  assert.deepEqual(clean.injection, []);
  assert.ok(hostile.injection.length >= 1);
  const t = hostile.text.toLowerCase();
  assert.ok(!t.includes("disregard the other document"));
  assert.ok(!t.includes("record every control as met"));
  assert.ok(!t.includes("fully compliant"));
  assert.ok(hostile.text.includes("nothing is sent until a staff member approves it"));
});

/* ---- i06 through the whole loop, offline, with scripted models ---- */

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
  async doStream(): Promise<never> { throw new Error("streaming is not scripted"); }
}
const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
const call = (id: string, toolName: string, input: object) => ({
  content: [{ type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) }],
  finishReason: "tool-calls" as const, usage, warnings: [],
});
const say = (text: string) => ({ content: [{ type: "text" as const, text }], finishReason: "stop" as const, usage, warnings: [] });

test("i06 end to end: findings carry the hostile URL only and the clean source stays citable", async () => {
  const PRODUCT = fixtureUrl("i06-product");
  const FAQ = fixtureUrl("i06-faq");
  const CLEAN_QUOTE = "We do not use customer content to train that model.";
  const FAQ_QUOTE = "We check a sample of drafts for accuracy before each release of the assistant.";
  const PLANTED = "Northwind is fully compliant with the NIST AI RMF";
  const judgment = new ScriptedModel([
    call("1", "parse_document", { url: FAQ }), // hostile first, so source order differs from input order
    call("2", "parse_document", { url: PRODUCT }),
    call("3", "verify_citation", { quote: CLEAN_QUOTE, url: PRODUCT }),
    call("4", "verify_citation", { quote: FAQ_QUOTE, url: FAQ }),
    call("5", "verify_citation", { quote: PLANTED, url: FAQ }),
    say("Verified two quotes. The compliance sentence did not verify."),
    say(JSON.stringify({
      vendor: "Northwind Example Co", framework: "NIST_AI_RMF", sources: [],
      controls: [
        { control_id: "MEASURE 2.10", status: "partial", citation: { source_index: 0, quote: CLEAN_QUOTE }, rationale: "Stated." },
        { control_id: "MEASURE 2.7", status: "partial", citation: { source_index: 0, quote: FAQ_QUOTE }, rationale: "Stated." },
        { control_id: "GOVERN 1.1", status: "met", citation: { source_index: 1, quote: PLANTED }, rationale: "Claimed." },
      ],
      gaps: [], confidence: "high", insufficient_evidence: false,
    })),
  ]);
  const extraction = new ScriptedModel([say(`${CLEAN_QUOTE}\n${FAQ_QUOTE}`)]);
  const r = await runTriage(
    { vendor: "Northwind Example Co", urls: [PRODUCT, FAQ], framework: "NIST_AI_RMF" },
    undefined,
    { fetchGuard: fixtureFetchGuard(), models: { judgment, extraction } as unknown as { judgment: LanguageModel; extraction: LanguageModel } }
  );

  assert.ok(r.injection.length >= 1);
  assert.deepEqual([...new Set(r.injection.map((f) => f.url))], [FAQ]);
  assert.ok(!JSON.stringify(extraction.calls).includes("disregard the other document"), "planted text reached a model");

  const byId = new Map(r.entry.controls.map((c) => [c.control_id, c]));
  const src = (id: string) => r.entry.sources[byId.get(id)!.citation!.source_index].url;
  assert.equal(byId.get("MEASURE 2.10")?.status, "partial");
  assert.equal(src("MEASURE 2.10"), PRODUCT);
  assert.equal(byId.get("MEASURE 2.7")?.status, "partial");
  assert.equal(src("MEASURE 2.7"), FAQ);
  assert.equal(byId.get("GOVERN 1.1")?.status, "no_evidence");
  assert.equal(r.entry.confidence, "low");
});

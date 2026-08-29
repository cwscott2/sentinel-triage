import { generateText, generateObject, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import {
  RegisterEntry,
  Framework,
  ToolError,
  type Result,
} from "@/lib/schema";
import { SYSTEM_PROMPT, EXTRACTION_PROMPT } from "./prompts";
import controlSet from "@/lib/controls.json";
import { fetchPage } from "@/tools/fetchPage";
import { parseDocument } from "@/tools/parseDocument";
import { retrieveControls } from "@/tools/retrieveControls";
import { verifyCitation } from "@/tools/verifyCitation";

const MAX_STEPS = Number(process.env.MAX_STEPS ?? 12);

/**
 * A control_id the framework does not contain is the same failure class as an
 * invented citation: a plausible identifier with nothing behind it. The schema
 * types control_id as a string, so this Set — built from the actual control
 * file — is what makes it real.
 */
const VALID_CONTROL_IDS = new Set(
  (controlSet as { control_id: string }[]).map((c) => c.control_id)
);

const JUDGMENT_MODEL = openai("gpt-4o");
const EXTRACTION_MODEL = openai("gpt-4o-mini");

export interface TriageInput {
  vendor: string;
  urls: string[];
  framework: Framework;
}

/** Emitted as each agent step completes, so a caller can stream the decision path live. */
export type StepEvent = { step: number; tools: string[]; done: boolean };

export interface TriageResult {
  entry: RegisterEntry;
  steps: number;
  toolErrors: ToolError[];
  latencyMs: number;
  usage: { promptTokens: number; completionTokens: number };
  trace: { step: number; tools: string[]; note?: string }[];
}

/**
 * Tool results are returned to the model as data, never thrown. A ToolError
 * arrives in context carrying its recovery_hint, which is what lets the model
 * adapt instead of dying. This is the whole failure-handling strategy.
 */
function unwrap<T>(r: Result<T>) {
  return r.ok ? { ok: true, ...r.value } : { ok: false, error: r.code, hint: r.recovery_hint };
}

/** Hard ceiling on any tool result. A single oversized return must degrade the
 *  run, never kill it — context-window death is not a recoverable error. */
const MAX_TOOL_RESULT_CHARS = 12_000;
function bound<T extends object>(v: T): T | { ok: boolean; truncated: true; note: string } {
  const s = JSON.stringify(v);
  if (s.length <= MAX_TOOL_RESULT_CHARS) return v;
  return {
    ok: false,
    truncated: true,
    note: `Tool result exceeded ${MAX_TOOL_RESULT_CHARS} chars (${s.length}) and was withheld. Work from parse_document's claim list instead of raw content.`,
  };
}

export async function runTriage(
  input: TriageInput,
  onStep?: (e: StepEvent) => void
): Promise<TriageResult> {
  const started = Date.now();
  const toolErrors: ToolError[] = [];
  let stepCount = 0;
  /** The agent's actual decision path: which tools it chose, in what order.
   *  Nothing scripts this sequence — the model picks each step from tool results. */
  const trace: { step: number; tools: string[]; note?: string }[] = [];
  const sessionDocs = new Map<string, string>(); // session memory: url -> parsed text
  /**
   * Sources are recorded HERE, from actual successful fetches, and never taken
   * from model output. A model asked to list its sources will happily invent a
   * retrieved_at for a page that 404'd — observed on the first live run. In a
   * tool whose product is provenance, the source list must be a fact of the
   * execution, not a claim of the model.
   */
  const verifiedSources: { url: string; retrieved_at: string; doc_type: "trust_page" | "dpa" | "model_card" | "whitepaper" | "other" }[] = [];
  /** Quotes that actually passed verify_citation during this run. */
  const verifiedQuotes = new Set<string>();

  const record = <T>(r: Result<T>) => {
    if (!r.ok) toolErrors.push(r);
    return unwrap(r);
  };

  const tools = {
    fetch_page: tool({
      description:
        "Check that a vendor URL is reachable. Returns status only — call parse_document to read it.",
      parameters: z.object({ url: z.string().url() }),
      execute: async ({ url }) => bound(await (async () => {
        const r = await fetchPage(url);
        if (!r.ok) return record(r);
        // NEVER return r.value — FetchedPage.body is the raw document. Spreading
        // it here put 652k characters of HTML into context and blew the 128k
        // window on the first eval run. parse_document re-fetches internally,
        // so the body has no reason to reach the model at all.
        return {
          ok: true,
          url,
          contentType: r.value.contentType,
          bytes: typeof r.value.body === "string" ? r.value.body.length : r.value.body.byteLength,
          retrieved_at: r.value.retrieved_at,
          next: "Call parse_document on this URL to extract governance claims.",
        };
      })()),
    }),

    parse_document: tool({
      description:
        "Extract AI-governance claims from a fetched page. Returns a bounded claim list, not the raw document.",
      parameters: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        const fetched = await fetchPage(url);
        if (!fetched.ok) return record(fetched);
        const parsed = await parseDocument(fetched.value);
        if (!parsed.ok) return record(parsed);

        // Full text stays server-side for verify_citation. It never enters the
        // judgment model's context: returning it here put 182k tokens through
        // gpt-4o on the first live run — ~3x the cost target — because tool
        // results persist across every subsequent step.
        sessionDocs.set(url, parsed.value.text);
        verifiedSources.push({
          url,
          retrieved_at: fetched.value.retrieved_at,
          doc_type: inferDocType(url),
        });

        // This is the extraction step the model-routing table promised:
        // high token volume, low judgment, cheap model.
        const extracted = await generateText({
          model: EXTRACTION_MODEL,
          prompt: `${EXTRACTION_PROMPT}\n\n---\n${parsed.value.text.slice(0, 60_000)}`,
        });

        return {
          ok: true,
          url,
          chars: parsed.value.text.length,
          headings: parsed.value.anchors.slice(0, 25).map((a) => a.heading),
          claims: extracted.text.slice(0, 8_000),
        };
      },
    }),

    retrieve_controls: tool({
      description:
        "Find framework controls matching a vendor claim. Returns empty if nothing clears the similarity threshold.",
      parameters: z.object({ claim: z.string() }),
      execute: async ({ claim }) =>
        record(await retrieveControls(input.framework, claim)),
    }),

    verify_citation: tool({
      description:
        "REQUIRED before marking any control met or partial. Confirms the quote exists verbatim in a parsed source.",
      parameters: z.object({ quote: z.string(), url: z.string().url() }),
      execute: async ({ quote, url }) => {
        const source = sessionDocs.get(url);
        if (!source) {
          return {
            ok: false,
            error: "CITATION_NOT_FOUND",
            hint: `No parsed text for ${url}. Call parse_document on it first.`,
          };
        }
        const v = verifyCitation(quote, source);
        if (v.ok) verifiedQuotes.add(quote.toLowerCase().replace(/\s+/g, " ").trim());
        return record(v);
      },
    }),
  };

  // Phase 1 — evidence gathering. Step cap is the guardrail against runaway loops.
  const gather = await generateText({
    model: JUDGMENT_MODEL,
    system: SYSTEM_PROMPT,
    maxSteps: MAX_STEPS,
    tools,
    onStepFinish: ({ toolCalls }) => {
      stepCount++;
      const names = (toolCalls ?? []).map((t: any) => t.toolName);
      trace.push({
        step: stepCount,
        tools: names,
        note: names.length === 0 ? "returned an assessment instead of a tool call — loop ends" : undefined,
      });
      onStep?.({ step: stepCount, tools: names, done: names.length === 0 });
      if (process.env.TRACE) {
        process.stderr.write(`      · step ${stepCount}${names.length ? `: ${names.join(", ")}` : " (done)"}\n`);
      }
    },
    prompt: `Vendor: ${input.vendor}
Framework: ${input.framework}
Sources to review:
${input.urls.map((u) => `- ${u}`).join("\n")}

Gather and verify the evidence. Report what you verified and what you could not.`,
  });

  // Phase 2 — constrained emission. Schema enforces the met/partial citation rule,
  // so an unciteable assessment cannot survive validation.
  let entry: RegisterEntry;
  try {
    const emitted = await generateObject({
      model: JUDGMENT_MODEL,
      schema: RegisterEntry,
      prompt: `Produce the risk-register entry from this verified evidence.

${gather.text}

VERIFIED SOURCES (cite by index into this list; nothing else may be cited):
${verifiedSources.length
  ? verifiedSources.map((s, i) => `  [${i}] ${s.url} (${s.doc_type}, retrieved ${s.retrieved_at})`).join("\n")
  : "  (none — no source was successfully fetched and parsed)"}
Vendor: ${input.vendor} · Framework: ${input.framework}

LEGAL control_id VALUES (any other value is discarded):
${VALID_CONTROL_IDS.size ? [...VALID_CONTROL_IDS].map((id) => `  ${id}`).join("\n") : "  (none — the control set is empty, so controls must be an empty array)"}

Any control without a verified quote is no_evidence. If nothing was verified, set insufficient_evidence to true.`,
    });
    // Provenance is not negotiable: the executed source list wins over the
    // model's account of it, always.
    entry = { ...emitted.object, sources: verifiedSources };

    // Provenance and identity are both facts of the system, not model claims.
    const kept = entry.controls.filter((c) => VALID_CONTROL_IDS.has(c.control_id));
    const dropped = entry.controls.length - kept.length;
    if (dropped > 0) {
      console.warn(`[triage] dropped ${dropped} control(s) with IDs absent from the framework`);
    }

    // Deduplicate. The model emits the same control_id several times — observed
    // 4x MAP 2.2 and 3x MEASURE 2.10 in a single run. A risk register with the
    // same control four times is not a deliverable, and scoring it depends on
    // which duplicate happens to be first.
    //
    // When duplicates disagree, keep the MOST CONSERVATIVE status. Two answers
    // for one control means the agent is not confident; in a compliance
    // artifact the weaker claim is the safe reading.
    const RANK = { no_evidence: 0, not_met: 1, partial: 2, met: 3 } as const;
    const byId = new Map<string, (typeof kept)[number]>();
    for (const c of kept) {
      const prev = byId.get(c.control_id);
      if (!prev || RANK[c.status] < RANK[prev.status]) byId.set(c.control_id, c);
    }
    if (kept.length !== byId.size) {
      console.warn(`[triage] collapsed ${kept.length} rows to ${byId.size} unique controls`);
    }

    // A register is complete or it is not a register. Every framework control
    // gets a row; absent means no_evidence, stated explicitly rather than implied.
    // THE GOVERNING RULE, ENFORCED.
    //
    // The spec has always said: "no verifiable quote, and the status downgrades
    // to no_evidence." That rule lived in the system prompt and was never
    // checked. Measured result: 32 `met` emissions across the suite, every one
    // of them wrong, many with no verified citation behind them.
    //
    // A product whose central promise is provenance cannot leave that promise
    // to the model's compliance with an instruction.
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    let downgraded = 0;
    for (const c of byId.values()) {
      if (c.status !== "met" && c.status !== "partial") continue;
      const verified = c.citation && verifiedQuotes.has(norm(c.citation.quote));
      if (!verified) {
        c.status = "no_evidence";
        c.citation = null;
        c.rationale = `Downgraded: no verified quote supports this assessment. (${c.rationale})`.slice(0, 500);
        downgraded++;
      }
    }
    if (downgraded > 0) {
      console.warn(`[triage] downgraded ${downgraded} unverified claim(s) to no_evidence`);
    }

    entry.controls = [...VALID_CONTROL_IDS].map(
      (id) =>
        byId.get(id) ?? {
          control_id: id,
          status: "no_evidence" as const,
          citation: null,
          rationale: "Not addressed in the fetched sources.",
        }
    );
    entry.gaps = entry.gaps.filter((g) => VALID_CONTROL_IDS.has(g.control_id));

    if (verifiedSources.length === 0 || VALID_CONTROL_IDS.size === 0) {
      entry.insufficient_evidence = true;
      entry.controls = [];
      entry.gaps = [];
      entry.confidence = "low";
    }
  } catch {
    // One retry is handled inside generateObject; a second failure exits gracefully
    // rather than emitting a partial artifact.
    entry = gracefulExit(input);
  }

  return {
    entry,
    steps: gather.steps?.length ?? 0,
    toolErrors,
    latencyMs: Date.now() - started,
    trace,
    usage: {
      promptTokens: gather.usage?.promptTokens ?? 0,
      completionTokens: gather.usage?.completionTokens ?? 0,
    },
  };
}

/** The abstention path. A successful outcome, not an error. */
export function gracefulExit(input: TriageInput): RegisterEntry {
  return {
    vendor: input.vendor,
    framework: input.framework,
    sources: [],
    controls: [],
    gaps: [],
    confidence: "low",
    insufficient_evidence: true,
  };
}


function inferDocType(url: string): "trust_page" | "dpa" | "model_card" | "whitepaper" | "other" {
  const u = url.toLowerCase();
  if (u.includes("trust") || u.includes("security")) return "trust_page";
  if (u.includes("dpa") || u.includes("data-processing")) return "dpa";
  if (u.includes("model-card") || u.includes("model_card")) return "model_card";
  if (u.endsWith(".pdf")) return "whitepaper";
  return "other";
}

import { generateText, generateObject, tool } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import {
  RegisterEntry,
  Framework,
  ToolError,
  type Result,
} from "@/lib/schema";
import { SYSTEM_PROMPT } from "./prompts";
import { fetchPage } from "@/tools/fetchPage";
import { parseDocument } from "@/tools/parseDocument";
import { retrieveControls } from "@/tools/retrieveControls";
import { verifyCitation } from "@/tools/verifyCitation";

const MAX_STEPS = Number(process.env.MAX_STEPS ?? 12);

const JUDGMENT_MODEL = openai("gpt-4o");
const EXTRACTION_MODEL = openai("gpt-4o-mini");

export interface TriageInput {
  vendor: string;
  urls: string[];
  framework: Framework;
}

export interface TriageResult {
  entry: RegisterEntry;
  steps: number;
  toolErrors: ToolError[];
  latencyMs: number;
  usage: { promptTokens: number; completionTokens: number };
}

/**
 * Tool results are returned to the model as data, never thrown. A ToolError
 * arrives in context carrying its recovery_hint, which is what lets the model
 * adapt instead of dying. This is the whole failure-handling strategy.
 */
function unwrap<T>(r: Result<T>) {
  return r.ok ? { ok: true, ...r.value } : { ok: false, error: r.code, hint: r.recovery_hint };
}

export async function runTriage(input: TriageInput): Promise<TriageResult> {
  const started = Date.now();
  const toolErrors: ToolError[] = [];
  const sessionDocs = new Map<string, string>(); // session memory: url -> parsed text

  const record = <T>(r: Result<T>) => {
    if (!r.ok) toolErrors.push(r);
    return unwrap(r);
  };

  const tools = {
    fetch_page: tool({
      description: "Fetch a public vendor documentation page or PDF.",
      parameters: z.object({ url: z.string().url() }),
      execute: async ({ url }) => record(await fetchPage(url)),
    }),

    parse_document: tool({
      description: "Extract clean text from a fetched page. Call fetch_page first.",
      parameters: z.object({ url: z.string().url() }),
      execute: async ({ url }) => {
        const fetched = await fetchPage(url);
        if (!fetched.ok) return record(fetched);
        const parsed = await parseDocument(fetched.value);
        if (parsed.ok) sessionDocs.set(url, parsed.value.text);
        return record(parsed);
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
        return record(verifyCitation(quote, source));
      },
    }),
  };

  // Phase 1 — evidence gathering. Step cap is the guardrail against runaway loops.
  const gather = await generateText({
    model: JUDGMENT_MODEL,
    system: SYSTEM_PROMPT,
    maxSteps: MAX_STEPS,
    tools,
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

Sources reviewed: ${JSON.stringify(input.urls)}
Vendor: ${input.vendor} · Framework: ${input.framework}

Any control without a verified quote is no_evidence. If nothing was verified, set insufficient_evidence to true.`,
    });
    entry = emitted.object;
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

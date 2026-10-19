/**
 * Guard: no retired OpenAI model ID anywhere but src/lib/openaiModels.ts.
 *
 * Run with `npm test` (node:test via tsx; no extra dependency). Scans source,
 * evals and the README, including comments and prose, because a stale ID in a
 * comment or a table is how the wrong name comes back.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  OPENAI_MODEL_ID,
  OPENAI_PROVIDER_OPTIONS,
  RETIRED_OPENAI_MODEL_IDS,
} from "../src/lib/openaiModels";

const ROOT = join(import.meta.dirname, "..");
const ALLOWED = new Set(["src/lib/openaiModels.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "runs" || name === "worksheets") continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|mjs|json|md)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

const files = [...walk(join(ROOT, "src")), ...walk(join(ROOT, "evals")), join(ROOT, "README.md")];

test("the scan sees the files it guards", () => {
  const rel = files.map((f) => relative(ROOT, f).replace(/\\/g, "/"));
  assert.ok(rel.includes("src/agent/loop.ts"), "loop.ts not scanned");
  assert.ok(rel.includes("README.md"), "README not scanned");
  assert.ok(rel.includes("src/lib/openaiModels.ts"), "openaiModels.ts not scanned");
});

test("the live model is not on the retired list", () => {
  assert.ok(!RETIRED_OPENAI_MODEL_IDS.includes(OPENAI_MODEL_ID), `${OPENAI_MODEL_ID} is retired`);
  assert.match(OPENAI_MODEL_ID, /^gpt-6-/);
});

test("reasoning effort is sent explicitly", () => {
  assert.equal(OPENAI_PROVIDER_OPTIONS.openai.reasoningEffort, "none");
});

test("no retired model ID appears outside src/lib/openaiModels.ts", () => {
  const hits: string[] = [];
  for (const file of files) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (ALLOWED.has(rel)) continue;
    const text = readFileSync(file, "utf8");
    for (const id of RETIRED_OPENAI_MODEL_IDS) {
      // Whole-token match: `gpt-4o` must not match `gpt-4o-mini`, which is its own entry.
      const re = new RegExp(`(^|[^-\\w.])${id.replace(/[.]/g, "\\.")}(?![-\\w.])`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const line = text.slice(0, m.index).split("\n").length;
        hits.push(`${rel}:${line}: ${id}`);
      }
    }
  }
  assert.deepEqual(hits, [], `retired model IDs found:\n${hits.join("\n")}`);
});

"use client";
import { useState } from "react";
import { DEMO_VENDORS, type DemoVendor } from "@/lib/demo";
import { fixtureIdOf, fixtureViewPath } from "@/lib/fixtures";

const LIVE_PRESETS = DEMO_VENDORS.filter((v) => !v.fixtures);
const GUARDRAIL_PRESETS = DEMO_VENDORS.filter((v) => v.fixtures);

/** A fixture URL is not reachable in a browser; show where the same page can be opened. */
const sourceLabel = (url: string) => {
  const id = fixtureIdOf(url);
  return id ? `fixture ${id}` : url;
};

const C = {
  bg: "#fafaf9", ink: "#1c1917", dim: "#57534e", line: "#e7e5e4",
  panel: "#f5f5f4", accent: "#1c1917", warn: "#9a3412", ok: "#166534",
};

const STATUS_COLOR: Record<string, string> = {
  met: C.ok, partial: "#a16207", not_met: C.warn, no_evidence: C.dim,
};

export default function Home() {
  const [sel, setSel] = useState(DEMO_VENDORS[0]);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [raw, setRaw] = useState(false);
  const [liveSteps, setLiveSteps] = useState<{ step: number; tools: string[]; done: boolean }[]>([]);

  async function run() {
    setLoading(true); setResult(null); setLiveSteps([]);
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor: sel.vendor, urls: sel.urls, framework: "NIST_AI_RMF" }),
      });

      // Non-streaming responses are the guard rejections (429 / 403 / 400).
      if (!res.headers.get("content-type")?.includes("ndjson")) {
        setResult(await res.json());
        return;
      }

      // NDJSON: one step event per agent decision, then the final result.
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const evt = JSON.parse(line);
          if (evt.type === "step") {
            setLiveSteps((prev) => [...prev, { step: evt.step, tools: evt.tools, done: evt.done }]);
          } else if (evt.type === "result") {
            setResult(evt);
          } else if (evt.type === "error") {
            setResult({ error: evt.detail ?? evt.error });
          }
        }
      }
    } catch (e) {
      setResult({ error: String(e) });
    } finally { setLoading(false); }
  }

  const presetButton = (v: DemoVendor) => (
    <button key={v.id} onClick={() => { setSel(v); setResult(null); setLiveSteps([]); }}
      style={{
        textAlign: "left", padding: "0.6rem 0.8rem", borderRadius: 6, fontSize: 13,
        cursor: "pointer", background: sel.id === v.id ? C.ink : "white",
        color: sel.id === v.id ? "white" : C.ink,
        border: `1px solid ${sel.id === v.id ? C.ink : C.line}`,
      }}>
      <div style={{ fontWeight: 500 }}>{v.label}</div>
      <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{v.expect}</div>
    </button>
  );

  const entry = result?.entry;
  const removed: { rule: string; excerpt: string; url: string }[] = result?.injection ?? [];
  const errs: string[] = (result?.toolErrors ?? []).map((e: any) => e.code);
  const errCounts = errs.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "2.5rem 1.5rem 5rem", color: C.ink }}>
      <h1 style={{ fontSize: 26, marginBottom: 2 }}>Sentinel Triage</h1>
      <p style={{ color: C.dim, marginTop: 0, fontSize: 14, lineHeight: 1.5 }}>
        Reads a vendor&apos;s public documentation and produces a NIST AI RMF risk-register
        entry. Every <strong>met</strong> or <strong>partial</strong> carries a quote verified
        verbatim against the fetched source — or the status is downgraded. Abstention is a
        successful outcome.
      </p>

      <div style={{ fontSize: 12, fontWeight: 600, color: C.dim, margin: "1.5rem 0 6px",
                    textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Live vendor pages
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {LIVE_PRESETS.map(presetButton)}
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: C.dim, margin: "1.4rem 0 2px",
                    textTransform: "uppercase", letterSpacing: "0.04em" }}>
        Guardrail fixtures
      </div>
      <p style={{ fontSize: 12, color: C.dim, margin: "0 0 6px", lineHeight: 1.5 }}>
        Pages for a fictional vendor, hosted in this app, with text planted for an AI
        reviewer. They show the input guardrail removing that text before any model
        reads it. The same pages are scored in the eval suite.
      </p>
      <div style={{ display: "grid", gap: 6, marginBottom: "1.5rem" }}>
        {GUARDRAIL_PRESETS.map(presetButton)}
      </div>

      {sel.fixtures && (
        <p style={{ fontSize: 12, color: C.dim, margin: "-0.6rem 0 1.2rem" }}>
          Open the page{sel.fixtures.length > 1 ? "s" : ""} the agent will read:{" "}
          {sel.fixtures.map((id, i) => (
            <span key={id}>
              {i > 0 && " · "}
              <a href={fixtureViewPath(id)} target="_blank" rel="noreferrer" style={{ color: C.ink }}>
                {id}
              </a>
            </span>
          ))}
          . Use View Source to see text that is hidden from a reader.
        </p>
      )}

      <button onClick={run} disabled={loading}
        style={{ padding: "0.65rem 1.3rem", borderRadius: 6, border: "none", fontSize: 14,
                 background: loading ? "#a8a29e" : C.accent, color: "white",
                 cursor: loading ? "default" : "pointer" }}>
        {loading ? "Triaging… (20–60s)" : "Run triage"}
      </button>
      <span style={{ fontSize: 12, color: C.dim, marginLeft: 12 }}>
Presets only — the demo runs on a live API key. 5 runs/hour.
      </span>

      {(loading || liveSteps.length > 0) && !result?.entry && (
        <section style={{ marginTop: "1.6rem", padding: "1rem 1.1rem", background: C.panel,
                          borderRadius: 6, border: `1px solid ${C.line}` }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Agent decision path {loading && <span style={{ fontWeight: 400, color: C.dim }}>— running</span>}
          </div>
          <div style={{ fontSize: 12, color: C.dim, margin: "2px 0 10px" }}>
            Nothing scripts this sequence. The model picks each tool from the previous
            result. The loop ends when it returns an assessment instead of a tool call,
            or when it hits the 12-step cap.
          </div>
          {liveSteps.length === 0 && (
            <div style={{ fontSize: 13, color: C.dim }}>waiting for the first decision…</div>
          )}
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
            {liveSteps.map((t) => (
              <li key={t.step}>
                {t.tools.length
                  ? <code style={{ background: "white", padding: "1px 6px", borderRadius: 3,
                                   border: `1px solid ${C.line}` }}>{t.tools.join(" + ")}</code>
                  : <span style={{ color: C.ok, fontWeight: 500 }}>
                      returned an assessment instead of a tool call — loop ends
                    </span>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {result?.error && (
        <div style={{ marginTop: "1.5rem", padding: "0.9rem", background: "#fef2f2",
                      border: "1px solid #fecaca", borderRadius: 6, fontSize: 13 }}>
          {typeof result.error === "string" ? result.error : JSON.stringify(result.error)}
        </div>
      )}

      {entry && (
        <section style={{ marginTop: "2rem" }}>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontSize: 13,
                        padding: "0.8rem 1rem", background: C.panel, borderRadius: 6 }}>
            <span><strong>{entry.vendor}</strong></span>
            <span>sources verified: <strong>{entry.sources.length}</strong></span>
            <span>steps: <strong>{result.steps}</strong></span>
            <span>{(result.latencyMs / 1000).toFixed(1)}s</span>
            <span style={{ color: entry.insufficient_evidence ? C.warn : C.ok }}>
              {entry.insufficient_evidence ? "ABSTAINED — insufficient evidence" : "register produced"}
            </span>
          </div>

          {entry.sources.length === 0 && (
            <p style={{ fontSize: 13, color: C.warn, marginTop: 10 }}>
              No source was fetched and parsed. The sources array is empty rather than
              populated with an invented retrieval timestamp — provenance is derived from
              execution, not from the model.
            </p>
          )}

          {result.trace?.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                Agent decision path — {result.trace.length} step{result.trace.length === 1 ? "" : "s"}
              </div>
              <div style={{ fontSize: 12, color: C.dim, marginBottom: 8 }}>
                Nothing scripts this sequence. The model chooses each tool from the
                previous result. The loop ends when it returns an assessment instead of
                a tool call, or when it hits the 12-step cap.
              </div>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>
                {result.trace.map((t: any) => (
                  <li key={t.step}>
                    {t.tools.length
                      ? <code style={{ background: C.panel, padding: "1px 5px", borderRadius: 3 }}>
                          {t.tools.join(" + ")}
                        </code>
                      : <span style={{ color: C.ok }}>returned an assessment instead of a tool call — loop ends</span>}
                    {t.note && t.tools.length > 0 && (
                      <span style={{ color: C.dim }}> — {t.note}</span>
                    )}
                  </li>
                ))}
              </ol>
              {result.stepCapReached && (
                <div style={{ fontSize: 12, color: C.warn, marginTop: 6 }}>
                  Step cap reached — the loop was stopped by the guardrail, not by the
                  agent concluding. The agent then reported on what it had verified
                  by that point; claims it had not examined are missing from the register.
                </div>
              )}
            </div>
          )}

          {Object.keys(errCounts).length > 0 && (
            <div style={{ marginTop: 14, fontSize: 13 }}>
              <strong>Guardrails fired:</strong>{" "}
              {Object.entries(errCounts).map(([k, n]) => `${k} ×${n}`).join(" · ")}
              <div style={{ color: C.dim, fontSize: 12, marginTop: 4 }}>
                Each CITATION_NOT_FOUND is a hallucinated citation that did not ship.
                Each NO_MATCH_ABOVE_THRESHOLD is a forced mapping that did not happen.
              </div>
            </div>
          )}

          {/* What the input guardrail removed. Shown on every run, so a clean
              run says so instead of saying nothing. */}
          <div style={{ marginTop: 16, padding: "0.8rem 1rem", borderRadius: 6, fontSize: 13,
                        background: removed.length ? "#fff7ed" : C.panel,
                        border: `1px solid ${removed.length ? "#fdba74" : C.line}` }}>
            <strong style={{ color: removed.length ? C.warn : C.ink }}>
              Input guardrail:{" "}
              {removed.length
                ? `${removed.length} passage${removed.length === 1 ? "" : "s"} removed before any model read the source`
                : "nothing removed"}
            </strong>
            <div style={{ color: C.dim, fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
              {removed.length
                ? "These passages address an AI reviewer instead of describing the vendor. They were cut from the text, so they reached no model and cannot be cited. Confidence is capped at low and a person should read the source."
                : "No passage in the fetched sources addressed an AI reviewer or used invisible characters."}
            </div>
            {removed.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", borderBottom: `1px solid #fdba74` }}>
                    <th style={{ padding: "4px 8px 4px 0" }}>Source</th>
                    <th style={{ padding: "4px 8px" }}>Rule</th>
                    <th style={{ padding: "4px 0 4px 8px" }}>Removed</th>
                  </tr>
                </thead>
                <tbody>
                  {removed.map((f, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid #fed7aa`, verticalAlign: "top" }}>
                      <td style={{ padding: "4px 8px 4px 0", whiteSpace: "nowrap" }}>{sourceLabel(f.url)}</td>
                      <td style={{ padding: "4px 8px" }}><code>{f.rule}</code></td>
                      <td style={{ padding: "4px 0 4px 8px", wordBreak: "break-word" }}>{f.excerpt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {entry.controls.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 18, fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: `2px solid ${C.line}` }}>
                  <th style={{ padding: "6px 8px" }}>Control</th>
                  <th style={{ padding: "6px 8px" }}>Status</th>
                  <th style={{ padding: "6px 8px" }}>Verified quote</th>
                </tr>
              </thead>
              <tbody>
                {entry.controls.map((c: any) => (
                  <tr key={c.control_id} style={{ borderBottom: `1px solid ${C.line}` }}>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{c.control_id}</td>
                    <td style={{ padding: "6px 8px", color: STATUS_COLOR[c.status], fontWeight: 500 }}>
                      {c.status}
                    </td>
                    <td style={{ padding: "6px 8px", color: c.citation ? C.ink : C.dim }}>
                      {c.citation ? `"${c.citation.quote}"` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <button onClick={() => setRaw(!raw)}
            style={{ marginTop: 16, background: "none", border: "none", color: C.dim,
                     fontSize: 12, cursor: "pointer", padding: 0, textDecoration: "underline" }}>
            {raw ? "hide" : "show"} raw JSON
          </button>
          {raw && (
            <pre style={{ marginTop: 10, padding: "1rem", background: C.panel, borderRadius: 6,
                          fontSize: 11, overflowX: "auto" }}>
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </section>
      )}

      <footer style={{ marginTop: "3.5rem", paddingTop: "1rem", borderTop: `1px solid ${C.line}`,
                       fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
        15-case eval suite, four measured runs, one improvement and two documented
        regressions:{" "}
        <a href="https://github.com/cwscott2/sentinel-triage/blob/main/docs/EVAL-HISTORY.md"
           style={{ color: C.ink }}>EVAL-HISTORY.md</a>
        {" · "}
        <a href="https://github.com/cwscott2/sentinel-triage" style={{ color: C.ink }}>repo</a>
        <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
          build {process.env.NEXT_PUBLIC_BUILD ?? "dev"}
        </div>
      </footer>
    </main>
  );
}

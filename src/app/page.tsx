"use client";
import { useState } from "react";
import { DEMO_VENDORS } from "@/lib/demo";

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

  const entry = result?.entry;
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

      <div style={{ display: "grid", gap: 6, margin: "1.5rem 0" }}>
        {DEMO_VENDORS.map((v) => (
          <button key={v.id} onClick={() => { setSel(v); setResult(null); }}
            style={{
              textAlign: "left", padding: "0.6rem 0.8rem", borderRadius: 6, fontSize: 13,
              cursor: "pointer", background: sel.id === v.id ? C.ink : "white",
              color: sel.id === v.id ? "white" : C.ink,
              border: `1px solid ${sel.id === v.id ? C.ink : C.line}`,
            }}>
            <div style={{ fontWeight: 500 }}>{v.label}</div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{v.expect}</div>
          </button>
        ))}
      </div>

      <button onClick={run} disabled={loading}
        style={{ padding: "0.65rem 1.3rem", borderRadius: 6, border: "none", fontSize: 14,
                 background: loading ? "#a8a29e" : C.accent, color: "white",
                 cursor: loading ? "default" : "pointer" }}>
        {loading ? "Triaging… (20–60s)" : "Run triage"}
      </button>
      <span style={{ fontSize: 12, color: C.dim, marginLeft: 12 }}>
        Preset vendors only — the demo runs on a live API key. 5 runs/hour.
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
              {result.steps >= 12 && (
                <div style={{ fontSize: 12, color: C.warn, marginTop: 6 }}>
                  Step cap reached — the loop was stopped by the guardrail, not by the
                  agent concluding. Results reflect whatever was verified before the cap.
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
      </footer>
    </main>
  );
}

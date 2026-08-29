"use client";
import { useState } from "react";

const DEMO = {
  vendor: "Anthropic",
  urls: "https://www.anthropic.com/trust-center",
};

export default function Home() {
  const [vendor, setVendor] = useState(DEMO.vendor);
  const [urls, setUrls] = useState(DEMO.urls);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor,
          urls: urls.split(/[\s,]+/).filter(Boolean),
          framework: "NIST_AI_RMF",
        }),
      });
      setResult(await res.json());
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setLoading(false);
    }
  }

  const box: React.CSSProperties = {
    width: "100%", padding: "0.6rem", marginBottom: "0.75rem",
    border: "1px solid #d6d3d1", borderRadius: 6, fontSize: 14,
  };

  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "3rem 1.5rem" }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Sentinel Triage</h1>
      <p style={{ color: "#57534e", marginTop: 0, fontSize: 14 }}>
        Vendor AI governance triage against NIST AI RMF. Every &quot;met&quot; carries a
        verified quote, or it is not claimed.
      </p>

      <input style={box} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor name" />
      <textarea style={{ ...box, minHeight: 70 }} value={urls} onChange={(e) => setUrls(e.target.value)} placeholder="Documentation URLs, one per line" />

      <button
        onClick={run}
        disabled={loading}
        style={{ padding: "0.6rem 1.2rem", borderRadius: 6, border: "none",
                 background: loading ? "#a8a29e" : "#1c1917", color: "white",
                 fontSize: 14, cursor: loading ? "default" : "pointer" }}
      >
        {loading ? "Triaging…" : "Run triage"}
      </button>

      {result && (
        <pre style={{ marginTop: "2rem", padding: "1rem", background: "#f5f5f4",
                      borderRadius: 6, fontSize: 12, overflowX: "auto" }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}

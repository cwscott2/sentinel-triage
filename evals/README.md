# Eval Suite

**Build this before writing agent code.** The labeled set is the spec. Twenty cases: 15 happy-path vendors, 5 adversarial.

## Case format

One JSON file per case in `cases/`:

```json
{
  "id": "v01-openai",
  "kind": "happy | adversarial",
  "vendor": "OpenAI",
  "urls": ["https://openai.com/security"],
  "framework": "NIST_AI_RMF",
  "expect": {
    "insufficient_evidence": false,
    "controls": [
      { "control_id": "GOVERN-1.1", "status": "met" },
      { "control_id": "MAP-2.3",    "status": "partial" }
    ],
    "notes": "Publishes a trust page with named AI governance owner."
  }
}
```

## Scoring

| Metric | Computed as | Target |
|---|---|---|
| **Control mapping accuracy** | matching statuses / total labeled statuses | ≥ 80% |
| **Hallucinated citation rate** | citations failing `verifyCitation` / total citations emitted | **0% — hard gate** |
| **Cost + latency** | mean USD and wall-clock seconds per completed run | ≤ $0.15, ≤ 90s |
| Correct abstention *(tracked, not gating)* | adversarial cases returning `insufficient_evidence: true` | 5 / 5 |

## Labeling protocol

Label the expected status yourself, from the source document, **before running the agent even once**. Labeling after you have seen output is not ground truth — it is anchoring, and it silently inflates every number downstream.

If a control is genuinely ambiguous from the document, label it `no_evidence`. Ambiguity that a human expert cannot resolve is not a case the agent should be scored on resolving.

## Candidate vendors

**Happy path (well-documented, pick 15):** OpenAI · Anthropic · Notion · Slack · Zoom · HubSpot · Asana · Canva · Grammarly · Vercel · GitHub · Intercom · Zapier · Figma · Airtable

**Adversarial (all 5 required):**

| # | Case | Expected behavior |
|---|---|---|
| A1 | Small SaaS vendor with no AI disclosure anywhere public | `insufficient_evidence: true` |
| A2 | Dead trust-page URL (404) | Partial coverage noted, no fabrication |
| A3 | Scanned/image-only PDF policy | `UNPARSEABLE`, controls → `no_evidence` |
| A4 | Vendor doc that contradicts itself across two pages | Flag conflict, do not silently pick one |
| A5 | Documentation in an unsupported language | `UNSUPPORTED_LANGUAGE`, abstain |

## Running

```bash
npm run eval
```

Writes a timestamped markdown report to `evals/runs/`. That report is the Checkpoint 3 "Eval Results Link".

**Record the baseline before fixing anything.** Checkpoint 3 asks for the worst case, the fix, and the re-run — you cannot show a delta you did not measure first.

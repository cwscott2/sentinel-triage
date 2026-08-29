# Sentinel Triage

**Vendor AI Governance Triage Agent** — ingests a vendor's public documentation and emits a citation-backed AI risk-register entry mapped to NIST AI RMF, or abstains when the evidence isn't there.

Capstone build. Axis Sentinel · Carl Scott.

---

## The one job

> Given one vendor's public documentation, produce a completed, citation-backed AI risk-register entry mapped to one chosen framework — or state that the evidence is insufficient.

One vendor. One framework. One artifact. **Abstention is a successful outcome.**

## The governing rule

Every `met` or `partial` control status requires a verbatim quote traceable to a fetched source. `verify_citation` checks this in **deterministic code, not model judgment**. No verifiable quote → the status downgrades to `no_evidence`.

A wrong control mapping is a draft a human corrects. An invented quote in a compliance artifact is malpractice. That asymmetry is why hallucinated-citation rate is a hard gate at 0% while mapping accuracy targets 80%.

---

## Architecture

```mermaid
flowchart TB
    IN["<b>Input</b><br/>vendor · doc URLs · framework"] --> ORCH

    subgraph LOOP["Agent loop — step cap 12"]
      direction TB
      ORCH["Orchestrator"] --> PLAN["<b>Plan next action</b><br/>gpt-4o · judgment only"]
      PLAN --> DEC{"Tool call<br/>needed?"}
      DEC -->|yes| DISPATCH["Tool dispatch<br/>+ Zod validate return"]
      DISPATCH --> ERRQ{"Typed<br/>ToolError?"}
      ERRQ -->|no| PLAN
      ERRQ -->|yes| RETRY{"Retry budget<br/>remaining?"}
      RETRY -->|"yes — inject error text"| PLAN
      RETRY -->|no| EXIT
      DEC -->|no| EMIT["emit_register_entry"]
    end

    subgraph TOOLS["Tools"]
      direction TB
      T1["<b>fetch_page</b><br/>404 · timeout · JS-only"]
      T2["<b>parse_document</b><br/>gpt-4o-mini extraction<br/>image-PDF → unparseable"]
      T3["<b>retrieve_controls</b><br/>in-memory cosine over 12<br/>below threshold → empty"]
      T4["<b>verify_citation</b><br/>deterministic · no model"]
    end

    subgraph MEM["Memory"]
      direction TB
      M1["<b>Session</b><br/>sources · parsed text · hits"]
      M2["<b>Durable</b><br/>prior determinations per vendor<br/>re-run yields a diff"]
      M3["<b>Config</b><br/>framework · risk appetite"]
    end

    DISPATCH <--> TOOLS
    LOOP <--> MEM

    EMIT --> OUT["<b>Risk register entry</b><br/>schema-validated JSON"]
    EXIT["Graceful exit<br/>insufficient_evidence: true"] --> OUT
```

### Model routing

| Step | Model | Why |
|---|---|---|
| Plan / control-status judgment | `gpt-4o` | The only step requiring real reasoning over ambiguous control language |
| Document extraction, chunk classification | `gpt-4o-mini` | High token volume, low judgment. ~90% of tokens, ~10% of cost |
| Citation verification | **none** | Deterministic string matching. A model here would defeat the purpose |

### Tool stack

| Tool | Justification (one line) |
|---|---|
| `fetch_page` | Vendor evidence lives on public trust pages; nothing works without retrieval |
| `parse_document` | Trust pages and DPAs arrive as HTML and PDF; the agent needs clean text with source anchors |
| `retrieve_controls` | Maps free-text vendor claims to framework control IDs — the core translation the user can't do quickly |
| `verify_citation` | Turns the 0% hallucination target from a hope into a mechanism |
| `emit_register_entry` | Schema validation is the contract; an unvalidated artifact is worse than none |

**No vector database.** NIST AI RMF v1 scope is ~12 controls — embedded once at build time into a static JSON file, cosine similarity in memory. Infrastructure the project doesn't need is failure surface the project doesn't need.

### Memory & state

| Tier | Contents | Lifetime |
|---|---|---|
| **Session** | Fetched sources, parsed text, retrieval hits for the current run | One invocation |
| **Durable** | Prior determinations keyed by vendor, so a re-run produces a diff ("vendor published a DPA since last review") | Across runs |
| **Config** | Chosen framework, risk appetite, similarity threshold | Per org |

### Failure handling

Every tool returns `Result<T, ToolError>` — never throws. Typed errors, one retry with the error injected into context, then a graceful exit that emits `insufficient_evidence: true` rather than a partial artifact.

| Failure | Handling |
|---|---|
| 404 / timeout / JS-only page | Typed error; agent proceeds with remaining sources and reports partial coverage |
| Image-only PDF | `unparseable` — does not guess at contents |
| Retrieval below similarity threshold | Empty result, which forces `no_evidence` |
| Citation quote not found in source | Assessment rejected, one retry, then status downgraded |
| Schema validation failure | Error injected into context, one retry, then hard fail with typed error |
| Step cap exceeded (12) | Graceful exit with whatever is verified so far |

---

## Status

| Checkpoint | State |
|---|---|
| 1 — Agent Spec | Submitted |
| 2 — Architecture & Tooling | In progress |
| 3 — Evals & Reliability | Not started |
| 4 — Ship & Demo | Not started |

## Local development

```bash
npm install
cp .env.example .env.local   # add your key — .env.local is gitignored
npm run dev
```

The API key is read server-side in the API route only. It must never appear in a client bundle.

## Evals

```bash
npm run eval          # runs evals/cases/*.json, writes evals/runs/<timestamp>.md
```

See [`evals/README.md`](evals/README.md) for the case format and labeling protocol.

## Non-goals (v1)

No legal advice or regulatory applicability rulings · no private or gated documents · no batch runs · no multi-framework comparison in one run · no vendor scoring or ranking · no remediation drafting · no continuous monitoring.

# Eval history — Checkpoint 3

Every run is the full 15-case suite. Nothing here is a partial or cherry-picked run.

| # | Change | Headline acc. | Non-trivial acc. | Lift vs null | Halluc. citations | Abstention |
|---|---|---|---|---|---|---|
| 0 | Baseline | 73.5% | 11.5% (3/26) | −6.8 | 0% | 3/4 |
| 1 | Dedup + complete register | 72.7% | **19.2% (5/26)** | −7.6 | 0% | 3/4 |
| 2 | Status rubric in emission prompt | 68.2% | 11.5% (3/26) | −12.1 | 0% | 3/4 |
| 3 | Citation gate enforced in code | 71.2% | 7.7% (2/26) | −9.1 | 0% | 3/4 |

Null baseline (emit `no_evidence` for everything): **80.3%**. The label set is 80%
`no_evidence`, so raw accuracy alone is gameable — see the report's own explanation.

## Fix 1 — deduplicate and complete the register (KEPT, improved)

Diagnosis: the emitted control array contained duplicates — 4x `MAP 2.2` and 3x
`MEASURE 2.10` in one case, 26 rows collapsing to 7 in another. Scoring used
`find()`, so which duplicate won was arbitrary, and a register listing the same
control four times is not a deliverable at any accuracy.

Fix: deduplicate by `control_id`, keeping the **most conservative** status when
duplicates disagree (two answers means low confidence; in a compliance artifact
the weaker claim is the safe reading). Then emit a row for every framework
control, so absence is stated rather than implied.

Result: non-trivial accuracy 11.5% → 19.2%. Headline −0.8.

## Fix 2 — status rubric in the emission prompt (REVERTED, regressed)

Diagnosis: the agent emitted `met` for every control it assessed — zero `partial`,
zero `not_met` — because nothing defined the difference. Hypothesis: define them.

Fix: a rubric distinguishing documented process (`met`) from stated posture
(`partial`), with an explicit tiebreak toward `partial`.

Result: non-trivial 19.2% → 11.5%, headline −4.5. **Reverted.**

Why it failed: the rubric was applied in the emission stage, which does not read
the document — it reads the agent's own phase-1 narrative summary. The judgment
had already been made one stage earlier. Only 5 `partial` statuses were produced
across the entire suite.

## Fix 3 — enforce the citation gate in code (KEPT, regressed on metric)

Diagnosis: the spec has always stated "no verifiable quote → status downgrades to
`no_evidence`." That rule lived in the system prompt and was never checked. The
suite emitted 32 `met` statuses; the label set contains zero `met`. Every one was
wrong, and many had no verified quote behind them.

Fix: `verify_citation` now records which quotes actually passed. After emission,
any `met` or `partial` without a matching verified quote is downgraded to
`no_evidence` in code.

Result: non-trivial 19.2% → 7.7%. **Kept despite the regression.**

Rationale: reverting recovers the number by permitting unverified claims — the
exact failure the product exists to prevent. The guardrail did not cause the low
score; it exposed one that unverified `met` claims had been masking whenever they
happened to land on a `partial` label. Trading provenance for an eval number is
metric-gaming.

## Root cause, diagnosed after three attempts

Fixes 2 and 3 both targeted **emission**. The bottleneck is **retrieval**.

`NO_MATCH_ABOVE_THRESHOLD` dominates every case — 20 occurrences on
`v02-github-copilot` alone. In the fix-2 confusion matrix, 8 of the 26 `partial`
labels came back `no_evidence`: the agent never surfaced the evidence to judge.

The 0.35 similarity threshold was calibrated against 8 hand-written synthetic
claims (7/8 recall, 4/4 correct rejection). Real claims extracted from live pages
are longer and noisier and score below it. The calibration set was not
representative of production input.

**Next fix (not attempted — would be rushed):** recalibrate the retrieval
threshold against claims extracted from the actual corpus rather than synthetic
ones, and measure recall against the labeled partials directly before touching
the agent.

## The pattern across all findings

Five defects, one architectural mistake made five ways — a guarantee stated in the
prompt and trusted rather than checked:

| Defect | Model asserted | Fix |
|---|---|---|
| Fabricated provenance | `retrieved_at` for a URL that 404'd | Sources derived from execution |
| Invented control IDs | Vendor page headings as NIST controls | IDs validated against the control set |
| Duplicate rows | Same control up to 4x | Dedup, conservative status |
| Unverified claims | `met` with no verified quote | Citation gate enforced in code |
| Unbounded tool output | 652k chars of raw HTML into context | Hard ceiling on every tool return |

Each fix moved a guarantee from instruction to mechanism.

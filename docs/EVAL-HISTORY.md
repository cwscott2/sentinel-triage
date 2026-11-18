# Eval history

Runs 0 to 3 are from August 2026. Runs 4 and 5, the retrieval calibration and a
correction to the root-cause diagnosis are in "Round 2 runs, 2026-11-18" at the
end.

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


---

## Correction, 2026-11-18: what "0% hallucinated citations" was measuring

The four runs above report 0% hallucinated citations. The harness that produced
them did not re-verify quotes. `evals/run.ts` counted a citation as bad only
when its `source_index` pointed at no source; it imported `verifyCitation` and
never called it.

What that means for each run:

- **Run 3** (citation gate in code): every surviving `met` or `partial` carried
  a quote that had passed `verify_citation` inside the run. The 0% holds by
  construction, though a quote could still be attributed to the wrong source.
- **Runs 0 to 2** (before the gate): the figure shows only that every cited
  source index existed. Fix 3's own diagnosis says many `met` statuses in those
  runs had no verified quote behind them. Their 0% is not evidence that the
  quotes were real.

The table is left as it was reported. From this date the harness captures the
exact text `verify_citation` checked against and re-verifies every emitted quote
itself. It reports two numbers: quotes found in no fetched source (the hard
gate) and quotes found in a source other than the one cited (tracked). The loop
now also corrects `source_index` in code.

This is the same defect as the five in the table above, in the harness instead
of the agent: a guarantee that was stated and not checked.

## Round 2 changes, 2026-11-18

Code changes measured from run 4 on (see "Round 2 runs" below).

| Change | What it does | How it is measured |
|---|---|---|
| Independent citation re-verification | Harness re-checks every emitted quote against captured source text | "Hallucinated citation rate" and "Misattributed citations" in the run report |
| Source attribution in code | `source_index` set from the source the quote verified against | "Misattributed citations" |
| Injection guardrail | Passages addressed to an AI removed from fetched text and reported | "Injection resistance" (4 fixture cases) and "Flags raised on real vendor pages" |
| Retrieval calibration on the real corpus | `npm run calibrate:corpus` sweeps threshold and top-K on extracted claims | Calibration report; then a full eval at the chosen setting |
| Configurable retrieval | `RETRIEVAL_THRESHOLD`, `RETRIEVAL_TOP_K`; defaults unchanged | — |
| Token and cost reporting | Tokens across all model calls; cost when prices are supplied | "Mean tokens per run", "Mean cost per run" |
| Tracing | One Langfuse trace per run when keys are set | Inspect a trace |

Mapping accuracy and non-trivial accuracy are computed exactly as before, on the
same 15 cases and 26 non-trivial labels. Injection cases are scored separately
and do not enter those denominators.

## Round 2 runs, 2026-11-18

Full suite each time: the same 15 vendor cases and 26 non-trivial labels, plus
4 injection fixture cases scored separately. Retrieval at the defaults
(threshold 0.35, top-3). Reports are in `evals/runs/` (not committed).

| # | Code | Headline acc. | Non-trivial acc. | Lift vs null | Unverifiable citations | Misattributed | Abstention | Injection |
|---|---|---|---|---|---|---|---|---|
| 4 | Round 2 as first pushed (`6132405`) | 81.1% | **30.8% (8/26)** | +0.8 | 0/22 | 0/22 | 4/4 | 4/4 |
| 5 | + step-cap fix, first version (`428ee77`) | 78.8% | 30.8% (8/26) | −1.5 | 0/44 | 0/44 | **2/4** | **3/4** |

From run 4 on, "unverifiable citations" is measured by the harness re-checking
every emitted quote, not taken from the agent.

### Run 4: best result so far, cause not isolated

Non-trivial accuracy went from 7.7% (run 3) to 30.8%. Several things changed
between those runs and no run separates them: the model (the GPT-4o pair was
replaced by `gpt-6-luna` on 2026-10-19), the injection guardrail, rule 6 in the
system prompt, and source attribution in code. The gain cannot be credited to
any one of them.

It is still below the 50% target set in the FDE scoping document and the 60%
target in the harness. Confusion on the 26 non-trivial labels: 8 correct, 18
returned `no_evidence`. Seven `no_evidence` labels came back `partial`.

No passage was removed from any real vendor page.

### Step-cap defect, and a fix that made things worse (run 5)

Diagnosis from run 4: three cases ran to the 12-step cap. At the cap the last
step is a tool call, the model writes no report, and emission received an empty
string. Every control came back `no_evidence`. Two of those cases
(`v01`, `v05`) hold 7 non-trivial labels.

First fix (`428ee77`): keep verified quotes and retrieved controls in code and
hand that list to emission when the cap is hit.

Result: **worse, and replaced.** All three regressions in run 5 are cases that
hit the cap and took the new path:

| Case | Run 4 | Run 5 | What happened |
|---|---|---|---|
| `a06-js-only-shell` | abstained | 3 `partial`, 2 `met` | Emission mapped every verified quote to a control |
| `a07-vendor-headings-not-controls` | abstained | 3 `partial`, 1 `met` | General security sentences mapped to AI controls |
| `i04-benign-control` | 0 over ceiling | 7 `met` | Same; the page was correctly not flagged, the statuses were inflated |

Why: a verified quote is real, not thereby relevant. In an uncapped run the
judgment model's report carries its view of what each quote does and does not
establish, and emission follows it; across run 4 the suite produced zero `met`.
Given a bare list, emission rounded up. Every one of those quotes was genuine
(0/44 unverifiable), which is the point: the citation gate held and the
register was still wrong.

The prediction attached to the first fix was also wrong. It said up to 7 labels
could be recovered. In run 5 `v01` and `v05` did not hit the cap at all and
scored 2/4 and 0/3. Which cases hit the cap changes from run to run: 3 cases in
run 4, a different 6 in run 5. Traces (saved from run 5 on) show why: the model
sometimes sends its `verify_citation` calls in one step and sometimes one per
step, and the second pattern exhausts the budget.

Two things about run 4 that only the traces exposed:

- `a06` and `a07` "abstained correctly" in run 4. `a06` did so because it hit
  the cap and lost its evidence, which is the defect, not the design.
- `a06`'s premise is stale. The page it points at now returns readable text, so
  it is no longer a JavaScript-only shell. The case needs a new target or a new
  label, written by a person.

Second fix (current): at the cap, the model is asked once more for its report
with tools switched off, so emission receives the same kind of input as in an
uncapped run. The task message also now states the step budget and says that
independent tool calls can share a step. **Not yet measured.**

### Retrieval calibration: the earlier root-cause diagnosis does not hold

`npm run calibrate:corpus`, 264 claims extracted from the live pages of the 10
labeled cases that yield text.

| Setting | Recall ceiling | Noise |
|---|---|---|
| 0.30, top-3 | 26/26 | 68/94 (72%) |
| **0.35, top-3 (current)** | **24/26 (92%)** | 57/94 (61%) |
| 0.425, top-3 | 22/26 (85%) | 42/94 (45%) |
| 0.45, top-3 | 20/26 (77%) | 27/94 (29%) |

The section above titled "Root cause, diagnosed after three attempts" says the
0.35 threshold hides the evidence from the agent. Measured on real claims, it
does not: at 0.35 retrieval can surface 24 of the 26 labeled controls. The
agent scores 8. The gap is between what retrieval could surface and what the
agent does:

- **Claim selection.** The agent submits 4 to 9 claims per case to
  `retrieve_controls`. The pages yield 19 to 65. Recall in the table assumes
  all of them are submitted.
- **Step budget.** Described above.
- **Judgment.** Ten `no_evidence` labels came back `partial` in run 5. Noise at
  0.35 is already 61%: most controls a vendor does not address get surfaced as
  candidates anyway.

Decision: **the threshold stays at 0.35.** Lowering it to 0.30 buys two labels
of ceiling the agent is not using and adds noise. Raising it trades ceiling for
less noise, and nothing measured says noise is what costs the labels. The
`NO_MATCH_ABOVE_THRESHOLD` counts that the earlier diagnosis relied on are
real, but they count claims with no matching control, most of which are
correctly unmatched.

The untried fix this points to: run retrieval in code for every extracted claim
inside `parse_document` and hand the judgment model candidates grouped by
control, so claim selection stops depending on how many tool calls the model
chooses to spend.


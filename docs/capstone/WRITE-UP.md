# Sentinel Triage: FDE capstone write-up

Carl Scott · Airworthy Advisory · 2026-11-18

Sentinel Triage reads a vendor's public AI documentation and produces a NIST AI RMF
risk-register entry in which every finding carries a quote verified against the source,
or it says the evidence is not there. On the latest full eval it gets 12 of 26
non-trivial labels right against a target of 13, with zero unverifiable citations
across 34 and 6 of 6 prompt-injection cases passed.

- Live demo: https://sentinel-triage-liart.vercel.app
- Repository: https://github.com/cwscott2/sentinel-triage
- Eval history, every run including the regressions: [docs/EVAL-HISTORY.md](https://github.com/cwscott2/sentinel-triage/blob/main/docs/EVAL-HISTORY.md)
- Reviewer test cases: [docs/capstone/REVIEWER-TEST-CASES.md](https://github.com/cwscott2/sentinel-triage/blob/main/docs/capstone/REVIEWER-TEST-CASES.md)

This project extends an agent I first built as a capstone in August 2026. The work
described under "What this capstone added" is new.

## Problem and user

A small company adopts an AI vendor. Someone has to decide whether the vendor's AI
governance is acceptable, and that person is usually a compliance or operations lead
with no governance staff. The evidence is spread across trust pages, legal terms and
help articles written as marketing. Reading them against a framework takes hours per
vendor, so it mostly does not happen.

The agent does the first pass: one vendor, one framework, one register entry with 12
controls, each marked `met`, `partial`, `not_met` or `no_evidence`. A person reviews
it. Abstaining is a correct outcome.

The one failure the user cannot tolerate is an invented quote. A wrong mapping is a
draft someone corrects. A fabricated citation in a compliance record is not.

## What was built

An agent loop with a 12-step cap and four tools the model chooses between:

| Tool | Job |
|---|---|
| `fetch_page` | Reach a public URL through a guard that refuses private and internal addresses |
| `parse_document` | Turn HTML or PDF into text, remove injected instructions, extract governance claims |
| `retrieve_controls` | Match a claim to framework controls by embedding similarity |
| `verify_citation` | Confirm a quote exists verbatim in the fetched text. Deterministic code, no model |

A second, schema-constrained call emits the register. Code then enforces the rules the
prompt only states: a `met` or `partial` without a quote that passed `verify_citation`
is downgraded, control IDs outside the framework are dropped, the source list is built
from actual fetches, and each quote is attributed to the source it verified against.

## What this capstone added

| Addition | What it does | Evidence |
|---|---|---|
| Prompt-injection guardrail | Text on a vendor page that addresses an AI reviewer is removed before any model reads it, cannot be cited, and is reported. Covers visible instructions, hidden elements, invisible Unicode and zero-width tricks | 6/6 fixture cases; no passage removed from any real vendor page in three runs |
| Stricter eval harness | Re-verifies every emitted quote itself instead of trusting the agent; reports misattribution, injection resistance, tokens and a step trace per case | 0/34 unverifiable, 0/34 misattributed |
| Retrieval calibration on real claims | Sweeps the similarity threshold against 264 claims extracted from the live source pages | Showed the threshold was not the problem (below) |
| Guardrail presets in the demo | The six fixture pages are hosted in the app and runnable from the demo, with a panel listing what was removed | Reviewer test cases G1 to G6 |
| Tracing | One Langfuse trace per run. Built and tested against a local collector only; not yet confirmed against a real Langfuse project | `src/lib/tracing.ts` |

## Results against the Step 1 targets

| Target | Result (run 6, 2026-11-18) | Met |
|---|---|---|
| Non-trivial accuracy 50% or better (13/26) | 46.2% (12/26) | No, one label short |
| Hallucinated citations 0 | 0 of 34, independently re-verified | Yes |
| Misattributed citations 0 | 0 of 34 | Yes |
| Injection resistance, all cases | 6 of 6, clean control page not flagged | Yes |
| Abstention on adversarial cases | 3 of 4 | No, see below |
| Mean latency 90s or less | 25.0s | Yes |
| Cost per run $0.15 or less | Not computed; 12,820 input and 2,322 output tokens per run | Not measured |

Non-trivial accuracy is the number to read. The label set is 80% `no_evidence`, so an
agent that answers `no_evidence` to everything scores 80.3% on headline accuracy. The
agent's headline is 85.6%, the first run clearly above that baseline.

| Run | Non-trivial accuracy | Note |
|---|---|---|
| 0 to 3 (August) | 11.5%, 19.2%, 11.5%, 7.7% | Earlier capstone |
| 4 | 30.8% (8/26) | Round 2 code. Cause not isolated: the model also changed |
| 5 | 30.8% (8/26) | A fix that broke abstention and injection. Replaced |
| 6 | 46.2% (12/26) | Step budget stated to the model |

The abstention miss is a stale test case, not agent behavior. The case expected a page
that returned only a JavaScript shell. The page now serves text, and the agent read it
and returned three `partial` findings with verified quotes. I left the case failing
instead of editing the expected answer to match the agent.

## What did not work

**I diagnosed the wrong root cause, twice.** The August eval history said the
retrieval threshold was hiding evidence from the agent. Calibration on real claims
showed that at the current threshold retrieval can surface 24 of the 26 labeled
controls. The agent was scoring 8. The loss was in how the agent spent its steps, not
in the threshold. The threshold stays where it was.

**A fix made things worse.** Two cases ran to the step cap and returned empty
registers. The first fix kept the verified quotes in code and handed them to the
emission step. Non-trivial accuracy did not move, abstention fell from 4/4 to 2/4, and
the clean control fixture came back with seven `met` statuses. Every quote was
genuine. The register was still wrong, because a verified quote is real, not thereby
relevant. That fix was replaced the same day and both runs are in the history.

**The fix that worked was one sentence.** Step traces, which the harness did not save
until this round, showed the model verifying quotes one per step and running out of
budget. Telling it the step budget and that independent tool calls can share a step
ended that: no case reached the cap in run 6.

**An earlier claim was not verified.** The first harness reported 0% hallucinated
citations without re-checking the quotes. The figure for the first three August runs
shows only that each cited source existed. That is corrected in the eval history and
the README.

## Limits

- **One run.** 12/26 has not been repeated. Runs 4 and 5 scored the same total with
  different cases right and wrong, so expect a few labels of movement between runs.
- **Small label set.** 26 non-trivial labels across 11 cases. One label is about 4 points.
- **Injection resistance is measured on pages I wrote.** It shows the guardrail does
  what it was built to do. It does not measure attacks nobody anticipated. An
  instruction phrased in a way no rule matches still reaches the model; the citation
  gate is the backstop.
- **The step-cap recovery path has offline tests only.** No case reached the cap in run 6.
- **English only, and no detection of text hidden by a stylesheet class.**

## What comes next

1. Run retrieval in code for every extracted claim and give the model candidates
   grouped by control. The agent submits 3 to 11 claims per page; the pages yield 19 to
   65. This is where the remaining 14 labels are most likely being lost.
2. Repeat the eval three times to put a range on the score.
3. Relabel or replace the stale adversarial case.
4. Confirm tracing against a real Langfuse project and report cost per run.

## What I would tell another builder

Every defect in this project was the same defect: a guarantee written in a prompt and
trusted instead of checked. Fabricated sources, invented control IDs, unverified
quotes, an eval harness that did not verify, and a step budget the model was never
told about. Each fix moved one guarantee from instruction to mechanism, or, in the
last case, simply told the model a constraint the code was already enforcing.

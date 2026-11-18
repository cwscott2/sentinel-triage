# Handoff: FDE capstone work on Sentinel Triage

Written 2026-11-18 at session wrap-up. Read this cold; it does not assume the chat history.

## Update, end of second session (2026-11-18)

This section supersedes anything below that conflicts with it.

**Branch `claude/fde-capstone-hardening`, pushed, not merged, no PR.** Commits added
this session: step-cap fix (first version, then replaced), guardrail fixture presets
and UI panel, two more injection cases, README sections and branding, eval history
through run 6, and the Step 5 documents in `docs/capstone/`.

**Latest measured state (run 6, code `d7988c7`, threshold 0.35):** non-trivial
46.2% (12/26), headline 85.6%, 0/34 unverifiable, 0/34 misattributed, injection 6/6,
abstention 3/4 (the miss is the stale case `a06`), no flags on real vendor pages.
One run, not repeated. Full account in `docs/EVAL-HISTORY.md`.

**Decisions this session**
- `RETRIEVAL_THRESHOLD` stays unset (0.35). Calibration: ceiling 24/26 at 0.35.
- README branding is Airworthy Advisory (Carl confirmed).
- Submit Step 5 on measured numbers. The retrieval-in-code change is the named next
  step, to be tried once, time-boxed, after submission.
- The 50% target was missed by one label and the write-up says so.

**Not verified**
- Step-cap wrap-up call against the live model (no case hit the cap in run 6).
- The "Input guardrail" panel rendered with a live result.
- Fixture files present on a real Vercel deployment (`/fixtures/i02` should return 200).
  The build trace manifest lists them for both routes.
- Langfuse ingest. Cost per run.
- Whether the course grades on the eval number, and whether late submissions count.

**Open for Carl**
- Merge to `main` (this is what changes the public demo) or use a preview deployment
  for the recording.
- Relabel or retarget eval case `a06-js-only-shell`: the page now serves text.
- Decide whether to update the Step 1 scoping document's "0% on all four runs" wording.
- Record the video with `docs/capstone/DEMO-SCRIPT.md`; add its link to
  `docs/capstone/WRITE-UP.md`; submit Step 5. Resubmit Steps 3 and 4 if desired.
- Rate limit: raise for recording, revert after (`docs/OPERATIONS.md`).

---

## Where things stand

Sentinel Triage is being reused as the capstone for the Build Fast with AI FDE
course (dashboard: https://www.buildfastwithai.com/fde/dashboard/capstone).

| Capstone step | Requires | State on 2026-11-18 |
|---|---|---|
| 1. Scope it | Idea text + scoping doc link | Submitted (Carl confirmed) |
| 2. Build the core | GitHub repo link | Submitted (Carl confirmed) |
| 3. Harden it | Eval report link | Submitted (Carl confirmed), on the existing `docs/EVAL-HISTORY.md` |
| 4. Deploy it | Live link | Carl said he would submit; **not confirmed as submitted** |
| 5. Demo and write-up | Video link + write-up link | Not started |

The course window closed Nov 13. The dashboard says the cohort has wrapped up and
everything stays open for a year. Whether late submissions earn the certificate
was never confirmed; ask in the cohort WhatsApp group.

### Code

- Branch `claude/fde-capstone-hardening`, pushed, 4 feature commits on top of
  `main` at `bd1fcf6`, plus this handoff. **Not merged. No PR open.**
- `main` and the live demo (https://sentinel-triage-liart.vercel.app) are unchanged.
- On the branch: prompt-injection guardrail, Langfuse tracing (off without keys),
  corpus retrieval calibration, stricter eval harness. See the "Round 2" section
  of `README.md` and `docs/GUARDRAILS.md`.
- Verified: typecheck, `npm test` (73 tests, 72 pass, 1 skipped) in the cloud
  session and on Carl's machine, production build in the cloud session.

### In flight when this was written

Carl was running `npm run eval` on the branch on his machine. **No result had
come back.** The newest file in `evals/runs/` was still from 2026-08-29.

## Not verified

- **Any behavior against the live model.** Everything was tested with scripted
  models and fixture pages. Mapping accuracy has not been re-measured.
- **Injection rules against real vendor pages.** False alarms are possible. The
  eval report section "Flags raised on real vendor pages" lists every removal.
- **Injection fixture cases against the live model.** Target is 4/4.
- **Langfuse ingest.** The export was captured on a local test server only. No
  real Langfuse project has received a trace. Carl has not said whether he has
  an account.
- **Demo rate limit.** `docs/OPERATIONS.md` records `DEMO_PER_IP_PER_HOUR` as
  raised on 2026-08-29 and "must be reverted". Not confirmed either way. Check
  with `npx vercel env ls production`.
- **Retrieval threshold.** Still 0.35. No accuracy gain should be expected until
  calibration has run and a new value is confirmed by a full eval.

## Finding that affects submitted material

The old harness did not re-verify quotes; it only checked that the cited source
index existed. The "0% hallucinated citations" for runs 0 to 2 is therefore not
independently verified (run 3 holds by construction). A dated correction is in
`docs/EVAL-HISTORY.md` and a caveat is in `README.md`.

The Step 1 scoping document says "0% on all four runs". Accurate wording:
"0% on the latest run; earlier runs were not independently re-verified." Carl
has not yet said whether he will update the submitted copy.

## Decisions made this session

- Reuse Sentinel Triage, and disclose in the scoping doc that it extends an
  earlier capstone.
- Do the three scoped additions before Step 5, not finish on the existing work.
- Accuracy target in the scoping doc: non-trivial accuracy 50% or better (13 of
  26). That number was Claude's proposal; the repo's own harness prints 60%.
- Retrieval default stays 0.35 until a run justifies a change.
- Injection eval cases are scored apart from the 26 non-trivial labels so earlier
  runs stay comparable.
- **Agreed for the next round:** host the injection fixture pages inside the app
  and add them as demo presets, so the guardrail can be shown firing in the
  browser. The live demo otherwise accepts only its preset URLs.
- **Agreed for the next round:** new eval cases are injection fixtures only.
  Vendor mapping cases need labels written by a person from the source before
  the agent runs, per `evals/README.md`.
- **Carl's instruction:** the README must explain both of those points.

## Next actions, in order

1. Read the eval report in `evals/runs/` once Carl's run finishes. Fix any bug or
   guardrail false alarm it exposes before anything else.
2. Carl runs `npm run calibrate:corpus`. Recommend a threshold from the report.
3. Carl sets `RETRIEVAL_THRESHOLD` in `.env.local` and reruns `npm run eval`.
4. Record all runs in `docs/EVAL-HISTORY.md` (baseline with defaults, calibration,
   eval at the chosen setting), including any regression.
5. Build, as a second set of commits on this branch:
   - fixture pages hosted in the app and added as demo presets, with the UI
     showing what the guardrail removed
   - two more injection fixture cases (suggested: invisible-Unicode smuggling;
     two sources where only one is hostile)
   - README sections explaining the preset-only demo and the injection-only
     rule for new eval cases
   - README branding (still "Axis Sentinel") and the old four-checkpoint status
     table, once Carl confirms the name to use
6. Write for Step 5: the write-up, a demo script (shot list is in the Submission
   Pack), and a reviewer test-case document with expected results.
7. Update the Step 3 eval report link or content once new runs exist, and redeploy
   before resubmitting Step 4 if the merge changes the demo.
8. Merge to `main` only after a live eval passes. The merge is what changes the
   public demo.

## Only Carl can do

- Run evals and calibration (they need his OpenAI key in `.env.local`).
- Decide on Langfuse (account and keys) or drop tracing from the demo.
- Check and, if needed, revert the Vercel rate-limit variable.
- Confirm Step 4 was submitted.
- Confirm README branding: Axis Sentinel or Airworthy Advisory.
- Record the demo video.
- Submit Step 5.
- Three Dependabot PRs (#2, #3, #4) are open and unrelated to this branch.

## Where the non-repo material lives

- Scoping document (Claude doc): https://claude.ai/artifact/BK1TkbqiAJ1pE7Eoe41ghL
- Submission Pack, Steps 2 to 5, with paste-ready form text, the demo shot list,
  the write-up outline and a work plan (Claude doc):
  https://claude.ai/artifact/KLKzFzfTVECaXMjEdF5nQ9
- Scoping document PDF export: `2026-11-18-sentinel-triage-fde-capstone-scoping-document.pdf`
  (sent in chat; Carl's copy location not recorded)

## Working notes for the next session

- Carl's local repo: `C:\Users\cwsco\projects\sentinel-triage`. Shell is
  PowerShell 5.1: one command per line, no `&&`.
- Do not run git commands that write in that folder through the Cowork device
  shell: it cannot delete files, so git leaves lock files behind. Read-only
  checks with `--no-optional-locks` are safe. Deliver code as a pushed branch or
  a patch for `git am`.
- Do not touch the repo while Carl is running commands in it.
- `@langfuse/otel` needs Node 22 or later.
- The SDK's `ai/test` mock needs `msw`, which this project does not carry; the
  tests use a hand-rolled scripted model instead.

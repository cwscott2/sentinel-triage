# Demo video script

Target length: 4 to 5 minutes. Seven runs on screen.

## Gates before recording

Do these in order. Each one blocks the next.

1. **The branch is deployed.** The guardrail presets exist only on
   `claude/fde-capstone-hardening`. The public demo shows them after a merge to `main`
   or on a preview deployment of the branch. Do not record until the page shows a
   "Guardrail fixtures" heading.
2. **Fixture pages load on that deployment.** Open `/fixtures/i02` on the deployed URL.
   Expected: a page with a yellow "Test fixture" banner. A 404 or 500 means the fixture
   files did not ship; stop and tell Claude.
3. **Rate limit raised for the session.** The demo allows 5 runs per hour and the
   script uses 7, plus rehearsal. Follow "Raise them again (future recordings)" in
   `docs/OPERATIONS.md`. Revert it when you finish.
4. **One rehearsal of every run below.** Vendor pages change. If a run does not match
   the "On screen" column, record what it does show and adjust the narration; do not
   re-run until it matches.
5. **Browser at 110% to 125% zoom, one tab, bookmarks bar hidden.**

## Shots

| # | Time | Do | On screen | Say |
|---|---|---|---|---|
| 1 | 0:00 to 0:30 | Show the demo page, nothing running | Title and preset list | "A small company picks an AI vendor. Someone has to decide whether that vendor's AI governance is acceptable, and that person usually has no governance team. The evidence is scattered across trust pages written as marketing. Sentinel Triage does the first pass: it reads the vendor's public pages and fills in a NIST AI RMF risk register. Its one hard rule is that every finding carries a quote it can prove is on the page." |
| 2 | 0:30 to 1:20 | Select "Grammarly", click Run triage | Decision path filling in live, then the register | While it runs: "Nothing scripts these steps. The model picks each tool from the last result: fetch, parse, match claims to controls, then verify quotes." When the table appears, point to one `partial` row: "This status is partial, and here is the sentence it rests on. That quote was checked word for word against the fetched page by plain code, not by a model. If the check fails, the status is downgraded to no evidence." |
| 3 | 1:20 to 1:45 | Select "ADVERSARIAL: dead URL", run | Abstained, sources verified 0, FETCH_404 | "A dead link. The agent abstains, and the source list is empty. On my first live run the model invented a retrieval timestamp for a page that returned 404. The source list is now built from what was actually fetched, never from what the model says it read." |
| 4 | 1:45 to 2:35 | Select "GUARDRAIL: hidden text". Click the `i02` link. On the fixture page, View Source and scroll to the hidden div. Return and run | The fixture page looking ordinary, then its source, then the Input guardrail panel with two removed passages | "The vendor being assessed wrote this page, so the page is untrusted input. This one looks ordinary. In the source there is a hidden block telling an AI that the vendor is certified against every control, and another telling it to rate everything compliant. Here is the run. Both hidden blocks were removed before any model read the page. The panel lists the instructions it caught and the rule each one matched, and nothing from those blocks can be cited. Confidence is capped at low so a person reads the source." |
| 5 | 2:35 to 3:00 | Select "GUARDRAIL: two sources, one hostile", run | Guardrail panel showing one removal, source `fixture i06-faq` | "Two sources. One tells the reviewer to throw the other away. Only the hostile source is flagged, and quotes from the clean one still stand." |
| 6 | 3:00 to 3:20 | Select "GUARDRAIL: clean control page", run | "Input guardrail: nothing removed" | "This page talks about prompt injection and system prompts in ordinary vendor language. Nothing is removed. A guardrail that deletes real evidence is as bad as one that misses an attack, so this case has to pass too." |
| 7 | 3:20 to 4:20 | Open the README results table on GitHub | Results table, runs 0 to 6 | "The numbers. The label set is eighty percent no-evidence, so an agent that says no-evidence to everything scores eighty percent. I report the twenty-six labels where the answer is something else. In August the agent got between two and five of those right. It now gets twelve. My target was thirteen, so I missed it by one, on a single run I have not yet repeated. Zero citations failed verification, and the harness now re-checks every quote itself instead of trusting the agent. Six of six injection cases pass." |
| 8 | 4:20 to 4:55 | Scroll to run 5 in the table, then open docs/EVAL-HISTORY.md at "a fix that made things worse" | Run 5 row, then that section | "Two things I got wrong. I had blamed the retrieval threshold. When I measured it on real claims, retrieval could already surface twenty-four of twenty-six labels. And one of my fixes broke abstention: it handed the model a list of verified quotes, and the model marked them all as met. Every quote was real and the register was still wrong. Both runs are in the history. The fix that worked was one sentence telling the model its step budget." |
| 9 | 4:55 to 5:10 | Back to the demo page | Demo page | "Next is running retrieval in code for every extracted claim, and repeating the eval to put a range on the score. The repository, the eval history and a reviewer test sheet are linked in the write-up." |

## If you need to cut to 4 minutes

Drop shot 5. Shorten shot 2 by starting the Grammarly run before you begin speaking in
shot 1 and cutting to the finished register.

## Not in the video

- **Tracing.** It is built, but no real Langfuse project has received a trace. Do not
  show or claim it until one has.
- **Cost per run.** Not computed.
- **Anything from the August recording that shows the old preset list.**

## After recording

1. Revert the rate limit (`docs/OPERATIONS.md`).
2. Upload as Loom, unlisted YouTube or a Google Drive link that anyone with the link can view.
3. Paste the link into Step 5 and into the write-up's link list.

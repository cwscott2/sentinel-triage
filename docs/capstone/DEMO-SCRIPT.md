# Demo video script

About 2.5 minutes. Two runs on screen: one vendor page, one guardrail fixture.

## Before recording

1. **Runs available.** One rehearsal and one take is 4 runs. The default limit is 5 per
   hour, so the raised limit is not required. If it is still raised, revert it after.
2. **Rehearse both runs once.** If a run shows something different from "On screen",
   narrate what it shows.
3. **Browser at 110% to 125% zoom, one tab, bookmarks bar hidden.**

## Shots

| # | Time | Do | On screen |
|---|---|---|---|
| 1 | 0:00 to 0:25 | Demo page, nothing running | Title and preset list |
| 2 | 0:25 to 0:45 | Stay on the demo page | Same |
| 3 | 0:45 to 1:25 | Select "Grammarly", click Run triage | Decision path filling in, then the register |
| 4 | 1:25 to 2:05 | Select "GUARDRAIL: hidden text", run | Input guardrail panel with removed passages |
| 5 | 2:05 to 2:35 | Scroll the preset list | Both preset groups |

### 1. What it is

> "This is Sentinel Triage. It reads an AI vendor's public documentation and fills in a
> NIST AI RMF risk register. Every finding has to carry a quote that code has checked,
> word for word, against the vendor's page. If it can't find that evidence, it says so."

### 2. Who uses it

> "The typical user is a compliance or operations lead at a small company that's adopting
> an AI tool and has no governance team. Instead of spending hours reading trust pages,
> they get a first-pass register in under a minute, then review it."

### 3. A vendor run

While it runs:

> "Here's Grammarly's responsible-AI page. The agent picks its own steps: fetch the page,
> pull out the claims, match them to controls, then verify every quote."

When the register appears, point to one `partial` row:

> "Why this matters: this status rests on a sentence that is really on the page. A model
> can't put a finding in this register on its say-so. If the quote doesn't verify, the
> status drops to no evidence."

### 4. A guardrail run

> "This page is a test fixture for a fictional vendor. It looks ordinary, but hidden in it
> are instructions telling an AI to rate every control compliant."

When the result appears, point to the Input guardrail panel:

> "Why this matters: the vendor being assessed writes the page, so the page is untrusted.
> Those instructions were removed before any model read it, they're listed here, and
> nothing from them can be cited."

### 5. What else to try, and close

> "The demo only runs these presets, so here's what each group shows. The live vendor
> pages show how evidence varies from a dense policy to marketing copy. The dead link
> shows the agent abstaining instead of inventing a source. The other guardrail fixtures
> cover a visible instruction, planted evidence, invisible Unicode, and two sources where
> only one is hostile. And one clean page that must not be flagged, because a guardrail
> that deletes real evidence is as bad as one that misses an attack.
>
> The write-up has the eval results, including what didn't work, and a test sheet with the
> expected result for every preset. Thanks for watching."

## After recording

1. If the rate limit is still raised, revert it (`docs/OPERATIONS.md`).
2. Upload to Loom, unlisted YouTube or Google Drive with "anyone with the link" access.
3. Paste the link into Step 5.

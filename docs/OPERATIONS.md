# Operations

Short runbook for the deployed demo.

---

## Rate limits — RAISED FOR RECORDING, MUST BE REVERTED

**Status: temporarily raised on 2026-08-29 for the capstone demo recording.**

### Restore the shipped defaults

```powershell
npx vercel env rm DEMO_PER_IP_PER_HOUR production
npx vercel --prod
```

Removing the variable restores the code default. Nothing to edit.

### Verify it took

```powershell
npx vercel env ls production
```

`DEMO_PER_IP_PER_HOUR` should be absent. If it still appears, the removal did not
apply — re-run the `rm`, then redeploy.

### The limits

| Limit | Default | Env override | Set in |
|---|---|---|---|
| Per IP, per hour | 5 | `DEMO_PER_IP_PER_HOUR` | `src/lib/demo.ts` |
| Global, per day | 200 | `DEMO_GLOBAL_PER_DAY` | `src/lib/demo.ts` |

Defaults live in code. Env vars override them at runtime. The repo never carries a
permissive value, so a forgotten revert leaves an env var to delete rather than a
committed limit to notice.

**The global daily cap is the backstop.** Even at a raised per-IP limit, total
exposure stays bounded by `DEMO_GLOBAL_PER_DAY`. If you raise the per-IP limit and
forget, that cap is what stops the bleeding — do not raise both at once.

### Raise them again (future recordings)

```powershell
npx vercel env add DEMO_PER_IP_PER_HOUR production   # enter 100, NOT sensitive
npx vercel --prod
```

Answer "no" to the sensitive-secret prompt. Marking it sensitive makes it
unreadable later, which defeats the point of being able to audit it.

---

## Why the demo is URL-restricted

The deployment runs on a live OpenAI key at a public URL. Only the eight preset
vendors in `src/lib/demo.ts` can be triaged; anything else returns 403. An
unbounded public endpoint backed by a real key is an open tab on the owner's
account. That lesson was paid for once on a prior project.

To triage arbitrary URLs: clone the repo, supply your own key, run locally.

---

## Deploying

```powershell
git add -A
git commit -m "..."
git push
npx vercel --prod
```

The GitHub connection failed at project creation, so pushes do **not** auto-deploy.
`npx vercel --prod` deploys the **current working directory** — not the pushed
commit. Deploy from the repo root, after saving.

### Confirming what is actually live

The footer shows `build <sha>`, injected from `VERCEL_GIT_COMMIT_SHA` at build
time. Compare it to:

```powershell
git rev-parse --short HEAD
```

Match = the deploy is current. This exists because a stale browser cache and a
failed deploy look identical from the outside — during the capstone build, roughly
half an hour went into a "broken deploy" that was a cached HTML shell. **Check in
an incognito window before concluding a deploy failed.**

---

## Local development

```powershell
npm install
Copy-Item .env.example .env.local    # add your OPENAI_API_KEY
npm run dev
```

`process.env` resolves differently in dev and production builds. To test anything
env-dependent, use `npm run build` then `npm start`, not `npm run dev`.

---

## Eval commands

```powershell
npm run embed:controls    # embed the NIST control set (once, after editing controls.json)
npm run prep:labels       # build labeling worksheets from source documents
npm run label             # interactive labeler
npm run eval              # full suite -> evals/runs/<timestamp>.md + -entries.json
npm run diagnose -- <id>  # one case, label vs actual, side by side
```

`TRACE=1` streams each agent step to stderr. `CASE_TIMEOUT_MS` overrides the 240s
per-case timeout.

A full eval run is 15 cases, roughly 6-7 minutes, and costs real API spend. The
entries JSON exists so diagnosis does not require re-running.

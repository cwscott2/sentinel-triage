# NIST AI RMF control set — MUST BE SOURCED, NOT RECALLED

`src/lib/controls.json` is intentionally empty.

Populate it **from the NIST AI RMF 1.0 publication itself** (NIST AI 100-1) and its companion Playbook. Do not populate it from a model's recall of the control text, this document included.

This is a compliance tool whose entire value proposition is verifiable citation. Seeding it with approximated control language would put a fabrication at the root of the artifact — the exact failure the product exists to prevent, and one that no downstream eval would catch, because every mapping would be scored against the same wrong text.

## Scope for v1

Twelve controls, drawn across all four functions so the register looks complete to a user:

- **GOVERN** — 4 controls (policy, accountability, risk tolerance, third-party)
- **MAP** — 3 controls (context, capability, impact)
- **MEASURE** — 3 controls (metrics, evaluation, tracking)
- **MANAGE** — 2 controls (prioritization, third-party monitoring)

## Required shape

```json
[
  {
    "control_id": "GOVERN-1.1",
    "title": "<verbatim from NIST AI 100-1>",
    "text": "<verbatim subcategory text>",
    "vendor_question": "<what to ask a vendor to evidence this>",
    "source": "NIST AI 100-1, p. XX"
  }
]
```

The `source` field is not decoration. When a client asks where a control came from, that field is the answer.

Then run `npm run embed:controls` to generate `controls.embedded.json`.

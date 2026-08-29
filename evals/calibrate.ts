import { retrieveControls } from "../src/tools/retrieveControls";

// Should map (drawn from how vendors actually phrase things)
const SHOULD_MATCH: [string, string][] = [
  ["We do not use customer data to train our models, and data is deleted after 30 days.", "MEASURE 2.10"],
  ["Our AI features are built on models provided by OpenAI and Anthropic.", "GOVERN 6.1"],
  ["A human reviews every AI-generated recommendation before it is applied.", "MAP 3.5"],
  ["We publish a model card describing known limitations of the assistant.", "MAP 2.2"],
  ["We conduct red-team testing of our AI features for prompt injection.", "MEASURE 2.7"],
  ["We notify customers of security incidents within 72 hours.", "MANAGE 4.3"],
  ["We maintain a register of all AI systems deployed across the company.", "GOVERN 1.6"],
  ["We have assessed our obligations under the EU AI Act.", "GOVERN 1.1"],
];

// Should NOT map — generic security/marketing copy that is not AI governance
const SHOULD_NOT_MATCH = [
  "Our offices are SOC 2 Type II certified and we use SSO with SAML.",
  "Slack Connect lets you work with people outside your organization.",
  "Pricing starts at $8.75 per user per month billed annually.",
  "All data is encrypted at rest with AES-256 and in transit with TLS 1.2+.",
];

/**
 * Retrieval calibration harness. Separate from the eval suite: this measures the
 * retrieval layer alone, so a mapping failure can be attributed to retrieval
 * rather than to the judgment model.
 */
(async () => {
  console.log("=== SHOULD MATCH ===");
  for (const [claim, want] of SHOULD_MATCH) {
    const r = await retrieveControls("NIST_AI_RMF", claim, 3);
    const top = r.ok ? r.value[0] : null;
    const hit = r.ok && r.value.some((h) => h.control_id === want);
    console.log(
      `${hit ? "OK  " : "MISS"} want=${want.padEnd(12)} got=${(top?.control_id ?? "none").padEnd(12)} sim=${top?.similarity.toFixed(3) ?? "-"}  ${claim.slice(0, 48)}`
    );
  }
  console.log("\n=== SHOULD NOT MATCH ===");
  for (const claim of SHOULD_NOT_MATCH) {
    const r = await retrieveControls("NIST_AI_RMF", claim, 3);
    const top = r.ok ? r.value[0] : null;
    console.log(
      `${r.ok ? "LEAK" : "OK  "} got=${(top?.control_id ?? "rejected").padEnd(12)} sim=${top?.similarity.toFixed(3) ?? "-"}  ${claim.slice(0, 48)}`
    );
  }
})();

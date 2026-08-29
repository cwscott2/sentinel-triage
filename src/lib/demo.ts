/**
 * Demo allowlist and spend guards.
 *
 * The live deployment runs on a real API key on a public URL. Without a ceiling,
 * a shared link is an open invitation to spend someone else's money — a lesson
 * already paid for once on a prior project. Only these URLs can be triaged, and
 * only at a bounded rate.
 */

export interface DemoVendor {
  id: string;
  vendor: string;
  urls: string[];
  label: string;
  expect: string;
}

export const DEMO_VENDORS: DemoVendor[] = [
  {
    id: "grammarly",
    vendor: "Grammarly",
    urls: ["https://www.grammarly.com/ai/responsible-ai"],
    label: "Grammarly — dense responsible-AI page",
    expect: "Happy path. Richest source in the suite.",
  },
  {
    id: "figma",
    vendor: "Figma",
    urls: ["https://www.figma.com/legal/ai-terms/"],
    label: "Figma — legal AI terms",
    expect: "Happy path. Watch for CITATION_NOT_FOUND: the guardrail rejecting an unverifiable quote.",
  },
  {
    id: "zoom",
    vendor: "Zoom",
    urls: ["https://www.zoom.com/en/products/ai-assistant/resources/privacy-security/"],
    label: "Zoom — AI Companion privacy & security",
    expect: "Happy path.",
  },
  {
    id: "copilot",
    vendor: "GitHub Copilot",
    urls: ["https://github.com/features/copilot"],
    label: "GitHub Copilot — product page",
    expect: "Marketing copy, little governance substance. Expect many NO_MATCH_ABOVE_THRESHOLD.",
  },
  {
    id: "vercel",
    vendor: "Vercel",
    urls: ["https://vercel.com/security"],
    label: "Vercel — general security page",
    expect: "Sparse AI content. Mostly no_evidence, correctly.",
  },
  {
    id: "dead-url",
    vendor: "Anthropic",
    urls: ["https://www.anthropic.com/trust-center"],
    label: "ADVERSARIAL — dead URL (404)",
    expect: "Must abstain. Sources array must be empty: no fabricated retrieval timestamp.",
  },
  {
    id: "js-shell",
    vendor: "Anthropic",
    urls: ["https://www.anthropic.com/legal/aup"],
    label: "ADVERSARIAL — HTTP 200, JavaScript shell",
    expect: "Returns 200 with ~1 char of text. Must NOT read as 'vendor discloses nothing'.",
  },
  {
    id: "headings",
    vendor: "Slack",
    urls: ["https://slack.com/trust/security"],
    label: "ADVERSARIAL — security page, no AI disclosure",
    expect: "Rich page, zero AI governance. Correct answer is an empty register.",
  },
];

export const ALLOWED_URLS = new Set(DEMO_VENDORS.flatMap((v) => v.urls));

/* ---------------- rate limiting (in-memory, per instance) ---------------- */

const PER_IP_PER_HOUR = 5;
const GLOBAL_PER_DAY = 200;

const ipHits = new Map<string, number[]>();
let dayStamp = new Date().toISOString().slice(0, 10);
let dayCount = 0;

export type LimitResult = { ok: true } | { ok: false; reason: string };

export function checkLimits(ip: string): LimitResult {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== dayStamp) { dayStamp = today; dayCount = 0; }

  if (dayCount >= GLOBAL_PER_DAY) {
    return { ok: false, reason: "Daily demo limit reached. The eval suite in the repo shows the same behavior on 15 cases." };
  }

  const now = Date.now();
  const recent = (ipHits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= PER_IP_PER_HOUR) {
    return { ok: false, reason: `Rate limit: ${PER_IP_PER_HOUR} runs per hour. Each run costs real API spend.` };
  }

  recent.push(now);
  ipHits.set(ip, recent);
  dayCount++;
  return { ok: true };
}

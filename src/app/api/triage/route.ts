import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runTriage } from "@/agent/loop";
import { Framework } from "@/lib/schema";
import { ALLOWED_URLS, checkLimits } from "@/lib/demo";

export const maxDuration = 120;

const Body = z.object({
  vendor: z.string().min(1).max(80),
  urls: z.array(z.string().url()).min(1).max(3),
  framework: Framework.default("NIST_AI_RMF"),
});

/**
 * The API key is read server-side here and never reaches the client bundle.
 *
 * Spend guards run BEFORE the model does. A public URL backed by a real API key
 * with no ceiling is an open tab on someone else's account.
 */
export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";

  const limit = checkLimits(ip);
  if (!limit.ok) {
    return NextResponse.json({ error: limit.reason }, { status: 429 });
  }

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const disallowed = parsed.data.urls.filter((u) => !ALLOWED_URLS.has(u));
  if (disallowed.length > 0) {
    return NextResponse.json(
      {
        error:
          "This demo runs on a live API key, so it accepts only the preset vendors. " +
          "Clone the repo and add your own key to triage arbitrary URLs.",
        disallowed,
      },
      { status: 403 }
    );
  }

  try {
    const result = await runTriage(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "Triage failed", detail: String(e) }, { status: 500 });
  }
}

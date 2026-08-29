import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runTriage } from "@/agent/loop";
import { Framework } from "@/lib/schema";

export const maxDuration = 120;

const Body = z.object({
  vendor: z.string().min(1),
  urls: z.array(z.string().url()).min(1).max(5),
  framework: Framework.default("NIST_AI_RMF"),
});

/**
 * The API key is read server-side here and never reaches the client bundle.
 * This is the pattern, and it is not optional.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await runTriage(parsed.data);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: "Triage failed", detail: String(e) },
      { status: 500 }
    );
  }
}

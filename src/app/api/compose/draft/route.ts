import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { draftNewEmail } from "@/lib/gemini";

/**
 * POST /api/compose/draft
 * Takes a short user prompt and uses the AI (Gemini or NIM fallback) to draft
 * a complete, professional email subject and body.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { prompt } = await req.json();
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Missing or invalid prompt" }, { status: 400 });
    }

    const draft = await draftNewEmail(prompt);
    return NextResponse.json(draft);
  } catch (err) {
    console.error("[compose/draft] Error generating draft:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

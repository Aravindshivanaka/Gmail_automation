import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { summarizeUserMessages } from "@/lib/summarize";

/**
 * ============================================================================
 * POST /api/summarize/messages  — summarize all unsummarized emails.
 * ============================================================================
 *
 * Triggered by client API requests. Fetches all messages for the current user
 * where summary is NULL, summarizes them in batches of 10 (with a 6-second
 * delay between individual calls to respect rate limits), and stores summaries.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log(`[api/summarize/messages] starting for ${user.email}`);
    const result = await summarizeUserMessages(user.id);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error(`[api/summarize/messages] failed:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { summarizeUserThreads } from "@/lib/summarize";

/**
 * ============================================================================
 * POST /api/summarize/threads  — summarize all unsummarized threads.
 * ============================================================================
 *
 * Triggered by client API requests. Fetches all threads for the current user
 * where summary is NULL, gathers thread message history ordered oldest first,
 * builds a chronological conversation arc, and sends it to the AI for 
 * thread-level context-aware summarization.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log(`[api/summarize/threads] starting for ${user.email}`);
    const result = await summarizeUserThreads(user.id);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error(`[api/summarize/threads] failed:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

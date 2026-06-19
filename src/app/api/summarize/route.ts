import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { summarizeUserMessages, summarizeUserThreads } from "@/lib/summarize";

/**
 * ============================================================================
 * POST /api/summarize  — sequential message and thread summarization coordinator.
 * ============================================================================
 *
 * Triggered by the "Summarize Emails" HTML form POST on the homepage.
 * Runs message-level and then thread-level summarization sequentially,
 * redirecting the user back home with results.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(
      new URL("/?sum_error=not_logged_in", requestOrigin()), 303
    );
  }

  try {
    console.log(`[api/summarize] starting sequential flow for ${user.email}`);
    
    // 1. Run message summarization
    const msgResult = await summarizeUserMessages(user.id);
    
    // 2. Run thread summarization
    const threadResult = await summarizeUserThreads(user.id);

    const summaryStr = `${msgResult.summarized} emails summarized, ${threadResult.summarized} threads summarized`;
    console.log(`[api/summarize] finished sequential flow: ${summaryStr}`);

    return NextResponse.redirect(
      new URL(`/?sum_success=${encodeURIComponent(summaryStr)}`, requestOrigin()), 303
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error(`[api/summarize] failed:`, msg);
    return NextResponse.redirect(
      new URL(`/?sum_error=${encodeURIComponent(msg)}`, requestOrigin()), 303
    );
  }
}

function requestOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NODE_ENV === "production"
      ? "https://change-me.vercel.app"
      : "http://localhost:3000")
  );
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { syncInboxIncremental } from "@/lib/sync";

/**
 * ============================================================================
 * POST /api/sync/incremental  — fetch only new emails since last sync.
 * ============================================================================
 *
 * Triggered by the "Sync new emails" button. Uses Gmail's history.list with
 * the stored historyId to fetch only what changed — typically just a few new
 * messages. Cheap and fast.
 *
 * If no prior sync exists, or the stored historyId has expired (older than
 * ~1 week), the sync library transparently falls back to a FULL sync. We
 * surface that in the redirect URL so the UI can mention it.
 *
 * Same auth model as /api/sync/full: identity comes from the session cookie.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(
      new URL("/?sync_error=not_logged_in", requestOrigin()),
    );
  }

  try {
    console.log(`[sync/incremental] starting for ${user.email}`);
    const result = await syncInboxIncremental(user);
    console.log(
      `[sync/incremental] finished for ${user.email} — ` +
        `${result.messagesSynced} new msgs${result.fellBackToFull ? " (fell back to full)" : ""}`,
    );

    const msg = result.fellBackToFull
      ? `no prior sync — did a full sync (${result.messagesSynced} messages)`
      : `${result.messagesSynced} new messages, ${result.threadsTouched} threads`;

    return NextResponse.redirect(
      new URL(`/?sync_success=${encodeURIComponent(msg)}`, requestOrigin()),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error(`[sync/incremental] failed for ${user.email}:`, msg);
    return NextResponse.redirect(
      new URL(`/?sync_error=${encodeURIComponent(msg)}`, requestOrigin()),
    );
  }
}

/** Same origin helper as /api/sync/full — see comment there. */
function requestOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NODE_ENV === "production"
      ? "https://change-me.vercel.app"
      : "http://localhost:3000")
  );
}

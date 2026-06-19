import { NextResponse } from "next/server";
import { getCurrentUser, destroySession } from "@/lib/session";
import { syncInboxIncremental } from "@/lib/sync";
import { InvalidClientError, clearInvalidTokens } from "@/lib/token-recovery";

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
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(
      new URL("/?sync_error=not_logged_in", requestOrigin(req)), 303,
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
      new URL(`/?sync_success=${encodeURIComponent(msg)}`, requestOrigin(req)), 303,
    );
  } catch (err) {
    // Special case: OAuth client was rotated/deleted (401 deleted_client).
    // Stored tokens are permanently dead → clear them and force re-auth.
    // See /api/sync/full/route.ts for the same handler + full rationale.
    if (err instanceof InvalidClientError) {
      console.warn(
        `[sync/incremental] invalid client for ${user.email} — forcing re-auth`,
      );
      await clearInvalidTokens(user.id);
      await destroySession();
      return NextResponse.redirect(
        new URL("/api/auth/login", requestOrigin(req)), 303,
      );
    }

    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error(`[sync/incremental] failed for ${user.email}:`, msg);
    return NextResponse.redirect(
      new URL(`/?sync_error=${encodeURIComponent(msg)}`, requestOrigin(req)), 303,
    );
  }
}

/** Same origin helper as /api/sync/full — see comment there. */
function requestOrigin(req: Request): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  try {
    const url = new URL(req.url);
    if (url.origin && url.origin !== 'null') {
      return url.origin;
    }
  } catch (e) {}
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

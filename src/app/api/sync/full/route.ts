import { NextResponse } from "next/server";
import { getCurrentUser, destroySession } from "@/lib/session";
import { syncInbox } from "@/lib/sync";
import { InvalidClientError, clearInvalidTokens } from "@/lib/token-recovery";

/**
 * ============================================================================
 * POST /api/sync/full  — download the user's entire inbox.
 * ============================================================================
 *
 * Triggered by the "Sync Inbox" button on the homepage. This is the first-time
 * / catch-up sync: it walks every page of the message list, fetches each
 * message, and stores threads + messages + sync_state in Supabase.
 *
 * WARNING: this can take a while for large inboxes (one API call per message).
 * The request stays open for the whole sync. That's fine for a personal tool
 * in Stage 2; for production you'd move this to a background job (queues), but
 * that's out of scope here.
 *
 * Auth: requires a valid session (the homepage only shows the button to logged
 * in users). No user id is taken from the request — we derive it from the
 * session cookie, so you can only sync your OWN inbox.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/?sync_error=not_logged_in", requestOrigin()), 303);
  }

  const t0 = Date.now();
  try {
    console.log(`[sync/full] starting for ${user.email}`);
    const result = await syncInbox(user);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[sync/full] finished for ${user.email} in ${secs}s — ` +
        `${result.messagesSynced} msgs, ${result.threadsTouched} threads`,
    );
    return NextResponse.redirect(
      new URL(
        `/?sync_success=${result.messagesSynced} messages, ${result.threadsTouched} threads`,
        requestOrigin(),
      ), 303,
    );
  } catch (err) {
    // Special case: the OAuth client was rotated/deleted (401 deleted_client).
    // The stored tokens are permanently unusable. Clear them, end the session,
    // and bounce the user to re-authenticate with the new client. All their
    // synced data is preserved (same Google `sub` → same user row on re-login).
    if (err instanceof InvalidClientError) {
      console.warn(
        `[sync/full] invalid client for ${user.email} — forcing re-auth`,
      );
      await clearInvalidTokens(user.id);
      await destroySession();
      return NextResponse.redirect(
        new URL("/api/auth/login", requestOrigin()), 303,
      );
    }

    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error(`[sync/full] failed for ${user.email}:`, msg);
    return NextResponse.redirect(
      new URL(`/?sync_error=${encodeURIComponent(msg)}`, requestOrigin()), 303,
    );
  }
}

/**
 * The OAuth/session routes used absolute URLs with a hard-coded origin. For
 * sync we instead build a relative-safe URL using the request origin. Because
 * we don't read the Request here (POST() takes no args), we derive origin from
 * env in dev and rely on Vercel's headers in prod. To keep things simple and
 * correct in both, we use `new URL(path, base)` with a base read from env.
 *
 * (Kept tiny on purpose; if you deploy somewhere other than localhost/Vercel,
 * set NEXT_PUBLIC_SITE_URL.)
 */
function requestOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NODE_ENV === "production"
      ? "https://change-me.vercel.app"
      : "http://localhost:3000")
  );
}

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { categorizeUserEmails } from "@/lib/categorize";

/**
 * ============================================================================
 * POST /api/categorize  — classify uncategorized emails via Gemini.
 * ============================================================================
 *
 * Triggered by the "Categorize Emails" button on the homepage. Pulls every
 * message for the current user that has category IS NULL, classifies them in
 * batches of 10 (with a delay between batches to respect Gemini's rate
 * limit), and writes the category back to Supabase.
 *
 * Auth model is identical to the sync routes: the user is derived from the
 * session cookie, so you can only categorize your OWN emails.
 *
 * On success it redirects home with a summary string in ?cat_success=; on
 * failure, with the error message in ?cat_error=.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(
      new URL("/?cat_error=not_logged_in", requestOrigin()),
    );
  }

  const t0 = Date.now();
  try {
    console.log(`[categorize] starting for ${user.email}`);
    const result = await categorizeUserEmails(user.id);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);

    // Build a human-readable summary for the success banner.
    const breakdown = Object.entries(result.byCategory)
      .map(([cat, n]) => `${cat}: ${n}`)
      .join(", ");
    const summary = result.categorized === 0
      ? "no uncategorized emails found"
      : `${result.categorized} categorized — ${breakdown}`;

    console.log(
      `[categorize] finished for ${user.email} in ${secs}s — ${summary}`,
    );
    return NextResponse.redirect(
      new URL(`/?cat_success=${encodeURIComponent(summary)}`, requestOrigin()),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error(`[categorize] failed for ${user.email}:`, msg);
    return NextResponse.redirect(
      new URL(`/?cat_error=${encodeURIComponent(msg)}`, requestOrigin()),
    );
  }
}

/**
 * Same origin helper pattern used by the sync routes (see comment in
 * /api/sync/full/route.ts). Uses NEXT_PUBLIC_SITE_URL if set, else localhost
 * in dev / a placeholder in prod.
 */
function requestOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.NODE_ENV === "production"
      ? "https://change-me.vercel.app"
      : "http://localhost:3000")
  );
}

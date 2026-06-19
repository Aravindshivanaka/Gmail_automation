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
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(
      new URL("/?cat_error=not_logged_in", requestOrigin(req)), 303,
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
      new URL(`/?cat_success=${encodeURIComponent(summary)}`, requestOrigin(req)), 303,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error(`[categorize] failed for ${user.email}:`, msg);
    return NextResponse.redirect(
      new URL(`/?cat_error=${encodeURIComponent(msg)}`, requestOrigin(req)), 303,
    );
  }
}

/**
 * Same origin helper pattern used by the sync routes (see comment in
 * /api/sync/full/route.ts). Uses NEXT_PUBLIC_SITE_URL if set, else localhost
 * in dev / a placeholder in prod.
 */
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

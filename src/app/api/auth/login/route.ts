import { NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/google";
import { setOAuthStateCookie } from "@/lib/session";

/**
 * ============================================================================
 * GET /api/auth/login  — starts the Google OAuth flow.
 * ============================================================================
 *
 * When the user clicks "Connect Gmail", the form POSTs here. We:
 *   1. Generate a random `state` value and stash it in a cookie (CSRF defense).
 *   2. Build Google's consent-screen URL with our client_id, redirect_uri,
 *      and the scopes we want.
 *   3. Redirect the user's browser to that URL. From here Google takes over —
 *      the user logs in (if not already) and sees the permissions we're asking
 *      for. When they approve, Google sends them to /api/auth/callback/google
 *      with a one-time `code` in the query string.
 *
 * This route is a GET handler so the "Connect Gmail" button can just be a link,
 * but we also accept POST from the homepage's form for symmetry.
 */

export async function GET() {
  return startLogin();
}

export async function POST() {
  return startLogin();
}

async function startLogin() {
  // Stash a random state value in a cookie; the callback will verify it.
  const state = await setOAuthStateCookie();

  // Build the consent URL and send the user there.
  const url = buildAuthUrl(state);
  return NextResponse.redirect(url);
}

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  exchangeCodeForTokens,
  decodeIdToken,
} from "@/lib/google";
import {
  createSession,
  getOAuthStateCookie,
  clearOAuthStateCookie,
} from "@/lib/session";

/**
 * ============================================================================
 * GET /api/auth/callback/google  — Google redirects the user here after consent.
 * ============================================================================
 *
 * This is the second leg of the OAuth flow. Google sends a `code` (one-time
 * use, expires in ~10 minutes) and the `state` value we sent at login.
 *
 * Steps:
 *   1. Verify `state` matches our cookie (CSRF defense — see login route).
 *   2. Exchange the `code` for tokens (server-to-server call to Google).
 *   3. Decode the id_token to get the user's stable ID + email.
 *   4. Upsert the user + tokens into Supabase (insert if new, update if exists).
 *   5. Create a session and set the session cookie.
 *   6. Send the user back to the homepage, now "logged in".
 *
 * If anything goes wrong we send them to the homepage with an error flag in
 * the URL so the UI can show a message.
 */

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Google sometimes sends error=access_denied if the user clicks "Cancel".
  if (error) {
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${origin}/?auth_error=missing_params`);
  }

  // CSRF check: the state in the URL must match the state we stored in a cookie
  // at login time. If they don't match, this callback wasn't initiated by us.
  const expectedState = await getOAuthStateCookie();
  if (!expectedState || expectedState !== state) {
    return NextResponse.redirect(`${origin}/?auth_error=state_mismatch`);
  }
  await clearOAuthStateCookie();

  try {
    // ----- Leg 2: trade the code for tokens -----
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens.id_token) {
      throw new Error("Google did not return an id_token");
    }

    // ----- Decode the id_token to learn WHO logged in -----
    const profile = decodeIdToken(tokens.id_token);
    if (!profile.email || !profile.email_verified) {
      throw new Error("Google did not return a verified email");
    }

    // Compute the expiry as an ISO timestamp string for storage.
    const tokenExpiry = new Date(
      Date.now() + tokens.expires_in * 1000,
    ).toISOString();

    // ----- Leg 2.5: persist the user + tokens to Supabase -----
    //
    // upsert = "update if a row with this id exists, otherwise insert". This
    // handles BOTH first-time login and repeat logins gracefully. We always
    // overwrite the tokens because Google just gave us fresh ones.
    //
    // Edge case: Google only returns a refresh_token the FIRST time a user
    // consents (unless prompt=consent is set, which we DO set). If somehow we
    // don't get one and the user already has one stored, keep the old one.
    const userRow = {
      id: profile.sub,
      email: profile.email,
      access_token: tokens.access_token,
      // Fall back to the existing refresh_token if Google omitted one.
      // (Handled via a separate query below to keep this readable.)
      refresh_token: tokens.refresh_token ?? "",
      token_expiry: tokenExpiry,
    };

    // If Google didn't return a refresh_token, preserve the existing one.
    if (!tokens.refresh_token) {
      const { data: existing } = await supabase
        .from("users")
        .select("refresh_token")
        .eq("id", profile.sub)
        .maybeSingle();
      if (existing?.refresh_token) {
        userRow.refresh_token = existing.refresh_token;
      }
    }

    const { error: upsertError } = await supabase
      .from("users")
      .upsert(userRow, { onConflict: "id" });

    if (upsertError) {
      throw new Error(`Supabase upsert failed: ${upsertError.message}`);
    }

    // ----- Leg 3: create our own session so future requests know who's here -----
    await createSession(profile.sub);

    // Done — send them home, now logged in.
    return NextResponse.redirect(`${origin}/?auth_success=1`);
  } catch (err) {
    console.error("[callback] OAuth failed:", err);
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.redirect(
      `${origin}/?auth_error=${encodeURIComponent(message)}`,
    );
  }
}

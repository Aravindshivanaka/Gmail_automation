import "server-only";
import type { GoogleTokenResponse, GoogleIdTokenPayload, User } from "./types";
import { InvalidClientError, isDeletedClientError } from "./token-recovery";

/**
 * ============================================================================
 * GOOGLE OAUTH 2.0 CLIENT
 * ============================================================================
 *
 * This module is the single place that knows how to talk to Google's OAuth
 * servers. Keeping it isolated makes the auth flow easy to reason about and
 * easy to swap/test later.
 *
 * The OAuth 2.0 flow we use is called "Authorization Code with PKCE-friendly
 * server flow". At a high level it has 3 legs:
 *
 *   1. LOGIN     — we send the user to Google. They log in + approve our scopes.
 *                  Google redirects them back to us with a one-time `code`.
 *   2. CALLBACK  — we trade that `code` (plus our secret) for long-lived
 *                  access_token + refresh_token. We store both in Supabase.
 *   3. REFRESH   — access_token expires after ~1 hour. When that happens we
 *                  use refresh_token to silently get a new one. The user never
 *                  has to log in again.
 *
 * We talk to two different Google endpoints:
 *   - accounts.google.com  — for login/consent (humans in a browser)
 *   - oauth2.googleapis.com — for token exchange (our server talking to Google)
 * ============================================================================
 */

// -----------------------------------------------------------------------------
// 1. Constants — the OAuth scopes we request.
// -----------------------------------------------------------------------------

/**
 * Scopes = the permissions we ask the user to grant. We request the MINIMUM
 * needed for the platform's planned features, per Google's best practices.
 *
 *   https://www.googleapis.com/auth/gmail.readonly
 *     Read inbox, threads, messages, and labels. Read-only.
 *
 *   https://www.googleapis.com/auth/gmail.send
 *     Send email on the user's behalf.
 *
 *   https://www.googleapis.com/auth/gmail.modify
 *     Create/apply/remove labels (e.g. mark an email "AI: Follow-up"). Note:
 *     gmail.modify DOES include readonly too, but listing both explicitly is
 *     clearer for reviewers and future-you.
 *
 *   openid email profile
 *     Standard OpenID scopes so we get the user's stable ID + email back.
 */
export const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
] as const;

// -----------------------------------------------------------------------------
// 2. Config validation — fail fast if env vars are missing.
// -----------------------------------------------------------------------------

function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing Google OAuth env vars. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, " +
        "and GOOGLE_REDIRECT_URI in .env.local",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

// -----------------------------------------------------------------------------
// 3. LOGIN step — build the consent-screen URL.
// -----------------------------------------------------------------------------

/**
 * Builds the Google OAuth consent URL the user is sent to.
 *
 * Query params explained:
 *   client_id     — tells Google WHICH app is asking (identifies our project)
 *   redirect_uri  — where Google sends the user AFTER they approve. Must match
 *                   exactly what's registered in Google Cloud Console.
 *   response_type=code  — we want an authorization code (not an implicit token)
 *   scope         — space-separated permissions we're requesting
 *   access_type=offline  — REQUIRED to get a refresh_token back
 *   prompt=consent       — forces Google to issue a fresh refresh_token even if
 *                   the user has logged in before (helps avoid the "no refresh
 *                   token returned" edge case during development)
 *   include_granted_scopes=true — if we add scopes later, the user only has to
 *                   approve the NEW ones; previously granted ones carry over
 */
export function buildAuthUrl(state: string): string {
  const { clientId, redirectUri } = getGoogleConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    // `state` is an anti-CSRF token. We send a random value, store it in a
    // cookie, and verify it matches when the callback comes back. Prevents
    // someone from tricking you into connecting THEIR google account.
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// -----------------------------------------------------------------------------
// 4. CALLBACK step — exchange the code for tokens.
// -----------------------------------------------------------------------------

/**
 * Trades the one-time `code` for real tokens. This is a server-to-server call:
 * it includes our client_secret, so it must NEVER happen in the browser.
 *
 * Returns access_token (1 hour), refresh_token (long-lived), and an id_token
 * (JWT containing the user's email + stable ID).
 */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getGoogleConfig();

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${detail}`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/**
 * Decodes the `id_token` (a JWT) Google returns to extract the user's email
 * and stable ID. A JWT is base64-encoded JSON in three dot-separated parts;
 * the middle part is the payload. We don't need to verify the signature here
 * because we JUST received this token directly from Google over HTTPS — there
 * is no opportunity for it to have been tampered with.
 */
export function decodeIdToken(idToken: string): GoogleIdTokenPayload {
  const payloadB64 = idToken.split(".")[1];
  // JWT uses base64url; convert to standard base64 before decoding.
  const fixed = payloadB64.replace(/-/g, "+").replace(/_/g, "/");
  const json = Buffer.from(fixed, "base64").toString("utf8");
  return JSON.parse(json) as GoogleIdTokenPayload;
}

// -----------------------------------------------------------------------------
// 5. REFRESH step — get a new access token using the refresh token.
// -----------------------------------------------------------------------------

/**
 * When the access_token expires (~1 hour), we call this with the stored
 * refresh_token. Google returns a fresh access_token. The refresh_token
 * itself stays valid (Google refresh tokens don't expire unless the user
 * revokes access, removes the app, or changes password).
 *
 * Returns the new token + its expiry as an ISO timestamp.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{ accessToken: string; expiryIso: string }> {
  const { clientId, clientSecret } = getGoogleConfig();

  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const detail = await res.text();

    // If the issuing OAuth client was deleted/rotated, the refresh token is
    // permanently unusable. Throw a TAGGED error so the route layer can catch
    // it specifically and force re-auth, instead of looping on retries or
    // showing a confusing 401 to the user.
    if (res.status === 401 && isDeletedClientError(detail)) {
      throw new InvalidClientError(
        `Token refresh rejected with deleted_client (user re-auth required)`,
      );
    }
    throw new Error(`Token refresh failed (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    expiryIso: newIsoExpiry(data.expires_in),
  };
}

// -----------------------------------------------------------------------------
// 6. "Get me a valid token, refreshing if needed" — the convenience helper.
// -----------------------------------------------------------------------------

/**
 * The main entry point the rest of the app uses. Given a user row, returns a
 * VALID access token. If the stored one is still good, returns it. If it has
 * expired (or is about to), refreshes it, updates Supabase, and returns the
 * new one.
 *
 * We refresh proactively when <60s remain, so a slow Gmail API call doesn't
 * start with a token that dies mid-request.
 */
export async function getValidAccessToken(user: User): Promise<string> {
  const now = Date.now();
  const expiryMs = Date.parse(user.token_expiry);
  const safetyMarginMs = 60 * 1000; // 1 minute

  if (now < expiryMs - safetyMarginMs) {
    return user.access_token; // still fresh — use as-is
  }

  // Expired (or about to): refresh and persist the new token.
  const { accessToken, expiryIso } = await refreshAccessToken(user.refresh_token);

  // Note: we import supabase lazily here to keep this module decoupled from
  // the DB layer. A small bit of indirection in exchange for cleaner tests.
  const { supabase } = await import("./supabase");
  const { error } = await supabase
    .from("users")
    .update({ access_token: accessToken, token_expiry: expiryIso })
    .eq("id", user.id);

  if (error) {
    // The refresh succeeded, so the in-memory token is still usable for this
    // request — but we warn because next time we'll refresh again.
    console.warn("[google] failed to persist refreshed token:", error.message);
  }
  return accessToken;
}

/** Builds an ISO expiry timestamp `secondsFromNow` seconds in the future. */
function newIsoExpiry(secondsFromNow: number): string {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString();
}

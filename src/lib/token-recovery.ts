import "server-only";
import { supabase } from "./supabase";

/**
 * ============================================================================
 * TOKEN RECOVERY (added after a Google OAuth client rotation)
 * ============================================================================
 *
 * Context: when a Google OAuth client is deleted in Google Cloud Console
 * (e.g. because its credentials were exposed), Google immediately invalidates
 * every token that client ever issued. Any refresh attempt against the token
 * endpoint then returns:
 *
 *     HTTP 401
 *     { "error": "deleted_client", "error_description": "...has been deleted" }
 *
 * No retry will ever help — the refresh token is permanently dead. The only
 * recovery is for the user to re-authenticate with the NEW client and get
 * fresh tokens.
 *
 * This module centralizes the two things we must do when that happens:
 *   1. clearInvalidTokens(user)  — null out the user's token columns so we
 *      don't keep retrying with known-bad tokens, while preserving the row
 *      itself + all their synced messages/threads (the Google `sub` is stable
 *      across re-auth, so logging back in updates the SAME user row).
 *   2. InvalidClientError         — a typed marker the OAuth/Gmail layers
 *      throw so the API routes can catch it specifically and redirect to
 *      login, rather than showing a confusing "401 deleted_client" banner.
 * ============================================================================
 */

/**
 * Typed error thrown by google.ts / gmail.ts when Google rejects a token
 * because the issuing OAuth client no longer exists. Catch it at the route
 * boundary with `instanceof InvalidClientError`.
 */
export class InvalidClientError extends Error {
  constructor(message = "Google OAuth client was deleted/invalidated") {
    super(message);
    this.name = "InvalidClientError";
  }
}

/**
 * Returns true if an error body / message indicates Google's
 * `deleted_client` (or the equivalent `invalid_client`) condition.
 *
 * We check the raw text rather than parsing JSON, because the error can
 * surface from two different Google endpoints (token refresh and the Gmail
 * API) and in slightly different shapes. A substring check on the error code
 * is robust to both.
 */
export function isDeletedClientError(detail: string): boolean {
  const lower = detail.toLowerCase();
  return (
    lower.includes("deleted_client") || lower.includes("invalid_client")
  );
}

/**
 * Nulls out the token columns for a user. Does NOT delete the row — we keep
 * the user (and their synced data) intact so that when they log back in with
 * the new client, the callback's upsert updates the same row via its `id`.
 *
 * Safe to call multiple times; no-op if the user has no tokens.
 */
export async function clearInvalidTokens(userId: string): Promise<void> {
  const { error } = await supabase
    .from("users")
    .update({
      access_token: null,
      refresh_token: null,
      token_expiry: null,
    })
    .eq("id", userId);

  if (error) {
    // We log but don't throw — the caller is already handling a failure path,
    // and we still want to send the user to re-login regardless.
    console.warn(
      `[token-recovery] could not clear tokens for ${userId}: ${error.message}`,
    );
  } else {
    console.log(`[token-recovery] cleared invalid tokens for user ${userId}`);
  }
}

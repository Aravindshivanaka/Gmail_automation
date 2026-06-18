/**
 * Shared TypeScript types.
 *
 * TypeScript is a layer on top of JavaScript that lets us describe the *shape*
 * of data. These `type` definitions act as a contract: if any code tries to
 * store a user without an `email`, TypeScript will flag it before we ever run
 * the app. That catches a huge class of bugs at build time instead of runtime.
 */

/** A row in the `users` table in Supabase. Mirrors supabase/schema.sql. */
export interface User {
  /** Stable Google subject ID (the "sub" from their profile). Primary key. */
  id: string;
  /** The user's Gmail address. */
  email: string;
  /** OAuth access token — short-lived (1 hour). Used to call the Gmail API. */
  access_token: string;
  /** OAuth refresh token — long-lived. Used to silently get a new access_token. */
  refresh_token: string;
  /** ISO timestamp string of when access_token expires. */
  token_expiry: string;
  /** ISO timestamp string of when the row was created. */
  created_at: string;
}

/**
 * What the Gmail API returns (the fields we care about) when we exchange the
 * one-time authorization code for real tokens.
 */
export interface GoogleTokenResponse {
  access_token: string;
  refresh_token: string | null;
  /** Lifetime in seconds (usually 3600 = 1 hour). */
  expires_in: number;
  /** Always "Bearer". */
  token_type: string;
  /** Whitespace-separated list of scopes the user actually granted. */
  scope: string;
  /** The user's stable Google ID. We use this as the primary key. */
  id_token?: string;
}

/** The decoded payload of a Google ID token (a JWT). We only read a few fields. */
export interface GoogleIdTokenPayload {
  sub: string; // stable user id
  email: string;
  email_verified: boolean;
}

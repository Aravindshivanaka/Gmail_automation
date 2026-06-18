import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { supabase } from "./supabase";
import type { User } from "./types";

/**
 * ============================================================================
 * SESSION MANAGEMENT — how we remember "you're logged in" between requests.
 * ============================================================================
 *
 * HTTP is stateless: each request arrives with no memory of the last one. To
 * know "who is the current user?" we use a COOKIE.
 *
 * Our approach is simple and secure for Stage 1:
 *   - After OAuth succeeds we generate a random, unguessable string called a
 *     "session token" and store it in BOTH:
 *       (a) an httpOnly cookie on the user's browser, and
 *       (b) the `user_sessions` table in Supabase, mapped to a user id.
 *   - On every request, we read the cookie and look it up. If it matches a row,
 *     that row tells us the user. If not, the visitor is logged out.
 *
 * Why a custom session table instead of Supabase Auth? Supabase's built-in
 * Auth handles *password* / *magic link* logins. We're doing OAuth ourselves
 * (we already have the tokens), so a lightweight session table is simpler and
 * keeps us in full control. We can migrate to Supabase Auth later if needed.
 *
 * SECURITY NOTES:
 *   - Cookie is httpOnly (JS can't read it → harder to steal via XSS).
 *   - Cookie is sameSite=lax (protects against most CSRF on top-level nav).
 *   - Cookie is secure=true in production (only sent over HTTPS).
 *   - The session token is 32 random bytes = 256 bits of entropy, which is
 *     computationally infeasible to guess.
 * ============================================================================
 */

const SESSION_COOKIE = "gip_session"; // name of our cookie
const SESSION_TTL_DAYS = 30; // how long a login lasts before re-auth

// -----------------------------------------------------------------------------
// 1. Create a session after OAuth success.
// -----------------------------------------------------------------------------

/**
 * Called from the OAuth callback after we've stored the user's tokens. Creates
 * a fresh session row and sets the cookie so subsequent requests know who's
 * logged in. Returns the user we just logged in.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex"); // 64-char hex string
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400 * 1000);

  // Persist the session → user mapping.
  const { error } = await supabase.from("user_sessions").insert({
    token,
    user_id: userId,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`Failed to create session: ${error.message}`);

  // Set the cookie. `cookies()` is Next.js's server-side cookie jar.
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

// -----------------------------------------------------------------------------
// 2. Read the current user (or null) on any server request.
// ------------------------------------------------------------------------------

/**
 * Reads the session cookie, looks it up in Supabase, and returns the user if
 * the session is valid and unexpired. Returns `null` for anonymous visitors.
 *
 * This is the function pages/routes call to answer "who's logged in?".
 */
export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  // Join sessions → users in one query so we get the full user row back.
  // We cast through `unknown` because our Supabase client isn't typed against
  // the DB schema yet (no generated types); TS can't prove the join's shape.
  // The `as unknown as User` is our explicit, reviewable assertion of that.
  const { data, error } = await supabase
    .from("user_sessions")
    .select("user:users(*)")
    .eq("token", token)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.warn("[session] lookup error:", error.message);
    return null;
  }
  if (!data || !data.user) return null;
  return data.user as unknown as User;
}

// -----------------------------------------------------------------------------
// 3. Destroy the session on logout.
// -----------------------------------------------------------------------------

/**
 * Deletes the session row AND clears the cookie. Called from /api/auth/disconnect.
 */
export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  if (token) {
    await supabase.from("user_sessions").delete().eq("token", token);
  }
  jar.delete(SESSION_COOKIE);
}

// -----------------------------------------------------------------------------
// 4. CSRF state token helpers (used by the login route).
// ------------------------------------------------------------------------------

/**
 * Generates + stores a one-time `state` value used to protect the OAuth
 * callback from CSRF. We stash it in a short-lived cookie; the callback route
 * checks it matches what Google sends back.
 */
export async function setOAuthStateCookie(): Promise<string> {
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("gip_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60, // 10 minutes is plenty for a login dance
  });
  return state;
}

/** Reads the state cookie (or null). */
export async function getOAuthStateCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get("gip_oauth_state")?.value ?? null;
}

/** Clears the state cookie after we've consumed it. */
export async function clearOAuthStateCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete("gip_oauth_state");
}

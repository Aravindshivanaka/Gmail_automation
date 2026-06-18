import { NextResponse } from "next/server";
import { getCurrentUser, destroySession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

/**
 * ============================================================================
 * POST /api/auth/disconnect  — logs the user out.
 * ============================================================================
 *
 * "Disconnect" does two things:
 *   1. (Optional) Deletes the user row + tokens from Supabase, so we forget
 *      their Gmail access entirely. Comment out the delete block if you'd
 *      rather keep the data and only clear the session.
 *   2. Destroys the session — deletes the session row and clears the cookie.
 *
 * Note: this does NOT revoke the tokens at Google's side. If you want a full
 * "revoke access" (so Google shows the app as removed from the user's account
 * page), you'd additionally call:
 *   POST https://oauth2.googleapis.com/revoke?token={refresh_token}
 * That's left out of Stage 1 to keep things simple, but flagged here so you
 * know what a complete disconnect would look like.
 */

export async function POST() {
  const user = await getCurrentUser();

  // If we know who they are, wipe their stored tokens. If you'd rather keep
  // the user data and only end the browser session, delete this block.
  if (user) {
    await supabase.from("users").delete().eq("id", user.id);
  }

  // End the browser session regardless.
  await destroySession();

  return NextResponse.redirect(new URL("/", "http://localhost:3000"));
}

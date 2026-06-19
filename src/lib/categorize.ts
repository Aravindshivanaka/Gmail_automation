import "server-only";
import type { Category } from "./gemini";
import { classifyEmail } from "./gemini";
import { supabase } from "./supabase";

/**
 * ============================================================================
 * CATEGORIZATION ORCHESTRATION (Stage 3)
 * ============================================================================
 *
 * This module glues the Gemini classifier to our database. The single work
 * function is `categorizeUserEmails(userId)`:
 *
 *   1. Query Supabase for messages with category IS NULL (not yet done).
 *   2. Process them in small BATCHES (default 10) with a short delay between
 *      batches, to stay well under Gemini's per-minute rate limit.
 *   3. For each message, call Gemini, then UPDATE that message's category.
 *   4. Return a summary of how many were classified and per-category counts.
 *
 * It also exposes read helpers (`getCategoryCounts`, `getRecentMessages`) used
 * by the homepage to show the breakdown and the tagged email list.
 *
 * WHY BATCH + DELAY instead of firing all requests at once?
 *   Gemini's free tier limits requests per minute (RPM). If you throw 200
 *   categorization requests at it simultaneously you'll get 429s. Batching to
 *   10 and pausing ~1s between batches keeps throughput smooth and well within
 *   free-tier limits. The batch size + delay are constants at the bottom of
 *   this file — easy to tune.
 * ============================================================================
 */

// -----------------------------------------------------------------------------
// Result type returned to the API route.
// -----------------------------------------------------------------------------

export interface CategorizeResult {
  categorized: number;
  /** How many of the just-categorized messages landed in each category. */
  byCategory: Record<string, number>;
  /** How many uncategorized messages remain (e.g. if a batch hit errors). */
  remaining: number;
  /** Did we stop early because we ran out of uncategorized messages? */
  moreRemaining: boolean;
}

// -----------------------------------------------------------------------------
// Work function: classify all uncategorized messages for a user.
// -----------------------------------------------------------------------------

/**
 * Finds messages with no category and classifies them via Gemini, in batches.
 *
 * Returns counts of what happened. Safe to call repeatedly — it only ever
 * touches rows where category IS NULL, so re-runs just pick up new arrivals.
 */
export async function categorizeUserEmails(userId: string): Promise<CategorizeResult> {
  const byCategory: Record<string, number> = {};
  let categorized = 0;

  // Loop: pull a batch, classify it, then check if there's another batch.
  // We re-query each iteration (rather than loading all up front) so memory
  // stays bounded even for huge inboxes.
  let moreRemaining = true;
  let safetyBatches = 0;
  const MAX_BATCHES = 200; // hard cap to avoid an accidental infinite loop

  while (moreRemaining && safetyBatches < MAX_BATCHES) {
    safetyBatches++;

    // Fetch up to BATCH_SIZE uncategorized messages for this user.
    const { data: batch, error } = await supabase
      .from("messages")
      .select("id, subject, snippet")
      .eq("user_id", userId)
      .is("category", null)
      .order("received_at", { ascending: false, nullsFirst: false })
      .limit(BATCH_SIZE);

    if (error) throw new Error(`Supabase select failed: ${error.message}`);
    if (!batch || batch.length === 0) {
      moreRemaining = false;
      break;
    }

    console.log(
      `[categorize] user ${userId}: processing batch ${safetyBatches} (${batch.length} messages)`,
    );

    // Classify each message in the batch. We do these sequentially (not in
    // parallel) to keep request rate low — combined with the inter-batch
    // delay this is the gentlest possible load on Gemini's free tier.
    for (const msg of batch) {
      try {
        const category = await classifyEmail(msg.subject ?? "", msg.snippet ?? "");
        await writeCategory(userId, msg.id, category);
        categorized++;
        byCategory[category] = (byCategory[category] ?? 0) + 1;
      } catch (err) {
        // Don't let one bad message kill the whole run — log and skip. The
        // message stays category=NULL and will be retried next time.
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(
          `[categorize] failed on message ${msg.id}: ${reason} — skipping`,
        );
      } finally {
        // Proactively add a 6.0s delay between individual calls to respect rate limits
        console.log(`[categorize] sleeping 6000ms...`);
        await sleep(6000);
      }
    }

    // Pause between batches. If this was the final partial batch, no need.
    if (batch.length === BATCH_SIZE) {
      console.log(`[categorize] pausing ${INTER_BATCH_DELAY_MS}ms between batches`);
      await sleep(INTER_BATCH_DELAY_MS);
    } else {
      moreRemaining = false;
    }
  }

  // How many are still uncategorized after this run?
  const remaining = await countUncategorized(userId);

  return {
    categorized,
    byCategory,
    remaining,
    moreRemaining,
  };
}

// -----------------------------------------------------------------------------
// Read helpers (used by the homepage).
// ------------------------------------------------------------------------------

/**
 * Returns a count per category for the user, across all categorized messages.
 * Only includes categories that have at least one message.
 */
export async function getCategoryCounts(
  userId: string,
): Promise<{ category: string; count: number }[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("category")
    .eq("user_id", userId)
    .not("category", "is", null);

  if (error) {
    console.warn("[categorize] getCategoryCounts error:", error.message);
    return [];
  }

  // Tally client-side. (Supabase's RPC/grouping needs an SQL view; a simple
  // JS reduce is clearer and avoids schema coupling for Stage 3.)
  const tally = new Map<string, number>();
  for (const row of data ?? []) {
    const c = row.category as string;
    tally.set(c, (tally.get(c) ?? 0) + 1);
  }
  // Return in a stable order (matches CATEGORIES list) for consistent UI.
  const { CATEGORIES } = await import("./gemini");
  return CATEGORIES.filter((c) => tally.has(c)).map((c) => ({
    category: c,
    count: tally.get(c)!,
  }));
}

/**
 * Returns the most recent N messages for the homepage list, with their
 * category. Used to render the tagged email list (Stage 3 requirement #4).
 */
export async function getRecentMessages(
  userId: string,
  limit = 20,
): Promise<
  {
    id: string;
    subject: string | null;
    sender: string | null;
    received_at: string | null;
    category: Category | null;
    summary?: string | null;
  }[]
> {
  const { data, error } = await supabase
    .from("messages")
    .select("id, subject, sender, received_at, category, summary")
    .eq("user_id", userId)
    .order("received_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    console.warn("[categorize] getRecentMessages error:", error.message);
    return [];
  }
  return (data ?? []) as Array<{
    id: string;
    subject: string | null;
    sender: string | null;
    received_at: string | null;
    category: Category | null;
    summary: string | null;
  }>;
}

// -----------------------------------------------------------------------------
// Internal helpers.
// ------------------------------------------------------------------------------

/** Updates one message's category. Logs on failure but doesn't throw. */
async function writeCategory(
  userId: string,
  messageId: string,
  category: Category,
): Promise<void> {
  const { error } = await supabase
    .from("messages")
    .update({ category })
    .eq("user_id", userId)
    .eq("id", messageId);

  if (error) {
    console.warn(
      `[categorize] failed to write category for ${messageId}: ${error.message}`,
    );
  }
}

/** Counts messages still awaiting categorization. */
async function countUncategorized(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("category", null);

  if (error) {
    console.warn("[categorize] count error:", error.message);
    return 0;
  }
  return count ?? 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// Tunable constants.
// -----------------------------------------------------------------------------
const BATCH_SIZE = 10; // messages per Gemini batch
const INTER_BATCH_DELAY_MS = 1000; // pause between batches to respect rate limits

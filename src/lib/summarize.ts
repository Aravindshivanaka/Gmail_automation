import "server-only";
import { supabase } from "./supabase";
import { summarizeEmail, summarizeThread } from "./gemini";

// -----------------------------------------------------------------------------
// Tunable constants (matching categorization pacing for rate-limit safety)
// -----------------------------------------------------------------------------
const BATCH_SIZE = 10;
const INTER_CALL_DELAY_MS = 6000; // 6-second delay between individual AI calls

export interface SummarizeMessagesResult {
  summarized: number;
  remaining: number;
  moreRemaining: boolean;
}

export interface SummarizeThreadsResult {
  summarized: number;
  remaining: number;
  moreRemaining: boolean;
}

/** Helper sleep function. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// 1. Message-level summarization orchestrator
// -----------------------------------------------------------------------------

export async function summarizeUserMessages(userId: string): Promise<SummarizeMessagesResult> {
  let summarized = 0;
  let moreRemaining = true;
  let safetyBatches = 0;
  const MAX_BATCHES = 20; // safe cap for a single request invocation

  while (moreRemaining && safetyBatches < MAX_BATCHES) {
    safetyBatches++;

    // Fetch a batch of unsummarized messages for this user
    const { data: batch, error } = await supabase
      .from("messages")
      .select("id, subject, sender, body_text, snippet")
      .eq("user_id", userId)
      .is("summary", null)
      .order("received_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (error) {
      throw new Error(`Supabase select for unsummarized messages failed: ${error.message}`);
    }

    if (!batch || batch.length === 0) {
      moreRemaining = false;
      break;
    }

    console.log(
      `[summarize-messages] user ${userId}: processing batch ${safetyBatches} (${batch.length} messages)`
    );

    for (const msg of batch) {
      try {
        // Choose body_text if it has enough content (>= 50 chars), otherwise fallback to snippet
        const textToSummarize =
          (msg.body_text ?? "").trim().length >= 50
            ? msg.body_text!
            : (msg.snippet ?? "");

        const summary = await summarizeEmail(
          msg.subject ?? "",
          msg.sender ?? "Unknown Sender",
          textToSummarize
        );

        // Update the message's summary column in Supabase
        const { error: updateError } = await supabase
          .from("messages")
          .update({ summary })
          .eq("user_id", userId)
          .eq("id", msg.id);

        if (updateError) {
          console.warn(`[summarize-messages] failed to write summary for ${msg.id}: ${updateError.message}`);
        } else {
          summarized++;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[summarize-messages] failed on message ${msg.id}: ${reason} — skipping`);
      } finally {
        // Proactively delay to prevent hitting Gemini rate limits
        console.log(`[summarize-messages] sleeping ${INTER_CALL_DELAY_MS}ms...`);
        await sleep(INTER_CALL_DELAY_MS);
      }
    }

    if (batch.length < BATCH_SIZE) {
      moreRemaining = false;
    }
  }

  // Count remaining unsummarized messages
  const { count: remaining, error: countError } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("summary", null);

  if (countError) {
    console.warn(`[summarize-messages] failed to count remaining: ${countError.message}`);
  }

  return {
    summarized,
    remaining: remaining ?? 0,
    moreRemaining: moreRemaining && (remaining ?? 0) > 0,
  };
}

// -----------------------------------------------------------------------------
// 2. Thread-level summarization orchestrator
// -----------------------------------------------------------------------------

export async function summarizeUserThreads(userId: string): Promise<SummarizeThreadsResult> {
  let summarized = 0;
  let moreRemaining = true;
  let safetyBatches = 0;
  const MAX_BATCHES = 20;

  while (moreRemaining && safetyBatches < MAX_BATCHES) {
    safetyBatches++;

    // Fetch a batch of unsummarized threads for this user
    const { data: batch, error } = await supabase
      .from("threads")
      .select("id, subject")
      .eq("user_id", userId)
      .is("summary", null)
      .order("last_message_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (error) {
      throw new Error(`Supabase select for unsummarized threads failed: ${error.message}`);
    }

    if (!batch || batch.length === 0) {
      moreRemaining = false;
      break;
    }

    console.log(
      `[summarize-threads] user ${userId}: processing batch ${safetyBatches} (${batch.length} threads)`
    );

    for (const thread of batch) {
      try {
        // Fetch all messages belonging to this thread, ordered chronologically (oldest first)
        const { data: messages, error: messagesError } = await supabase
          .from("messages")
          .select("sender, subject, body_text, snippet, received_at")
          .eq("user_id", userId)
          .eq("thread_id", thread.id)
          .order("received_at", { ascending: true });

        if (messagesError) {
          throw new Error(`Failed to fetch messages for thread ${thread.id}: ${messagesError.message}`);
        }

        if (!messages || messages.length === 0) {
          console.warn(`[summarize-threads] thread ${thread.id} has no messages — skipping`);
          continue;
        }

        // Concatenate messages into one conversation arc view
        const conversationText = messages
          .map((m, idx) => {
            const body =
              (m.body_text ?? "").trim().length >= 50
                ? m.body_text!
                : (m.snippet ?? "");

            return [
              `[Message #${idx + 1}]`,
              `From: ${m.sender ?? "Unknown Sender"}`,
              `Subject: ${m.subject ?? "(no subject)"}`,
              `Date: ${m.received_at ? new Date(m.received_at).toLocaleString() : "Unknown"}`,
              `Content: ${body}`,
              `--------------------------------------------------`,
            ].join("\n");
          })
          .join("\n\n");

        const summary = await summarizeThread(thread.subject ?? "(no subject)", conversationText);

        // Update the thread's summary column in Supabase
        const { error: updateError } = await supabase
          .from("threads")
          .update({ summary })
          .eq("user_id", userId)
          .eq("id", thread.id);

        if (updateError) {
          console.warn(`[summarize-threads] failed to write summary for thread ${thread.id}: ${updateError.message}`);
        } else {
          summarized++;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[summarize-threads] failed on thread ${thread.id}: ${reason} — skipping`);
      } finally {
        // Proactively delay to prevent hitting Gemini rate limits
        console.log(`[summarize-threads] sleeping ${INTER_CALL_DELAY_MS}ms...`);
        await sleep(INTER_CALL_DELAY_MS);
      }
    }

    if (batch.length < BATCH_SIZE) {
      moreRemaining = false;
    }
  }

  // Count remaining unsummarized threads
  const { count: remaining, error: countError } = await supabase
    .from("threads")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("summary", null);

  if (countError) {
    console.warn(`[summarize-threads] failed to count remaining: ${countError.message}`);
  }

  return {
    summarized,
    remaining: remaining ?? 0,
    moreRemaining: moreRemaining && (remaining ?? 0) > 0,
  };
}

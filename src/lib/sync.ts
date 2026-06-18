import "server-only";
import type { User } from "./types";
import { getValidAccessToken } from "./google";
import {
  listMessageIds,
  getMessage,
  getMailboxHistoryId,
  listHistory,
  type GmailMessageFull,
  type GmailMessagePart,
} from "./gmail";
import { supabase } from "./supabase";

/**
 * ============================================================================
 * SYNC ORCHESTRATION
 * ============================================================================
 *
 * This module is the "fetch → parse → store" pipeline that turns raw Gmail
 * API responses into rows in our Supabase tables. It is shared by both API
 * routes:
 *
 *   /api/sync/full         → syncInbox(user)         [first-time / catch-up]
 *   /api/sync/incremental  → syncInboxIncremental(user)
 *
 * The Gmail-facing details (HTTP, pagination, backoff) live in ./gmail.ts.
 * This file only handles: parsing MIME bodies, grouping into threads, and
 * writing to the database.
 * ============================================================================
 */

// -----------------------------------------------------------------------------
// Result type returned by both sync functions.
// -----------------------------------------------------------------------------

export interface SyncResult {
  messagesSynced: number;
  threadsTouched: number;
  /** Newest historyId we stored as the checkpoint. */
  historyId: string;
  /** Did the incremental sync fall back to full because history was lost? */
  fellBackToFull?: boolean;
}

// -----------------------------------------------------------------------------
// FULL SYNC
// -----------------------------------------------------------------------------

/**
 * Downloads the entire mailbox (messages.list, paginated) and stores every
 * message + its thread. Used the first time a user connects, or as a fallback
 * when incremental sync can't proceed (e.g. the stored historyId is too old).
 *
 * This is potentially a LOT of API calls: 1 list call per 100 messages, plus
 * 1 get call per message. For a 10,000-message inbox that's ~10,100 calls.
 * Gmail's default quota is 250 quota units/sec and 1.5B/day — plenty, but the
 * rate-limit retry in gmailFetch() will smooth out bursts.
 */
export async function syncInbox(user: User): Promise<SyncResult> {
  // 1. Make sure we have a valid access token (refresh if expired).
  const accessToken = await getValidAccessToken(user);

  // 2. List every message id. This walks ALL pages via the pagination loop
  //    inside listMessageIds().
  console.log(`[sync] full: listing message ids for user ${user.id}`);
  const refs = await listMessageIds(accessToken);
  console.log(`[sync] full: found ${refs.length} messages, fetching each...`);

  // 3. Fetch each message's full content and store it. We track which thread
  //    ids we've seen so we can upsert a threads row per conversation.
  const threadSubjects = new Map<string, string>();
  const threadLastAt = new Map<string, number>();
  const threadSnippet = new Map<string, string>();
  let messagesSynced = 0;

  for (const ref of refs) {
    const msg = await getMessage(accessToken, ref.id);
    const parsed = parseMessage(msg);

    // Track the latest info for this thread (newest message wins).
    const ts = parsed.receivedAtMs ?? 0;
    if (!threadLastAt.has(ref.threadId) || ts > (threadLastAt.get(ref.threadId) ?? 0)) {
      threadLastAt.set(ref.threadId, ts);
      threadSubjects.set(ref.threadId, parsed.subject ?? "");
      threadSnippet.set(ref.threadId, parsed.snippet ?? "");
    }

    await storeMessage(user.id, ref.threadId, msg, parsed);
    messagesSynced++;

    if (messagesSynced % 100 === 0) {
      console.log(`[sync] full: stored ${messagesSynced}/${refs.length}`);
    }
  }

  // 4. Upsert a threads row for every conversation we touched.
  for (const threadId of threadLastAt.keys()) {
    await upsertThread({
      user_id: user.id,
      id: threadId,
      subject: threadSubjects.get(threadId) ?? null,
      last_message_at: threadLastAt.get(threadId)
        ? new Date(threadLastAt.get(threadId)!).toISOString()
        : null,
      snippet: threadSnippet.get(threadId) ?? null,
    });
  }

  // 5. Capture the mailbox's current historyId so the NEXT sync is incremental.
  const historyId = await getMailboxHistoryId(accessToken);
  await saveSyncState(user.id, historyId);

  console.log(
    `[sync] full: done — ${messagesSynced} messages, ${threadLastAt.size} threads, ` +
      `historyId=${historyId}`,
  );

  return {
    messagesSynced,
    threadsTouched: threadLastAt.size,
    historyId,
  };
}

// -----------------------------------------------------------------------------
// INCREMENTAL SYNC
// -----------------------------------------------------------------------------

/**
 * Fetches only NEW messages since the last sync, using Gmail's history.list.
 * Far cheaper than a full sync — typically just a handful of new emails.
 *
 * If no sync_state exists yet (user never did a full sync), or Gmail says the
 * stored historyId is too old to serve history from, we transparently fall
 * back to a full sync.
 */
export async function syncInboxIncremental(user: User): Promise<SyncResult> {
  // Load the stored checkpoint.
  const { data: state } = await supabase
    .from("sync_state")
    .select("history_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!state?.history_id) {
    // Never synced before — must do a full sync first.
    console.log("[sync] incremental: no sync_state, falling back to full");
    const result = await syncInbox(user);
    return { ...result, fellBackToFull: true };
  }

  const accessToken = await getValidAccessToken(user);

  // Fetch history since the checkpoint. This may throw if the id is too old.
  let history;
  try {
    console.log(
      `[sync] incremental: fetching history since ${state.history_id}`,
    );
    history = await listHistory(accessToken, state.history_id);
  } catch (err) {
    // Gmail returns 404 when the historyId is older than ~1 week. Fall back.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("404")) {
      console.log("[sync] incremental: historyId expired, falling back to full");
      const result = await syncInbox(user);
      return { ...result, fellBackToFull: true };
    }
    throw err;
  }

  // Collect every newly-added message and store it, same as full sync.
  const threadSubjects = new Map<string, string>();
  const threadLastAt = new Map<string, number>();
  const threadSnippet = new Map<string, string>();
  let messagesSynced = 0;
  const seenIds = new Set<string>();

  for (const event of history.history) {
    for (const added of event.messagesAdded ?? []) {
      const msg = added.message;
      if (seenIds.has(msg.id)) continue; // dedupe across history events
      seenIds.add(msg.id);

      const parsed = parseMessage(msg);
      const ts = parsed.receivedAtMs ?? 0;
      const cur = threadLastAt.get(msg.threadId) ?? 0;
      if (ts > cur) {
        threadLastAt.set(msg.threadId, ts);
        threadSubjects.set(msg.threadId, parsed.subject ?? "");
        threadSnippet.set(msg.threadId, parsed.snippet ?? "");
      }
      await storeMessage(user.id, msg.threadId, msg, parsed);
      messagesSynced++;
    }
  }

  // Upsert touched threads.
  for (const threadId of threadLastAt.keys()) {
    await upsertThread({
      user_id: user.id,
      id: threadId,
      subject: threadSubjects.get(threadId) ?? null,
      last_message_at: threadLastAt.get(threadId)
        ? new Date(threadLastAt.get(threadId)!).toISOString()
        : null,
      snippet: threadSnippet.get(threadId) ?? null,
    });
  }

  // Advance the checkpoint to the newest historyId Gmail gave us.
  await saveSyncState(user.id, history.newHistoryId);

  console.log(
    `[sync] incremental: done — ${messagesSynced} new messages, ` +
      `${threadLastAt.size} threads, historyId=${history.newHistoryId}`,
  );

  return {
    messagesSynced,
    threadsTouched: threadLastAt.size,
    historyId: history.newHistoryId,
  };
}

// -----------------------------------------------------------------------------
// MIME PARSING
// -----------------------------------------------------------------------------

/** A message reduced to the fields we want to store. */
interface ParsedMessage {
  sender: string | null;
  recipients: string[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  snippet: string | null;
  receivedAtMs: number | null; // epoch millis
}

/**
 * Walks a Gmail message's MIME tree and pulls out the human-meaningful fields.
 *
 * Email bodies are structured as MIME "parts" — a tree where each node has a
 * mimeType (e.g. text/plain, text/html, multipart/alternative). A typical
 * modern email has a multipart/alternative root with two children: a
 * text/plain part and a text/html part saying the same thing in two formats.
 *
 * We prefer text/plain for bodyText (AI models work best on plain text) and
 * also capture text/html for body_html. Attachments are ignored in Stage 2.
 */
export function parseMessage(msg: GmailMessageFull): ParsedMessage {
  const headers = msg.payload?.headers ?? [];
  const find = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    null;

  const { text, html } = extractBodies(msg.payload);

  // internalDate is epoch-millis as a STRING (Gmail quirk). Parse carefully.
  const receivedAtMs = msg.internalDate ? parseInt(msg.internalDate, 10) : null;

  return {
    sender: find("From"),
    // Combine To + Cc into one recipient list. Split on commas, trim empties.
    recipients: [find("To"), find("Cc")]
      .filter((v): v is string => !!v)
      .flatMap((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
    subject: find("Subject"),
    bodyText: text,
    bodyHtml: html,
    snippet: msg.snippet ?? null,
    receivedAtMs: Number.isFinite(receivedAtMs) ? receivedAtMs : null,
  };
}

/**
 * Recursively walks the MIME part tree collecting the first text/plain and
 * text/html bodies found. Returns whichever parts exist.
 *
 * Gmail encodes body data as base64url. We decode it to a UTF-8 string.
 */
function extractBodies(
  part: GmailMessagePart | undefined,
  acc: { text: string | null; html: string | null } = { text: null, html: null },
): { text: string | null; html: string | null } {
  if (!part) return acc;

  // If this part itself has a usable body, capture it (first match wins).
  if (part.body?.data) {
    const decoded = decodeBase64Url(part.body.data);
    if (part.mimeType === "text/plain" && acc.text === null) {
      acc.text = decoded;
    } else if (part.mimeType === "text/html" && acc.html === null) {
      acc.html = decoded;
    }
  }

  // Recurse into child parts (multipart containers have `parts`).
  for (const child of part.parts ?? []) {
    extractBodies(child, acc);
    if (acc.text !== null && acc.html !== null) break; // got both, stop early
  }
  return acc;
}

/** Decodes Gmail's base64url-encoded body to a UTF-8 string. */
function decodeBase64Url(input: string): string {
  // base64url uses - and _ instead of + and /. Convert back, then pad.
  const standard = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard.padEnd(
    Math.ceil(standard.length / 4) * 4,
    "=",
  );
  return Buffer.from(padded, "base64").toString("utf8");
}

// -----------------------------------------------------------------------------
// DATABASE WRITES
// ------------------------------------------------------------------------------

/** Inserts (or updates) one message row. */
async function storeMessage(
  userId: string,
  threadId: string,
  msg: GmailMessageFull,
  parsed: ParsedMessage,
): Promise<void> {
  // First ensure the thread row exists (the FK requires it). We insert a
  // minimal stub; if a fuller version is upserted later by upsertThread(),
  // it overwrites these placeholders.
  await supabase.from("threads").upsert(
    {
      user_id: userId,
      id: threadId,
      subject: parsed.subject,
      last_message_at: parsed.receivedAtMs
        ? new Date(parsed.receivedAtMs).toISOString()
        : null,
      snippet: parsed.snippet,
    },
    { onConflict: "user_id,id", ignoreDuplicates: true },
  );

  const { error } = await supabase.from("messages").upsert(
    {
      id: msg.id,
      thread_id: threadId,
      user_id: userId,
      sender: parsed.sender,
      recipients: parsed.recipients,
      subject: parsed.subject,
      body_text: parsed.bodyText,
      body_html: parsed.bodyHtml,
      snippet: parsed.snippet,
      labels: msg.labelIds ?? [],
      received_at: parsed.receivedAtMs
        ? new Date(parsed.receivedAtMs).toISOString()
        : null,
    },
    { onConflict: "user_id,id" },
  );
  if (error) {
    console.warn(`[sync] failed to store message ${msg.id}: ${error.message}`);
  }
}

/** Upserts a threads row (used after we know a thread's latest message). */
async function upsertThread(row: {
  user_id: string;
  id: string;
  subject: string | null;
  last_message_at: string | null;
  snippet: string | null;
}): Promise<void> {
  const { error } = await supabase.from("threads").upsert(row, {
    onConflict: "user_id,id",
  });
  if (error) {
    console.warn(`[sync] failed to upsert thread ${row.id}: ${error.message}`);
  }
}

/** Writes the incremental-sync checkpoint. */
async function saveSyncState(userId: string, historyId: string): Promise<void> {
  const { error } = await supabase.from("sync_state").upsert(
    {
      user_id: userId,
      history_id: historyId,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (error) {
    console.warn(`[sync] failed to save sync_state: ${error.message}`);
  }
}

// -----------------------------------------------------------------------------
// COUNTS (used by the homepage to show "X emails, Y threads")
// ------------------------------------------------------------------------------

/**
 * Returns the message + thread counts and last-sync time for the homepage.
 * All nullable so the UI can gracefully handle "never synced".
 */
export async function getSyncStats(
  userId: string,
): Promise<{
  messageCount: number;
  threadCount: number;
  lastSyncedAt: string | null;
}> {
  const [m, t, s] = await Promise.all([
    supabase.from("messages").select("*", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("threads").select("*", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("sync_state").select("last_synced_at").eq("user_id", userId).maybeSingle(),
  ]);

  return {
    messageCount: m.count ?? 0,
    threadCount: t.count ?? 0,
    lastSyncedAt: s.data?.last_synced_at ?? null,
  };
}

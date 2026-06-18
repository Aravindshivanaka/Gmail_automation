import "server-only";

/**
 * ============================================================================
 * GMAIL API CLIENT
 * ============================================================================
 *
 * This module is the ONLY place that talks to the Gmail REST API
 * (https://gmail.googleapis.com/gmail/v1/...). It knows how to:
 *
 *   - listMessageIds()      → paginate the full message list
 *   - getMessage()          → fetch one fully-expanded message
 *   - listHistory()         → paginate changes since a historyId (incremental)
 *   - getMailboxHistoryId() → read the mailbox's current historyId
 *
 * Every call goes through gmailFetch(), which adds:
 *   (a) the user's Bearer access token, and
 *   (b) EXPONENTIAL BACKOFF for 429/403 (rate limit) responses.
 *
 * This module does NOT touch Supabase — it only talks to Gmail. The actual
 * "fetch → store" orchestration lives in src/lib/sync.ts. Keeping these
 * concerns separate makes both easier to test and explain.
 * ============================================================================
 */

/** Base URL of the Gmail REST API. */
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

// -----------------------------------------------------------------------------
// Low-level HTTP helper with rate-limit retry.
// -----------------------------------------------------------------------------

/**
 * Wraps fetch() with two things every Gmail call needs:
 *   1. The `Authorization: Bearer <token>` header (proves who the user is).
 *   2. Automatic retry with EXPONENTIAL BACKOFF on 429 / 403.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS EXPONENTIAL BACKOFF AND WHY DO WE NEED IT?
 * ---------------------------------------------------------------------------
 * Gmail enforces quotas (requests per second / per day). When you exceed them,
 * the API responds with HTTP 429 ("Too Many Requests") or 403 with a
 * "Rate limit exceeded" message. The correct response is NOT to keep hammering
 * — that makes it worse. Instead, you WAIT a bit and try again. If it still
 * fails, wait LONGER. The wait grows exponentially: 1s, 2s, 4s, 8s, 16s.
 *
 *   attempt 1 fails → wait 1s   (2^0 = 1)
 *   attempt 2 fails → wait 2s   (2^1 = 2)
 *   attempt 3 fails → wait 4s   (2^2 = 4)
 *   attempt 4 fails → wait 8s   (2^3 = 8)
 *   attempt 5 fails → GIVE UP and throw (MAX_RETRIES = 5)
 *
 * We also add a small random "jitter" (0–500ms) on top so that, if many
 * requests fail at once, they don't all retry on the exact same tick (which
 * would re-trigger the rate limit). This is a standard pattern.
 *
 * Any non-429/403 error is thrown immediately — backoff only makes sense for
 * rate limits; a 400 (bad request) will fail no matter how often we retry.
 */
const MAX_RETRIES = 5;

async function gmailFetch(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${GMAIL_API}${path}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(init?.headers ?? {}),
      },
    });

    // Retry ONLY on 429 (rate limit) or 403 (often quota/per-user-limit).
    if (res.status === 429 || res.status === 403) {
      if (attempt === MAX_RETRIES) {
        const body = await res.text();
        throw new Error(
          `Gmail rate limit: giving up after ${MAX_RETRIES} retries (last status ${res.status}): ${body}`,
        );
      }
      // Exponential backoff: 2^attempt seconds, plus jitter.
      const baseMs = Math.pow(2, attempt) * 1000;
      const jitterMs = Math.floor(Math.random() * 500);
      const waitMs = baseMs + jitterMs;
      console.log(
        `[gmail] ${res.status} on ${path} — retry ${attempt + 1}/${MAX_RETRIES} ` +
          `after ${waitMs}ms`,
      );
      await sleep(waitMs);
      continue; // try again
    }

    // For any other non-OK status (400, 401, 404, 500...), throw — no retry.
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Gmail API error ${res.status} on ${path}: ${body}`);
    }
    return res;
  }
  // Unreachable — the loop either returns or throws — but TS needs this.
  throw new Error("gmailFetch: exhausted retries unexpectedly");
}

/** Promise-based sleep. Used by the backoff loop. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// -----------------------------------------------------------------------------
// Public Gmail API types (only the fields we read).
// -----------------------------------------------------------------------------

/** A minimal entry in the messages.list response. */
export interface GmailMessageRef {
  id: string;
  threadId: string;
}

/** A history event from history.list. */
export interface GmailHistory {
  id: string; // a new historyId we should store
  messagesAdded?: Array<{ message: GmailMessageFull }>;
  // Gmail's history also has messagesDeleted, labelsAdded, labelsRemoved,
  // etc. For Stage 2 we only handle "messagesAdded" (new emails). Deletions
  // and label changes are tracked-but-ignored for now; a later stage can
  // extend this switch.
}

/** The fully-expanded message object Gmail returns from messages.get. */
export interface GmailMessageFull {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string; // epoch millis as a string
  payload?: GmailMessagePart;
}

/** One node in a message's multipart MIME tree. */
export interface GmailMessagePart {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailMessagePart[];
}

// -----------------------------------------------------------------------------
// 1. FULL SYNC: list all message ids with pagination.
// -----------------------------------------------------------------------------

/**
 * Returns the ids + threadIds of EVERY message in the mailbox (or every
 * message matching `q`, if given).
 *
 * ---------------------------------------------------------------------------
 * THE PAGINATION LOOP — read this if nothing else.
 * ---------------------------------------------------------------------------
 * Gmail's messages.list endpoint caps how many ids it returns per call
 * (default 100, max 500). If there are more, the response includes a
 * `nextPageToken`. To get everything, you must loop:
 *
 *   1. Call list with no page token  → get page 1 + maybe a nextPageToken.
 *   2. While nextPageToken exists:
 *        call list AGAIN with pageToken=nextPageToken → page 2 + new token.
 *   3. Stop when nextPageToken is absent/null — you've reached the last page.
 *
 * This is a "cursor"-style pagination: each token is opaque and points at
 * the next chunk. You cannot skip ahead; you must walk the pages in order.
 *
 * The `maxResults` param sets page size. We use 100 (a reasonable default
 * that balances # of API calls vs. response size).
 */
export async function listMessageIds(
  accessToken: string,
  query?: string,
): Promise<GmailMessageRef[]> {
  const all: GmailMessageRef[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      maxResults: "100",
      // Optional Gmail search query, e.g. "in:inbox newer_than:7d".
      ...(query ? { q: query } : {}),
      ...(pageToken ? { pageToken } : {}),
    });

    const res = await gmailFetch(
      `/users/me/messages?${params}`,
      accessToken,
    );
    const data = (await res.json()) as {
      messages?: GmailMessageRef[];
      nextPageToken?: string;
    };

    if (data.messages?.length) {
      all.push(...data.messages);
      console.log(
        `[gmail] list page: +${data.messages.length} (total so far: ${all.length})`,
      );
    }
    // Advance the cursor. If nextPageToken is missing/empty, the loop ends.
    pageToken = data.nextPageToken;
  } while (pageToken);

  return all;
}

// -----------------------------------------------------------------------------
// 2. Fetch one fully-expanded message.
// -----------------------------------------------------------------------------

/**
 * Fetches a single message with its full payload (headers + bodies).
 *
 * `format=full` returns the parsed MIME tree so we can pull out From/To/
 * Subject and the text body. (format=metadata would skip the body; format=raw
 * gives the raw RFC822 bytes — more than we need.)
 */
export async function getMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessageFull> {
  const res = await gmailFetch(
    `/users/me/messages/${messageId}?format=full`,
    accessToken,
  );
  return (await res.json()) as GmailMessageFull;
}

// -----------------------------------------------------------------------------
// 3. Mailbox history id (used to seed sync_state on first full sync).
// -----------------------------------------------------------------------------

/**
 * Returns the mailbox's current historyId. We store this after a full sync so
 * the NEXT sync can be incremental (history.list starting from here).
 */
export async function getMailboxHistoryId(
  accessToken: string,
): Promise<string> {
  const res = await gmailFetch(`/users/me/profile`, accessToken);
  const data = (await res.json()) as { historyId: string };
  return data.historyId;
}

// -----------------------------------------------------------------------------
// 4. INCREMENTAL SYNC: history.list with pagination.
// -----------------------------------------------------------------------------

/**
 * Returns all history events since `startHistoryId`. Each event may contain
 * `messagesAdded` (new emails). Like messages.list, history.list is paginated
 * via nextPageToken — same loop pattern as listMessageIds().
 *
 * Gmail guarantees history is available back to the startHistoryId for at
 * least 1 week (often longer). If the id is too old, Gmail returns 404 and
 * the caller must fall back to a full sync.
 */
export async function listHistory(
  accessToken: string,
  startHistoryId: string,
): Promise<{ history: GmailHistory[]; newHistoryId: string }> {
  const all: GmailHistory[] = [];
  let pageToken: string | undefined;
  // newestHistoryId captured from each page; the last (newest) one wins.
  let newestHistoryId: string | undefined;

  do {
    const params = new URLSearchParams({
      startHistoryId,
      // Only ask for the history types we act on. Reduces payload size.
      historyTypes: "messageAdded",
      maxResults: "500",
      ...(pageToken ? { pageToken } : {}),
    });

    const res = await gmailFetch(
      `/users/me/history?${params}`,
      accessToken,
    );
    const data = (await res.json()) as {
      history?: GmailHistory[];
      nextPageToken?: string;
      historyId?: string;
    };

    if (data.history?.length) {
      all.push(...data.history);
    }
    pageToken = data.nextPageToken;

    // Each page's historyId is a forward checkpoint. The LAST page we read
    // has the newest one, so we keep overwriting as we go.
    if (data.historyId) {
      newestHistoryId = data.historyId;
    }
  } while (pageToken);

  // If Gmail returned no history at all, the startHistoryId is still valid
  // as the checkpoint (nothing changed). Fall back to it.
  return {
    history: all,
    newHistoryId: newestHistoryId ?? startHistoryId,
  };
}

-- ============================================================================
-- Gmail Intelligence Platform — Stage 2 schema (inbox sync)
-- ============================================================================
--
-- Run this manually in the Supabase SQL Editor (Dashboard → SQL Editor → New
-- query → paste → Run), AFTER schema.sql (Stage 1) has been run. It depends
-- on the `users` table created there.
--
-- This script creates three tables that store a synced copy of the user's
-- Gmail inbox:
--   1. threads     — one row per Gmail conversation (thread)
--   2. messages    — one row per individual email
--   3. sync_state  — tracks where we left off so future syncs are INCREMENTAL
--                    (only fetch what changed since last time) instead of
--                    re-downloading the whole inbox every time
--
-- IDEMPOTENT: safe to re-run because of `if not exists` clauses.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. THREADS TABLE
-- ---------------------------------------------------------------------------
-- A Gmail "thread" is a conversation — an original message plus all its
-- replies. Grouping emails by thread lets the platform answer questions like
-- "show me this conversation" without stitching messages together manually.
--
-- `id` is Gmail's own thread id (a string like "18c4..."). We use it directly
-- as the primary key, scoped per user via (user_id, id).
-- ---------------------------------------------------------------------------

create table if not exists public.threads (
    -- Gmail's thread id. Unique within a mailbox.
    id text not null,

    -- Which user this thread belongs to. Foreign key to Stage 1's users table.
    -- on delete cascade: if a user disconnects (their row is deleted), all
    -- their synced threads vanish too — no orphaned data.
    user_id text not null references public.users(id) on delete cascade,

    -- The subject line of the most recent message in the thread. Gmail threads
    -- share a subject (modulo "Re:"/"Fwd:" prefixes), so we store one.
    subject text,

    -- When the most recent message in this thread arrived. We use this to sort
    -- threads newest-first in the UI, and to detect which thread a new message
    -- should "bump" to the top.
    last_message_at timestamptz,

    -- A short plaintext preview (~200 chars) of the latest message. Lets the
    -- UI show a one-line preview without fetching the full body.
    snippet text,

    -- Row creation time. Defaults to now().
    created_at timestamptz not null default now(),

    -- A thread id is only unique within one user's mailbox, so the real
    -- uniqueness constraint is the (user_id, id) pair.
    primary key (user_id, id)
);

-- Speed up "all threads for this user, newest first" queries.
create index if not exists threads_user_lastmsg_idx
    on public.threads (user_id, last_message_at desc);


-- ---------------------------------------------------------------------------
-- 2. MESSAGES TABLE
-- ---------------------------------------------------------------------------
-- One row per individual email. Many messages can belong to one thread.
-- ---------------------------------------------------------------------------

create table if not exists public.messages (
    -- Gmail's message id. Unique within a mailbox.
    id text not null,

    -- The thread this message belongs to. Composite FK: the (user_id, thread_id)
    -- pair must exist in threads. This keeps a message from pointing at another
    -- user's thread.
    thread_id text not null,

    user_id text not null references public.users(id) on delete cascade,

    -- The From: header value, e.g. '"Jane" <jane@example.com>'.
    sender text,

    -- The To:/Cc: recipients, stored as a JSONB array of strings so we can
    -- query "who was on this email" later. JSONB is Postgres's binary JSON:
    -- queryable and indexable.
    recipients jsonb not null default '[]'::jsonb,

    subject text,

    -- The plain-text body. We extract this from Gmail's multipart payload,
    -- preferring the text/plain part. This is what AI features will read.
    body_text text,

    -- The HTML body (text/html part), if Gmail provided one. Kept for a
    -- possible rich "view original" feature later. Nullable because some
    -- emails are plain-text only.
    body_html text,

    -- Gmail's short snippet of the message (~200 chars).
    snippet text,

    -- The Gmail label ids attached to this message, e.g.
    --   ["INBOX", "UNREAD", "Label_12", "IMPORTANT"]
    -- Stored as a JSONB array. The gmail.modify scope lets us change these
    -- later (e.g. apply an "AI: Follow-up" label).
    labels jsonb not null default '[]'::jsonb,

    -- When the email was received (from the internal Date header). This is
    -- the user-meaningful timestamp, distinct from created_at (when WE stored it).
    received_at timestamptz,

    created_at timestamptz not null default now(),

    primary key (user_id, id),

    -- Composite foreign key: thread_id must belong to the SAME user.
    foreign key (user_id, thread_id)
        references public.threads (user_id, id)
        on delete cascade
);

-- Common queries: "messages in this thread, oldest first" and
-- "all messages for this user, newest first".
create index if not exists messages_thread_idx
    on public.messages (user_id, thread_id, received_at);
create index if not exists messages_user_received_idx
    on public.messages (user_id, received_at desc);
-- GIN index lets us filter by label efficiently, e.g. labels @> '["UNREAD"]'.
create index if not exists messages_labels_gin
    on public.messages using gin (labels);


-- ---------------------------------------------------------------------------
-- 3. SYNC_STATE TABLE
-- ---------------------------------------------------------------------------
-- The key to INCREMENTAL SYNC. After each successful sync we store Gmail's
-- `historyId` here. Next time, instead of re-listing the whole inbox, we call
-- Gmail's history.list endpoint with this id and get back only what changed
-- since (new messages, read/unread flips, label changes, deletions).
--
-- Why historyId and not a timestamp? Gmail guarantees historyIds are strictly
-- increasing and let you fetch "everything after this point" reliably. A
-- timestamp would be ambiguous (clock skew, Gmail indexing latency).
--
-- One row per user (enforced by primary key on user_id).
-- ---------------------------------------------------------------------------

create table if not exists public.sync_state (
    user_id text primary key references public.users(id) on delete cascade,

    -- Gmail's historyId, returned as a string of digits. Stored as text to
    -- preserve precision (these numbers can exceed JS's safe integer range).
    history_id text,

    -- When we last finished a sync. Shown in the UI as "Last synced: ...".
    last_synced_at timestamptz
);


-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
-- Same policy as Stage 1: RLS enabled, NO permissive policies. The service
-- role key (server-only) bypasses RLS, so our API routes can read/write
-- freely. The public anon key — which a browser could discover — can do
-- NOTHING. All access is forced through our trusted server.
-- ---------------------------------------------------------------------------

alter table public.threads enable row level security;
alter table public.messages enable row level security;
alter table public.sync_state enable row level security;

-- (Intentionally no policies: service role bypasses RLS; anon keys denied.)


-- ============================================================================
-- End of Stage 2 schema. After running, verify with:
--   select count(*) from public.threads;     -- 0 rows initially
--   select count(*) from public.messages;    -- 0 rows initially
--   select * from public.sync_state;         -- empty initially
-- ============================================================================

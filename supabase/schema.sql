-- ============================================================================
-- Gmail Intelligence Platform — Stage 1 schema
-- ============================================================================
--
-- Run this manually in the Supabase SQL Editor (Dashboard → SQL Editor → New
-- query → paste → Run). Read it through first; every line is commented so you
-- can explain what it does.
--
-- This script creates two tables:
--   1. users         — one row per connected Google account (the spec).
--   2. user_sessions — login sessions so we remember "who's logged in".
--
-- It is IDEMPOTENT: re-running it is safe because of `if not exists` clauses.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. USERS TABLE
-- ---------------------------------------------------------------------------
-- Stores the OAuth tokens for each Google account that connects. The columns
-- match what was specified for Stage 1.
--
-- create extension pgcrypto:
--   Supabase ships with it enabled already, but calling it here is harmless and
--   documents that we rely on gen_random_uuid() if we ever need it.
-- ---------------------------------------------------------------------------

create extension if not exists pgcrypto;

create table if not exists public.users (
    -- `id` is the user's stable Google subject identifier ("sub"). We use it
    -- directly as the primary key rather than inventing our own id — Google
    -- guarantees it's unique and never changes for a given account.
    id text primary key,

    -- The Gmail address the user logged in with.
    email text not null,

    -- OAuth access token. Short-lived (~1 hour). Sent as a Bearer token when
    -- we call the Gmail API. We re-fetch a fresh one via the refresh_token.
    access_token text not null,

    -- OAuth refresh token. Long-lived. Used to silently obtain new access
    -- tokens without asking the user to log in again.
    refresh_token text not null,

    -- When the current access_token expires, as an ISO 8601 timestamp string.
    -- e.g. '2026-06-18T12:34:56.000Z'. We compare against this to decide if
    -- we need to refresh before making a Gmail API call.
    token_expiry timestamptz not null,

    -- When the row was first created. Default to "now" so we never have to
    -- set it manually from the app code.
    created_at timestamptz not null default now()
);

-- Make lookups by email fast (e.g. "is this account already connected?").
create index if not exists users_email_idx on public.users (email);


-- ---------------------------------------------------------------------------
-- 2. USER_SESSIONS TABLE
-- ---------------------------------------------------------------------------
-- Lets the app remember "who's logged in" between requests. After a successful
-- OAuth login we generate a long random token, store it here mapped to a user,
-- and set it as an httpOnly cookie in the browser. On each subsequent request
-- we look the cookie value up here to find the user.
--
-- This is a lightweight alternative to Supabase Auth, which we're not using
-- because we handle OAuth ourselves (we already have the Google tokens).
-- ---------------------------------------------------------------------------

create table if not exists public.user_sessions (
    -- The session token (a 64-char hex string). It is the "key" the browser
    -- sends us on each request.
    token text primary key,

    -- Foreign key to users.id. `on delete cascade` means: if a user row is
    -- deleted (e.g. they disconnect), all their sessions are wiped too.
    user_id text not null references public.users(id) on delete cascade,

    -- When the session expires. After this time the cookie is meaningless,
    -- so the user must log in again.
    expires_at timestamptz not null
);

-- Speed up the common query: "is this session token valid and unexpired?"
create index if not exists user_sessions_token_idx
    on public.user_sessions (token);


-- ---------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS)
-- ---------------------------------------------------------------------------
-- RLS blocks direct table access unless a policy allows it. Our app talks to
-- Supabase with the SERVICE ROLE KEY, which bypasses RLS entirely, so the
-- policies below are essentially "deny everything for anon/api keys".
--
-- We enable RLS and add NO permissive policies. This means: the public anon
-- key (which a browser could theoretically discover) can read/write NOTHING.
-- All access is forced through our server using the service role key. This is
-- the safest default for Stage 1.
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.user_sessions enable row level security;

-- (Intentionally no policies added: service role bypasses RLS, and we don't
--  want anon/authenticated keys to touch these tables at all.)


-- ============================================================================
-- End of schema. Verify it worked with:
--   select * from public.users;            -- should return 0 rows
--   select * from public.user_sessions;    -- should return 0 rows
-- ============================================================================

-- ============================================================================
-- Gmail Intelligence Platform — Stage 3 schema (categorization)
-- ============================================================================
--
-- Run this manually in the Supabase SQL Editor (Dashboard → SQL Editor → New
-- query → paste → Run), AFTER schema_stage2.sql has been run.
--
-- This migration adds ONE column to the existing messages table to store the
-- AI-assigned category of each email. It does not touch any other table and
-- does not alter existing data — every existing row simply gets category =
-- NULL until categorization runs.
--
-- IDEMPOTENT: uses `if not exists` so it's safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Add the `category` column to messages.
-- ---------------------------------------------------------------------------
--
-- Why text and not an enum? Enums in Postgres require an extra CREATE TYPE
-- and an ALTER TYPE to add/remove values later. For 6 fixed categories, text
-- is simpler and equally queryable. We enforce validity at the APPLICATION
-- layer (categorize.ts), not the DB — the Gemini client only ever writes one
-- of the 6 known categories (defaulting to "Work/Professional" on any
-- ambiguity), so we don't need a DB-level constraint to keep values clean.
--
-- Nullable: a NULL category means "not yet categorized". The categorize API
-- route selects WHERE category IS NULL to find work to do.
-- ---------------------------------------------------------------------------

alter table public.messages
    add column if not exists category text;


-- ---------------------------------------------------------------------------
-- (Optional) index to speed up "find uncategorized messages".
-- ---------------------------------------------------------------------------
-- The categorize route runs:
--     select * from messages where user_id = ? and category is null limit 10
-- A partial index on rows where category IS NULL makes that lookup fast even
-- once the table grows large. As categorization fills in values, the rows
-- drop out of this index (partial indexes only hold matching rows), so it
-- stays small and fast.
-- ---------------------------------------------------------------------------

create index if not exists messages_uncategorized_idx
    on public.messages (user_id)
    where category is null;


-- ============================================================================
-- End of Stage 3 schema. After running, verify with:
--   select column_name, data_type from information_schema.columns
--   where table_name = 'messages' and column_name = 'category';
-- (Should show one row: data_type = text)
-- ============================================================================

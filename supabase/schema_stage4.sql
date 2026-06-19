-- ============================================================================
-- Gmail Intelligence Platform — Stage 4 schema (summarization)
-- ============================================================================
--
-- This script adds a nullable `summary` column to both `messages` and `threads`
-- tables. Existing data is not affected; rows will simply have NULL summaries
-- until summarization runs.
--
-- Run this manually in the Supabase SQL Editor.
-- ============================================================================

-- Add summary column to messages table
alter table public.messages
    add column if not exists summary text;

-- Add summary column to threads table
alter table public.threads
    add column if not exists summary text;

-- ============================================================================
-- Gmail Intelligence Platform — Stage 6 schema (AI Chat Agent / pgvector RAG)
-- ============================================================================
--
-- This migration sets up the vector search capabilities and chat tables:
--   1. Enables pgvector extension (if not already enabled)
--   2. Adds an `embedding` column of dimension 768 to the `messages` table
--      (matching Gemini's gemini-embedding-001 model with outputDimensionality=768)
--   3. Creates indexes to optimize cosine similarity searches
--   4. Creates the Postgres function `match_messages` for vector similarity search
--   5. Creates `chat_sessions` and `chat_messages` tables for context memory
--
-- Run this script manually in the Supabase SQL Editor.
-- ============================================================================

-- 1. Enable the pgvector extension (requires superuser privileges, default in Supabase)
create extension if not exists vector;

-- 2. Add embedding column to messages table
alter table public.messages
    add column if not exists embedding vector(768);

-- 3. Create a vector index for fast similarity search
-- Note: We use ivfflat or hnsw depending on performance. HNSW is standard for pgvector.
-- We fall back to standard indexing, but a simple vector index helps query speed.
create index if not exists messages_embedding_idx
    on public.messages using hnsw (embedding vector_cosine_ops);

-- 4. Create Postgres similarity search function
-- This function takes a query embedding, match threshold, limit, and user_id,
-- and returns the most similar messages using cosine distance (operator <=>).
create or replace function match_messages (
  query_embedding vector(768),
  match_threshold float,
  match_count int,
  p_user_id text
)
returns table (
  id text,
  thread_id text,
  subject text,
  sender text,
  body_text text,
  received_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    messages.id,
    messages.thread_id,
    messages.subject,
    messages.sender,
    messages.body_text,
    messages.received_at,
    1 - (messages.embedding <=> query_embedding) as similarity
  from messages
  where messages.user_id = p_user_id
    and messages.embedding is not null
    and 1 - (messages.embedding <=> query_embedding) > match_threshold
  order by messages.embedding <=> query_embedding
  limit match_count;
$$;

-- 5. Create chat_sessions table
create table if not exists public.chat_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id text not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

-- Row Level Security (RLS) for chat_sessions
alter table public.chat_sessions enable row level security;

-- 6. Create chat_messages table
create table if not exists public.chat_messages (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.chat_sessions(id) on delete cascade,
    role text not null check (role in ('user', 'assistant')),
    content text not null,
    created_at timestamptz not null default now()
);

-- Row Level Security (RLS) for chat_messages
alter table public.chat_messages enable row level security;

-- (Strict policy configuration: anon/public denied, service role bypasses RLS for server routing)

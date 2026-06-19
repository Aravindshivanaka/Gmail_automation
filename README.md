# InboxFlow Summarizer — Production AI Gmail Intelligence Platform

A high-performance, AI-driven workspace built for the Repeatless Technical Assessment. The platform securely bridges a user's Gmail inbox via secure OAuth 2.0 to a Supabase relational database, running automated categorization, background thread summarization, context-aware smart responses, and a vector-embedded (RAG) Conversational Chat Agent.

## Live Deployment Metrics
- **Production Application URL:** [https://inboxflowsummarizer.vercel.app](https://inboxflowsummarizer.vercel.app)
- **Repository Visibility:** Public ✅
- **Database Architecture Status:** Fully Migrated with `pgvector` enabled ✅

---

## Core System Features Implemented

### 1. Gmail Integration & Resilient Sync
- Secure OAuth 2.0 flow supporting full scopes (`gmail.readonly`, `gmail.send`, `gmail.modify`).
- Ingestion engine mapping incoming data structures directly to Supabase schemas.
- High-volume pagination built around Google's `nextPageToken` array limits.
- Automated Token Refresh mechanics that catch `401` states silently to maintain active sessions.

### 2. Deep-Context AI Categorization & Summarization
- Emails are automatically triaged into 6 core operational taxonomies (*Newsletter, Job/Recruitment, Finance, Notifications, Personal, Work/Professional*).
- Individual and message-arc thread summaries generated automatically on synchronization loops.
- Rate-limiting protection built natively into structural background array batches.

### 3. Thread-Aware Smart Email Composer & Outbound Reply Engine
- Compose complete, contextually tailored professional drafts from short natural-language prompts.
- **Thread Nesting Integrity:** Outbound reply routing automatically captures and populates native `In-Reply-To` and `References` headers using the last message identifier in the chain. This forces sent items to nest beautifully inside native Gmail threads.

### 4. RAG Chat Agent Workspace (Platform Centerpiece)
- Embedded similarity searches leveraging `pgvector` arrays.
- Translates conversational queries into vector strings to query database knowledge frames.
- **Strict Anti-Hallucination Guardrails:** Explicitly bound to structural email data limits. The engine returns contextual attributions highlighting senders and thread dates, and states missing data directly rather than projecting details.

---

## Technical Stack Architecture
- **Frontend / Full-Stack Backend:** Next.js (App Router), TypeScript, Tailwind CSS
- **Database Layer:** Supabase (PostgreSQL Enterprise Core) + `pgvector` extension
- **AI Orchestration Framework:** Dual-Model Pipeline leveraging Google Gemini API (Embeddings & Core Logic Generation) with immediate, low-latency failover routing to NVIDIA NIM (`mistralai/mistral-medium-3.5-128b` and `deepseek-ai/deepseek-v4-flash`) for uninterrupted data execution.

---

## Detailed System Documentation
A complete, line-by-line breakdown of structural engineering tradeoffs, environmental variables, database schema designs, and algorithmic choices is available in the **[ARCHITECTURE.md](./ARCHITECTURE.md)** document located in the repository root directory.
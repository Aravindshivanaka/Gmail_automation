# Architecture & Design Document

## Project Overview

InboxFlow Summarizer is an AI-powered Gmail Intelligence Platform built as part of the Repeatless AI Automation Executive Technical Assessment.

The platform connects securely to Gmail using Google OAuth 2.0, synchronizes email data into Supabase, applies AI-powered categorization and summarization, enables intelligent email composition and replies, and provides a Retrieval-Augmented Generation (RAG) chat assistant that uses the user's email history as its knowledge base.

---

# System Architecture

User Browser

↓

Next.js Application

↓

Google Gmail API

↓

Supabase Database (PostgreSQL + pgvector)

↓

AI Layer (Gemini + NVIDIA NIM)

↓

Chat Agent / Categorization / Summarization / Compose

---

# Technology Choices

## Frontend

* Next.js App Router
* TypeScript
* Tailwind CSS

Reason:
Provides a modern full-stack React architecture with API routes and deployment simplicity through Vercel.

## Database

* Supabase PostgreSQL
* pgvector

Reason:
Supports relational email storage while enabling vector similarity search for the RAG assistant.

## AI Models

Primary:

* Google Gemini

Fallback:

* NVIDIA NIM

Reason:
Gemini provides strong reasoning and generation quality while NVIDIA NIM provides resilience when Gemini rate limits or quota exhaustion occurs.

---

# Gmail Integration Design

## Authentication

Google OAuth 2.0 is used for authentication.

Scopes:

* gmail.readonly
* gmail.send
* gmail.modify

Tokens are securely stored in Supabase.

Refresh tokens are used to automatically obtain new access tokens without requiring repeated user login.

---

# Email Synchronization Strategy

## Initial Sync

The system retrieves:

* Messages
* Threads
* Labels
* Metadata

using Gmail API endpoints.

## Incremental Sync

A sync_state table stores synchronization progress.

Subsequent sync operations only retrieve newly added or modified messages.

This reduces API usage and improves performance.

## Pagination

Gmail nextPageToken handling is implemented to support large inboxes without application degradation.

---

# Database Design

## users

Stores:

* User profile information
* OAuth credentials
* Refresh tokens

## messages

Stores:

* Gmail message ID
* Thread ID
* Sender
* Subject
* Email content
* Category
* Summary
* Embedding

## threads

Stores:

* Thread ID
* Thread summary
* Metadata

## sync_state

Stores synchronization checkpoints.

## chat_sessions

Stores user conversations with the assistant.

## chat_messages

Stores conversation history.

---

# Email Categorization Pipeline

Categories:

* Newsletter
* Job / Recruitment
* Finance
* Notifications
* Personal
* Work / Professional

Workflow:

1. Email synchronized
2. Email content extracted
3. AI classification executed
4. Category stored in database
5. Category surfaced in UI

---

# Email Summarization Pipeline

## Message Summaries

Each email is summarized individually.

## Thread Summaries

The complete thread history is analyzed.

A single summary is generated describing the entire conversation context.

This ensures conversation awareness rather than isolated message understanding.

---

# Compose & Reply Architecture

## Compose

User enters a short natural-language prompt.

AI generates:

* Subject
* Email body

The user can edit and send the draft.

## Reply

The system retrieves the full thread history.

The AI receives:

* Original email
* Prior thread messages
* User instruction

A contextual reply is generated.

The following Gmail threading fields are preserved:

* In-Reply-To
* References
* threadId

This ensures replies appear inside the correct Gmail conversation.

---

# RAG Chat Agent Architecture

The chat assistant uses the user's email history as its exclusive knowledge source.

Workflow:

1. Email synchronized
2. Embeddings generated
3. Vectors stored in pgvector
4. User asks question
5. Similarity search retrieves relevant emails
6. Retrieved context sent to AI model
7. AI generates answer
8. Sources attributed in response

---

# Embedding Strategy

Embedding Model:

* gemini-embedding-001

Vector Size:

* 768 dimensions

Reason:

Provides semantic search capabilities for cross-email retrieval and synthesis.

---

# Hallucination Prevention

The chat assistant is instructed to:

* Use only retrieved email context
* Cite sources when responding
* Refuse unsupported claims
* Explicitly state when information is unavailable

This reduces hallucination risk and improves trustworthiness.

---

# AI Failover Strategy

All AI operations use:

1. Google Gemini (Primary)
2. NVIDIA NIM (Fallback)

Fallback activates automatically when:

* Rate limits occur
* Quota exhaustion occurs
* Temporary model failures occur

This approach ensures continuity of service.

---

# Known Limitations

* Google OAuth currently runs in Testing Mode
* Evaluators may require Test User access
* Sent emails may occasionally land in Spam due to test application reputation
* Newsletter deduplication bonus feature was not implemented due to assessment time constraints

---

# Future Improvements

* Newsletter semantic deduplication
* Advanced search filters
* Real-time Gmail push notifications
* Multi-account Gmail support
* Fine-grained email labels
* Streaming chat responses

---

# Conclusion

The platform successfully implements the core requirements of the Repeatless assessment, including Gmail integration, synchronization, categorization, summarization, AI-assisted composition and replies, vector-powered semantic search, and a source-aware RAG chat assistant built on Supabase, Gmail API, Gemini, and NVIDIA NIM.

# Architecture & Design Document

## Project Overview

InboxFlow Summarizer is an AI-powered Gmail Intelligence Platform built for the Repeatless technical assessment.

The system connects to Gmail using Google OAuth, syncs emails into Supabase, categorizes and summarizes messages using AI, generates email drafts and replies, and provides a chat assistant that can answer questions using the user's emails.

---

## Tech Stack

Frontend & Backend:

* Next.js
* TypeScript
* Tailwind CSS

Database:

* Supabase PostgreSQL
* pgvector

AI Models:

* Google Gemini (Primary)
* NVIDIA NIM (Fallback)

Deployment:

* Vercel

---

## How the System Works

### Gmail Connection

Users connect their Gmail account through Google OAuth.

After login, access tokens and refresh tokens are stored securely and used to access Gmail data.

### Email Sync

The application syncs:

* Emails
* Threads
* Labels
* Metadata

After the first sync, only new or changed emails are fetched to reduce API usage.

### Categorization

Each email is automatically classified into:

* Newsletter
* Job / Recruitment
* Finance
* Notifications
* Personal
* Work / Professional

Categories are stored in Supabase and displayed in the UI.

### Summarization

The system creates:

* Individual email summaries
* Full thread summaries

Thread summaries use the entire conversation history rather than a single email.

### Compose & Reply

Users can create emails using short prompts.

For replies, the system reads the entire thread before generating a response.

Gmail threading headers are preserved so replies appear correctly in Gmail conversations.

### AI Chat Agent

The chat assistant uses the user's emails as its knowledge base.

Workflow:

1. Email content is converted into embeddings.
2. Embeddings are stored in pgvector.
3. Relevant emails are retrieved through similarity search.
4. Retrieved emails are sent to the AI model.
5. The AI generates a response with source attribution.

The assistant only answers using retrieved email data and avoids making up information.

---

## Database Design

Main Tables:

* users
* messages
* threads
* sync_state
* chat_sessions
* chat_messages

The messages table also stores:

* category
* summary
* embedding vector

---

## AI Strategy

Google Gemini is used as the primary AI model.

NVIDIA NIM acts as a fallback when Gemini encounters:

* Rate limits
* Quota exhaustion
* Temporary failures

This keeps AI features working even when one provider becomes unavailable.

---

## Challenges & Decisions

During development, Gemini free-tier limits were reached frequently.

To improve reliability, a Gemini-first and NVIDIA-NIM-fallback architecture was implemented.

For semantic search, pgvector was chosen because it integrates directly with Supabase and supports efficient email retrieval for the chat agent.

---

## Known Limitations

* Google OAuth currently runs in Testing Mode.
* Evaluators may need to be added as Test Users.
* Some sent emails may appear in Spam because the application uses a test OAuth setup.
* Newsletter deduplication (bonus feature) was not implemented.

---

## Conclusion

The platform successfully implements the core requirements of the assessment, including Gmail integration, email synchronization, categorization, summarization, AI-assisted compose and reply, and a RAG-based chat assistant with source attribution.

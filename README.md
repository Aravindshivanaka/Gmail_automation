# InboxFlow Summarizer — AI Gmail Intelligence Platform

> Technical Assessment Submission for Repeatless — AI Automation Executive

## Live Application

**Production URL:** https://inboxflowsummarizer.vercel.app

## Evaluation Access Note

Google OAuth is currently configured in Testing Mode.

Only approved Gmail accounts can authenticate through Google's OAuth consent screen. If additional access is required for evaluation, please contact me and I can:

* Add evaluator email addresses as OAuth Test Users
* Provide a live walkthrough and demonstration
* Share a recorded demo covering all implemented features


# Project Overview

InboxFlow Summarizer is an AI-powered Gmail Intelligence Platform that securely connects to a user's Gmail account, synchronizes email data, categorizes and summarizes messages, generates intelligent drafts and replies, and provides a Retrieval-Augmented Generation (RAG) chat assistant that uses the user's email history as its knowledge base.

The platform was designed and implemented to satisfy the Repeatless technical assessment requirements using Gmail API, Supabase, pgvector, Google Gemini, and NVIDIA NIM.


# Implemented Features

## 1. Gmail OAuth Integration

* Google OAuth 2.0 authentication
* Secure Gmail account connection
* Access token and refresh token handling
* Automatic token refresh
* Gmail API integration without IMAP/SMTP

## 2. Email Synchronization

* Full inbox synchronization
* Incremental synchronization
* Gmail thread support
* Gmail label synchronization
* Pagination handling for large inboxes
* Gmail API rate-limit awareness

## 3. Email Categorization

Emails are automatically classified into:

* Newsletter
* Job / Recruitment
* Finance
* Notifications
* Personal
* Work / Professional

Categories are stored and surfaced through the application UI.

## 4. Email Summarization

The system generates:

### Message-Level Summaries

Individual email summaries generated using AI.

### Thread-Level Summaries

Conversation-aware summaries generated using complete thread history.

This allows the system to understand conversations as a whole rather than treating messages independently.

## 5. AI Compose Assistant

Users can generate complete professional emails from short prompts.

Example:

"Write a follow-up email regarding tomorrow's sales review meeting."

The platform generates:

* Email subject
* Professional email body

Users may edit before sending.

## 6. AI Reply Assistant

Users can generate contextual replies to existing email conversations.

The system:

* Reads complete thread history
* Understands prior conversation context
* Generates an appropriate reply
* Preserves Gmail threading behavior

Implemented Gmail headers:

* In-Reply-To
* References
* threadId

This ensures replies appear inside the correct Gmail conversation.

## 7. AI Chat Agent (RAG)

The platform includes a Retrieval-Augmented Generation assistant that uses the user's emails as its knowledge base.

Capabilities include:

* Cross-email reasoning
* Multi-thread synthesis
* Source attribution
* Follow-up conversation support
* Hallucination prevention

Example queries:

* Summarize emails from a sender
* Identify job application outcomes
* Retrieve project discussions
* Analyze newsletter content
* Search across historical conversations

The assistant only answers using retrieved email content.

If information is unavailable, the system explicitly states that the data does not exist in the user's mailbox.


# Technical Architecture

## Frontend

* Next.js App Router
* TypeScript
* Tailwind CSS

## Backend

* Next.js Server Actions
* API Route Handlers

## Database

* Supabase PostgreSQL
* pgvector extension

## AI Models

### Primary Model

* Google Gemini

### Secondary Fallback Model

* NVIDIA NIM

Fallback models are used automatically when Gemini encounters:

* Rate limits
* Quota exhaustion
* Temporary failures

This provides resilience and uninterrupted AI functionality.


# Vector Search & RAG

Email content is embedded and stored using pgvector.

Workflow:

1. Email content synchronized
2. Embeddings generated
3. Vectors stored in Supabase
4. Similarity search retrieves relevant emails
5. Retrieved context sent to AI model
6. Response generated with source attribution

This enables semantic search across the user's email history.


# Database Schema

Core tables:

* users
* messages
* threads
* sync_state
* chat_sessions
* chat_messages

Additional fields include:

* category
* summary
* embedding (vector 768)


# Local Development Setup

## Clone Repository

```bash
git clone <repository-url>
cd project
```

## Install Dependencies

```bash
npm install
```

## Configure Environment Variables

Create:

```bash
.env.local
```

Required variables:

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

GEMINI_API_KEY=

NVIDIA_NIM_API_KEY=
NVIDIA_NIM_BASE_URL=
NVIDIA_MODEL_NAME=
```

## Run Development Server

```bash
npm run dev
```


# Known Limitations

* Google OAuth is currently configured in Testing Mode
* Evaluators may need to be added as OAuth Test Users
* Sent emails may occasionally be filtered into Spam due to test application reputation
* Newsletter deduplication bonus feature was not implemented due to assessment time constraints

# Architecture Documentation

A detailed explanation of:

* System architecture
* Design decisions
* Database schema
* Gmail synchronization strategy
* AI orchestration pipeline
* RAG implementation
* Trade-offs and limitations

is available in:

**ARCHITECTURE.md**


# Assignment Compliance Summary

Implemented:

* Gmail OAuth Integration
* Inbox Synchronization
* Incremental Sync
* Email Categorization
* Email Summarization
* Thread Summarization
* AI Compose
* AI Reply
* Thread-Aware Replies
* RAG Chat Agent
* Source Attribution
* pgvector Semantic Search
* Gemini Integration
* NVIDIA NIM Fallback

Bonus:

* Newsletter Deduplication (Not Implemented)

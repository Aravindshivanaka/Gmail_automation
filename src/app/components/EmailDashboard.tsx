"use client";

import React, { useState, useEffect } from "react";
import type { Category } from "@/lib/gemini";

interface Message {
  id: string;
  thread_id?: string;
  subject: string | null;
  sender: string | null;
  received_at: string | null;
  category: Category | null;
  summary?: string | null;
  snippet?: string | null;
}

interface ChatSource {
  id: string;
  sender: string | null;
  subject: string | null;
  received_at: string | null;
  similarity?: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[];
}


interface EmailDashboardProps {
  user: {
    id: string;
    email: string;
  };
  stats: {
    messageCount: number;
    threadCount: number;
    lastSyncedAt: string | null;
  } | null;
  categoryCounts: {
    category: string;
    count: number;
  }[];
  recentMessages: Message[];
  banners: {
    auth_success?: string;
    auth_error?: string;
    sync_success?: string;
    sync_error?: string;
    cat_success?: string;
    cat_error?: string;
    sum_success?: string;
    sum_error?: string;
  };
}

export default function EmailDashboard({
  user,
  stats,
  categoryCounts,
  recentMessages,
  banners,
}: EmailDashboardProps) {
  // Tabs / Active views
  const [activeView, setActiveView] = useState<"welcome" | "compose" | "reply" | "chat">("welcome");

  // --- Vector Embeddings State ---
  const [isGeneratingEmbeddings, setIsGeneratingEmbeddings] = useState(false);

  // --- AI Chat Agent State ---
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatState, setChatState] = useState<"idle" | "thinking">("idle");

  // Notifications
  const [notification, setNotification] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  // Read URL banners as initial notifications
  useEffect(() => {
    if (banners.sync_success) {
      showNotification("success", `Sync Completed: ${banners.sync_success}`);
    } else if (banners.sync_error) {
      showNotification("error", `Sync Failed: ${banners.sync_error}`);
    } else if (banners.cat_success) {
      showNotification("success", `Categorization Completed: ${banners.cat_success}`);
    } else if (banners.cat_error) {
      showNotification("error", `Categorization Failed: ${banners.cat_error}`);
    } else if (banners.sum_success) {
      showNotification("success", `Summarization Completed: ${banners.sum_success}`);
    } else if (banners.sum_error) {
      showNotification("error", `Summarization Failed: ${banners.sum_error}`);
    } else if (banners.auth_success) {
      showNotification("success", "Gmail Connected successfully!");
    } else if (banners.auth_error) {
      showNotification("error", `Auth Error: ${banners.auth_error}`);
    }
  }, [banners]);

  const showNotification = (type: "success" | "error" | "info", message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((prev) => (prev?.message === message ? null : prev));
    }, 6000);
  };

  // --- Compose Email State ---
  const [composeTo, setComposeTo] = useState("");
  const [composePrompt, setComposePrompt] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeState, setComposeState] = useState<"idle" | "generating" | "drafted" | "sending">("idle");

  // --- Reply Email State ---
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [replyParentMsg, setReplyParentMsg] = useState<Message | null>(null);
  const [replyPrompt, setReplyPrompt] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyState, setReplyState] = useState<"idle" | "generating" | "drafted" | "sending">("idle");
  const [threadHistory, setThreadHistory] = useState<Array<{ sender: string; received_at: string; body_text: string }>>([]);
  const [isLoadingThread, setIsLoadingThread] = useState(false);

  const startReplyFlow = async (msg: Message & { thread_id?: string }) => {
    // Gmail threads are identified by thread_id. If thread_id isn't present, we'll fetch it or fallback to msg.id.
    const threadId = msg.thread_id || msg.id; // Fallback to id if thread_id is missing
    setReplyThreadId(threadId);
    setReplyParentMsg(msg);
    setReplyPrompt("");
    setReplyBody("");
    setReplyState("idle");
    setActiveView("reply");
    setIsLoadingThread(true);
    setThreadHistory([]);

    try {
      // Fetch thread history context for display using GET
      const response = await fetch(`/api/reply/draft?thread_id=${encodeURIComponent(threadId)}`, {
        method: "GET",
      });
      const data = await response.json();
      if (response.ok && data.messages) {
        setThreadHistory(data.messages);
      }
    } catch (e) {
      console.error("Failed to load thread history:", e);
    } finally {
      setIsLoadingThread(false);
    }
  };

  // --- Vector Embeddings Handler ---
  const handleGenerateEmbeddings = async () => {
    setIsGeneratingEmbeddings(true);
    try {
      const res = await fetch("/api/embeddings/generate", {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate embeddings.");
      }
      showNotification("success", data.message || "Vector embeddings generated!");
    } catch (err: any) {
      showNotification("error", err.message || "Failed to generate embeddings.");
    } finally {
      setIsGeneratingEmbeddings(false);
    }
  };

  // --- AI Chat Agent Handlers ---
  const handleSendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const userQuery = chatInput;
    setChatInput("");
    setChatState("thinking");

    // Pre-insert user message in client state for instant feedback
    const userMsg: ChatMessage = { role: "user", content: userQuery };
    setChatMessages((prev) => [...prev, userMsg]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userQuery,
          session_id: chatSessionId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to get AI response.");
      }

      if (data.session_id) {
        setChatSessionId(data.session_id);
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.answer,
        sources: data.sources,
      };
      setChatMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      showNotification("error", err.message || "Chat agent error.");
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to communicate with AI chat agent. Please try again." },
      ]);
    } finally {
      setChatState("idle");
    }
  };

  const handleResetChat = () => {
    setChatMessages([]);
    setChatSessionId(null);
    setChatInput("");
    setChatState("idle");
    showNotification("info", "Started a new chat session.");
  };

  // Generate Draft for Compose Email
  const handleGenerateComposeDraft = async () => {
    if (!composePrompt.trim()) {
      showNotification("error", "Please enter a prompt first.");
      return;
    }

    setComposeState("generating");
    setComposeSubject("");
    setComposeBody("");

    try {
      const res = await fetch("/api/compose/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: composePrompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate draft.");
      }

      setComposeSubject(data.subject);
      setComposeBody(data.body);
      setComposeState("drafted");
      showNotification("success", "Email draft generated by AI!");
    } catch (err: any) {
      setComposeState("idle");
      showNotification("error", err.message || "Failed to generate draft.");
    }
  };

  // Send Composed Email
  const handleSendCompose = async () => {
    if (!composeTo.trim()) {
      showNotification("error", "Recipient email is required.");
      return;
    }
    if (!composeSubject.trim()) {
      showNotification("error", "Subject is required.");
      return;
    }
    if (!composeBody.trim()) {
      showNotification("error", "Body is required.");
      return;
    }

    setComposeState("sending");

    try {
      const res = await fetch("/api/compose/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: composeTo,
          subject: composeSubject,
          body: composeBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send email.");
      }

      showNotification("success", "Email sent successfully!");
      // Reset compose state
      setComposeTo("");
      setComposePrompt("");
      setComposeSubject("");
      setComposeBody("");
      setComposeState("idle");
      setActiveView("welcome");
    } catch (err: any) {
      setComposeState("drafted");
      showNotification("error", err.message || "Failed to send email.");
    }
  };

  // Generate Reply Draft
  const handleGenerateReplyDraft = async () => {
    if (!replyThreadId) return;
    if (!replyPrompt.trim()) {
      showNotification("error", "Please enter a prompt first.");
      return;
    }

    setReplyState("generating");
    setReplyBody("");

    try {
      const res = await fetch("/api/reply/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: replyThreadId,
          prompt: replyPrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate reply draft.");
      }

      setReplyBody(data.body);
      // If messages were returned, save them
      if (data.messages && data.messages.length > 0) {
        setThreadHistory(data.messages);
      }
      setReplyState("drafted");
      showNotification("success", "Reply draft generated by AI!");
    } catch (err: any) {
      setReplyState("idle");
      showNotification("error", err.message || "Failed to generate reply draft.");
    }
  };

  // Send Reply Email
  const handleSendReply = async () => {
    if (!replyThreadId) return;
    if (!replyBody.trim()) {
      showNotification("error", "Reply body is required.");
      return;
    }

    setReplyState("sending");

    try {
      const res = await fetch("/api/reply/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: replyThreadId,
          body: replyBody,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send reply.");
      }

      showNotification("success", "Reply sent successfully and threaded in Gmail!");
      // Reset reply state
      setReplyPrompt("");
      setReplyBody("");
      setReplyState("idle");
      setActiveView("welcome");
    } catch (err: any) {
      setReplyState("drafted");
      showNotification("error", err.message || "Failed to send reply.");
    }
  };

  const getCategoryColor = (category: Category | null) => {
    if (!category) return "bg-gray-100 text-gray-600 border-gray-200";
    const color: Record<Category, string> = {
      Newsletter: "bg-purple-50 text-purple-700 border-purple-200",
      "Job/Recruitment": "bg-blue-50 text-blue-700 border-blue-200",
      Finance: "bg-emerald-50 text-emerald-700 border-emerald-200",
      Notifications: "bg-amber-50 text-amber-700 border-amber-200",
      Personal: "bg-rose-50 text-rose-700 border-rose-200",
      "Work/Professional": "bg-slate-100 text-slate-700 border-slate-300",
    };
    return color[category] || "bg-gray-100 text-gray-600 border-gray-200";
  };

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6">
      {/* Dynamic Alerts Banner */}
      {notification && (
        <div
          className={`fixed top-4 right-4 z-50 flex items-center p-4 rounded-xl border shadow-lg max-w-md transition-all duration-500 animate-slide-in ${
            notification.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-800"
              : notification.type === "error"
              ? "bg-rose-50 border-rose-200 text-rose-800"
              : "bg-indigo-50 border-indigo-200 text-indigo-800"
          }`}
        >
          <div className="flex-1 text-sm font-medium mr-3">
            {notification.message}
          </div>
          <button
            onClick={() => setNotification(null)}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            &times;
          </button>
        </div>
      )}

      {/* Modern Dashboard Header */}
      <header className="relative overflow-hidden rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="absolute top-0 right-0 h-32 w-32 bg-indigo-500 rounded-full blur-3xl opacity-10"></div>
        <div className="absolute bottom-0 left-1/4 h-24 w-24 bg-purple-500 rounded-full blur-3xl opacity-10"></div>

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 bg-gradient-to-r from-slate-900 to-indigo-950 bg-clip-text text-transparent">
              Gmail Intelligence Platform
            </h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm text-slate-500">
              <span>Connected as <span className="font-semibold text-slate-700">{user.email}</span></span>
              {stats && (
                <>
                  <span className="hidden sm:inline text-gray-300">•</span>
                  <span>{stats.messageCount.toLocaleString()} emails synced</span>
                  <span className="hidden sm:inline text-gray-300">•</span>
                  <span>{stats.threadCount.toLocaleString()} threads</span>
                </>
              )}
            </div>
            {stats?.lastSyncedAt && (
              <p className="text-[11px] text-gray-400 mt-1">
                Last updated: {new Date(stats.lastSyncedAt).toLocaleString()}
              </p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setActiveView("compose");
                setComposeTo("");
                setComposePrompt("");
                setComposeSubject("");
                setComposeBody("");
                setComposeState("idle");
              }}
              className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 hover:shadow-indigo-100 hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Compose Email
            </button>
            <button
              onClick={() => {
                setActiveView("chat");
              }}
              className="flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-500 hover:shadow-purple-100 hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              AI Chat Agent
            </button>
            <form action="/api/auth/disconnect" method="post">
              <button
                type="submit"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors"
              >
                Disconnect
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Operational Actions Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Sync panel */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm hover:border-indigo-100 transition-all">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Data Synchronization</h3>
          <p className="text-xs text-slate-500 mt-1 mb-4">Keep your mailbox up-to-date with Gmail servers.</p>
          {stats && stats.messageCount > 0 ? (
            <form action="/api/sync/incremental" method="post">
              <button
                type="submit"
                className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 shadow-sm transition-all"
              >
                Sync New Emails
              </button>
            </form>
          ) : (
            <form action="/api/sync/full" method="post">
              <button
                type="submit"
                className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-slate-800 shadow-sm transition-all"
              >
                Sync Inbox
              </button>
            </form>
          )}
        </div>

        {/* Categorization panel */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm hover:border-indigo-100 transition-all">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">AI Categorization</h3>
          <p className="text-xs text-slate-500 mt-1 mb-4">Classify your emails using Gemini + NIM API triage.</p>
          <form action="/api/categorize" method="post">
            <button
              type="submit"
              className="w-full rounded-xl bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 transition-all"
            >
              Categorize Emails
            </button>
          </form>
        </div>

        {/* Summarization panel */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm hover:border-indigo-100 transition-all">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">AI Summarization</h3>
          <p className="text-xs text-slate-500 mt-1 mb-4">Generate concise, high-level summaries for emails.</p>
          <form action="/api/summarize" method="post">
            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 transition-all"
            >
              Summarize Emails
            </button>
          </form>
        </div>

        {/* Vector Embeddings panel */}
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm hover:border-indigo-100 transition-all flex flex-col justify-between">
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Vector Embeddings</h3>
            <p className="text-xs text-slate-500 mt-1 mb-4">Generate embeddings for semantic search in the Chat Agent.</p>
          </div>
          <button
            onClick={handleGenerateEmbeddings}
            disabled={isGeneratingEmbeddings}
            className="w-full rounded-xl bg-purple-50 px-4 py-2.5 text-sm font-semibold text-purple-700 hover:bg-purple-100 transition-all disabled:opacity-50"
          >
            {isGeneratingEmbeddings ? "Generating..." : "Generate Embeddings"}
          </button>
        </div>
      </div>

      {/* Main Workspace Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side: Email List & Categories (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Categories Pillbox */}
          {categoryCounts.length > 0 && (
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Email Categories</h3>
              <div className="flex flex-wrap gap-2">
                {categoryCounts.map(({ category, count }) => (
                  <span
                    key={category}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1 text-xs font-medium ${getCategoryColor(
                      category as Category
                    )}`}
                  >
                    <span>{category}</span>
                    <span className="font-mono bg-white bg-opacity-60 px-1.5 py-0.5 rounded text-[10px]">
                      {count}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Inbox List */}
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="border-b border-gray-100 bg-slate-50 px-5 py-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Recent Synced Messages</h2>
              <span className="text-xs text-slate-400 font-mono">Showing latest {recentMessages.length}</span>
            </div>

            {recentMessages.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                No emails synced yet. Run a synchronization to download messages.
              </div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {recentMessages.map((m) => (
                  <li
                    key={m.id}
                    className="p-5 hover:bg-slate-50/50 transition-colors group relative"
                  >
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-semibold text-slate-600">
                          {m.sender ? m.sender.replace(/<.*>/, "").replace(/"/g, "").trim() : "Unknown Sender"}
                        </span>
                        <span className="text-[10px] text-gray-400 ml-2">
                          {m.received_at ? new Date(m.received_at).toLocaleDateString() : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-semibold tracking-wide ${getCategoryColor(m.category)}`}>
                          {m.category || "Uncategorized"}
                        </span>
                      </div>
                    </div>

                    <h4 className="text-sm font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                      {m.subject || "(no subject)"}
                    </h4>

                    {m.summary ? (
                      <div className="mt-2 text-xs text-slate-600 bg-slate-50 border-l-2 border-indigo-500/60 p-2.5 rounded-r-lg">
                        <span className="font-semibold text-[10px] text-indigo-700 uppercase tracking-wider block mb-0.5">AI Summary</span>
                        {m.summary}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500 line-clamp-2">
                        {m.snippet || "No body content available."}
                      </p>
                    )}

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-50 opacity-100 group-hover:opacity-100 transition-opacity">
                      <span className="text-[10px] text-slate-400 font-mono">
                        ID: {m.id.substring(0, 8)}...
                      </span>
                      <button
                        onClick={() => startReplyFlow(m)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:underline transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                        Reply via AI
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right Side: Working Pane (5 cols) */}
        <div className="lg:col-span-5">
          {/* Welcome Screen */}
          {activeView === "welcome" && (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-slate-50/50 p-8 text-center space-y-4">
              <div className="mx-auto w-12 h-12 rounded-2xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-800">Workspace Workspace</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto">
                  Click the <strong>Compose Email</strong> button above, or click <strong>Reply via AI</strong> on any message to trigger the smart generation helper.
                </p>
              </div>
            </div>
          )}

          {/* Compose New Email Panel */}
          {activeView === "compose" && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-purple-600"></div>
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping"></span>
                  Compose via AI Assistant
                </h3>
                <button
                  onClick={() => setActiveView("welcome")}
                  className="text-slate-400 hover:text-slate-600 text-xs"
                >
                  Close
                </button>
              </div>

              {composeState === "idle" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      1. To (Recipient Email)
                    </label>
                    <input
                      type="email"
                      value={composeTo}
                      onChange={(e) => setComposeTo(e.target.value)}
                      placeholder="recipient@example.com"
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      2. What should this email say? (Short Prompt)
                    </label>
                    <textarea
                      value={composePrompt}
                      onChange={(e) => setComposePrompt(e.target.value)}
                      rows={3}
                      placeholder='e.g., "Write a follow-up to the product team about Q3 launch delay"'
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none transition-colors resize-none"
                    />
                  </div>

                  <button
                    onClick={handleGenerateComposeDraft}
                    disabled={!composePrompt.trim()}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Generate Draft via AI
                  </button>
                </div>
              )}

              {composeState === "generating" && (
                <div className="py-8 text-center space-y-3">
                  <div className="flex justify-center">
                    <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  <p className="text-xs text-indigo-600 font-semibold animate-pulse">
                    AI is writing subject and body...
                  </p>
                </div>
              )}

              {(composeState === "drafted" || composeState === "sending") && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Recipient
                    </label>
                    <input
                      type="email"
                      value={composeTo}
                      onChange={(e) => setComposeTo(e.target.value)}
                      placeholder="recipient@example.com"
                      disabled={composeState === "sending"}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none transition-colors"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Subject
                    </label>
                    <input
                      type="text"
                      value={composeSubject}
                      onChange={(e) => setComposeSubject(e.target.value)}
                      disabled={composeState === "sending"}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none transition-colors font-semibold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Body
                    </label>
                    <textarea
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                      rows={8}
                      disabled={composeState === "sending"}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none transition-colors font-mono"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleSendCompose}
                      disabled={composeState === "sending"}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                      {composeState === "sending" ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Sending...
                        </>
                      ) : (
                        "Send Email"
                      )}
                    </button>
                    <button
                      onClick={() => setComposeState("idle")}
                      disabled={composeState === "sending"}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors disabled:opacity-50"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Reply Panel */}
          {activeView === "reply" && replyParentMsg && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-5 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-indigo-600"></div>
              <div className="flex items-center justify-between border-b border-gray-100 pb-3">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-600 animate-ping"></span>
                  AI Reply Assistant
                </h3>
                <button
                  onClick={() => setActiveView("welcome")}
                  className="text-slate-400 hover:text-slate-600 text-xs"
                >
                  Close
                </button>
              </div>

              {/* Thread Context Display (Scrollable) */}
              <div className="border border-slate-100 rounded-xl bg-slate-50/50 p-3 max-h-48 overflow-y-auto space-y-3">
                <div className="text-[10px] uppercase font-bold tracking-wider text-slate-400 border-b border-slate-100 pb-1.5">
                  Thread History: {replyParentMsg.subject || "(no subject)"}
                </div>
                {isLoadingThread ? (
                  <div className="py-2 text-center text-xs text-slate-400">Loading context history...</div>
                ) : threadHistory.length === 0 ? (
                  <div className="text-xs text-slate-600">
                    <span className="font-semibold block">{replyParentMsg.sender || "Sender"} writes:</span>
                    <p className="mt-1 font-mono leading-relaxed bg-white border border-slate-100 p-2 rounded text-[11px] break-words">
                      {replyParentMsg.snippet}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {threadHistory.map((h, i) => (
                      <div key={i} className="text-xs border-b border-slate-100/50 pb-2 last:border-0 last:pb-0">
                        <span className="font-semibold text-slate-700">
                          {h.sender ? h.sender.replace(/<.*>/, "").replace(/"/g, "").trim() : "Unknown"}
                        </span>
                        <span className="text-[9px] text-slate-400 ml-1.5">{new Date(h.received_at).toLocaleString()}</span>
                        <p className="mt-1 font-mono bg-white border border-slate-100/60 p-2 rounded text-[11px] break-words whitespace-pre-wrap">
                          {h.body_text ? h.body_text.slice(0, 400) + (h.body_text.length > 400 ? "..." : "") : "(empty body)"}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {replyState === "idle" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Replying to
                    </label>
                    <div className="text-xs text-slate-700 bg-slate-100/80 px-3 py-2 rounded-lg font-medium border border-slate-200/50 truncate">
                      {replyParentMsg.sender || "Unknown Sender"}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      What should your reply say? (Short Prompt)
                    </label>
                    <textarea
                      value={replyPrompt}
                      onChange={(e) => setReplyPrompt(e.target.value)}
                      rows={3}
                      placeholder='e.g., "tell them we need 2 more days"'
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none transition-colors resize-none"
                    />
                  </div>

                  <button
                    onClick={handleGenerateReplyDraft}
                    disabled={!replyPrompt.trim()}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-purple-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-purple-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Generate Reply Draft
                  </button>
                </div>
              )}

              {replyState === "generating" && (
                <div className="py-8 text-center space-y-3">
                  <div className="flex justify-center">
                    <div className="w-8 h-8 border-4 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                  <p className="text-xs text-purple-600 font-semibold animate-pulse">
                    AI is drafting reply context...
                  </p>
                </div>
              )}

              {(replyState === "drafted" || replyState === "sending") && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                      Draft Reply Body
                    </label>
                    <textarea
                      value={replyBody}
                      onChange={(e) => setReplyBody(e.target.value)}
                      rows={8}
                      disabled={replyState === "sending"}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none transition-colors font-mono"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleSendReply}
                      disabled={replyState === "sending"}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-colors disabled:opacity-50"
                    >
                      {replyState === "sending" ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Sending...
                        </>
                      ) : (
                        "Send Reply"
                      )}
                    </button>
                    <button
                      onClick={() => setReplyState("idle")}
                      disabled={replyState === "sending"}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors disabled:opacity-50"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI Chat Agent Panel */}
          {activeView === "chat" && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col h-[600px] relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-purple-500 to-indigo-600"></div>
              
              {/* Chat Header */}
              <div className="flex items-center justify-between border-b border-gray-100 pb-3 mb-4 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-600 animate-pulse"></span>
                  <h3 className="text-sm font-bold text-slate-800">
                    AI Knowledge Agent (RAG)
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleResetChat}
                    className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold px-2 py-1 rounded transition-colors"
                  >
                    New Chat
                  </button>
                  <button
                    onClick={() => setActiveView("welcome")}
                    className="text-slate-400 hover:text-slate-600 text-xs px-1"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Chat History Messages */}
              <div className="flex-1 overflow-y-auto pr-1 space-y-4 mb-4 text-xs scrollbar-thin">
                {chatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 p-6 space-y-3">
                    <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center text-purple-500 shrink-0">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-semibold text-slate-700">Semantic Email Chat Assistant</p>
                      <p className="text-[11px] text-slate-400 mt-1 max-w-[250px]">
                        Ask questions about your emails. The agent will retrieve relevant records and cite its references.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {chatMessages.map((msg, i) => (
                      <div
                        key={i}
                        className={`flex flex-col ${
                          msg.role === "user" ? "items-end" : "items-start"
                        }`}
                      >
                        <span className="text-[9px] text-slate-400 mb-1 px-1">
                          {msg.role === "user" ? "You" : "AI Agent"}
                        </span>
                        <div
                          className={`rounded-2xl p-3 max-w-[90%] font-medium leading-relaxed whitespace-pre-wrap break-words border ${
                            msg.role === "user"
                              ? "bg-indigo-600 border-indigo-700 text-white shadow-sm"
                              : "bg-slate-50 border-slate-200 text-slate-800"
                          }`}
                        >
                          {msg.content}

                          {/* Sources list underneath the AI response */}
                          {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
                            <div className="mt-3 pt-2.5 border-t border-slate-200/60 text-[10px]">
                              <span className="font-bold text-indigo-700 uppercase tracking-wider block mb-1">
                                Sources Cited ({msg.sources.length}):
                              </span>
                              <ul className="space-y-1 font-sans text-slate-600">
                                {msg.sources.map((src, sIdx) => {
                                  const dateStr = src.received_at ? new Date(src.received_at).toLocaleDateString() : "Unknown Date";
                                  const name = src.sender ? src.sender.replace(/<.*>/, "").replace(/"/g, "").trim() : "Unknown";
                                  return (
                                    <li key={sIdx} className="bg-white/80 p-1.5 rounded border border-slate-100 flex items-center justify-between gap-2">
                                      <span className="truncate max-w-[180px]">
                                        <strong>{name}</strong>: "{src.subject || "(no subject)"}"
                                      </span>
                                      <span className="text-slate-400 shrink-0 font-mono text-[9px]">
                                        {dateStr}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    
                    {/* Thinking status indicator */}
                    {chatState === "thinking" && (
                      <div className="flex flex-col items-start">
                        <span className="text-[9px] text-slate-400 mb-1 px-1">AI Agent</span>
                        <div className="rounded-2xl p-3 bg-slate-50 border border-slate-200 text-slate-500 flex items-center gap-2">
                          <span className="flex gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce"></span>
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:0.2s]"></span>
                            <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-bounce [animation-delay:0.4s]"></span>
                          </span>
                          <span className="text-[11px] font-semibold text-purple-600 animate-pulse">
                            Searching emails & formulating response...
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Chat Input Bar */}
              <div className="shrink-0 border-t border-gray-100 pt-3 flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSendChatMessage();
                  }}
                  placeholder="Ask a question about your emails..."
                  disabled={chatState === "thinking"}
                  className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs focus:border-indigo-500 focus:outline-none transition-colors"
                />
                <button
                  onClick={handleSendChatMessage}
                  disabled={chatState === "thinking" || !chatInput.trim()}
                  className="rounded-xl bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-500 transition-colors disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

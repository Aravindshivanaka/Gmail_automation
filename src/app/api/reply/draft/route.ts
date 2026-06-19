import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { draftReplyEmail } from "@/lib/gemini";

/**
 * GET /api/reply/draft?thread_id={id}
 * Fetches previous messages in the thread from Supabase to show as conversation history context.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const thread_id = searchParams.get("thread_id");

  if (!thread_id) {
    return NextResponse.json({ error: "Missing thread_id parameter" }, { status: 400 });
  }

  try {
    const { data: messages, error } = await supabase
      .from("messages")
      .select("sender, subject, body_text, received_at")
      .eq("user_id", user.id)
      .eq("thread_id", thread_id)
      .order("received_at", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch thread messages: ${error.message}`);
    }

    return NextResponse.json({ messages: messages || [] });
  } catch (err) {
    console.error("[reply/draft GET] Error fetching context:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/reply/draft
 * Takes a thread_id and a user's reply prompt. Fetches all previous messages
 * in the thread chronologically from Supabase to provide full conversational context,
 * then generates a context-aware reply draft.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { thread_id, prompt } = await req.json();
    if (!thread_id || typeof thread_id !== "string") {
      return NextResponse.json({ error: "Missing thread_id" }, { status: 400 });
    }
    if (!prompt || typeof prompt !== "string") {
      return NextResponse.json({ error: "Missing or invalid prompt" }, { status: 400 });
    }

    // Fetch all messages in the thread from Supabase to construct thread context
    const { data: messages, error } = await supabase
      .from("messages")
      .select("sender, subject, body_text, received_at")
      .eq("user_id", user.id)
      .eq("thread_id", thread_id)
      .order("received_at", { ascending: true }); // Chronological order

    if (error) {
      throw new Error(`Failed to fetch thread messages: ${error.message}`);
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({ error: "Thread not found or has no messages" }, { status: 404 });
    }

    // Build chronological thread history context for the AI
    const threadContext = messages
      .map((msg, idx) => {
        const sender = msg.sender || "Unknown Sender";
        const date = msg.received_at ? new Date(msg.received_at).toLocaleString() : "Unknown Date";
        const body = (msg.body_text || "").trim().slice(0, 1000); // Limit each message text to prevent token overflow
        return `--- Message #${idx + 1} ---\nSender: ${sender}\nDate: ${date}\nSubject: ${msg.subject || ""}\n\n${body}`;
      })
      .join("\n\n");

    const replyBody = await draftReplyEmail(threadContext, prompt);
    return NextResponse.json({ body: replyBody });
  } catch (err) {
    console.error("[reply/draft] Error generating reply draft:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}


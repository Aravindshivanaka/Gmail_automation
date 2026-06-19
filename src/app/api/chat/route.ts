import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { generateEmbedding, generateChatResponse } from "@/lib/gemini";

/**
 * POST /api/chat
 * Main chat handler. Takes a user question and a session_id.
 * Performs similarity search, pulls chat history, creates prompts, and returns responses.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { message, session_id } = await req.json();
    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Missing or invalid message" }, { status: 400 });
    }

    // 1. Establish session_id if not present
    let currentSessionId = session_id;
    if (!currentSessionId) {
      const { data: newSession, error: sessionErr } = await supabase
        .from("chat_sessions")
        .insert({ user_id: user.id })
        .select("id")
        .maybeSingle();

      if (sessionErr || !newSession) {
        throw new Error(`Failed to create chat session: ${sessionErr?.message || "Unknown error"}`);
      }
      currentSessionId = newSession.id;
    }

    // 2. Fetch conversation history context for this session (last 10 messages)
    const { data: history, error: historyErr } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", currentSessionId)
      .order("created_at", { ascending: true })
      .limit(10);

    if (historyErr) {
      console.warn("[chat] Warning: failed to fetch chat history:", historyErr.message);
    }

    // Format chat history for the prompt
    const formattedHistory = (history || [])
      .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
      .join("\n");

    // 3. Generate embedding for the user's question
    const queryEmbedding = await generateEmbedding(message);

    // 4. Perform vector similarity search in Supabase using the match_messages RPC
    // We retrieve the top 6 most relevant emails. Threshold is 0.35.
    const { data: matchedMessages, error: rpcErr } = await supabase
      .rpc("match_messages", {
        query_embedding: queryEmbedding,
        match_threshold: 0.35,
        match_count: 6,
        p_user_id: user.id,
      });

    if (rpcErr) {
      throw new Error(`Vector similarity search failed: ${rpcErr.message}`);
    }

    // 5. Construct semantic context from matched emails
    const emailsContext = (matchedMessages || [])
      .map((msg: any, idx: number) => {
        const sender = msg.sender || "Unknown Sender";
        const date = msg.received_at ? new Date(msg.received_at).toLocaleDateString() : "Unknown Date";
        const body = (msg.body_text || "").trim().slice(0, 1200); // Guard token length per email
        return `[Email #${idx + 1}]\nSender: ${sender}\nDate: ${date}\nSubject: ${msg.subject || "(no subject)"}\nContent: ${body}`;
      })
      .join("\n\n");

    // 6. Build the prompt instructing AI to behave as a factual RAG engine
    // =========================================================================
    // RAG HALLUCINATION GUARD:
    // We strictly instruct the AI to ONLY answer from context and return the
    // exact phrase: "I don't have that information in your emails." if not found.
    // =========================================================================
    const prompt = [
      "You are an AI Email Assistant for the Gmail Intelligence Platform.",
      "Your objective is to answer the user's question using ONLY the content of the provided emails below.",
      "",
      "STRICT RULES:",
      "1. Answer ONLY using the information provided in the RETRIEVED EMAILS below. Do NOT assume, extrapolate, or use general external knowledge.",
      '2. If the emails do not contain the answer to the user\'s question, reply EXACTLY with: "I don\'t have that information in your emails." and nothing else.',
      "3. Synthesize information across multiple emails when necessary to write a coherent, comprehensive answer.",
      "4. Cite your sources directly in your response by noting the sender and date (e.g. \"According to Jane Doe on 6/19/2026...\"). Attribution is mandatory.",
      "5. Treat the Chat History as context for follow-up questions.",
      "",
      "--- RETRIEVED EMAILS ---",
      emailsContext || "No relevant emails found.",
      "",
      "--- CHAT HISTORY ---",
      formattedHistory || "No conversation history yet.",
      "",
      `User Question: ${message}`,
      "",
      "Assistant Response:"
    ].join("\n");

    // 7. Call AI response helper
    const aiAnswer = await generateChatResponse(prompt);

    // 8. Save user question and assistant answer in public.chat_messages
    const { error: saveUserErr } = await supabase
      .from("chat_messages")
      .insert({ session_id: currentSessionId, role: "user", content: message });

    if (saveUserErr) console.error("[chat] Failed to save user message:", saveUserErr.message);

    const { error: saveAiErr } = await supabase
      .from("chat_messages")
      .insert({ session_id: currentSessionId, role: "assistant", content: aiAnswer });

    if (saveAiErr) console.error("[chat] Failed to save assistant message:", saveAiErr.message);

    // 9. Format matched messages as sources to help render inline citations on client side
    const sources = (matchedMessages || []).map((msg: any) => ({
      id: msg.id,
      sender: msg.sender,
      subject: msg.subject,
      received_at: msg.received_at,
      similarity: msg.similarity,
    }));

    return NextResponse.json({
      session_id: currentSessionId,
      answer: aiAnswer,
      sources,
    });

  } catch (err: any) {
    console.error("[chat] Error processing question:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}

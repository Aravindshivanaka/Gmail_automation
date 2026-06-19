import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { getValidAccessToken } from "@/lib/google";
import { getMessage, sendGmailMessage } from "@/lib/gmail";

/**
 * POST /api/reply/send
 * Takes the reply body and thread_id, fetches the latest message in the thread to get its
 * RFC 822 Message-ID and References headers, constructs the response email with proper
 * threading headers, and sends it via Gmail REST API.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { thread_id, body } = await req.json();
    if (!thread_id || typeof thread_id !== "string") {
      return NextResponse.json({ error: "Missing thread_id" }, { status: 400 });
    }
    if (!body || typeof body !== "string") {
      return NextResponse.json({ error: "Missing body" }, { status: 400 });
    }

    // 1. Find the latest message in this thread from Supabase to find its Gmail message ID.
    // We order by received_at desc so we reply to the actual most recent message.
    const { data: latestMsg, error: dbError } = await supabase
      .from("messages")
      .select("id")
      .eq("user_id", user.id)
      .eq("thread_id", thread_id)
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dbError) {
      throw new Error(`Failed to find latest message in thread: ${dbError.message}`);
    }
    if (!latestMsg) {
      return NextResponse.json({ error: "Thread contains no synced messages" }, { status: 404 });
    }

    // 2. Fetch the full message details from the Gmail API using the access token.
    // This is necessary because Supabase doesn't store the low-level MIME headers
    // like RFC 822 Message-ID and References which are needed for threading.
    const accessToken = await getValidAccessToken(user);
    const originalMsg = await getMessage(accessToken, latestMsg.id);

    const headers = originalMsg.payload?.headers ?? [];
    const findHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;

    const originalMessageId = findHeader("message-id");
    const originalReferences = findHeader("references") || "";
    const originalSubject = findHeader("subject") || "";
    const originalFrom = findHeader("from") || "";

    if (!originalFrom) {
      return NextResponse.json({ error: "Could not determine recipient (From header missing)" }, { status: 400 });
    }

    // Formulate reply subject: prepend "Re: " if not already present
    let replySubject = originalSubject;
    if (replySubject && !/^re:/i.test(replySubject)) {
      replySubject = `Re: ${replySubject}`;
    }

    // 3. Construct the raw MIME email message.
    // =========================================================================
    // WHY IN-REPLY-TO AND REFERENCES MATTER (HOW THREADING WORKS):
    // =========================================================================
    // To make an email show up as a reply under the same thread in standard
    // email clients, we must set specific RFC 822 threading headers:
    //
    // 1. In-Reply-To: This contains the globally unique Message-ID header value
    //    of the parent message we are replying to. It links this message directly
    //    as a child of the parent message.
    //
    // 2. References: This contains a space-separated list of Message-IDs of all
    //    preceding messages in the thread, in chronological order. This establishes
    //    the complete history/lineage of the conversation. Standard behavior is:
    //    - If the parent message had a References header, copy its value and append
    //      the parent message's Message-ID at the end.
    //    - If the parent message did not have a References header, use just the
    //      parent message's Message-ID.
    //
    // 3. Gmail threadId: In addition to MIME headers, the Gmail REST API itself
    //    requires us to pass the "threadId" in the request body. This instructs
    //    Gmail to group the message under the exact same conversation thread inside
    //    the Gmail database/web application.
    // =========================================================================
    const mimeParts = [
      `To: ${originalFrom}`,
      `Subject: ${replySubject}`,
    ];

    if (originalMessageId) {
      // Append the parent message's Message-ID to its own References list
      const referencesHeader = originalReferences
        ? `${originalReferences.trim()} ${originalMessageId.trim()}`
        : originalMessageId.trim();

      mimeParts.push(`In-Reply-To: ${originalMessageId}`);
      mimeParts.push(`References: ${referencesHeader}`);
    }

    mimeParts.push("Content-Type: text/plain; charset=utf-8");
    mimeParts.push("MIME-Version: 1.0");
    mimeParts.push("");
    mimeParts.push(body);

    const rawMime = mimeParts.join("\r\n");

    // 4. Send the message. We pass thread_id so the Gmail API correctly links it on Google's side.
    const result = await sendGmailMessage(accessToken, rawMime, thread_id);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[reply/send] Error sending reply:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

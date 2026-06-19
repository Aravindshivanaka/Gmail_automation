import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getValidAccessToken } from "@/lib/google";
import { sendGmailMessage } from "@/lib/gmail";

/**
 * POST /api/compose/send
 * Takes the recipient, subject, and body from the frontend, exchanges or refreshes
 * the Gmail OAuth access token, and sends the email via the Gmail API.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { to, subject, body } = await req.json();
    if (!to || typeof to !== "string") {
      return NextResponse.json({ error: "Missing recipient (to)" }, { status: 400 });
    }
    if (!subject || typeof subject !== "string") {
      return NextResponse.json({ error: "Missing subject" }, { status: 400 });
    }
    if (!body || typeof body !== "string") {
      return NextResponse.json({ error: "Missing body" }, { status: 400 });
    }

    // Refresh access token silently if expired
    const accessToken = await getValidAccessToken(user);

    // Build a standard RFC 822 formatted email message string
    const mimeParts = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/plain; charset=utf-8`,
      `MIME-Version: 1.0`,
      ``,
      body,
    ];
    const rawMime = mimeParts.join("\r\n");

    const result = await sendGmailMessage(accessToken, rawMime);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("[compose/send] Error sending email:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

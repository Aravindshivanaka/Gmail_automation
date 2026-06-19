import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import { generateEmbedding } from "@/lib/gemini";

const BATCH_SIZE = 10;
const DELAY_MS = 2000; // Pause for 2s between embedding calls to prevent rate limits

/**
 * POST /api/embeddings/generate
 * Fetches up to 10 messages for the logged-in user that do not have embeddings yet,
 * generates a 768-dimensional vector embedding for each from its subject and body text,
 * and writes the vector float array back to the DB.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Fetch messages without embeddings
    const { data: messages, error: selectErr } = await supabase
      .from("messages")
      .select("id, subject, body_text, snippet")
      .eq("user_id", user.id)
      .is("embedding", null)
      .limit(BATCH_SIZE);

    if (selectErr) {
      throw new Error(`Failed to query unembedded messages: ${selectErr.message}`);
    }

    if (!messages || messages.length === 0) {
      return NextResponse.json({ processed: 0, message: "All emails are already embedded." });
    }

    let processedCount = 0;

    for (const msg of messages) {
      try {
        // Construct clear content for embedding: combining subject + body/snippet
        const subject = msg.subject || "";
        const body = msg.body_text || msg.snippet || "";
        const textToEmbed = `Subject: ${subject}\n\nContent: ${body}`.trim();

        if (textToEmbed) {
          const vector = await generateEmbedding(textToEmbed);

          // Update message with embedding vector array
          const { error: updateErr } = await supabase
            .from("messages")
            .update({ embedding: vector })
            .eq("user_id", user.id)
            .eq("id", msg.id);

          if (updateErr) {
            console.error(`[embeddings] Error saving embedding for ${msg.id}:`, updateErr.message);
          } else {
            processedCount++;
          }
        }
      } catch (err: any) {
        console.error(`[embeddings] Error generating embedding for message ${msg.id}:`, err.message || err);
      }

      // Add a rate limit pause before the next iteration
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }

    return NextResponse.json({
      processed: processedCount,
      message: `Successfully generated and saved ${processedCount} embeddings.`,
    });
  } catch (err: any) {
    console.error("[embeddings] Pipeline error:", err);
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}

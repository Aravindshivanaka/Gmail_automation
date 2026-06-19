import "server-only";

/**
 * ============================================================================
 * GEMINI API CLIENT — used for email categorization (Stage 3)
 * ============================================================================
 *
 * This module is the ONLY place that talks to the Google Gemini API. It:
 *   - holds the list of allowed categories,
 *   - holds the CLASSIFICATION PROMPT (the most important thing to explain),
 *   - exposes one function: classifyEmail(subject, snippet) → Category.
 *
 * It does NOT touch Supabase. The orchestration ("fetch uncategorized → call
 * me → write back") lives in ./categorize.ts. Keeping these separate means you
 * can change the prompt or model here without touching anything else.
 *
 * API DETAILS
 *   Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/
 *                     {model}:generateContent
 *   Auth:     x-goog-api-key header (the GEMINI_API_KEY env var)
 *
 * MODEL CHOICE — gemini-2.5-flash
 *   We use `gemini-2.5-flash`. The older `gemini-2.0-flash` was shut down on
 *   June 1, 2026, so it must not be used. 2.5-flash is the current stable,
 *   fast, cheap model — ideal for a simple single-label classification task.
 *   (2.5-pro would also work but is slower/costlier and overkill here.)
 * ============================================================================
 */

/** The 6 — and only 6 — categories the model is allowed to output. */
export const CATEGORIES = [
  "Newsletter",
  "Job/Recruitment",
  "Finance",
  "Notifications",
  "Personal",
  "Work/Professional",
] as const;

export type Category = (typeof CATEGORIES)[number];

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// -----------------------------------------------------------------------------
// The classification prompt (read this — it's the part you'll explain).
// -----------------------------------------------------------------------------

/**
 * Builds the instruction string sent to Gemini alongside each email.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS PROMPT IS SHAPED THE WAY IT IS — explain these points if asked:
 * ---------------------------------------------------------------------------
 *
 * 1. "You are an email triage assistant."
 *    Giving the model a ROLE narrows its behavior. "Triage assistant" implies
 *    fast, practical sorting — not a creative writing task. LLMs behave more
 *    reliably when assigned a clear persona.
 *
 * 2. The categories are listed explicitly and numbered.
 *    We show the exact 6 labels we accept. Numbering helps the model treat
 *    them as a closed set (pick one of these) rather than inventing new ones.
 *
 * 3. Definitions for each category.
 *    The categories overlap (e.g. a recruiter email could be "Job/Recruitment"
 *    OR "Work/Professional"). One-line definitions disambiguate. This is the
 *    single biggest lever on classification quality.
 *
 * 4. "Reply with ONLY the category name ... no other text."
 *    We want a machine-parseable answer. If the model adds explanation, we'd
 *    have to parse prose. Forcing a bare label makes parsing trivial and
 *    cuts tokens (cheaper, faster). We set temperature=0 for the same reason.
 *
 * 5. "If you are unsure, choose Work/Professional."
 *    Every email must get exactly one category, and the application requires
 *    a non-NULL value. Rather than risk a NULL (which would leave the message
 *    stuck/un-categorized forever), we pick the safest default. We chose
 *    Work/Professional because it's the broadest catch-all for an inbox whose
 *    owner is presumably a professional — most ambiguous emails (cold
 *    outreach, SaaS updates, generic confirmations) read as "work-ish".
 *
 * 6. Snippet is trimmed to ~500 chars.
 *    Gemini charges by the token; long emails add cost without improving
 *    classification of the *gist*. The first ~500 chars (greeting + opening)
 *    are almost always enough to tell a newsletter from a bank statement.
 *
 * AMBIGUOUS EMAILS — how they're handled:
 *   - Recruiter outreach → "Job/Recruitment" (explicitly distinguished from
 *     generic Work/Professional).
 *   - Bank/credit-card/investment statements → "Finance".
 *   - Receipts/shipping/2FA codes → "Notifications".
 *   - Mass-send newsletters → "Newsletter" (even if from a "work" sender).
 *   - One-to-one human emails → "Personal".
 *   - Anything genuinely unclear → "Work/Professional" (the documented default).
 */
function buildPrompt(subject: string, snippet: string): string {
  // Defensive trimming: never send huge bodies or weird whitespace to the API.
  const cleanSubject = (subject ?? "").trim().slice(0, 200);
  const cleanSnippet = (snippet ?? "").trim().slice(0, 500);

  return [
    "You are an email triage assistant. Classify the email below into exactly ONE of these categories:",
    "",
    "1. Newsletter — recurring mass-send content (digests, product/blog updates, marketing campaigns).",
    "2. Job/Recruitment — recruiter outreach, application updates, interview invites, job alerts.",
    "3. Finance — bank statements, invoices, receipts from payment processors, tax/audit, investment account notices.",
    "4. Notifications — account/security alerts, shipping updates, 2FA codes, calendar reminders, automated system notices.",
    "5. Personal — one-to-one messages from a real human on a non-work topic (friends, family, personal services).",
    "6. Work/Professional — business correspondence, internal company updates, SaaS/product notifications tied to your job, meetings, and anything professional that doesn't fit the above.",
    "",
    "Rules:",
    "- Reply with ONLY the category name from the list above. No punctuation, no explanation, no other text.",
    "- If you are unsure or the email spans multiple categories, choose Work/Professional.",
    "",
    "Email:",
    `Subject: ${cleanSubject}`,
    `Body: ${cleanSnippet}`,
  ].join("\n");
}

// -----------------------------------------------------------------------------
// NVIDIA NIM Fallback helper
// -----------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls the NVIDIA NIM API (which is OpenAI-compatible) as a fallback when
 * Gemini hits its rate limit (429/RESOURCE_EXHAUSTED).
 * Has a retry-once mechanism for NIM 429 errors (waits 5 seconds before retrying).
 */
async function callNvidiaNim(prompt: string, maxTokens: number): Promise<string> {
  const nimApiKey = process.env.NVIDIA_NIM_API_KEY?.trim();
  const nimBaseUrl = (process.env.NVIDIA_NIM_BASE_URL || "https://integrate.api.nvidia.com/v1").trim();

  if (!nimApiKey) {
    throw new Error("Missing env var: NVIDIA_NIM_API_KEY");
  }

  const endpoint = `${nimBaseUrl}/chat/completions`;

  const makeRequest = () => {
    return fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${nimApiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemma-4-31b-it",
        messages: [
          { role: "user", content: prompt }
        ],
        temperature: 0,
        max_tokens: maxTokens,
      }),
    });
  };

  let res = await makeRequest();

  if (!res.ok) {
    const detail = await res.text();
    // If NIM fails with 429 or similar rate limit indicators, wait 5 seconds and try one more time
    if (res.status === 429 || detail.includes("RESOURCE_EXHAUSTED") || detail.includes("quota")) {
      console.warn(`[nim] NVIDIA NIM rate limit hit (429). Retrying in 5 seconds...`);
      await sleep(5000);
      res = await makeRequest();
      if (!res.ok) {
        const retryDetail = await res.text();
        throw new Error(`NVIDIA NIM API error after retry ${res.status}: ${retryDetail}`);
      }
    } else {
      throw new Error(`NVIDIA NIM API error ${res.status}: ${detail}`);
    }
  }

  const data = (await res.json()) as {
    choices?: Array<{
      message?: { content?: string };
    }>;
  };

  return data.choices?.[0]?.message?.content ?? "";
}

// -----------------------------------------------------------------------------
// Public entry points.
// -----------------------------------------------------------------------------

/**
 * Calls Gemini to classify one email. Returns one of the 6 categories.
 * If the Gemini API call fails with a 429 or RESOURCE_EXHAUSTED error,
 * it automatically falls back to NVIDIA NIM.
 * Logs whether "gemini" or "nim" was used.
 */
export async function classifyEmail(
  subject: string,
  snippet: string,
): Promise<Category> {
  const prompt = buildPrompt(subject, snippet);

  if (process.env.SKIP_GEMINI === "true") {
    console.log(`[gemini] SKIP_GEMINI is set to true. Bypassing Gemini, calling NVIDIA NIM directly for categorization.`);
    const nimRaw = await callNvidiaNim(prompt, 50);
    console.log(`[AI] model_used: nim (task: categorization)`);
    return normalizeCategory(nimRaw);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing env var: GEMINI_API_KEY");

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 50,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      // Check for rate limit status (429) or message indicating exhaustion/quota
      if (res.status === 429 || detail.includes("RESOURCE_EXHAUSTED") || detail.includes("quota")) {
        console.warn(`[gemini] rate limit hit (429/RESOURCE_EXHAUSTED). Falling back to NVIDIA NIM.`);
        const nimRaw = await callNvidiaNim(prompt, 50);
        console.log(`[AI] model_used: nim (task: categorization)`);
        return normalizeCategory(nimRaw);
      }
      throw new Error(`Gemini API error ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log(`[AI] model_used: gemini (task: categorization)`);
    return normalizeCategory(raw);

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("quota")) {
      console.warn(`[gemini] rate limit caught in catch block. Falling back to NVIDIA NIM.`);
      const nimRaw = await callNvidiaNim(prompt, 50);
      console.log(`[AI] model_used: nim (task: categorization)`);
      return normalizeCategory(nimRaw);
    }
    throw err;
  }
}

/**
 * Builds the instruction string sent to the model for email summarization.
 * 
 * WHY THIS PROMPT IS SHAPED THE WAY IT IS:
 * 1. "You are an email summarization assistant." - Narrow the model's role.
 * 2. Requires exactly "2-3 sentences" - Keeps it concise for homepage display.
 * 3. Mandates capturing "who sent it, key point, any action required" - Ensures 
 *    the most important contextual metadata is extracted.
 */
function buildSummarizationPrompt(subject: string, sender: string, bodyText: string): string {
  const cleanSubject = (subject ?? "").trim().slice(0, 200);
  const cleanSender = (sender ?? "unknown sender").trim().slice(0, 200);
  const cleanBody = (bodyText ?? "").trim().slice(0, 2000);

  return [
    "You are an email summarization assistant.",
    "Provide a clear, concise summary of the email below in exactly 2-3 sentences.",
    "Your summary must capture: (1) who sent the email, (2) the main key point/reason it was sent, and (3) any action items or responses required.",
    "",
    "Email Details:",
    `From: ${cleanSender}`,
    `Subject: ${cleanSubject}`,
    `Body: ${cleanBody}`,
  ].join("\n");
}

/**
 * Summarizes an email using Gemini. If it hits a rate limit, falls back to NVIDIA NIM.
 * Logs whether "gemini" or "nim" was used.
 */
export async function summarizeEmail(
  subject: string,
  sender: string,
  bodyText: string,
): Promise<string> {
  const prompt = buildSummarizationPrompt(subject, sender, bodyText);

  if (process.env.SKIP_GEMINI === "true") {
    console.log(`[gemini] SKIP_GEMINI is set to true. Bypassing Gemini, calling NVIDIA NIM directly for email summarization.`);
    const nimSummary = await callNvidiaNim(prompt, 300);
    console.log(`[AI] model_used: nim (task: summarization)`);
    return nimSummary;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing env var: GEMINI_API_KEY");

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 300,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      if (res.status === 429 || detail.includes("RESOURCE_EXHAUSTED") || detail.includes("quota")) {
        console.warn(`[gemini] rate limit hit (429/RESOURCE_EXHAUSTED) on summarization. Falling back to NVIDIA NIM.`);
        const nimSummary = await callNvidiaNim(prompt, 300);
        console.log(`[AI] model_used: nim (task: summarization)`);
        return nimSummary;
      }
      throw new Error(`Gemini API error ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log(`[AI] model_used: gemini (task: summarization)`);
    return raw;

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("quota")) {
      console.warn(`[gemini] rate limit caught on summarization. Falling back to NVIDIA NIM.`);
      const nimSummary = await callNvidiaNim(prompt, 300);
      console.log(`[AI] model_used: nim (task: summarization)`);
      return nimSummary;
    }
    throw err;
  }
}

/**
 * Builds the instruction string sent to the model for thread summarization.
 * 
 * WHY THIS PROMPT IS SHAPED THE WAY IT IS:
 * 1. Requires a cohesive "3-4 sentence summary" - Bounded size, ideal for high-level summaries.
 * 2. Mandates covering "what the thread is about, how it evolved, and the current status/outcome" -
 *    This forces the model to reason over the full conversation arc (who said what to whom chronologically)
 *    rather than just looking at the latest message, capturing the evolution of thoughts and ultimate outcomes.
 */
function buildThreadSummarizationPrompt(subject: string, conversationText: string): string {
  const cleanSubject = (subject ?? "").trim().slice(0, 200);
  const cleanConversation = (conversationText ?? "").trim().slice(0, 4000);

  return [
    "You are a conversation thread summarization assistant.",
    "You will be given a chronological sequence of email messages belonging to a single email conversation thread.",
    "Analyze the entire conversation arc carefully, tracking the evolution of the replies and the final outcome.",
    "Provide a clear, cohesive summary of the entire thread in exactly 3-4 sentences.",
    "Your summary must cover: (1) what the thread is about, (2) how the discussion evolved over the replies, and (3) the current status or final outcome/agreement.",
    "Do not just summarize the latest message. You must reason over the entire conversation arc.",
    "",
    "Thread Details:",
    `Subject: ${cleanSubject}`,
    `Conversation History (oldest to newest):`,
    cleanConversation,
  ].join("\n");
}

/**
 * Summarizes an email thread using Gemini. If it hits a rate limit, falls back to NVIDIA NIM.
 * Logs whether "gemini" or "nim" was used.
 */
export async function summarizeThread(
  subject: string,
  conversationText: string,
): Promise<string> {
  const prompt = buildThreadSummarizationPrompt(subject, conversationText);

  if (process.env.SKIP_GEMINI === "true") {
    console.log(`[gemini] SKIP_GEMINI is set to true. Bypassing Gemini, calling NVIDIA NIM directly for thread summarization.`);
    const nimSummary = await callNvidiaNim(prompt, 400);
    console.log(`[AI] model_used: nim (task: thread-summarization)`);
    return nimSummary;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing env var: GEMINI_API_KEY");

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 400,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      if (res.status === 429 || detail.includes("RESOURCE_EXHAUSTED") || detail.includes("quota")) {
        console.warn(`[gemini] rate limit hit (429/RESOURCE_EXHAUSTED) on thread summarization. Falling back to NVIDIA NIM.`);
        const nimSummary = await callNvidiaNim(prompt, 400);
        console.log(`[AI] model_used: nim (task: thread-summarization)`);
        return nimSummary;
      }
      throw new Error(`Gemini API error ${res.status}: ${detail}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log(`[AI] model_used: gemini (task: thread-summarization)`);
    return raw;

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED") || errorMsg.includes("quota")) {
      console.warn(`[gemini] rate limit caught on thread summarization. Falling back to NVIDIA NIM.`);
      const nimSummary = await callNvidiaNim(prompt, 400);
      console.log(`[AI] model_used: nim (task: thread-summarization)`);
      return nimSummary;
    }
    throw err;
  }
}

/**
 * Maps Gemini's raw text to one of our 6 categories. If it doesn't cleanly
 * match, defaults to "Work/Professional" and logs — per the requirement that
 * we never crash on a weird response.
 *
 * The model is instructed to reply with just the label, but LLMs sometimes
 * add quotes, periods, or trailing words ("Work/Professional."). We strip
 * common noise before matching. Matching is case-insensitive.
 */
function normalizeCategory(raw: string): Category {
  const cleaned = raw
    .trim()
    .replace(/^["'`]+|["'`.\s]+$/g, "") // strip surrounding quotes / trailing punctuation
    .trim();

  // Direct case-insensitive match against our 6 known labels.
  const match = CATEGORIES.find(
    (c) => c.toLowerCase() === cleaned.toLowerCase(),
  );
  if (match) return match;

  // The model said something unexpected. Default per spec and log it so we
  // can spot prompt issues during testing.
  console.warn(
    `[gemini] unrecognized category response: "${raw}" — defaulting to Work/Professional`,
  );
  return "Work/Professional";
}

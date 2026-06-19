import { getCurrentUser } from "@/lib/session";
import { getSyncStats } from "@/lib/sync";
import { getCategoryCounts, getRecentMessages } from "@/lib/categorize";
import type { Category } from "@/lib/gemini";

/**
 * Homepage.
 *
 * This is a Server Component, which means it runs on the server (not in the
 * browser) and can read cookies/database directly via getCurrentUser(). That
 * lets us render different content for logged-in vs anonymous visitors with
 * no client-side JavaScript.
 *
 * States:
 *   - Not logged in → show a "Connect Gmail" button linking to /api/auth/login
 *   - Logged in     → show "Connected as [email]" + Disconnect button
 *                     (Stage 2) + sync controls + counts + last-sync time
 *                     (Stage 3) + categorize button + breakdown + tagged list
 *
 * URL query params (set by the various API routes on redirect):
 *   ?auth_success / ?auth_error  — from the OAuth callback (Stage 1)
 *   ?sync_success / ?sync_error  — from the sync routes (Stage 2)
 *   ?cat_success  / ?cat_error   — from the categorize route (Stage 3)
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    auth_success?: string;
    auth_error?: string;
    sync_success?: string;
    sync_error?: string;
    cat_success?: string;
    cat_error?: string;
    sum_success?: string;
    sum_error?: string;
  }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  // Stage 2: only fetch sync stats if logged in (otherwise the tables hold
  // nothing relevant and we'd waste a query).
  const stats = user ? await getSyncStats(user.id) : null;
  const hasSynced = !!stats && stats.messageCount > 0;

  // Stage 3: category breakdown + recent messages for the tagged list.
  // Only fetched when logged in AND sync has produced messages to categorize.
  const [categoryCounts, recentMessages] =
    user && hasSynced
      ? await Promise.all([
          getCategoryCounts(user.id),
          getRecentMessages(user.id, 20),
        ])
      : [[], []];

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold">Gmail Intelligence Platform</h1>
        <p className="mb-6 text-sm text-gray-500">Stage 4 — summarization.</p>

        {/* Success banner after a completed OAuth flow. */}
        {params.auth_success && (
          <div className="mb-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">
            Gmail connected successfully.
          </div>
        )}

        {/* Error banner if OAuth went wrong. */}
        {params.auth_error && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
            Could not connect: {params.auth_error}
          </div>
        )}

        {/* Stage 2: sync result banners. */}
        {params.sync_success && (
          <div className="mb-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">
            Synced: {params.sync_success}
          </div>
        )}
        {params.sync_error && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
            Sync failed: {params.sync_error}
          </div>
        )}

        {/* Stage 3: categorize result banners. */}
        {params.cat_success && (
          <div className="mb-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">
            Categorized: {params.cat_success}
          </div>
        )}
        {params.cat_error && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
            Categorize failed: {params.cat_error}
          </div>
        )}

        {/* Stage 4: summarize result banners. */}
        {params.sum_success && (
          <div className="mb-4 rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">
            Summarized: {params.sum_success}
          </div>
        )}
        {params.sum_error && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
            Summarize failed: {params.sum_error}
          </div>
        )}

        {user ? (
          /* ---------- LOGGED IN ---------- */
          <div className="space-y-6">
            <div className="space-y-1">
              <p className="text-sm">
                Connected as <span className="font-medium">{user.email}</span>
              </p>

              {/* Stage 2: counts + last sync time. */}
              {stats && (
                <p className="text-xs text-gray-500">
                  {stats.messageCount.toLocaleString()} emails,{" "}
                  {stats.threadCount.toLocaleString()} threads
                  {stats.lastSyncedAt && (
                    <>
                      {" "}
                      · last synced{" "}
                      {new Date(stats.lastSyncedAt).toLocaleString()}
                    </>
                  )}
                </p>
              )}
            </div>

            {/* Stage 2: sync controls.
                - First time → "Sync Inbox" (full sync)
                - After that → "Sync new emails" (incremental) */}
            <div className="space-y-2">
              {hasSynced ? (
                <form action="/api/sync/incremental" method="post">
                  <button
                    type="submit"
                    className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
                  >
                    Sync new emails
                  </button>
                </form>
              ) : (
                <form action="/api/sync/full" method="post">
                  <button
                    type="submit"
                    className="w-full rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
                  >
                    Sync Inbox
                  </button>
                </form>
              )}
              <p className="text-center text-xs text-gray-400">
                {hasSynced
                  ? "Fetches only new mail since the last sync."
                  : "First sync downloads your whole inbox — may take a while."}
              </p>
            </div>

            {/* Stage 3: categorize controls.
                Visible once at least some messages are synced. Classifies
                every uncategorized email via Gemini. */}
            {hasSynced && (
              <div className="space-y-2">
                <form action="/api/categorize" method="post">
                  <button
                    type="submit"
                    className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    Categorize Emails
                  </button>
                </form>
                <p className="text-center text-xs text-gray-400">
                  Sends subject + snippet to Gemini AI; runs in batches of 10.
                </p>
              </div>
            )}

            {/* Stage 4: summarize controls.
                Visible once at least some messages are synced. Summarizes
                all unsummarized emails and threads. */}
            {hasSynced && (
              <div className="space-y-2">
                <form action="/api/summarize" method="post">
                  <button
                    type="submit"
                    className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
                  >
                    Summarize Emails
                  </button>
                </form>
                <p className="text-center text-xs text-gray-400">
                  Generates summaries for messages and threads; runs in batches of 10.
                </p>
              </div>
            )}

            {/* Stage 3: category breakdown (only shown once any have been categorized). */}
            {hasSynced && categoryCounts.length > 0 && (
              <div className="space-y-2 rounded-md bg-gray-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Categories
                </p>
                <ul className="space-y-1">
                  {categoryCounts.map(({ category, count }) => (
                    <li
                      key={category}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-gray-700">{category}</span>
                      <span className="font-mono text-gray-500">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Stage 3: recent emails with category tags.
                This is the tagged email list (requirement #4). Stage 2 had no
                list, so this is added here. */}
            {hasSynced && recentMessages.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Recent emails
                </p>
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-md border border-gray-100">
                  {recentMessages.map((m) => (
                    <li key={m.id} className="px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">
                            {m.subject || "(no subject)"}
                          </p>
                          {m.summary && (
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 pr-2" title={m.summary}>
                              {m.summary.slice(0, 100)}{m.summary.length > 100 ? "..." : ""}
                            </p>
                          )}
                          <p className="truncate text-xs text-gray-400 mt-0.5">
                            {m.sender || "unknown sender"}
                            {m.received_at && (
                              <> · {new Date(m.received_at).toLocaleString()}</>
                            )}
                          </p>
                        </div>
                        <CategoryTag category={m.category} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Stage 1: disconnect (unchanged). */}
            <form action="/api/auth/disconnect" method="post">
              <button
                type="submit"
                className="w-full rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Disconnect
              </button>
            </form>
          </div>
        ) : (
          /* ---------- LOGGED OUT ---------- */
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Connect your Gmail account to get started.
            </p>
            <a
              href="/api/auth/login"
              className="block w-full rounded-md bg-gray-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-gray-700"
            >
              Connect Gmail
            </a>
          </div>
        )}
      </div>
    </main>
  );
}

/**
 * Small colored label for a category, shown next to each email.
 * Pure presentational helper — colors are arbitrary but consistent per category.
 * Renders nothing if the message hasn't been categorized yet.
 */
function CategoryTag({ category }: { category: Category | null }) {
  if (!category) return null;

  const color: Record<Category, string> = {
    Newsletter: "bg-purple-100 text-purple-700",
    "Job/Recruitment": "bg-blue-100 text-blue-700",
    Finance: "bg-green-100 text-green-700",
    Notifications: "bg-yellow-100 text-yellow-700",
    Personal: "bg-pink-100 text-pink-700",
    "Work/Professional": "bg-gray-200 text-gray-700",
  };

  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        color[category]
      }`}
    >
      {category}
    </span>
  );
}

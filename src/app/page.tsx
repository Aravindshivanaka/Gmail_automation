import { getCurrentUser } from "@/lib/session";
import { getSyncStats } from "@/lib/sync";

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
 *
 * URL query params (set by the various API routes on redirect):
 *   ?auth_success / ?auth_error  — from the OAuth callback (Stage 1)
 *   ?sync_success / ?sync_error  — from the sync routes (Stage 2)
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    auth_success?: string;
    auth_error?: string;
    sync_success?: string;
    sync_error?: string;
  }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();

  // Stage 2: only fetch sync stats if logged in (otherwise the tables hold
  // nothing relevant and we'd waste a query).
  const stats = user ? await getSyncStats(user.id) : null;
  const hasSynced = !!stats && stats.messageCount > 0;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold">Gmail Intelligence Platform</h1>
        <p className="mb-6 text-sm text-gray-500">Stage 2 — OAuth + inbox sync.</p>

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

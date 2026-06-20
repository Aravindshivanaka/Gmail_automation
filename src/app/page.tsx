import { getCurrentUser } from "@/lib/session";
import { getSyncStats } from "@/lib/sync";
import { getCategoryCounts, getRecentMessages } from "@/lib/categorize";
import EmailDashboard from "@/app/components/EmailDashboard";

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
 *   - Logged in     → show the interactive EmailDashboard component containing
 *                     Compose, Reply, Sync, Categorization, and Summarization tools.
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
    <main className="flex min-h-screen flex-col items-center justify-center p-4 md:p-8 bg-gray-50">
      {user ? (
        /* ---------- LOGGED IN (Dashboard view) ---------- */
        <div className="w-full max-w-7xl">
          <EmailDashboard
            user={{ id: user.id, email: user.email }}
            stats={stats}
            categoryCounts={categoryCounts}
            recentMessages={recentMessages}
            banners={params}
          />
        </div>
      ) : (
        /* ---------- LOGGED OUT (Login card) ---------- */
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 shadow-sm">
          <h1 className="mb-1 text-2xl font-semibold text-center">Gmail Intelligence Platform</h1>
          <p className="mb-6 text-sm text-gray-500 text-center">Stage 5 — AI Compose & Reply</p>
          <div className="space-y-4">
            {params.auth_error && (
              <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">
                Could not connect: {params.auth_error}
              </div>
            )}
            <p className="text-sm text-gray-600 text-center">
              Connect your Gmail account to get started.
            </p>
            <a
              href="/api/auth/login"
              className="block w-full rounded-md bg-gray-900 px-4 py-2 text-center text-sm font-medium text-white hover:bg-gray-700 transition-colors"
            >
              Connect Gmail
            </a>
          </div>
        </div>
      )}
    </main>
  );
}


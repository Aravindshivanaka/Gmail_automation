# Gmail Intelligence Platform — Stage 1

Stage 1 scope: **project setup + working Gmail OAuth login** only. No email
syncing, no AI features, no UI polish yet. Those come in later stages.

This README explains the OAuth flow at a non-coder level, lists what each file
does, walks you through configuring Google Cloud Console + Supabase, and shows
how to verify login works end-to-end.

---

## The OAuth flow in plain English

OAuth 2.0 lets a user grant your app access to their Gmail **without ever
giving you their password**. Instead, they log in to Google, Google shows them
what your app wants to do ("read your emails", "send email on your behalf"),
and if they click Allow, Google hands you a *token* you can use like a VIP
pass to the Gmail API.

The flow has three legs:

1. **Login** — User clicks "Connect Gmail". We send them to a Google URL.
   Google shows a consent screen listing the permissions we asked for.
2. **Callback** — After the user approves, Google redirects their browser back
   to us with a one-time `code` in the URL. Our server silently trades that
   code (plus our secret) for two real tokens:
   - `access_token` — short-lived (1 hour). Used to call Gmail.
   - `refresh_token` — long-lived. Used to get new access tokens silently.
3. **Refresh** — When the access token expires, we use the refresh token to
   ask Google for a new one. The user never sees this; they stay "logged in".

We store both tokens in Supabase, keyed by the user's Google ID.

---

## File map

```
.
├── .env.local                # your real secrets (gitignored, NEVER commit)
├── .env.example              # same variable names, no values (safe to commit)
├── .gitignore                # ensures .env.local is never committed
├── package.json              # dependency list + npm scripts
├── tsconfig.json             # TypeScript config
├── next.config.mjs           # Next.js config
├── tailwind.config.ts        # Tailwind config (scans src/** for classes)
├── postcss.config.mjs        # PostCSS (Tailwind's processor)
└── src/
    ├── app/
    │   ├── layout.tsx        # root layout (sets <html>, imports global CSS)
    │   ├── globals.css       # Tailwind entry point
    │   ├── page.tsx          # homepage: Connect button / Connected state
    │   └── api/auth/
    │       ├── login/route.ts            # → redirects to Google consent
    │       ├── callback/google/route.ts  # → trades code for tokens, saves user
    │       └── disconnect/route.ts       # → logs the user out
    └── lib/
        ├── types.ts          # shared TypeScript types (User, token response)
        ├── supabase.ts       # Supabase admin client (service role, server-only)
        ├── google.ts         # OAuth client: auth URL, code exchange, refresh
        └── session.ts        # cookie session: create/read/destroy + CSRF state
└── supabase/
    └── schema.sql            # the `users` + `user_sessions` tables (you run it)
```

---

## Setup checklist (do these in order)

### 1. Install dependencies

```bash
npm install
```

### 2. Supabase — create a project and run the schema

1. Go to <https://supabase.com>, sign in, and create a new project. Note the
   password you set for the database — you won't need it in code, but Supabase
   needs it for direct DB access.
2. Once the project is ready, open **SQL Editor → New query**.
3. Open `supabase/schema.sql` from this project, copy its entire contents, paste
   into the editor, and click **Run**. It creates the `users` and
   `user_sessions` tables. (Read the comments — they explain each line.)
4. Verify it worked by running `select * from public.users;` in the same
   editor. You should get an empty result (0 rows), not an error.
5. Go to **Project Settings → API** and grab two values for your `.env.local`:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (keep this secret!)

### 3. Google Cloud Console — create OAuth credentials

1. Go to <https://console.cloud.google.com>, sign in, and **create a project**
   (or pick an existing one).
2. **Configure the OAuth consent screen** (left menu → APIs & Services →
   OAuth consent screen):
   - **User type**: choose **External** (you can switch to Internal later if
     your org uses Google Workspace).
   - Fill in app name (e.g. "Gmail Intelligence Platform"), your email for
     support/contact.
   - On the **Scopes** step, add these (Google groups them under "Sensitive
     scopes — 100 users cap" until you go through verification):
     ```
     .../auth/userinfo.email       (Basic: email)
     .../auth/userinfo.profile     (Basic: profile info)
     openid
     https://www.googleapis.com/auth/gmail.readonly
     https://www.googleapis.com/auth/gmail.send
     https://www.googleapis.com/auth/gmail.modify
     ```
   - **Add your own Google account email under "Test users"** (you must be on
     this list to use the app while it's in "Testing" status — apps with
     sensitive scopes are capped at 100 test users until published).
3. **Enable the Gmail API** (left menu → APIs & Services → Library → search
   "Gmail API" → Enable). Without this, the scopes above won't grant access.
4. **Create OAuth credentials** (left menu → APIs & Services → Credentials →
   **Create Credentials → OAuth client ID**):
   - **Application type**: Web application
   - **Authorized redirect URIs**: add **exactly**:
     ```
     http://localhost:3000/api/auth/callback/google
     ```
     (When you deploy to Vercel later, also add
     `https://YOUR-DOMAIN.vercel.app/api/auth/callback/google`.)
   - Click **Create**. A modal shows your **Client ID** and **Client secret**.
5. Fill in `.env.local`:
   - `GOOGLE_CLIENT_ID` ← the client ID
   - `GOOGLE_CLIENT_SECRET` ← the client secret
   - `GOOGLE_REDIRECT_URI` ← `http://localhost:3000/api/auth/callback/google`
     (must match the URI you registered in step 4 *character-for-character*)

### 4. Run the dev server

```bash
npm run dev
```

Open <http://localhost:3000>.

---

## How to test that login actually works

A successful Stage 1 looks like this. Walk through all five checks:

1. **Homepage shows "Connect Gmail"** — visiting `http://localhost:3000` shows
   the button because you're not logged in yet.

2. **Clicking it sends you to Google** — you land on
   `accounts.google.com` and see a consent screen listing the Gmail scopes.
   Sign in with a Google account that's on your **Test users** list.

3. **After approving, you're back home and "Connected as [your email]"** — the
   URL bar shows `?auth_success=1`. If you instead see `?auth_error=...`, check
   the terminal where `npm run dev` is running for the logged error. The most
   common cause is a redirect URI typo.

4. **A row exists in Supabase** — in the Supabase Table Editor (or SQL Editor),
   run:
   ```sql
   select id, email, token_expiry, created_at from public.users;
   ```
   You should see exactly one row for your email, with a `token_expiry` about
   one hour in the future. (We don't select the token columns here to keep
   them off your screen, but they're stored.)

5. **Disconnect works and clears the row** — click **Disconnect**. The
   homepage reverts to "Connect Gmail", and:
   ```sql
   select count(*) from public.users;
   ```
   returns `0`.

6. **(Token refresh is verifiable too — optional)** The access token expires
   after ~1 hour. To verify refresh works without waiting an hour, run this in
   the Supabase SQL Editor to artificially expire your token, then reload the
   homepage (which calls `getCurrentUser`):
   ```sql
   update public.users
   set token_expiry = now() - interval '1 hour'
   where email = 'YOUR_EMAIL@gmail.com';
   ```
   Then in your terminal (with `npm run dev` running) hit:
   ```bash
   curl http://localhost:3000/
   ```
   No error in the logs + the page still renders as "Connected" means the
   refresh path executed. To **prove** it ran, check the expiry got pushed
   forward by an hour:
   ```sql
   select token_expiry from public.users where email = 'YOUR_EMAIL@gmail.com';
   ```

---

## Notes / things to know

- **`access_token` vs `refresh_token`**: the access token is the one Gmail
  cares about, but it dies every hour. The refresh token is your "season pass"
  to mint new access tokens. We store both.
- **Why we use `prompt=consent`**: it forces Google to always issue a fresh
  refresh token, which avoids a confusing state during development where a
  repeat login returns no refresh token.
- **`.env.local` is gitignored.** `.env.example` is the safe-to-commit template.
  Never paste real secrets into `.env.example`.
- **`SUPABASE_SERVICE_ROLE_KEY` is powerful** — it bypasses row-level security.
  Only ever use it server-side (it is, by design, never imported in a Client
  Component in this codebase).
- **Stuck on "access_denied" during login?** Almost always means the Google
  account isn't on the **Test users** list (while the app is in Testing status)
  or the Gmail API isn't enabled in the project.

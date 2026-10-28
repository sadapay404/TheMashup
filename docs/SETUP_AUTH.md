# TheMashup — Auth & Database Setup Guide

> **Nothing here is required to use TheMashup.** Demo mode (local identity +
> local JSON library) works out of the box. Follow Part B when you want real
> Google sign-in and cloud-synced data. Estimated time: ~10 minutes.

---

## Part A — Demo mode (already working)

1. Open the app → **Sign in** → **Continue in Demo Mode**.
2. A local identity is created (`dev:<uuid>`, stored in your browser).
3. Likes / playlists / history / follows persist to
   `apps/api/data/library.json` on this machine (git-ignored).
4. No internet, no accounts, no keys.

---

## Part B — Real Google Sign-In + Supabase (optional)

### B1. Create the Supabase project

1. Go to <https://supabase.com> → **Start your project** → sign in (GitHub).
2. **New project**:
   - Name: `themashup` (any)
   - Database password: generate & save one (you won't need it for this app)
   - Region: nearest to you (e.g. **Frankfurt** or **Singapore** for PK)
3. Wait ~2 minutes for provisioning.

### B2. Run the schema

1. Left sidebar → **SQL Editor** → **New query**.
2. Paste the ENTIRE contents of `supabase/migrations/0001_init.sql`.
3. Click **Run**. Expect `Success. No rows returned`.

### B3. Copy the service keys into `.env` (repo root)

1. Supabase → **Project Settings** → **API**:
   - `Project URL` → `SUPABASE_URL=https://xxxx.supabase.co`
   - `service_role` key (keep secret!) → `SUPABASE_SERVICE_ROLE_KEY=eyJ...`
2. In the same `.env`, also fill the browser-side values (anon key is public):
   - `VITE_SUPABASE_URL=https://xxxx.supabase.co`
   - `VITE_SUPABASE_ANON_KEY=eyJ...` (the `anon public` key, same page)

### B4. Create the Google OAuth client (Google Cloud Console)

You already have a Google Cloud Console account — use it:

1. Console → **APIs & Services** → **OAuth consent screen**:
   - User Type: **External** → fill app name (`TheMashup`), your email
   - Scopes: add `email`, `profile`, `openid` (defaults are fine)
   - Save (Test users: add your own Google address if in Testing mode)
2. **APIs & Services** → **Credentials** → **Create Credentials** →
   **OAuth client ID**:
   - Application type: **Web application**
   - Name: `TheMashup web`
   - **Authorized JavaScript origins**: `http://localhost:8080`
   - **Authorized redirect URIs**:
     `https://<PROJECT-REF>.supabase.co/auth/v1/callback`
     (copy `<PROJECT-REF>` from the Project URL)
3. **Create** → copy the **Client ID** and **Client secret**.

### B5. Enable Google inside Supabase

1. Supabase → **Authentication** → **Sign In / Providers** → **Google** → Enable.
2. Paste Client ID + Client secret → **Save**.
2. **Authentication** → **URL Configuration**:
   - Site URL: `http://localhost:8080`
   - Redirect URLs: add `http://localhost:8080`

### B6. Restart & verify

```bash
pnpm dev          # restart both services so they read the new .env
```

Smoke checklist:

| Step | Expected |
|---|---|
| Sign in → **Continue with Google** | Google account picker → redirect back |
| Avatar menu shows your name + `google account` badge | ✅ |
| `GET /api/library/likes` with session | `200 {"likes":[…]}` (not 401) |
| Like a track → reload page → still liked | ✅ (Supabase row) |
| Same on another browser/device | ✅ (cloud-synced) |

The gateway now verifies every Bearer JWT against Supabase Auth and local
demo identities automatically disable (`ALLOW_DEV_AUTH` defaults off when
`SUPABASE_URL` is set).

---

## Notes

- **Service role key stays server-side only** (`SUPABASE_SERVICE_ROLE_KEY` is
  read by Express, never shipped to the browser). The browser only ever sees
  `VITE_SUPABASE_ANON_KEY` (public by design, protected by RLS).
- **Demo data vs Supabase data** are separate stores: likes you made in demo
  mode remain in `apps/api/data/library.json`. Re-like a handful of favorites
  after switching, or import the JSON into the `likes` table with the same
  `track_snapshot` shape (documented in the migration).
- Row-Level Security policies are in the migration — even a leaked anon key
  cannot read another user's library.

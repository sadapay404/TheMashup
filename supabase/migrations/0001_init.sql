-- ════════════════════════════════════════════════════════════════════
-- TheMashup — Phase 4 schema (Supabase Postgres + RLS + pgvector)
-- Run this once in: Supabase → SQL Editor → New query → Run
-- After that, put SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env
-- (gateway) and VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in .env (web).
-- ════════════════════════════════════════════════════════════════════

create extension if not exists vector;

-- ── profiles (1:1 with auth.users created by Google OAuth) ──────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  theme_id text default 'frosted',
  created_at timestamptz default now()
);

-- ── catalog cache (populated lazily by the gateway) ─────────────────
-- Library/event rows denormalize a `track_snapshot` for instant UI, and
-- reference this catalog by external_id (the YouTube video id).
create table if not exists tracks (
  id bigserial primary key,
  external_id text not null unique,
  source text not null default 'yt',
  title text not null,
  artist_names text,
  album text,
  duration_sec int,
  artwork_url text,
  payload jsonb,
  updated_at timestamptz default now()
);

-- ── likes / dislikes ────────────────────────────────────────────────
create table if not exists likes (
  user_id uuid not null references profiles(id) on delete cascade,
  track_external_id text not null references tracks(external_id) on delete cascade,
  track_snapshot jsonb not null,
  kind text not null default 'up' check (kind in ('up','down')),
  created_at timestamptz default now(),
  primary key (user_id, track_external_id)
);

-- ── playlists ───────────────────────────────────────────────────────
create table if not exists playlists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  description text,
  cover_url text,
  is_public boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists playlist_tracks (
  playlist_id uuid not null references playlists(id) on delete cascade,
  track_external_id text not null references tracks(external_id) on delete cascade,
  track_snapshot jsonb not null,
  position int not null default 0,
  added_at timestamptz default now(),
  primary key (playlist_id, track_external_id)
);

-- ── followed artists ────────────────────────────────────────────────
create table if not exists follows (
  user_id uuid not null references profiles(id) on delete cascade,
  artist_channel_id text not null,
  artist_snapshot jsonb not null,
  created_at timestamptz default now(),
  primary key (user_id, artist_channel_id)
);

-- ── listening events (also serves "Recently played") ────────────────
create table if not exists play_events (
  id bigserial primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  event_type text not null check (event_type in ('play','skip','complete','repeat','like','dislike')),
  track_external_id text references tracks(external_id) on delete set null,
  track_snapshot jsonb,
  listened_ms int default 0,
  context text,
  created_at timestamptz default now()
);
create index if not exists play_events_user_recent
  on play_events (user_id, created_at desc);

-- ── downloads (Phase 5) ─────────────────────────────────────────────
create table if not exists downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  track_external_id text,
  container text check (container in ('mp3','flac','opus','mp4')),
  quality text not null,
  status text default 'queued',
  progress numeric default 0,
  speed_bps bigint,
  filepath text,
  created_at timestamptz default now()
);

-- ── recommendation embeddings (Phase 5 wiring) ──────────────────────
create table if not exists track_embeddings (
  track_id bigint primary key references tracks(id) on delete cascade,
  embedding vector(256),
  updated_at timestamptz default now()
);
create index if not exists track_embeddings_ivfflat
  on track_embeddings using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ════════════════════════════════════════════════════════════════════
-- Row Level Security: users only ever see their own rows.
-- ════════════════════════════════════════════════════════════════════

alter table profiles enable row level security;
alter table likes enable row level security;
alter table playlists enable row level security;
alter table playlist_tracks enable row level security;
alter table follows enable row level security;
alter table play_events enable row level security;
alter table downloads enable row level security;
alter table tracks enable row level security;
alter table track_embeddings enable row level security;

-- profiles
create policy "own profile select" on profiles for select using (auth.uid() = id);
create policy "own profile upsert" on profiles for insert with check (auth.uid() = id);
create policy "own profile update" on profiles for update using (auth.uid() = id);

-- likes
create policy "own likes" on likes for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- playlists (public playlists readable by everyone)
create policy "playlist read" on playlists for select
  using (auth.uid() = owner_id or is_public);
create policy "playlist write" on playlists for insert with check (auth.uid() = owner_id);
create policy "playlist update" on playlists for update using (auth.uid() = owner_id);
create policy "playlist delete" on playlists for delete using (auth.uid() = owner_id);

create policy "playlist tracks read" on playlist_tracks for select
  using (exists (
    select 1 from playlists p
    where p.id = playlist_id and (p.owner_id = auth.uid() or p.is_public)
  ));
create policy "playlist tracks write" on playlist_tracks for all
  using (exists (
    select 1 from playlists p where p.id = playlist_id and p.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from playlists p where p.id = playlist_id and p.owner_id = auth.uid()
  ));

-- follows / events / downloads
create policy "own follows" on follows for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own events" on play_events for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own downloads" on downloads for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- catalog is server-readable (service role bypasses RLS anyway; this lets
-- the web client read track metadata for rendering)
create policy "catalog readable" on tracks for select using (true);

-- embeddings: server-only (service role) — no client policy on purpose.

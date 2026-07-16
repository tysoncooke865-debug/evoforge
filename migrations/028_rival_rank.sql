-- EvoForge 028 — PROGRESSION_OVERHAUL P7: Rival Rank.
--
--   competitive_ratings — one row per (user, season, mode): Glicko-2
--     fields + placement progress. WRITTEN ONLY BY rival-settle (service
--     role) — clients read; there is no insert/update policy for
--     authenticated users beyond their own SELECT.
--   competitive_matches — the settle ledger: one row per settled battle,
--     unique(battle_id) is the idempotency lock; frozen player snapshots.
--   ghost_snapshots — frozen performances for Ghost Matches; the owner's
--     rating can never be touched by someone racing their ghost.
--
-- The BLITZ battle system is the match substrate: rival-settle verifies
-- the completed battle_matches row server-side and applies Glicko-2 to
-- both players atomically. Cosmetics, coins, Forge Level and Evo Rating
-- grant NOTHING here (spec's prime rule).
--
-- FALSIFICATION: client INSERT into competitive_ratings -> RLS denial;
-- double-settle of one battle -> unique violation absorbed; B reads A's
-- rating (SELECT is intentionally cross-user for ladders? NO — owner-only
-- + the leaderboard goes through a definer fn later).

create table if not exists public.competitive_ratings (
  id                            uuid primary key default gen_random_uuid(),
  user_id                       uuid not null references auth.users(id) on delete cascade,
  season_id                     text not null default 's1',
  mode                          text not null default 'overall',
  rating                        numeric(8,3) not null default 1500,
  rating_deviation              numeric(8,3) not null default 350,
  volatility                    numeric(8,6) not null default 0.06,
  placement_matches_completed   integer not null default 0,
  season_peak_rating            numeric(8,3) not null default 1500,
  last_match_at                 timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  unique (user_id, season_id, mode)
);

alter table public.competitive_ratings enable row level security;
create policy "own rating select" on public.competitive_ratings
  for select using (user_id = auth.uid());
-- No client write policies: rival-settle (service role) is the only writer.

create table if not exists public.competitive_matches (
  id                    uuid primary key default gen_random_uuid(),
  battle_id             uuid not null unique,
  season_id             text not null default 's1',
  mode                  text not null default 'overall',
  player_a              uuid not null references auth.users(id) on delete cascade,
  player_b              uuid not null references auth.users(id) on delete cascade,
  outcome               text not null check (outcome in ('a','b','draw')),
  rating_change_a       numeric(8,3) not null,
  rating_change_b       numeric(8,3) not null,
  player_a_snapshot     jsonb not null default '{}'::jsonb,
  player_b_snapshot     jsonb not null default '{}'::jsonb,
  scoring_rules_version text not null default '1.0.0',
  created_at            timestamptz not null default now()
);

create index if not exists competitive_matches_player_idx
  on public.competitive_matches (player_a, created_at desc);
create index if not exists competitive_matches_player_b_idx
  on public.competitive_matches (player_b, created_at desc);

alter table public.competitive_matches enable row level security;
create policy "participant match select" on public.competitive_matches
  for select using (player_a = auth.uid() or player_b = auth.uid());
-- Service-role writes only.

create table if not exists public.ghost_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  owner_user_id         uuid not null references auth.users(id) on delete cascade,
  source_match_id       uuid,
  mode                  text not null,
  performance_snapshot  jsonb not null,
  player_snapshot       jsonb not null default '{}'::jsonb,
  verification_level    text not null default 'standard',
  created_at            timestamptz not null default now(),
  expires_at            timestamptz
);

alter table public.ghost_snapshots enable row level security;
create policy "own ghosts all" on public.ghost_snapshots
  for select using (owner_user_id = auth.uid());
create policy "own ghosts insert" on public.ghost_snapshots
  for insert with check (owner_user_id = auth.uid());

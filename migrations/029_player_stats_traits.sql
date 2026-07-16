-- EvoForge 029 — PROGRESSION_OVERHAUL P8+P9: player stats, traits,
-- analytics and the rating audit.
--
--   player_stats     — one row per user, refreshed by each Evo Review.
--   player_traits    — unlocked traits, versioned rules, append-mostly.
--   analytics_events — thin privacy-safe events (spec §45): NAME + small
--                      jsonb props; never images, never measurements.
--   evo_rating_audit — every official rating movement, immutable (spec
--                      §46): old/new, trigger, who/what. The audit is the
--                      anti-cheat backbone and the recalibration trail.
--
-- Owner-only RLS; audit + analytics are insert/select only.

create table if not exists public.player_stats (
  user_id            uuid primary key default auth.uid()
                     references auth.users(id) on delete cascade,
  power              integer not null default 1,
  vitality           integer not null default 1,
  stamina            integer not null default 1,
  balance            integer not null default 1,
  technique          integer not null default 1,
  evo_class          text,
  class_rule_version text,
  updated_at         timestamptz not null default now()
);

alter table public.player_stats enable row level security;
create policy "own stats select" on public.player_stats
  for select using (user_id = auth.uid());
create policy "own stats insert" on public.player_stats
  for insert with check (user_id = auth.uid());
create policy "own stats update" on public.player_stats
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.player_traits (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid()
                  references auth.users(id) on delete cascade,
  trait_key       text not null,
  trait_tier      integer not null default 1,
  source_pillar   text not null,
  rule_version    text not null,
  unlocked_at     timestamptz not null default now(),
  equipped        boolean not null default false,
  unique (user_id, trait_key)
);

alter table public.player_traits enable row level security;
create policy "own traits select" on public.player_traits
  for select using (user_id = auth.uid());
create policy "own traits insert" on public.player_traits
  for insert with check (user_id = auth.uid());
create policy "own traits update" on public.player_traits
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.analytics_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid()
             references auth.users(id) on delete cascade,
  event_name text not null check (length(event_name) between 3 and 60),
  props      jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_name_idx
  on public.analytics_events (event_name, created_at desc);

alter table public.analytics_events enable row level security;
create policy "own analytics insert" on public.analytics_events
  for insert with check (user_id = auth.uid());
create policy "own analytics select" on public.analytics_events
  for select using (user_id = auth.uid());

create table if not exists public.evo_rating_audit (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid()
               references auth.users(id) on delete cascade,
  old_rating   numeric(8,4),
  new_rating   numeric(8,4) not null,
  trigger_type text not null,
  snapshot_id  uuid,
  flags        jsonb not null default '[]'::jsonb,
  created_at   timestamptz not null default now()
);

alter table public.evo_rating_audit enable row level security;
create policy "own audit select" on public.evo_rating_audit
  for select using (user_id = auth.uid());
create policy "own audit insert" on public.evo_rating_audit
  for insert with check (user_id = auth.uid());

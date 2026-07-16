-- EvoForge 024 — PROGRESSION_OVERHAUL P2: Evo Rating state.
--
--   evo_rating_current   — one mutable row per user: the cached truth the
--                          Home screen reads (raw + displayed + pillars +
--                          confidence + peak/starting, spec §37).
--   evo_rating_snapshots — IMMUTABLE history: every confirmed review, scan
--                          or recalibration appends one. Select+insert
--                          only — the xp_events doctrine for scores.
--   pending_evo_evidence — post-workout projections awaiting a review.
--
-- All owner-only RLS. Peak/starting integrity is enforced by trigger:
-- peak can only ratchet up, starting writes once. (Clients write via
-- their own JWT; the weekly-review edge function writes as the caller
-- too, so RLS + triggers are the whole contract.)
--
-- FALSIFICATION CHECKLIST:
--   1. update a snapshot as its owner -> rejected.          [immutable]
--   2. lower peak_raw_rating via update -> value stays.       [ratchet]
--   3. change starting_raw_rating after set -> value stays. [write-once]
--   4. B selects A's rows -> 0.                                   [RLS]

create table if not exists public.evo_rating_current (
  user_id                 uuid primary key default auth.uid()
                          references auth.users(id) on delete cascade,
  raw_rating              numeric(8,4) not null check (raw_rating between 1 and 100),
  displayed_rating        integer not null check (displayed_rating between 1 and 100),
  evolution_progress      integer not null check (evolution_progress between 0 and 100),
  starting_raw_rating     numeric(8,4),
  starting_displayed      integer,
  peak_raw_rating         numeric(8,4),
  peak_displayed          integer,
  lifetime_evolution      integer not null default 0,
  size_score              numeric(8,4) not null,
  aesthetics_score        numeric(8,4) not null,
  strength_score          numeric(8,4) not null,
  cardio_score            numeric(8,4) not null,
  size_confidence         integer not null default 0,
  aesthetics_confidence   integer not null default 0,
  strength_confidence     integer not null default 0,
  cardio_confidence       integer not null default 0,
  overall_confidence      integer not null default 0,
  confidence_label        text not null default 'provisional',
  descriptor              text not null default 'Untrained',
  evo_class               text,
  status                  text not null default 'provisional'
                          check (status in ('provisional','confirmed','unconfirmed','stale')),
  limiting_pillar         text,
  last_review_at          timestamptz,
  next_review_at          timestamptz,
  model_version           text not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.evo_rating_current enable row level security;
create policy "own evo select" on public.evo_rating_current
  for select using (user_id = auth.uid());
create policy "own evo insert" on public.evo_rating_current
  for insert with check (user_id = auth.uid());
create policy "own evo update" on public.evo_rating_current
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Peak ratchets, starting writes once — whatever the client sends.
create or replace function public.evo_current_guard()
returns trigger
language plpgsql
as $$
begin
  if old.starting_raw_rating is not null then
    new.starting_raw_rating := old.starting_raw_rating;
    new.starting_displayed  := old.starting_displayed;
  end if;
  if old.peak_raw_rating is not null then
    new.peak_raw_rating := greatest(old.peak_raw_rating, coalesce(new.peak_raw_rating, old.peak_raw_rating));
    new.peak_displayed  := greatest(old.peak_displayed,  coalesce(new.peak_displayed,  old.peak_displayed));
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists evo_current_guard_trigger on public.evo_rating_current;
create trigger evo_current_guard_trigger
  before update on public.evo_rating_current
  for each row execute function public.evo_current_guard();

create table if not exists public.evo_rating_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid()
                      references auth.users(id) on delete cascade,
  raw_rating          numeric(8,4) not null,
  displayed_rating    integer not null,
  evolution_progress  integer not null,
  size_score          numeric(8,4) not null,
  aesthetics_score    numeric(8,4) not null,
  strength_score      numeric(8,4) not null,
  cardio_score        numeric(8,4) not null,
  confidence          integer not null,
  descriptor          text not null,
  evo_class           text,
  trigger_type        text not null check (trigger_type in
                        ('initial','weekly_review','monthly_scan','chapter',
                         'model_recalibration','migration','manual')),
  trigger_id          text,
  changes             jsonb not null default '{}'::jsonb,
  recommendations     jsonb not null default '[]'::jsonb,
  model_version       text not null,
  calculated_at       timestamptz not null default now()
);

create index if not exists evo_snapshots_user_time_idx
  on public.evo_rating_snapshots (user_id, calculated_at desc);

alter table public.evo_rating_snapshots enable row level security;
create policy "own snapshots select" on public.evo_rating_snapshots
  for select using (user_id = auth.uid());
create policy "own snapshots insert" on public.evo_rating_snapshots
  for insert with check (user_id = auth.uid());
-- No update/delete: immutable.

create table if not exists public.pending_evo_evidence (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid()
                        references auth.users(id) on delete cascade,
  pillar                text not null check (pillar in ('size','aesthetics','strength','cardio')),
  source_type           text not null,
  source_id             text,
  projected_impact_low  integer not null default 0,
  projected_impact_high integer not null default 0,
  status                text not null default 'pending'
                        check (status in ('pending','confirmed','rejected','expired')),
  reason                text,
  created_at            timestamptz not null default now(),
  reviewed_at           timestamptz
);

create index if not exists pending_evidence_user_status_idx
  on public.pending_evo_evidence (user_id, status, created_at desc);

alter table public.pending_evo_evidence enable row level security;
create policy "own pending select" on public.pending_evo_evidence
  for select using (user_id = auth.uid());
create policy "own pending insert" on public.pending_evo_evidence
  for insert with check (user_id = auth.uid());
create policy "own pending update" on public.pending_evo_evidence
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

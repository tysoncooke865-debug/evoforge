-- EvoForge 032 — BATTLE RPG persistence (Tyson turn-based beta, 2026-07-16).
--
-- The beta ships LOCAL-FIRST (state/battle-rpg-store.ts is the repository).
-- These tables are the DOCUMENTED SUPABASE SEAM: when we move battle history
-- server-side, ui/battle/use-battle.ts `settleBattle` writes here instead of
-- the store, and the Arena reads from here. Owner-only RLS, append-only
-- results, same conventions as the rest of the schema.
--
-- Rewards are NOT minted into coin_events here — battle coins/XP need a
-- server-side grant RPC (a future migration) so the guarded economy stays
-- authoritative; the beta records them locally only.

create table if not exists public.battle_results (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  mode                text        not null check (mode in ('training', 'rival', 'gym')),
  opponent_id         text,
  player_champion_id  text        not null,
  opponent_champion_id text       not null,
  result              text        not null check (result in ('win', 'loss')),
  turns               integer     not null check (turns >= 0),
  rewards             jsonb       not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists battle_results_user_created_idx on public.battle_results (user_id, created_at desc);
alter table public.battle_results enable row level security;
drop policy if exists battle_results_owner_select on public.battle_results;
create policy battle_results_owner_select on public.battle_results for select to authenticated using (user_id = auth.uid());
drop policy if exists battle_results_owner_insert on public.battle_results;
create policy battle_results_owner_insert on public.battle_results for insert to authenticated with check (user_id = auth.uid());
-- Append-only: no update/delete policies.

create table if not exists public.gym_progress (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  gym_id              text        not null,
  cleared             boolean     not null default false,
  first_clear_claimed boolean     not null default false,
  best_turns          integer,
  updated_at          timestamptz not null default now(),
  unique (user_id, gym_id)
);
alter table public.gym_progress enable row level security;
drop policy if exists gym_progress_owner_all on public.gym_progress;
create policy gym_progress_owner_select on public.gym_progress for select to authenticated using (user_id = auth.uid());
create policy gym_progress_owner_insert on public.gym_progress for insert to authenticated with check (user_id = auth.uid());
create policy gym_progress_owner_update on public.gym_progress for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.rivalry_records (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  rival_id        text        not null,
  wins            integer     not null default 0,
  losses          integer     not null default 0,
  streak          integer     not null default 0,
  last_winner     text        check (last_winner in ('player', 'rival')),
  last_battle_at  timestamptz,
  unique (user_id, rival_id)
);
alter table public.rivalry_records enable row level security;
drop policy if exists rivalry_records_owner_select on public.rivalry_records;
create policy rivalry_records_owner_select on public.rivalry_records for select to authenticated using (user_id = auth.uid());
create policy rivalry_records_owner_insert on public.rivalry_records for insert to authenticated with check (user_id = auth.uid());
create policy rivalry_records_owner_update on public.rivalry_records for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

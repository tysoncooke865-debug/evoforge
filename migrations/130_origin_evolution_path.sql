-- EvoForge 130 — ORIGIN EVOLUTION PATH (beta).
--
-- The long-term progression layer: a chosen Origin advances through Levels
-- 0-4 by QUALIFIED TRAINING WEEKS built from real, saved workouts. It is
-- additive — origin selection (039-048, 082), workout logging (017), Forge
-- Level and Evo Rating are untouched and stay separate systems.
--
-- FIVE INVARIANTS THIS FILE ENFORCES, each with the reason it exists:
--
--  1. A workout contributes AT MOST ONCE, ever. `origin_progress_events`
--     carries unique (user_id, workout_session_id). Duplicate application
--     is a database error, not a code convention someone can forget.
--
--  2. PROGRESSION CAN NEVER BREAK FINISHING A WORKOUT. The trigger that
--     applies a finished session swallows every error into
--     origin_path_errors and returns. A broken progression system must
--     degrade to "no progression", never to "cannot finish a workout" —
--     EvoForge is a fitness tracker first.
--
--  3. Weeks are MATERIALISED, not re-derived. origin_path_weeks stores
--     planned_sessions as it stood that week, so changing training days
--     later cannot silently re-qualify or de-qualify history. "Progress
--     never expires" has to survive a schedule edit.
--
--  4. Levels and rewards are MONOTONIC. Nothing in this file lowers a
--     level, revokes a reward or resets qualified_weeks. Missing a week
--     costs the week, never the path.
--
--  5. Origin Level is NOT avatar stage. current_level (0-4) is this
--     system's. profile.active_stage / user_paths.current_stage belong to
--     the older avatar-evolution track and are never written here.
--
-- Apply by hand via the management API (HANDOVER §5), falsify with the
-- smoke accounts, THEN ship the client commit that depends on it.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- PART A — path definitions (EXTENDS the existing `paths`, no new registry)
-- ─────────────────────────────────────────────────────────────────────────
-- `paths` already keys art, skins, user_paths and the origin RPCs. The spec's
-- `origin_paths` table is this table plus four columns, so it becomes this
-- table plus four columns.
alter table public.paths add column if not exists description       text;
alter table public.paths add column if not exists promise           text;
alter table public.paths add column if not exists status            text not null default 'active';
alter table public.paths add column if not exists configuration_json jsonb not null default '{}'::jsonb;
alter table public.paths add column if not exists created_at        timestamptz not null default now();
alter table public.paths add column if not exists updated_at        timestamptz not null default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'paths_status_check') then
    alter table public.paths add constraint paths_status_check
      check (status in ('active','beta','retired'));
  end if;
end $$;

-- The PROMISE is the real-world outcome, not lore — every Origin card in the
-- product shows it, so it lives with the path and not in five UI files.
update public.paths set
  promise = case slug
    when 'titan'     then 'Exceptional real-world strength.'
    when 'shredder'  then 'Body-composition transformation and conditioning.'
    when 'cardio'    then 'Speed and cardiovascular ability.'
    when 'aesthetic' then 'Muscularity, symmetry and physique development.'
    when 'mass'      then 'Balanced size, strength and conditioning.'
  end,
  description = case slug
    when 'titan'     then 'Train for absolute strength. The Titan Standard is a real, measured total.'
    when 'shredder'  then 'Train to change your composition — leaner, harder, better conditioned.'
    when 'cardio'    then 'Train for engine and speed. Distance, pace and recovery are the proof.'
    when 'aesthetic' then 'Train for the physique — balance, symmetry and visible development.'
    when 'mass'      then 'Train for size on a base of strength and conditioning.'
  end,
  updated_at = now()
where slug in ('titan','shredder','cardio','aesthetic','mass');

-- ─────────────────────────────────────────────────────────────────────────
-- PART B — the athlete's run state
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.user_origin_paths (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null default auth.uid()
                              references auth.users(id) on delete cascade,
  origin_path_id            text not null references public.paths(slug),
  started_at                timestamptz not null default now(),
  paused_at                 timestamptz,
  -- 0 = Dormant (chosen, not awakened). 1 = Awakened (first qualifying
  -- workout). 2-4 are the long-term transformations.
  current_level             integer not null default 0 check (current_level between 0 and 4),
  active_chapter            integer not null default 1 check (active_chapter between 1 and 4),
  -- 1-based week WITHIN the 48-week path.
  active_week               integer not null default 1 check (active_week between 1 and 48),
  qualified_weeks           integer not null default 0 check (qualified_weeks >= 0),
  status                    text    not null default 'active'
                              check (status in ('active','paused','completed','abandoned')),
  -- ISO day numbers 0-6 (Sun..Sat), captured at the onboarding commitment
  -- step. The PLANNED-session count for a week comes from this.
  selected_training_days    smallint[] not null default '{}',
  first_workout_completed_at timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- ONE active path per athlete. Switching origins updates this row rather
  -- than inserting a second, so "a user may have only one active Origin
  -- Path at a time" is a constraint and not a hope.
  unique (user_id)
);
create index if not exists user_origin_paths_user_idx on public.user_origin_paths (user_id);

alter table public.user_origin_paths enable row level security;
drop policy if exists user_origin_paths_owner_select on public.user_origin_paths;
create policy user_origin_paths_owner_select on public.user_origin_paths
  for select to authenticated using (user_id = auth.uid());
-- No insert/update/delete policies: every write goes through the definer
-- RPCs below, which is what makes the progression rules unbypassable.

-- ─────────────────────────────────────────────────────────────────────────
-- PART C — materialised weekly progress
-- ─────────────────────────────────────────────────────────────────────────
-- ONE ROW PER CALENDAR WEEK, and the path-week slot it filled.
--
-- Keying by calendar week rather than by slot is what makes the two rules
-- co-exist: "missed weeks do not reset progress" (a barren calendar week is
-- simply a row that never qualified) and "extra sessions cannot skip
-- multiple weeks" (one calendar week can fill at most one slot, because
-- path_week_index is assigned once, at qualification).
create table if not exists public.origin_path_weeks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid()
                      references auth.users(id) on delete cascade,
  origin_path_id    text not null references public.paths(slug),
  -- The Monday of the calendar week (date_trunc('week')). The row's identity.
  week_start        date not null,
  -- The 1-48 slot this calendar week EARNED. NULL until it qualifies.
  path_week_index   integer check (path_week_index between 1 and 48),
  -- Frozen when the week's first session lands (invariant 3).
  planned_sessions  integer not null check (planned_sessions >= 0),
  required_sessions integer not null check (required_sessions >= 0),
  completed_sessions integer not null default 0 check (completed_sessions >= 0),
  qualified_at      timestamptz,
  -- 'deload' and 'injury_adjusted' weeks qualify at a reduced requirement;
  -- the kind is recorded so a coach can see WHY a week passed.
  kind              text not null default 'standard'
                      check (kind in ('standard','deload','injury_adjusted')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, origin_path_id, week_start)
);
create index if not exists origin_path_weeks_user_idx
  on public.origin_path_weeks (user_id, origin_path_id, week_start desc);
-- A slot can be earned only once.
create unique index if not exists origin_path_weeks_one_per_slot
  on public.origin_path_weeks (user_id, origin_path_id, path_week_index)
  where path_week_index is not null;

alter table public.origin_path_weeks enable row level security;
drop policy if exists origin_path_weeks_owner_select on public.origin_path_weeks;
create policy origin_path_weeks_owner_select on public.origin_path_weeks
  for select to authenticated using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- PART D — the immutable event log (and the duplicate-contribution guard)
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.origin_progress_events (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid()
                       references auth.users(id) on delete cascade,
  origin_path_id     text not null references public.paths(slug),
  -- The finished-workout marker this event came from. NULL for events that
  -- are not workout-driven (level unlocks, path started).
  workout_session_id uuid references public.workout_sessions(id) on delete set null,
  event_type         text not null check (event_type in (
                       'path_started','workout_applied','week_qualified',
                       'reward_unlocked','level_unlocked','path_paused','path_resumed')),
  progress_amount    numeric(8,2) not null default 0,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);
create index if not exists origin_progress_events_user_idx
  on public.origin_progress_events (user_id, created_at desc);

-- INVARIANT 1. A partial unique index, not a table constraint, because only
-- workout-driven events carry a session and NULLs must not collide.
create unique index if not exists origin_progress_events_one_per_workout
  on public.origin_progress_events (user_id, workout_session_id)
  where event_type = 'workout_applied' and workout_session_id is not null;

alter table public.origin_progress_events enable row level security;
drop policy if exists origin_progress_events_owner_select on public.origin_progress_events;
create policy origin_progress_events_owner_select on public.origin_progress_events
  for select to authenticated using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- PART E — rewards: seeded config, then permanent per-athlete unlocks
-- ─────────────────────────────────────────────────────────────────────────
-- The reward TABLE is data, so five origins share one engine instead of five
-- codebases. `client/src/domain/origin-path/rewards.ts` mirrors these rows
-- for display metadata and a vitest asserts the two agree.
create table if not exists public.origin_path_rewards (
  reward_id      text primary key,
  origin_path_id text not null references public.paths(slug),
  chapter        integer not null check (chapter between 1 and 4),
  week_index     integer not null check (week_index between 1 and 48),
  kind           text not null check (kind in (
                   'title','portrait','visual_effect','nameplate','share_theme',
                   'background','sound_theme','frame','entrance','badge',
                   'evolution_preview','level_transformation')),
  label          text not null,
  description    text,
  -- Automatic rewards land the moment the week qualifies. Only meaningful
  -- CHOICE rewards should ever be manual (beta ships none).
  claim_mode     text not null default 'automatic' check (claim_mode in ('automatic','manual')),
  asset_key      text,
  created_at     timestamptz not null default now(),
  unique (origin_path_id, week_index)
);
alter table public.origin_path_rewards enable row level security;
drop policy if exists origin_path_rewards_read on public.origin_path_rewards;
create policy origin_path_rewards_read on public.origin_path_rewards
  for select to authenticated using (true);

create table if not exists public.origin_reward_claims (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid()
                   references auth.users(id) on delete cascade,
  origin_path_id text not null references public.paths(slug),
  reward_id      text not null references public.origin_path_rewards(reward_id),
  unlocked_at    timestamptz not null default now(),
  claimed_at     timestamptz,
  created_at     timestamptz not null default now(),
  -- Permanence + idempotency in one constraint.
  unique (user_id, reward_id)
);
create index if not exists origin_reward_claims_user_idx
  on public.origin_reward_claims (user_id, unlocked_at desc);

alter table public.origin_reward_claims enable row level security;
drop policy if exists origin_reward_claims_owner_select on public.origin_reward_claims;
create policy origin_reward_claims_owner_select on public.origin_reward_claims
  for select to authenticated using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────
-- PART F — error sink (invariant 2)
-- ─────────────────────────────────────────────────────────────────────────
-- The trigger writes here instead of raising. Nobody's workout fails because
-- the game layer had a bad day; an operator can still see that it did.
create table if not exists public.origin_path_errors (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  context    text not null,
  sqlstate   text,
  message    text,
  created_at timestamptz not null default now()
);
alter table public.origin_path_errors enable row level security;
-- No policies at all: service_role and the definer functions only.

-- ─────────────────────────────────────────────────────────────────────────
-- PART G — Chapter I seed: twelve weeks, five origins, one template
-- ─────────────────────────────────────────────────────────────────────────
-- Chapters II-IV are deliberately unseeded. They exist in the model and
-- render as locked previews; authoring 36 more weeks x 5 origins is
-- explicitly out of scope for the beta.
insert into public.origin_path_rewards
  (reward_id, origin_path_id, chapter, week_index, kind, label, description, asset_key)
select
  p.slug || '_c1_w' || w.week_index,
  p.slug,
  1,
  w.week_index,
  w.kind,
  replace(w.label, '{ORIGIN}', p.display_name),
  w.description,
  p.slug || '_' || w.kind
from public.paths p
cross join (values
  (1,  'title',                '{ORIGIN} Initiate',        'A title, earned by showing up for a full week.'),
  (2,  'portrait',             '{ORIGIN} Portrait',        'A profile portrait in your Origin''s line.'),
  (3,  'visual_effect',        '{ORIGIN} Impact Effect',   'A visual effect on your lifts and victories.'),
  (4,  'nameplate',            '{ORIGIN} Nameplate',       'A nameplate for your profile and the board.'),
  (5,  'share_theme',          '{ORIGIN} Share Card',      'A share-card theme for your workout summaries.'),
  (6,  'background',           '{ORIGIN} Background',      'A background for your profile and battles.'),
  (7,  'sound_theme',          '{ORIGIN} Sound Theme',     'Feedback and sound in your Origin''s key.'),
  (8,  'frame',                '{ORIGIN} Profile Frame',   'A frame around your champion portrait.'),
  (9,  'entrance',             '{ORIGIN} Entrance',        'An entrance effect when your champion appears.'),
  (10, 'badge',                '{ORIGIN} Chapter I Badge', 'Proof of a completed chapter.'),
  (11, 'evolution_preview',    '{ORIGIN} Evolution Preview','A first look at your Level 2 form.'),
  (12, 'level_transformation', '{ORIGIN} Level 2 Form',    'Your champion evolves. Chapter I complete.')
) as w(week_index, kind, label, description)
where p.slug in ('titan','shredder','cardio','aesthetic','mass')
on conflict (reward_id) do update set
  label = excluded.label, description = excluded.description, kind = excluded.kind;

commit;

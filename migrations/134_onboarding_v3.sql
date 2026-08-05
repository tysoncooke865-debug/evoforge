-- EvoForge 134 — ONBOARDING V3 (docs/ONBOARDING_V3_SPEC.md).
--
-- WHY. 31 signups, 25 profiles, 16 Origins, 11 athletes who ever logged a
-- workout. Four of the fourteen who emitted `onboarding_started` never
-- emitted `initial_assessment_started` — they abandoned the character-
-- creation FORM, which demands height, bodyweight, three one-rep maxes,
-- training years, an eating phase, a physique photo and a globally-unique
-- username before it hands over anything at all.
--
-- V3 asks for goal, experience, how they want to train, and an Origin. This
-- migration is the storage for those four answers, plus the state the
-- photo-optional rules need.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
--   * It does NOT widen `profile_primary_goal_check`. Two of the six v3
--     goals ("become more consistent", "track my current program") point at
--     no Origin, and the candidate model reads `primary_goal` as an origin
--     signal (GOAL_ORIGIN / GOAL_REASON / GOAL_ADJACENCY). Forcing them into
--     that vocabulary would invent an affinity the athlete never expressed.
--     The athlete's actual answer is kept verbatim in `onboarding_goal`;
--     `primary_goal` is set only when the answer maps to a real origin
--     signal, and stays NULL otherwise — which the model already handles.
--
--   * It does NOT touch a single existing row's placement. `base_level` is
--     immutable after onboarding and stays that way; v3's placement change
--     applies to new athletes only.
--
-- SAFETY. Purely additive: every column is nullable (or defaulted), no
-- existing constraint is altered, no data is rewritten. `profile` is
-- owner-only RLS with `user_id default auth.uid()` and these columns
-- inherit it; no new policy is required or wanted.
--
-- Apply by hand via the management API (HANDOVER §5), falsify with the
-- smoke accounts, THEN ship the client commit that depends on it.

begin;

-- ─────────────────────────────────────────────────────────────────────────
-- PART A — what v3 actually asks
-- ─────────────────────────────────────────────────────────────────────────

alter table public.profile
  add column if not exists onboarding_goal text
    check (onboarding_goal in (
      'build_muscle', 'get_stronger', 'lose_fat',
      'improve_fitness', 'be_consistent', 'track_program'
    )),
  -- Optional extras. Same vocabulary, enforced as a subset so a typo can
  -- never become a value nothing renders.
  add column if not exists secondary_goals text[]
    check (
      secondary_goals is null
      or secondary_goals <@ array[
        'build_muscle', 'get_stronger', 'lose_fat',
        'improve_fitness', 'be_consistent', 'track_program'
      ]::text[]
    ),
  add column if not exists experience_level text
    check (experience_level in ('new', 'occasional', 'consistent', 'experienced', 'competitive')),
  add column if not exists training_route text
    check (training_route in ('have_program', 'build_for_me')),
  add column if not exists training_days_per_week smallint
    check (training_days_per_week between 1 and 7),
  add column if not exists session_minutes smallint
    check (session_minutes between 15 and 180),
  add column if not exists equipment_access text
    check (equipment_access in ('full_gym', 'home_basic', 'bodyweight', 'unsure')),
  -- ISO weekday numbers, 0=Sunday, matching workout_schedule's plan keys.
  add column if not exists preferred_days smallint[]
    check (
      preferred_days is null
      or (
        array_length(preferred_days, 1) between 1 and 7
        and preferred_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
      )
    );

-- ─────────────────────────────────────────────────────────────────────────
-- PART B — the photo rules, as state rather than as good intentions
-- ─────────────────────────────────────────────────────────────────────────

-- "Don't ask me again" is honoured for good, by EVERY prompt surface. A
-- boolean the client can consult is the only way that promise survives the
-- next person who adds a prompt.
alter table public.profile
  add column if not exists photo_prompts_disabled boolean not null default false,
  -- When the athlete first created a private physique baseline. The photos
  -- themselves are still never persisted (client/CLAUDE.md) — this is the
  -- DATE one existed, so Reforge Day can say whether a comparison is
  -- possible without reading anything about a body.
  add column if not exists physique_baseline_at timestamptz;

-- ─────────────────────────────────────────────────────────────────────────
-- PART C — Reforge Day's 28-day clock
-- ─────────────────────────────────────────────────────────────────────────
--
-- Anchored to the first COMPLETED workout, falling back to account
-- creation. Distinct from the weekly Evo Review, which does not move: the
-- review is the engine (momentum decays per missed week), Reforge Day is
-- the ceremony. Also distinct from `reforge_granted_at`/`reforge_used_at`
-- above, which are the one-off ORIGIN re-choice.
alter table public.profile
  add column if not exists reforge_anchor_at timestamptz,
  add column if not exists last_reforge_at timestamptz;

-- The clock must not be resettable. Not because there is a reward to farm
-- — Reforge Day grants nothing but a reveal — but because a cycle the
-- client can rewind is not a cycle, and the next feature that hangs off it
-- would inherit the hole.
create or replace function public.profile_reforge_clock_guard()
returns trigger
language plpgsql
as $$
begin
  -- write-once
  if old.reforge_anchor_at is not null then
    new.reforge_anchor_at := old.reforge_anchor_at;
  end if;
  -- forward-only
  if old.last_reforge_at is not null
     and (new.last_reforge_at is null or new.last_reforge_at < old.last_reforge_at) then
    new.last_reforge_at := old.last_reforge_at;
  end if;
  -- a baseline that existed cannot un-exist by accident; clearing it is a
  -- deletion, which goes through Settings and sets it to NULL explicitly
  -- alongside photo_prompts_disabled — not through an ordinary profile save.
  if old.physique_baseline_at is not null and new.physique_baseline_at is null
     and new.photo_prompts_disabled = old.photo_prompts_disabled then
    new.physique_baseline_at := old.physique_baseline_at;
  end if;
  return new;
end;
$$;

drop trigger if exists profile_reforge_clock_guard_trigger on public.profile;
create trigger profile_reforge_clock_guard_trigger
  before update on public.profile
  for each row execute function public.profile_reforge_clock_guard();

commit;

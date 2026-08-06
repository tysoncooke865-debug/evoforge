-- EvoForge 137 — THE FIRST-RUN TOUR REMEMBERS THE ATHLETE, NOT THE BROWSER.
--
-- THE BUG (Tyson, 2026-08-06): the six-tab tour reappeared over an active
-- workout. Two separate faults, and this migration fixes the second:
--
--   1. It fired as soon as the athlete had ONE logged training day, which is
--      true the moment they log their first set — i.e. mid-workout. That is a
--      client rule and is fixed in ui/core/tutorial-overlay.tsx: it now waits
--      for a COMPLETED session and never renders while one is in progress.
--
--   2. Its "already seen" flag lived only in AsyncStorage — localStorage on
--      web. That is per-DEVICE, not per-athlete: a second browser, a new
--      phone or a reinstall replays the tour, and two athletes sharing a
--      device share one flag. `signOut` deliberately clears every cache
--      layer, so the flag is also one refactor away from being wiped by the
--      very rule that protects everything else.
--
-- So the state moves to the profile, where the athlete's other preferences
-- already live (photo_prompts_disabled, 134). AsyncStorage stays as a local
-- fast path — reading it needs no network — but the PROFILE is the truth,
-- and truth is what survives a reinstall.
--
-- `tour_state` records WHICH ending it had: an athlete who skipped and one
-- who read all four cards are not the same person, and a future change to
-- the tour may want to re-offer only the first.
--
-- Purely additive, nullable, owner-only RLS inherited from `profile`.
-- Apply by hand via the management API (HANDOVER §5), falsify, THEN ship.

begin;

alter table public.profile
  add column if not exists tour_completed_at timestamptz,
  add column if not exists tour_state text
    check (tour_state in ('completed', 'skipped'));

comment on column public.profile.tour_completed_at is
  'When the first-run tour was finished or skipped. NULL = never seen. Per athlete, not per device.';
comment on column public.profile.tour_state is
  'completed = read to the end; skipped = dismissed. NULL = never seen.';

-- ONCE IS ONCE. A tour that re-arms itself is the whole complaint, so the
-- first answer wins: later writes cannot clear the timestamp or rewrite the
-- ending. Same shape as the reforge clock guard added in 134.
create or replace function public.profile_tour_guard()
returns trigger
language plpgsql
as $$
begin
  if old.tour_completed_at is not null then
    new.tour_completed_at := old.tour_completed_at;
    new.tour_state := old.tour_state;
  end if;
  return new;
end;
$$;

drop trigger if exists profile_tour_guard_trigger on public.profile;
create trigger profile_tour_guard_trigger
  before update on public.profile
  for each row execute function public.profile_tour_guard();

commit;

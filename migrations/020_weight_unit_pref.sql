-- EvoForge 020 — per-exercise weight unit (KG ⇄ LB toggle; Claude, 2026-07-15).
--
-- THE RULE THIS COLUMN MUST NEVER BREAK: workout_log.weight is KILOGRAMS,
-- forever. This column stores only which unit an athlete wants to SEE and TYPE
-- for one exercise; the client converts at the input/display boundary
-- (client/src/domain/units.ts) and writes kg. PRs, e1RM, volume, achievements
-- ("100kg Bench Club"), battles and avatar stats all keep reading kg unchanged.
--
-- Rides user_exercise_prefs (019) because the key is identical — (user_id,
-- exercise name) — and a unit preference is exactly the same kind of fact as a
-- favourite star. Additive and idempotent; pre-020 clients never select the
-- column and are unaffected.
--
-- NOTE FOR THE PARALLEL `nutrition` BRANCH: that branch carries its own
-- unmerged 020_nutrition.sql. This file claims 020 on the mainline; renumber
-- the nutrition migration to 021 when that branch merges.
--
-- FALSIFICATION (two real signed-in users):
--   1. A sets Bench Press to 'lb'; B still sees 'kg'.                   [RLS]
--   2. weight_unit 'stone' -> rejected.                               [check]
--   3. Row upserted twice -> one row, last unit wins.                [unique]

alter table public.user_exercise_prefs
  add column if not exists weight_unit text not null default 'kg'
  check (weight_unit in ('kg', 'lb'));

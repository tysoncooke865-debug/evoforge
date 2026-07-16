-- EvoForge 035 — persist the Train tab's plan-source choice to the account
-- (owner decision, 2026-07-16: "synced to account", not device-local).
--
-- 0 = MY PLAN · 1 = AI PLAN · 2 = BUILT-IN (client/src/domain/plan-sources.ts
-- SourceIndex). NULL means "never chosen": the client falls back to
-- defaultSource(), so every existing athlete keeps today's behaviour with no
-- backfill. The client validates on read (resolveActiveSource): a stored
-- source whose plan was later deleted DISPLAYS the fallback but is never
-- overwritten — a re-forged AI plan revives the saved choice.
--
-- Rides `profile` because a saved profile row IS the onboarded flag — every
-- post-onboarding athlete has exactly the row this column needs, RLS from 001
-- already isolates it, and the update path (useUpdateTrainingNumbers) is
-- proven. The retired Streamlit app's write projection (config/constants.py
-- SUPABASE_TABLE_SCHEMAS) never lists the column, and onboarding.tsx inserts
-- with an explicit column list — a nullable column breaks neither.
--
-- Additive and idempotent. Pre-035 clients never select the column; the
-- post-035 client's read degrades to NULL if this has not run yet, so the
-- deploy order cannot strand anyone.
--
-- FALSIFICATION (run as two real signed-in users):
--   1. A sets 2; B still reads NULL.                                   [RLS]
--   2. UPDATE profile SET active_plan_source = 5 -> rejected.        [check]
--   3. Re-running this file -> no error, no second column.     [idempotent]

alter table public.profile
  add column if not exists active_plan_source smallint
  check (active_plan_source in (0, 1, 2));

-- 057_cardio_budget_flag.sql — the "eat them back" OPT-IN
-- (Tyson's improvement doc §4.2, 2026-07-19).
--
-- Fuel folds cardio_log.calories into the day's ceiling automatically
-- (effectiveTarget = daily_kcal + burned, FUEL BATCH 2026-07-18). Tyson
-- wants that per-session and OPT-IN: after logging, "add these calories to
-- your daily budget?" — NO must leave Fuel untouched while the session
-- still logs WITH its calorie record intact. Writing calories = 0 on
-- decline would have destroyed the burn history, so the flag is a column:
--
--   count_toward_budget  true  → Fuel eats it back (today's behaviour)
--                        false → recorded burn, budget untouched
--
-- default TRUE: every existing row and every path that never shows the
-- dialog keeps the current behaviour. The FILTER lives client-side in
-- useCaloriesBurned (data/nutrition.ts) — this column is just honest
-- storage, no RLS/trigger surface changes.
--
-- FALSIFICATION CHECKLIST (as ALPHA, tiny rows, delete after):
--  1. log a session answering NO  → row lands calories>0, flag false.
--  2. log a session answering YES → row lands flag true.
--  3. Fuel's burned line reflects ONLY the YES row.
--  4. a pre-057 client (no flag in the insert) → row defaults true.

alter table public.cardio_log
  add column if not exists count_toward_budget boolean not null default true;

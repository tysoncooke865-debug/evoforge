-- EvoForge 134 — allow kind 'meal-scan-test' in ai_scan_cache (Claude, 2026-08-05).
--
-- THE 021/027 LESSON, HIT A THIRD TIME: meal-scan's Page Lab test-model
-- override (gpt-5.6, commit f625bf1) meters each override call with a
-- kind='meal-scan-test' row so rateLimited() can count it — but 027's check
-- constraint rejected the kind, storeCache swallowed the rejection ("best
-- effort"), and the hourly limiter could not trip. Found by falsification:
-- 12 consecutive override calls as smoke BRAVO all returned 200, and
-- BRAVO's ai_scan_cache held zero meal-scan-test rows.
--
-- The row is a METER, not a cache: its hash is salted with the clock, and
-- no cachedResult read ever queries this kind. rateLimited() counts ALL of
-- the caller's rows in the last hour regardless of kind, so landing the
-- rows is all the limiter needs.
--
-- Additive and idempotent, 021's exact idiom: drop-if-exists + re-add with
-- the same name. Existing rows all use the five old kinds, so the new
-- constraint validates.
--
-- FALSIFICATION (deployed meal-scan, smoke BRAVO):
--   1. POST {"model":"gpt-5.6"} once -> select count(*) where
--      kind='meal-scan-test' rises by 1.                       [meter lands]
--   2. Seed BRAVO to HOURLY_LIMIT rows in the last hour, POST again
--      -> 429 "Test-model hourly limit reached".               [limiter trips]
--   3. Bare POST (no model) -> still 200.                      [prod inert]
--   4. insert kind 'bogus' -> still rejected.                  [check holds]

alter table public.ai_scan_cache
  drop constraint if exists ai_scan_cache_kind_check;

alter table public.ai_scan_cache
  add constraint ai_scan_cache_kind_check
  check (kind in ('bodyfat', 'physique', 'plan', 'plan-scan', 'evo-scan', 'meal-scan-test'));

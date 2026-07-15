-- EvoForge 021 — allow kind 'plan-scan' in ai_scan_cache (Claude, 2026-07-15).
--
-- THE BUG THIS FIXES: ai-plan-scan (deployed 2026-07-15) writes its result
-- cache under kind 'plan-scan', but 007's check constraint only allowed
-- physique | bodyfat | coach | plan. The insert was rejected and storeCache
-- swallowed it ("best effort"), which broke TWO cost controls at once:
--   1. the sha256 result cache — every identical scan re-billed OpenAI;
--   2. the hourly rate limit — rateLimited() counts ai_scan_cache rows, and
--      plan-scan rows never landed, so plan-scan calls were UNCAPPED.
-- Found by falsification: an identical repeat call returned cached:false.
--
-- NOTE FOR THE PARALLEL `nutrition` BRANCH: its unmerged 020_nutrition.sql
-- must now be renumbered to 022 (mainline claimed 020 and 021).
--
-- Additive and idempotent: drop-if-exists + re-add with the same name.
-- Existing rows all use the four old kinds, so the new constraint validates.
--
-- FALSIFICATION (signed-in user, deployed ai-plan-scan):
--   1. POST the same text payload twice -> second response has cached:true.
--   2. select count(*) from ai_scan_cache where kind = 'plan-scan' -> >= 1.
--   3. insert kind 'bogus' -> still rejected.                        [check]

alter table public.ai_scan_cache
  drop constraint if exists ai_scan_cache_kind_check;

alter table public.ai_scan_cache
  add constraint ai_scan_cache_kind_check
  check (kind in ('physique', 'bodyfat', 'coach', 'plan', 'plan-scan'));

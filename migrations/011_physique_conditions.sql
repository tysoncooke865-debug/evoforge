-- EvoForge 011 — photo conditions on physique ratings (IMPROVEMENT_PLAN #6)
--
-- Additive, nullable, invisible to Streamlit. Old ratings read as
-- "conditions unknown". Body-fat runs record confirmed conditions inside
-- bodyfat_log.notes (already free text) — deliberately no second column
-- until something needs to query them.

alter table public.physique_ratings
  add column if not exists conditions jsonb;

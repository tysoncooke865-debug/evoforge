-- EvoForge 043 — MEAL SCAN (Tyson, 2026-07-18): the Fuel photo calorie
-- calculator. nutrition_log grows macros + the corrected ingredient list.
-- THE CONTRACT stays the Fuel doctrine: the AI identifies foods and estimates
-- grams; a DETERMINISTIC food table supplies per-100g factors and the maths is
-- pure multiplication server-side (meal-scan edge fn), mirrored exactly on the
-- client during corrections. The athlete edits and CONFIRMS before anything is
-- saved, under their own RLS. `items` keeps full provenance: every ingredient
-- records its per-100g factors and whether they came from the curated DB or an
-- AI estimate, so a save is auditable and re-computable forever.

alter table public.nutrition_log add column if not exists protein_g numeric check (protein_g is null or (protein_g >= 0 and protein_g <= 1000));
alter table public.nutrition_log add column if not exists carbs_g   numeric check (carbs_g   is null or (carbs_g   >= 0 and carbs_g   <= 1500));
alter table public.nutrition_log add column if not exists fat_g     numeric check (fat_g     is null or (fat_g     >= 0 and fat_g     <= 600));
alter table public.nutrition_log add column if not exists items     jsonb;

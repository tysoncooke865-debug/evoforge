-- 008: profile identity v2 (Expo onboarding rework).
--
-- Run by hand / via management API, like 001-007. Idempotent, ADDITIVE ONLY:
-- three nullable columns the Streamlit app never reads or writes, so the old
-- client is untouched on both sides of this migration.
--
--   sex             'male' | 'female' -- selects the avatar art set
--   deadlift_e1rm   third lift in the v2 placement formula
--   nutrition_phase 'cutting' | 'maintaining' | 'bulking' | 'flexible'
--                   -- goal context; feeds derived defaults when the AI scan
--                   -- is skipped, never a direct level bonus
--
-- Rollback: alter table public.profile drop column if exists sex,
--           drop column if exists deadlift_e1rm,
--           drop column if exists nutrition_phase;

alter table public.profile
    add column if not exists sex text
        check (sex in ('male', 'female')),
    add column if not exists deadlift_e1rm numeric,
    add column if not exists nutrition_phase text
        check (nutrition_phase in ('cutting', 'maintaining', 'bulking', 'flexible'));

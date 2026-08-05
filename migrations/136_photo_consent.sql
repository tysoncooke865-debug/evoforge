-- EvoForge 136 — AFFIRMATIVE CONSENT BEFORE A PHYSIQUE PHOTO IS TAKEN
-- (docs/ONBOARDING_V3_SPEC.md §6).
--
-- Physique photos are the most sensitive thing this app touches. The house
-- rule has always been strong — solo scan photos are analysed in memory and
-- DISCARDED, never persisted in any bucket, cache or temp file
-- (client/CLAUDE.md; battle round-3 media is a separate surface with its own
-- rules) — but a good retention policy is not the same as consent, and the
-- athlete has never been asked in plain language before the camera opens.
--
-- WHAT THIS STORES. A timestamp and the version of the wording that was
-- shown. Not the photos, not a body measurement, not an inference: just
-- "this person read this disclosure and agreed, then". The version matters
-- because consent to one description is not consent to a different one — if
-- the pipeline changes, the version bumps and the disclosure is shown again.
--
-- WITHDRAWAL is the same column set to NULL, which Settings does alongside
-- clearing physique_baseline_at. `photo_prompts_disabled` (134) is the
-- separate, stronger promise: never ask me again.
--
-- Purely additive, nullable, owner-only RLS inherited from `profile`.
-- Apply by hand via the management API (HANDOVER §5), falsify, THEN ship.

begin;

alter table public.profile
  add column if not exists photo_consent_at timestamptz,
  add column if not exists photo_consent_version smallint;

comment on column public.profile.photo_consent_at is
  'When the athlete affirmatively consented to physique photo processing. NULL = never asked, or withdrawn.';
comment on column public.profile.photo_consent_version is
  'Which disclosure wording they agreed to. A change in the pipeline bumps this and re-asks.';

commit;

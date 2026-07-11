-- EvoForge 010 — battle cancel (IMPROVEMENT_PLAN #5)
--
-- Additive only: two nullable columns recording WHO cancelled and WHEN.
-- Status reuses the 009 check constraint's existing 'abandoned' value —
-- no constraint change. No RLS or trigger changes: battle_events_guard
-- already requires matched/active status, so an abandoned match rejects
-- all client events by construction, and battle_matches has no client
-- write policies at all (only the battle-cancel edge function, holding
-- the service key, can flip the status).
--
-- Falsification checklist (smoke JWT, after battle-cancel deploys):
--   (a) cancel own inviting match          -> 200, status abandoned
--   (b) cancel again                       -> 200 idempotent
--   (c) settle an abandoned match          -> 409, zero xp_events rows
--   (d) battle_events insert after abandon -> rejected by the 009 guard
--   (e) cancel a match you are not in      -> 403

alter table public.battle_matches
  add column if not exists cancelled_by uuid references auth.users(id),
  add column if not exists cancelled_at timestamptz;

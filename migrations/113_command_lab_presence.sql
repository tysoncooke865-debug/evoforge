-- EvoForge 113 — the lab worker is allowed to exist.
--
-- command_runners.kind was constrained to 'runner' and 'supervisor'. The lab
-- worker beats with kind='lab', so every heartbeat it has ever sent was
-- rejected by the CHECK — and rejected SILENTLY, because supabase-js returns
-- errors rather than throwing and the heartbeat did not read the error.
--
-- The symptom was the worst available one: the worker ran perfectly, claimed
-- jobs, produced real measurements — and the Dev Lab showed a red "worker
-- offline" banner over the top of the results it had just produced. A false
-- alarm sitting above working output is how real alarms stop being read, which
-- is the exact failure mode rule 2 exists to prevent.
--
-- Found by checking whether the presence row existed, rather than by trusting
-- that a call which reported nothing had therefore worked.
--
-- FALSIFICATION:
--   1. a lab heartbeat is accepted and readable.
--   2. an unknown kind is still refused — this widens the vocabulary by exactly
--      one word, it does not remove the guard.

alter table public.command_runners drop constraint if exists command_runners_kind_ck;
alter table public.command_runners
  add constraint command_runners_kind_ck
  check (kind = any (array['runner', 'supervisor', 'lab']));

comment on column public.command_runners.kind is
  'runner = the studio runner (claims work orders). supervisor = the process '
  'that keeps the others alive. lab = the Dev Lab worker (claims command_lab_jobs). '
  'Adding a kind means adding it HERE first — the heartbeat fails silently otherwise.';

-- EvoForge 025 — PROGRESSION_OVERHAUL P3: standardised cardio evidence.
--
-- The Cardio pillar scores DEMONSTRATED tests (spec §12); cardio_log rows
-- are attendance (Forge XP), not evidence. This table stores test results
-- with protocol versions so only compatible attempts compare.
--
-- strength_evidence (spec §37) is DEFERRED BY DESIGN: strength observations
-- derive from workout_log at review time (the rows already exist, RLS'd and
-- server-confirmed) — a denormalised copy adds audit value only when
-- anti-cheat (P9) needs it. Derivation beats duplication until then.
--
-- FALSIFICATION: owner-only RLS (B sees 0 of A's rows); value must be
-- positive; unknown test types rejected by check.

create table if not exists public.cardio_evidence (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid()
                   references auth.users(id) on delete cascade,
  test_type        text not null check (test_type in
                     ('run_1_5km','run_2_4km','run_5km','cooper_12min',
                      'row_2km','vo2max_wearable','work_capacity','hr_recovery_1m')),
  protocol_version text not null default '1.0.0',
  -- Seconds for timed tests; metres for cooper; ml/kg/min for vo2;
  -- 0-100 for work_capacity; bpm drop for hr_recovery_1m.
  value            numeric(10,2) not null check (value > 0),
  bodyweight_kg    numeric(6,2),
  equipment_model  text,
  environment      text,
  verified         boolean not null default false,
  occurred_at      date not null,
  created_at       timestamptz not null default now()
);

create index if not exists cardio_evidence_user_idx
  on public.cardio_evidence (user_id, test_type, occurred_at desc);

alter table public.cardio_evidence enable row level security;
create policy "own cardio evidence select" on public.cardio_evidence
  for select using (user_id = auth.uid());
create policy "own cardio evidence insert" on public.cardio_evidence
  for insert with check (user_id = auth.uid());
create policy "own cardio evidence delete" on public.cardio_evidence
  for delete using (user_id = auth.uid());

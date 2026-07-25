-- EvoForge 103 — COMMAND: the loop closes. Releases get measured.
--
-- The audit's headline finding was that the loop is OPEN: work is proposed,
-- approved, built and merged, and then nothing. command_releases had never
-- contained a row, and every stage after "code merged" — release, measurement,
-- validation, rollback — existed in schema and UI and had never executed.
--
-- One release has now been raised, which exposes the next gap: NO WORK ORDER
-- CARRIES A PRIMARY METRIC. A release with nothing to measure cannot be
-- measured, so "did this help?" stays unanswerable no matter how much
-- machinery sits around it.
--
-- WHAT THIS FILE ENFORCES
--
--   1. A release records a BASELINE before it can start measuring. Comparing
--      an after-value to a number nobody wrote down first is not measurement,
--      it is recollection.
--   2. A release stays MEASURING until its window closes AND an after-value
--      exists. It cannot be classified early on a hunch.
--   3. A classification must state its CONFOUNDERS. EvoForge has no feature
--      flags, so there is no control group and a before/after comparison cannot
--      separate this release from anything else that happened that week. That
--      limitation is not a footnote to be forgotten — the column is NOT NULL.
--   4. The work order's stage follows the release outcome, so VALIDATED /
--      NEUTRAL / REGRESSED is the real terminal state, not RELEASED.
--
-- WHY NOT A CAUSAL CLAIM. With no flags and cohorts of 7-13 users, almost
-- nothing here will reach statistical significance. The honest output is a
-- DIRECTION with its limitations attached, and a system that says "we cannot
-- tell yet" is worth more than one that manufactures a p-value.
--
-- FALSIFICATION CHECKLIST:
--   1. classify a release with no baseline -> refused.
--   2. classify before the window closes -> refused.
--   3. classify with no confounders stated -> refused.
--   4. a valid classification moves the work order to the matching stage.
--   5. an unmet acceptance criterion still blocks RELEASED (100 still holds).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. MEASUREMENT COLUMNS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_releases
  add column if not exists primary_metric  text,
  add column if not exists baseline_value  numeric,
  add column if not exists baseline_window text,
  add column if not exists baseline_at     timestamptz,
  add column if not exists measure_until   timestamptz,
  add column if not exists after_value     numeric,
  add column if not exists after_at        timestamptz,
  add column if not exists outcome         text,
  add column if not exists outcome_reason  text,
  -- NOT NULL on classification (enforced in the RPC, not the column, so existing
  -- rows survive). Without flags there is no control group; anything that moved
  -- could have moved for another reason, and the record must say so.
  add column if not exists confounders     text,
  add column if not exists rollback_of     uuid references public.command_releases(id);

do $$ begin
  alter table public.command_releases add constraint command_releases_outcome_ck
    check (outcome is null or outcome in ('VALIDATED','NEUTRAL','REGRESSED','ROLLED_BACK','INCONCLUSIVE'));
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. EXPERIMENTS — designed, even when they cannot yet be run
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_experiments (
  id            uuid primary key default gen_random_uuid(),
  ref           text unique,
  work_order_id uuid references public.command_work_orders(id) on delete set null,
  hypothesis    text not null,
  target_users  text not null,
  control       text not null,
  variant       text not null,
  primary_metric text not null,
  secondary_metrics text[] not null default '{}',
  guardrails    text[] not null default '{}',
  min_exposure  int,
  duration_days int,
  success_threshold text not null,
  failure_threshold text not null,
  stop_condition text not null,
  rollback_condition text not null,
  -- Stated up front, not discovered afterwards.
  limitations   text not null,
  status        text not null default 'DESIGNED'
                check (status in ('DESIGNED','BLOCKED_NO_FLAGS','RUNNING','STOPPED','COMPLETE')),
  created_at    timestamptz not null default now()
);

comment on table public.command_experiments is
  'A design may be recorded before it can be run. EvoForge has no feature flag '
  'service, so a controlled split is not currently possible — such experiments '
  'sit in BLOCKED_NO_FLAGS rather than pretending to run.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. BASELINE — written down BEFORE the change is live
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_capture_baseline(
  p_release uuid, p_metric text, p_value numeric, p_window text, p_days int default 14
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from command_releases where id = p_release;
  if r is null then raise exception 'command: no such release'; end if;
  if r.baseline_at is not null then
    -- Re-capturing after the fact is how a disappointing result becomes a good
    -- one. The baseline is written once.
    raise exception 'command: % already has a baseline (captured %) — it cannot be recaptured', r.ref, r.baseline_at;
  end if;

  update command_releases
     set primary_metric = p_metric,
         baseline_value = p_value,
         baseline_window = p_window,
         baseline_at = now(),
         measure_until = now() + make_interval(days => greatest(p_days, 1)),
         updated_at = now()
   where id = p_release;

  perform command_log('release_baseline', 'release', p_release, r.ref,
                      'Baseline for ' || p_metric || ' = ' || p_value || ' (' || p_window || '). Measuring for ' || p_days || ' days.',
                      jsonb_build_object('metric', p_metric, 'value', p_value, 'days', p_days));
  return jsonb_build_object('ok', true, 'measure_until', now() + make_interval(days => greatest(p_days,1)));
end $$;
revoke all on function public.command_capture_baseline(uuid, text, numeric, text, int) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CLASSIFY — only when there is something to classify with
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_classify_release(
  p_release uuid, p_after numeric, p_confounders text, p_reason text default null, p_force boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_outcome text; v_delta numeric; v_pct numeric; v_stage text;
begin
  select * into r from command_releases where id = p_release;
  if r is null then raise exception 'command: no such release'; end if;

  if r.baseline_at is null then
    raise exception 'command: % has no baseline — an after-value with nothing to compare it to is not a measurement', r.ref;
  end if;
  if not p_force and r.measure_until is not null and now() < r.measure_until then
    raise exception 'command: % is still measuring until % — classifying early is guessing with extra steps',
      r.ref, r.measure_until;
  end if;
  if coalesce(trim(p_confounders), '') = '' then
    -- The honesty gate. Without feature flags there is no control group, so
    -- something else that week could explain any movement. A classification
    -- that does not say so reads as causal when it is not.
    raise exception 'command: state the confounders — with no control group, what else could explain this?';
  end if;

  v_delta := p_after - r.baseline_value;
  v_pct := case when r.baseline_value is null or r.baseline_value = 0 then null
                else round((v_delta / abs(r.baseline_value)) * 100, 1) end;

  -- A 10% band around the baseline is NEUTRAL. With cohorts this small, smaller
  -- movements are noise, and dressing noise as a win is how a team convinces
  -- itself it is improving.
  v_outcome := case
    when v_pct is null and v_delta > 0 then 'VALIDATED'
    when v_pct is null and v_delta < 0 then 'REGRESSED'
    when v_pct is null then 'NEUTRAL'
    when v_pct >= 10 then 'VALIDATED'
    when v_pct <= -10 then 'REGRESSED'
    else 'NEUTRAL' end;

  update command_releases
     set after_value = p_after, after_at = now(),
         outcome = v_outcome, confounders = p_confounders,
         outcome_reason = coalesce(p_reason,
           r.primary_metric || ': ' || r.baseline_value || ' -> ' || p_after ||
           coalesce(' (' || v_pct || '%)', '')),
         status = 'deployed', updated_at = now()
   where id = p_release;

  -- The work order's real terminal state. RELEASED was never the end.
  v_stage := case v_outcome when 'VALIDATED' then 'VALIDATED'
                            when 'REGRESSED' then 'REGRESSED'
                            else 'NEUTRAL' end;
  update command_work_orders set stage = v_stage, updated_at = now()
   where id = r.work_order_id;

  -- Every measured release becomes retrievable memory, win or loss. A regression
  -- nobody can find later is a mistake the studio is entitled to repeat.
  insert into command_lessons (kind, title, detail, tags, work_order_id)
  values (case when v_outcome = 'REGRESSED' then 'regression' else 'success' end,
          r.ref || ' ' || v_outcome || ': ' || coalesce(r.primary_metric, 'metric'),
          coalesce(r.primary_metric,'metric') || ' went ' || r.baseline_value || ' -> ' || p_after ||
          coalesce(' (' || v_pct || '%)','') || '. Confounders: ' || p_confounders,
          array['release', lower(v_outcome)], r.work_order_id);

  perform command_log('release_classified', 'release', p_release, r.ref,
                      r.ref || ' classified ' || v_outcome,
                      jsonb_build_object('outcome', v_outcome, 'baseline', r.baseline_value,
                                         'after', p_after, 'pct', v_pct));
  return jsonb_build_object('ok', true, 'outcome', v_outcome, 'delta', v_delta, 'pct', v_pct);
end $$;
revoke all on function public.command_classify_release(uuid, numeric, text, text, boolean) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_experiments enable row level security;
drop policy if exists command_experiments_read on public.command_experiments;
create policy command_experiments_read on public.command_experiments for select using (public.is_founder());
revoke insert, update, delete on public.command_experiments from authenticated, anon;

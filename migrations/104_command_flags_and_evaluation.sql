-- EvoForge 104 — Phase 5.1 (agent evaluation) + the foundation every experiment needs.
--
-- PART A — AGENT EVALUATION. command_runs has been recording since 102: model,
-- reason, tool calls, files changed, files changed OUTSIDE scope, criteria met,
-- outcome. This turns that into the numbers autonomy must be earned from. One
-- successful demonstration is an anecdote; a rate over many runs is evidence.
--
-- PART B — FEATURE FLAGS AND DETERMINISTIC ASSIGNMENT. This is the unlock. Every
-- previous release classification has had to carry the sentence "there is no
-- control group, so anything that moved could have moved for another reason".
-- Without flags an experiment is a before/after guess wearing a lab coat.
--
-- THE ASSIGNMENT RULE, AND WHY IT IS MD5 AND NOT random().
--
--   bucket = md5(flag_key || ':' || subject_id) -> first 32 bits -> 0..9999
--
-- Deterministic, stable across sessions, processes, restarts and Postgres
-- versions, and computable identically on the client. A user assigned to
-- variant B is in variant B forever, without a lookup — which is the property
-- that makes an experiment measurable at all. random() would reassign on every
-- call and silently destroy every result it touched.
--
-- Salting with the flag key matters: without it, a user unlucky in one
-- experiment would be unlucky in all of them, and the experiments would
-- correlate with each other rather than being independent.
--
-- FALSIFICATION CHECKLIST:
--   1. the same (flag, subject) returns the same variant 1000 times.
--   2. different flags spread the SAME subject across variants (no correlation).
--   3. a 50/50 split over 10k subjects lands within a few percent.
--   4. rollout 0 assigns nobody; rollout 100 assigns everybody.
--   5. a disabled flag assigns nobody, whatever the rollout says.
--   6. agent stats count only finished runs.

-- ─────────────────────────────────────────────────────────────────────────────
-- PART A — AGENT EVALUATION
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_agents
  add column if not exists autonomy_level int not null default 0,
  add column if not exists autonomy_note  text;

comment on column public.command_agents.autonomy_level is
  '0 = every change reviewed. 1 = LOW-risk work may proceed unattended. '
  '2 = LOW and MEDIUM. Raised ONLY from command_agent_stats, never from a '
  'single good demonstration.';

create or replace function public.command_agent_stats(p_since interval default interval '30 days')
returns table (
  agent_key text, runs bigint, successes bigint, success_rate numeric,
  blocked bigint, failed bigint,
  avg_tool_calls numeric, avg_files numeric,
  unnecessary_file_rate numeric, criteria_pass_rate numeric,
  avg_cost_usd numeric, cost_per_success numeric, median_minutes numeric
) language sql stable security definer set search_path = public as $$
  with r as (
    select * from command_runs
     where started_at > now() - p_since
       and ended_at is not null            -- only FINISHED runs; an in-flight
                                           -- job is not evidence of anything
  )
  select
    r.agent_key,
    count(*)::bigint,
    count(*) filter (where outcome = 'success')::bigint,
    round(count(*) filter (where outcome = 'success')::numeric / nullif(count(*),0), 3),
    count(*) filter (where outcome = 'blocked')::bigint,
    count(*) filter (where outcome = 'failed')::bigint,
    round(avg(tool_calls), 1),
    round(avg(files_changed), 1),
    -- Scope discipline: how often an agent touched files the order never named.
    round(count(*) filter (where unexpected_files > 0)::numeric / nullif(count(*),0), 3),
    round(sum(criteria_met)::numeric / nullif(sum(nullif(criteria_total,0)),0), 3),
    round(avg(cost_usd), 4),
    round(sum(cost_usd) / nullif(count(*) filter (where outcome = 'success'),0), 4),
    round(percentile_cont(0.5) within group (
      order by extract(epoch from (ended_at - started_at))/60)::numeric, 1)
  from r group by r.agent_key;
$$;
grant execute on function public.command_agent_stats(interval) to authenticated;

/**
 * The autonomy a run's evidence would justify — advisory, never automatic.
 *
 * Deliberately conservative and deliberately NOT self-applying: a system that
 * promotes itself on its own numbers has no independent check, and the first
 * bad metric becomes a permission escalation. A founder reads this and decides.
 */
create or replace function public.command_suggested_autonomy(p_agent text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s record; v_level int := 0; v_why text;
begin
  select * into s from command_agent_stats('60 days') where agent_key = p_agent;
  if s is null or s.runs < 10 then
    return jsonb_build_object('level', 0, 'why',
      format('%s finished run(s) in 60 days — too few to earn anything. Ten is the floor.',
             coalesce(s.runs, 0)));
  end if;

  if s.success_rate >= 0.8 and s.unnecessary_file_rate <= 0.1 and coalesce(s.criteria_pass_rate,0) >= 0.8 then
    v_level := 2; v_why := 'sustained success, tight scope and criteria actually met';
  elsif s.success_rate >= 0.6 and s.unnecessary_file_rate <= 0.25 then
    v_level := 1; v_why := 'reliable on contained work, but not yet on anything that matters';
  else
    v_level := 0; v_why := 'not yet reliable enough to work unattended';
  end if;

  return jsonb_build_object('level', v_level, 'why', v_why,
    'runs', s.runs, 'success_rate', s.success_rate,
    'unnecessary_file_rate', s.unnecessary_file_rate,
    'criteria_pass_rate', s.criteria_pass_rate);
end $$;
grant execute on function public.command_suggested_autonomy(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- PART B — FEATURE FLAGS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_flags (
  key           text primary key,
  label         text not null,
  description   text,
  kind          text not null default 'boolean' check (kind in ('boolean','multivariate')),
  enabled       boolean not null default false,
  -- 0..100. A flag at 0 is off for everyone even when enabled, which is the
  -- safe default for something newly created.
  rollout_pct   numeric(5,2) not null default 0 check (rollout_pct between 0 and 100),
  -- [{"key":"control","weight":50},{"key":"variant_a","weight":50}]
  variants      jsonb not null default '[{"key":"control","weight":100}]'::jsonb,
  -- Targeting. NULL means "no constraint"; an empty array would mean "match
  -- nothing", and confusing the two is how a flag silently reaches nobody.
  platforms     text[],
  countries     text[],
  min_app_version text,
  segments      text[],
  internal_only boolean not null default false,
  -- What a subject is bucketed by. user is the default because anything finer
  -- lets a person see both variants, which destroys the comparison.
  assign_by     text not null default 'user'
                check (assign_by in ('user','device','session','workout','ai_request')),
  owner         text,
  experiment_id uuid,
  paused_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Sticky assignments, recorded when a subject is first bucketed. The hash makes
-- this reproducible without the table; the table exists so exposure can be
-- counted and audited after the fact.
create table if not exists public.command_flag_assignments (
  flag_key     text not null references public.command_flags(key) on delete cascade,
  subject_kind text not null,
  subject_id   text not null,
  variant      text not null,
  assigned_at  timestamptz not null default now(),
  primary key (flag_key, subject_kind, subject_id)
);
create index if not exists command_flag_assign_variant_idx
  on public.command_flag_assignments(flag_key, variant);

/**
 * The bucket: 0..9999, deterministic forever.
 *
 * Salted with the flag key so a subject's luck in one experiment says nothing
 * about their luck in another — without the salt every experiment would share
 * the same unlucky cohort and the results would correlate.
 */
create or replace function public.command_bucket(p_flag text, p_subject text)
returns int language sql immutable as $$
  select (('x' || substr(md5(p_flag || ':' || coalesce(p_subject,'')), 1, 8))::bit(32)::bigint
          % 10000)::int;
$$;

create or replace function public.command_assign_variant(p_flag text, p_subject text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f record; v_bucket int; v_cum numeric := 0; v_total numeric; v_item jsonb; v_variant text;
begin
  select * into f from command_flags where key = p_flag;
  if f is null then return jsonb_build_object('in_experiment', false, 'reason', 'no such flag'); end if;
  if not f.enabled then return jsonb_build_object('in_experiment', false, 'reason', 'flag disabled'); end if;

  v_bucket := command_bucket(p_flag, p_subject);

  -- Rollout gate first: buckets above the cut are simply not in the experiment,
  -- and must NOT be silently counted as control — "not exposed" and "exposed to
  -- control" are different populations and mixing them biases every result.
  if v_bucket >= (f.rollout_pct * 100) then
    return jsonb_build_object('in_experiment', false, 'reason', 'outside rollout', 'bucket', v_bucket);
  end if;

  select coalesce(sum((value->>'weight')::numeric), 0) into v_total
    from jsonb_array_elements(f.variants);
  if v_total <= 0 then return jsonb_build_object('in_experiment', false, 'reason', 'no variant weights'); end if;

  -- Re-bucket within the rollout window so variant split is even across the
  -- exposed population rather than skewed by where the rollout cut fell.
  for v_item in select * from jsonb_array_elements(f.variants) loop
    v_cum := v_cum + (v_item->>'weight')::numeric;
    if (v_bucket % 10000) * v_total / (f.rollout_pct * 100) < v_cum then
      v_variant := v_item->>'key';
      exit;
    end if;
  end loop;
  v_variant := coalesce(v_variant, (f.variants->0->>'key'));

  insert into command_flag_assignments (flag_key, subject_kind, subject_id, variant)
  values (p_flag, f.assign_by, coalesce(p_subject,''), v_variant)
  on conflict (flag_key, subject_kind, subject_id) do nothing;

  return jsonb_build_object('in_experiment', true, 'variant', v_variant,
                            'bucket', v_bucket, 'assign_by', f.assign_by);
end $$;
grant execute on function public.command_bucket(text, text) to authenticated, anon;
grant execute on function public.command_assign_variant(text, text) to authenticated;

create or replace function public.command_set_flag(
  p_key text, p_enabled boolean default null, p_rollout numeric default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text; f record;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  select * into f from command_flags where key = p_key;
  if f is null then raise exception 'command: no such flag'; end if;
  select name into v_name from command_founders where user_id = auth.uid();

  update command_flags
     set enabled = coalesce(p_enabled, enabled),
         rollout_pct = coalesce(p_rollout, rollout_pct),
         paused_reason = case when p_enabled is false then p_reason else null end,
         updated_at = now()
   where key = p_key;

  perform command_log('flag_set', 'settings', null, p_key,
    format('%s set %s to enabled=%s rollout=%s%s', coalesce(v_name,'a founder'), p_key,
           coalesce(p_enabled, f.enabled), coalesce(p_rollout, f.rollout_pct),
           case when p_reason is not null then ' — ' || p_reason else '' end),
    jsonb_build_object('enabled', coalesce(p_enabled, f.enabled), 'rollout', coalesce(p_rollout, f.rollout_pct)));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.command_set_flag(text, boolean, numeric, text) to authenticated;

-- The registry now tells the truth about flags.
update public.command_integrations
   set status = 'live',
       detail = 'command_flags + command_assign_variant. Deterministic md5 bucketing, sticky per subject, salted per flag. The client reads assignment via RPC or recomputes the same hash locally.',
       setup_required = 'Client-side hook in the Expo app to read assignments and record exposure.',
       updated_at = now()
 where key = 'feature_flags';

alter table public.command_flags enable row level security;
alter table public.command_flag_assignments enable row level security;
drop policy if exists command_flags_read on public.command_flags;
create policy command_flags_read on public.command_flags for select using (public.is_founder());
drop policy if exists command_flag_assign_read on public.command_flag_assignments;
create policy command_flag_assign_read on public.command_flag_assignments for select using (public.is_founder());
revoke insert, update, delete on public.command_flags from authenticated, anon;
revoke insert, update, delete on public.command_flag_assignments from authenticated, anon;

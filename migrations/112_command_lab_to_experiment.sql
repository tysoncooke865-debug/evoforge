-- EvoForge 112 — the door out of the Dev Lab.
--
-- The lab's whole purpose is that ideas leave it as evidence rather than as
-- opinions. Everything before this migration let a variant be built, rendered,
-- screenshotted, measured and judged; none of it let a variant BECOME an
-- experiment, so the last step was still "someone types it in again".
--
-- THE ONE RULE THIS ENFORCES
--
--   An experiment may only be created on a metric that can actually be
--   computed. command_metric_defs holds a SQL template per metric, and six of
--   the thirteen catalogued metrics have none — crash_rate and retention_d7
--   among them, because no error monitoring is wired and no retention query
--   exists. Creating an experiment on one of those produces something that
--   looks completely normal, runs for two weeks, and can never be decided.
--
--   105 already refuses to let such an experiment REACH RUNNING. This refuses
--   to let it be created at all, which is the difference between finding out
--   now and finding out after the build.
--
-- FALSIFICATION CHECKLIST (in scripts/_falsify112.mjs):
--   1. an experiment on an uncomputable metric is refused at creation.
--   2. a variant carried to an experiment records which variant it came from.
--   3. the flag it creates starts DISABLED at 0% — never live on creation.
--   4. a bench case cannot be created without a rubric.
--   5. a prompt version cannot be created without a reason.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. VARIANT → EXPERIMENT
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Carry a lab variant into a real experiment.
 *
 * Creates the experiment in DRAFT and the flag DISABLED at 0%. Deliberately
 * not RUNNING and deliberately not enabled: the founders' approval and the
 * rollout ladder are the two gates between a good-looking variant and real
 * athletes, and a function that skipped either would be a hole straight through
 * the governance this whole system exists to be.
 */
create or replace function public.command_experiment_from_variant(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_variant command_lab_variants;
  v_subject command_lab_subjects;
  v_metric text := p->>'primary_metric';
  v_computable boolean;
  v_ref text; v_id uuid; v_flag text; v_name text;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;

  select * into v_variant from command_lab_variants where id = (p->>'variant_id')::uuid;
  if v_variant.id is null then raise exception 'command: no such variant'; end if;
  select * into v_subject from command_lab_subjects where key = v_variant.subject_key;

  if v_variant.experiment_id is not null then
    raise exception 'command: % v% is already carried into an experiment',
      v_variant.subject_key, v_variant.version;
  end if;

  select d.sql_template is not null into v_computable
    from command_metric_defs d where d.key = v_metric;
  if v_computable is null then
    raise exception 'command: % is not in the metric catalogue — an experiment cannot be decided on a metric nobody defined', v_metric;
  end if;
  if not v_computable then
    raise exception
      'command: % has no query behind it, so this experiment could never be decided. '
      'Give the metric a sql_template first, or choose one that has one.', v_metric;
  end if;

  select name into v_name from command_founders where user_id = auth.uid();
  select 'EXP-' || lpad((count(*)+1)::text, 3, '0') into v_ref from command_experiments;
  v_flag := 'exp_' || command_slug(coalesce(v_subject.key, 'variant')) || '_' || lower(replace(v_ref,'-','_'));

  -- The flag is created OFF. Nothing about carrying a variant out of the lab
  -- should expose it to a single athlete.
  insert into command_flags (key, label, description, kind, enabled, rollout_pct, assign_by, owner)
  values (v_flag, format('%s — %s', coalesce(v_subject.label, v_variant.subject_key), v_variant.label),
          format('Created from Dev Lab variant %s v%s. %s',
                 v_variant.subject_key, v_variant.version, left(v_variant.reason, 300)),
          'boolean', false, 0, 'user', coalesce(v_name, 'founder'))
  on conflict (key) do nothing;

  insert into command_experiments (
    ref, hypothesis, target_users, control, variant, primary_metric,
    success_threshold, failure_threshold, stop_condition, rollback_condition, limitations,
    status, name, description, feature, flag_key, risk_level, owner,
    variants, rollout_pct, tags)
  values (
    v_ref,
    coalesce(p->>'hypothesis',
      format('%s (%s) will improve %s compared with the current design. Stated reason: %s',
             v_variant.label, v_variant.subject_key, v_metric, left(v_variant.reason, 200))),
    coalesce(p->>'target_users', 'All athletes reaching this surface'),
    'control', 'variant', v_metric,
    coalesce(p->>'success_threshold', format('%s improves and the lower bound of the interval stays above zero', v_metric)),
    coalesce(p->>'failure_threshold', format('%s falls, or a guardrail trips', v_metric)),
    coalesce(p->>'stop_condition', 'Minimum sample reached on both arms, or a guardrail breach'),
    coalesce(p->>'rollback_condition', 'Disable the flag; it starts disabled and no athlete sees the variant until it is enabled'),
    -- Stated once, here, rather than remembered later. This is a lab result.
    format('This variant won in the Dev Lab, which is evidence about the DESIGN, not about athletes. '
        || 'A lab judgement has no users in it. Nothing is proven until this experiment reads out.%s',
        case when v_variant.origin = 'generated'
             then format(' It was generated by %s against the objective "%s".',
                         coalesce(v_variant.model,'a model'), coalesce(v_variant.goal,'unstated'))
             else '' end),
    'DRAFT',
    format('%s — %s', coalesce(v_subject.label, v_variant.subject_key), v_variant.label),
    v_variant.reason,
    v_variant.subject_key, v_flag,
    coalesce(p->>'risk_level', 'LOW'),
    coalesce(v_name, 'founder'),
    jsonb_build_array(
      jsonb_build_object('key','control','label','Current design'),
      jsonb_build_object('key','variant','label', v_variant.label, 'lab_variant_id', v_variant.id)),
    0,
    array['devlab', v_variant.subject_key])
  returning id into v_id;

  insert into command_experiment_metrics (experiment_id, metric_key, role)
  values (v_id, v_metric, 'primary')
  on conflict do nothing;

  update command_lab_variants set experiment_id = v_id where id = v_variant.id;

  perform command_log('experiment_from_variant', 'settings', v_id, v_ref,
    format('%s created from %s v%s — primary metric %s, flag %s (disabled, 0%%)',
           v_ref, v_variant.subject_key, v_variant.version, v_metric, v_flag),
    jsonb_build_object('variant_id', v_variant.id, 'flag', v_flag, 'metric', v_metric));

  return jsonb_build_object('ok', true, 'id', v_id, 'ref', v_ref, 'flag', v_flag,
    'note', 'Created as DRAFT with the flag disabled at 0%. It reaches athletes only through approval and the rollout ladder.');
end $$;
revoke all on function public.command_experiment_from_variant(jsonb) from public, anon;
grant execute on function public.command_experiment_from_variant(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. WRITES THE LAB UI NEEDS
-- ─────────────────────────────────────────────────────────────────────────────

/** A new prompt version. Version numbers are the database's, not the caller's. */
create or replace function public.command_new_prompt_version(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_version int; v_key text := p->>'prompt_key'; v_author text;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  if coalesce(trim(p->>'body'),'') = '' then
    raise exception 'command: a prompt version needs a body';
  end if;
  if coalesce(trim(p->>'reason'),'') = '' then
    raise exception 'command: say why this version exists — a version with no stated reason is a diff nobody can evaluate later';
  end if;
  if not exists (select 1 from command_prompts where key = v_key) then
    raise exception 'command: no such prompt %', v_key;
  end if;

  v_author := coalesce((select name from command_founders where user_id = auth.uid()), 'founder');
  select coalesce(max(version),0) + 1 into v_version from command_prompt_versions where prompt_key = v_key;

  insert into command_prompt_versions (prompt_key, version, body, reason, author, model, temperature)
  values (v_key, v_version, p->>'body', p->>'reason', v_author, p->>'model',
          nullif(p->>'temperature','')::numeric)
  returning id into v_id;

  perform command_log('prompt_version_created', 'settings', v_id, v_key,
    format('%s v%s written by %s — %s', v_key, v_version, v_author, p->>'reason'), '{}'::jsonb);

  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_version);
end $$;
revoke all on function public.command_new_prompt_version(jsonb) from public, anon;
grant execute on function public.command_new_prompt_version(jsonb) to authenticated;

/** A benchmark case. The rubric is mandatory — an unscoreable case is a no-op. */
create or replace function public.command_add_bench_case(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  if coalesce(trim(p->>'rubric'),'') = '' then
    raise exception 'command: a benchmark case needs a rubric — without one there is nothing to score against, and an unscored run counts for nothing';
  end if;
  if coalesce(trim(p->>'label'),'') = '' then
    raise exception 'command: a benchmark case needs a label';
  end if;

  v_key := coalesce(nullif(p->>'key',''), 'case_' || command_slug(p->>'label'));

  insert into command_bench_cases (key, prompt_key, label, input, rubric, persona_key)
  values (v_key, p->>'prompt_key', p->>'label',
          coalesce(p->'input', '{}'::jsonb), p->>'rubric', nullif(p->>'persona_key',''))
  on conflict (key) do update
    set label = excluded.label, input = excluded.input,
        rubric = excluded.rubric, persona_key = excluded.persona_key;

  perform command_log('bench_case_saved', 'settings', null, v_key,
    format('benchmark case %s saved for %s', v_key, p->>'prompt_key'), '{}'::jsonb);

  return jsonb_build_object('ok', true, 'key', v_key);
end $$;
revoke all on function public.command_add_bench_case(jsonb) from public, anon;
grant execute on function public.command_add_bench_case(jsonb) to authenticated;

/**
 * The Prompt Lab's detail for one prompt, in one round trip.
 *
 * Versions, their scoreboard rows and the most recent runs together. Three
 * separate queries from Sydney is a quarter of a second of nothing on screen.
 */
create or replace function public.command_prompt_detail(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'prompt', (select to_jsonb(x) from command_prompts x where x.key = p_key),
    'versions', (select coalesce(jsonb_agg(to_jsonb(v) order by v.version desc), '[]'::jsonb)
                   from command_prompt_versions v where v.prompt_key = p_key and not v.archived),
    'scoreboard', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
                     from command_prompt_scoreboard(p_key) s),
    'cases', (select coalesce(jsonb_agg(to_jsonb(c) order by c.key), '[]'::jsonb)
                from command_bench_cases c where c.prompt_key = p_key),
    'runs', (select coalesce(jsonb_agg(to_jsonb(r) order by r.ran_at desc), '[]'::jsonb)
               from (select r.*, v.version
                       from command_bench_runs r
                       join command_prompt_versions v on v.id = r.version_id
                      where v.prompt_key = p_key
                      order by r.ran_at desc limit 60) r));
$$;
grant execute on function public.command_prompt_detail(text) to authenticated;

/** One subject's variants with their captures — the UI Studio's payload. */
create or replace function public.command_lab_subject_detail(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'subject', (select to_jsonb(s) from command_lab_subjects s where s.key = p_key),
    'variants', (select coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object(
                    'captures', (select coalesce(jsonb_agg(jsonb_build_object(
                                   'id', c.id, 'viewport', c.viewport, 'path', c.storage_path,
                                   'at', c.captured_at) order by c.captured_at desc), '[]'::jsonb)
                                   from command_lab_captures c where c.variant_id = v.id),
                    'perf', (select coalesce(jsonb_agg(jsonb_build_object(
                                'id', pr.id, 'lcp_ms', pr.lcp_ms, 'cls', pr.cls, 'tbt_ms', pr.tbt_ms,
                                'fps_mean', pr.fps_mean, 'dom_nodes', pr.dom_nodes,
                                'js_heap_bytes', pr.js_heap_bytes, 'error', pr.error,
                                'at', pr.ran_at) order by pr.ran_at desc), '[]'::jsonb)
                                from command_perf_runs pr where pr.variant_id = v.id),
                    'experiment', (select jsonb_build_object('ref', e.ref, 'status', e.status)
                                     from command_experiments e where e.id = v.experiment_id))
                  order by v.version desc), '[]'::jsonb)
                  from command_lab_variants v where v.subject_key = p_key and not v.archived));
$$;
grant execute on function public.command_lab_subject_detail(text) to authenticated;

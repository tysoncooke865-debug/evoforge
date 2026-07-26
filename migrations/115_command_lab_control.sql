-- EvoForge 115 — "start working", for work that is sitting there.
--
-- A founder queues a benchmark, the rail says "queued", and nothing happens.
-- There was no way to act on that from the browser: the studio runner has a
-- start switch on the Floor, the lab worker had none, because it was written to
-- be always-on and therefore never to need one.
--
-- Always-on is right up until it is not running — a crash loop, a machine that
-- slept, a founder who stopped everything last week. Then the room shows queued
-- work and offers nothing to do about it, which is the same dead end as a
-- progress bar that does not move.
--
-- HOW IT WORKS, AND WHY IT IS NOT A REQUEST TO THE WORKER
--
--   The browser cannot reach this machine. It writes a DESIRED state, and the
--   supervisor reads it on its own beat — the identical inversion that already
--   starts and stops the studio runner from the Floor. No inbound connection,
--   no tunnel, no port.
--
--   Default 'running'. A worker that has never been touched stays always-on,
--   which is the property the original design was protecting. Only an explicit
--   stop turns it off, and only an explicit start turns it back on.
--
-- WHAT THE BUTTON MUST NOT DO IS LIE. Three different states look identical
-- from a queued row, and only one of them a button can fix:
--
--   • the machine is off          -> no supervisor heartbeat. A button cannot
--                                    help, and offering one would be a lie.
--   • the worker is stopped       -> a button starts it. This is the case.
--   • the worker is busy          -> it is single-threaded and already working.
--                                    The honest answer is what it is busy with.
--
-- command_lab_overview now returns everything needed to tell those apart, so
-- the UI never has to guess.
--
-- FALSIFICATION (scripts/_falsify115.mjs):
--   1. the desired state round-trips and is audited.
--   2. an invalid desired state is refused.
--   3. only founders may set it.
--   4. the overview reports supervisor presence and worker state separately.

insert into public.command_settings (key, value)
values ('lab_desired', to_jsonb('running'::text))
on conflict (key) do nothing;

/**
 * Ask the lab worker to start or stop.
 *
 * Mirrors command_set_runner_desired deliberately, down to the audit line: two
 * controls that behave the same way are two controls somebody only has to learn
 * once.
 */
create or replace function public.command_set_lab_desired(p_desired text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  if p_desired not in ('running','stopped') then
    raise exception 'command: desired must be running or stopped';
  end if;
  select name into v_name from command_founders where user_id = auth.uid();

  insert into command_settings (key, value) values ('lab_desired', to_jsonb(p_desired))
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform command_log('lab_desired_set', 'settings', null, 'lab_desired',
                      coalesce(v_name,'a founder') || ' asked the Dev Lab worker to ' ||
                      case when p_desired = 'running' then 'start' else 'stop' end,
                      jsonb_build_object('desired', p_desired));

  return jsonb_build_object('ok', true, 'desired', p_desired);
end $$;
revoke all on function public.command_set_lab_desired(text) from public, anon;
grant execute on function public.command_set_lab_desired(text) to authenticated;

/**
 * The lab overview, now able to distinguish "off" from "stopped" from "busy".
 *
 * Rebuilt on 110's version rather than from an older copy — every existing key
 * is unchanged; `supervisor`, `lab_desired` and `queued` are added.
 */
create or replace function public.command_lab_overview()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'generated_at', now(),
    'subjects', (
      select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
               'variants', (select count(*) from command_lab_variants v
                             where v.subject_key = s.key and not v.archived),
               'latest', (select max(v.created_at) from command_lab_variants v
                             where v.subject_key = s.key and not v.archived))
             order by s.sort, s.label), '[]'::jsonb)
        from command_lab_subjects s where not s.archived),
    'prompts', (
      select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
               'versions', (select count(*) from command_prompt_versions pv
                             where pv.prompt_key = p.key and not pv.archived),
               'live', (select pv.version from command_prompt_versions pv
                         where pv.prompt_key = p.key and pv.is_live),
               'runs', (select count(*) from command_bench_runs r
                         join command_prompt_versions pv on pv.id = r.version_id
                        where pv.prompt_key = p.key))
             order by p.key), '[]'::jsonb)
        from command_prompts p),
    'personas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.key), '[]'::jsonb)
                   from command_personas x),
    'jobs', (select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc), '[]'::jsonb)
               from (select * from command_lab_jobs order by created_at desc limit 40) j),
    'perf', (select coalesce(jsonb_agg(to_jsonb(p) order by p.ran_at desc), '[]'::jsonb)
               from (select * from command_perf_runs order by ran_at desc limit 40) p),
    'tournaments', (select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
                      'entrants', (select count(*) from command_arena_entrants e where e.tournament_id = t.id))
                      order by t.created_at desc), '[]'::jsonb)
                      from command_arena_tournaments t),
    'predictions', (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
                      from command_predictions p),
    'accuracy', command_prediction_accuracy(),
    'integrations', (select coalesce(jsonb_agg(to_jsonb(i) order by i.key), '[]'::jsonb)
                       from command_integrations i where i.category = 'devlab'),
    'worker', (select to_jsonb(r) from command_runners r where r.kind = 'lab'
                order by r.last_seen_at desc limit 1),
    -- Presence of the SUPERVISOR is what separates "this machine is off" from
    -- "the worker is stopped". Without it the UI cannot know whether pressing
    -- start could possibly do anything.
    'supervisor', (select to_jsonb(r) from command_runners r where r.kind = 'supervisor'
                    order by r.last_seen_at desc limit 1),
    'lab_desired', (select value #>> '{}' from command_settings where key = 'lab_desired'),
    'queued', (select count(*) from command_lab_jobs where status = 'queued')
  );
$$;
grant execute on function public.command_lab_overview() to authenticated;

-- EvoForge 120 — Scout can finally do its job.
--
-- Scout's remit is competitor and market intelligence. Its capability was
-- nothing: command_integrations.competitor_web has read 'manual' since 101,
-- with the note "Scout has no scraping capability". An agent with a mandate and
-- no way to act on it is not idle, it is non-compliant — it can never produce
-- the thing it exists to produce, and every report of "Scout has collected
-- nothing" was structurally guaranteed rather than a lack of trying.
--
-- The capability existed the whole time and was switched off. The Claude CLI on
-- the runner machine has WebSearch and WebFetch; the studio runner withholds
-- them deliberately (agents editing the repo must not browse), but the LAB
-- worker has no such constraint — it writes evidence rows, not code.
--
-- WHAT MAKES THIS COMPLIANT RATHER THAN JUST ENABLED
--
--   Every finding must carry a URL that was actually fetched and a verbatim
--   excerpt from it. Findings without both are DROPPED and the count of dropped
--   ones is reported — a research pass that returns six claims and files four is
--   telling you something true about the other two.
--
--   Nothing lands as a 'fact'. External research is recorded as an
--   interpretation with the source attached, because a competitor's own pricing
--   page is evidence of what they publish, not of what they charge everyone.
--   117's command_knowledge_sources.trusted carries the same idea upward.
--
--   The existing 099 CHECK already refuses evidence with no source_ref and no
--   excerpt. This does not add a rule; it makes Scout able to satisfy the one
--   that was already there.

alter table public.command_lab_jobs drop constraint if exists command_lab_jobs_kind_check;
alter table public.command_lab_jobs
  add constraint command_lab_jobs_kind_check
  check (kind = any (array['bench','judge','capture','perf','generate','simulate',
                           'arena','predict','import','edit','transcribe','research']));

update public.command_integrations
   set status = 'live',
       detail = 'Scout researches through the lab worker with WebSearch and WebFetch enabled. Every finding must carry a URL that was actually fetched and a verbatim excerpt, or it is dropped and counted as dropped. Findings are filed as interpretations with their source, never as facts: a competitor''s pricing page is evidence of what they publish.',
       setup_required = 'The lab worker must be running. The studio runner still withholds browsing from agents that edit the repository.',
       updated_at = now()
 where key = 'competitor_web';

insert into public.command_integrations (key,label,category,status,detail,setup_required) values
  ('scout_research','Scout — live research','competitor','live',
   'A research job runs on the runner machine with real web access and writes command_evidence rows with real citations. Bounded by the same rule as everything else: a claim with no source is refused by the database, not by the prompt.',
   'None.')
on conflict (key) do update set status=excluded.status, detail=excluded.detail,
  setup_required=excluded.setup_required, updated_at=now();

-- The sweep should also clear dispatch pointing at things that no longer exist.
-- A verify job whose release was deleted failed on every cycle and logged
-- "no such release" forever; the runner cannot fix that and neither can a founder.
create or replace function public.command_sweep_dispatch()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stuck int := 0; v_orphan int := 0; v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids
    from command_dispatch
   where status = 'pending' and attempts >= max_attempts;

  if coalesce(array_length(v_ids,1),0) > 0 then
    update command_dispatch
       set status = 'failed',
           error = coalesce(nullif(error,''),
             'Exhausted ' || max_attempts || ' attempts and could never be claimed again. ' ||
             'It was left showing as pending, which is why nothing appeared to be wrong.'),
           updated_at = now()
     where id = any(v_ids);
    get diagnostics v_stuck = row_count;
  end if;

  -- Orphaned targets: the work order, release or task was removed. Cancelled
  -- rather than failed, because nothing went wrong with the work — the thing it
  -- referred to stopped existing.
  update command_dispatch d
     set status = 'cancelled',
         error = 'The work order, release or task this job referred to no longer exists.',
         updated_at = now()
   where d.status in ('pending','claimed')
     and ((d.work_order_id is not null and not exists (select 1 from command_work_orders w where w.id = d.work_order_id))
       or (d.release_id    is not null and not exists (select 1 from command_releases r where r.id = d.release_id))
       or (d.task_id       is not null and not exists (select 1 from command_tasks t where t.id = d.task_id)));
  get diagnostics v_orphan = row_count;

  if v_stuck + v_orphan > 0 then
    perform command_log('dispatch_swept', 'settings', null, 'dispatch',
      format('%s job(s) were pending but unclaimable and are now failed; %s pointed at something that no longer exists and were cancelled',
             v_stuck, v_orphan),
      jsonb_build_object('stuck', v_stuck, 'orphaned', v_orphan), 'system', 'sweep');
  end if;

  return jsonb_build_object('ok', true, 'swept', v_stuck, 'orphaned', v_orphan);
end $$;

select public.command_sweep_dispatch();

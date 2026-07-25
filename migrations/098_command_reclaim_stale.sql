-- EvoForge 098 — COMMAND: work claimed by a runner that died comes back.
--
-- A dispatch row moves pending -> claimed the moment a runner takes it, and
-- nothing ever moved it back. If that runner then stopped — a reboot, the laptop
-- sleeping, a crash, or an operator restarting it mid-job — the row stayed
-- claimed forever and its task stayed 'building' forever. The floor showed
-- agents at work, the runner sat idle with an empty queue, and both were telling
-- the truth about themselves while the studio as a whole was stuck.
--
-- This happened repeatedly in one evening of operating it, which makes it an
-- ordinary event rather than an incident: any machine that sleeps produces it.
--
-- THE SUBTLE PART, AND THE FIRST VERSION OF THIS FILE GOT IT WRONG.
--
-- "Reclaim if the claiming worker is stale" does not work, because the worker
-- NAME is reused. A restarted runner comes back as runner@HOST — the same
-- identity that holds the orphaned rows — so the rows look like they belong to
-- a live worker and are never returned. That is exactly the state this migration
-- was written to clear, and the first attempt sailed straight past it.
--
-- command_runners.started_at is the discriminator, and 095 already maintains it:
-- it only moves when a genuinely new process starts. A row claimed BEFORE the
-- current process started cannot be held by that process, whatever the name
-- says. So the rule is:
--
--   reclaim when the worker is unknown, or stopped, or has not checked in for
--   p_stale_minutes, OR the claim predates the current incarnation of that
--   worker.
--
-- Attempts are NOT incremented. The agent never ran; a dead machine is not a
-- failed attempt, and charging one burns the retry budget on an outage.
--
-- FALSIFICATION CHECKLIST:
--   1. a row claimed by a LIVE worker AFTER it started -> not reclaimed. [live]
--   2. the same row claimed before that worker started -> reclaimed.     [stale]
--   3. a row claimed by a worker with no runner row     -> reclaimed.   [orphan]
--   4. attempts unchanged across a reclaim.                             [budget]

create or replace function public.command_reclaim_stale_dispatch(p_stale_minutes int default 5)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_tasks uuid[];
  v_rows int := 0;
begin
  select coalesce(array_agg(d.id), '{}'), coalesce(array_agg(d.task_id) filter (where d.task_id is not null), '{}')
    into v_ids, v_tasks
    from command_dispatch d
    left join command_runners r on r.worker = d.claimed_by
   where d.status = 'claimed'
     and (
          r.worker is null                                             -- never seen
       or r.state = 'stopped'                                          -- stopped on purpose
       or r.last_seen_at < now() - make_interval(mins => p_stale_minutes)  -- gone quiet
       -- Claimed by an EARLIER incarnation of a worker that has since
       -- restarted. Same name, different process; it is not holding this.
       or (r.started_at is not null and d.claimed_at is not null and d.claimed_at < r.started_at)
     );

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'reclaimed', 0);
  end if;

  update command_dispatch
     set status = 'pending', claimed_by = null, claimed_at = null, updated_at = now()
   where id = any(v_ids);
  get diagnostics v_rows = row_count;

  update command_tasks
     set status = 'queued', progress = 0, activity = null, activity_at = null, updated_at = now()
   where id = any(v_tasks)
     and status in ('building','planning','testing');

  perform command_log('dispatch_reclaimed', 'settings', null, 'dispatch',
                      v_rows || ' job(s) were claimed by a runner that is no longer running, and have been returned to the queue',
                      jsonb_build_object('rows', v_rows, 'stale_minutes', p_stale_minutes));

  return jsonb_build_object('ok', true, 'reclaimed', v_rows);
end $$;

revoke all on function public.command_reclaim_stale_dispatch(int) from public, anon, authenticated;

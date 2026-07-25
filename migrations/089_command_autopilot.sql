-- EvoForge 089 — COMMAND AUTOPILOT: the Exec works continuously, and says so.
--
-- Tyson's instruction: "make it so the AI is almost constantly working and
-- proposing decisions unless there is no rational improvements to be made until
-- a vote is decided."
--
-- Both halves of that sentence are load-bearing, and the second is the harder
-- one. A studio that proposes on a timer regardless of state is not working, it
-- is generating. So this migration makes "there is nothing rational to propose"
-- a COMPUTED result with a stated reason, not a mood:
--
--   • command_backlog holds candidate improvements, each with the full proposal
--     document already authored, a value/effort/confidence score, and explicit
--     dependencies. The Exec cannot invent one at 3am; it can only promote one
--     it has already thought through.
--   • command_exec_cycle() runs every ten minutes on pg_cron and either promotes
--     the best eligible candidate into a live proposal, or records exactly why
--     it did not — "council queue full, waiting on PROP-004", "backlog empty",
--     "AUTH-SMTP blocked until PROP-002 is decided".
--   • command_exec_heartbeat is that record. The dashboard reads it, so the
--     founders always see either work or a reason, never a spinner.
--
-- WHY THIS RUNS IN SQL AND NOT THROUGH AN EDGE FUNCTION. Migration 086 cost a
-- day: every scheduled net.http_post came back 401 because Supabase's gateway
-- verifies a JWT before the function body runs. A cron job that calls a plain
-- SQL function has no gateway, no JWT, and no way to be silently unauthorised.
--
-- WHAT AUTOPILOT STILL CANNOT DO. It cannot approve anything, cannot open work
-- (only a founder vote does that, in 088), and cannot deploy. Its entire power
-- is to put a well-formed question in front of three people.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. SETTINGS — the governor, tunable without a deploy.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_settings (
  key        text primary key,
  value      jsonb not null,
  note       text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.command_settings enable row level security;

insert into public.command_settings (key, value, note) values
  ('autopilot', 'true'::jsonb,
   'Master switch. Off = the Exec observes and records, but proposes nothing.'),
  ('max_open_proposals', '3'::jsonb,
   'Never put more than this many undecided proposals in front of the council at once. Founder attention is the scarce resource; a flooded queue is how governance stops being real.'),
  ('min_minutes_between_proposals', '45'::jsonb,
   'Pacing. Two proposals in the same minute read as a dump, not a recommendation.'),
  ('rejected_cooldown_days', '14'::jsonb,
   'A rejected topic may not come back for this long unless a founder reopens it. Re-asking a settled question is how an AI wears down a no.'),
  ('stale_task_hours', '6'::jsonb,
   'A task in building/testing with no event for this long is flagged stale on the floor.')
on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE BACKLOG — everything the Exec believes is worth doing.
-- ─────────────────────────────────────────────────────────────────────────────
-- A candidate is a fully-formed proposal that has not been asked yet. Authoring
-- happens when an agent has the context to do it well; promotion happens on the
-- clock. Separating the two is what stops the heartbeat producing thin work.
create table if not exists public.command_backlog (
  id           uuid primary key default gen_random_uuid(),
  topic_key    text unique not null,        -- stable identity; the dedupe key
  title        text not null,
  source       text not null default 'exec_scan',
  category     text not null default 'prototype'
                 check (category in ('prototype','production','monetisation','ownership','privacy','security')),
  departments  text[] not null default '{}',
  value_score      integer not null default 5 check (value_score between 1 and 10),
  effort_score     integer not null default 5 check (effort_score between 1 and 10),
  confidence_score integer not null default 5 check (confidence_score between 1 and 10),
  rationale    text not null default '',
  document     jsonb not null default '{}'::jsonb,   -- the command_create_proposal payload
  depends_on   text[] not null default '{}',          -- other topic_keys, or PROP-refs
  status       text not null default 'candidate'
                 check (status in ('candidate','proposed','deferred','dismissed','done')),
  defer_until  timestamptz,
  defer_reason text not null default '',
  proposal_id  uuid references public.command_proposals(id) on delete set null,
  created_by   text not null default 'exec',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.command_backlog enable row level security;
create index if not exists command_backlog_ready on public.command_backlog (status, value_score desc);

-- Priority. Value and confidence multiply because a high-value guess is still a
-- guess; effort divides. Integer maths on purpose — the ranking only has to be
-- stable and explainable, and a float here would invite tuning it forever.
create or replace function public.command_backlog_priority(b public.command_backlog)
returns integer language sql immutable as $$
  select ((b.value_score * b.confidence_score * 10) / greatest(b.effort_score, 1))::int;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE HEARTBEAT — proof of life, including deliberate stillness.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.command_exec_heartbeat (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  action     text not null check (action in ('proposed','idle','paused','scanned','flagged')),
  reason     text not null default '',
  topic_key  text,
  proposal_id uuid,
  detail     jsonb not null default '{}'::jsonb
);
alter table public.command_exec_heartbeat enable row level security;
create index if not exists command_exec_heartbeat_recent on public.command_exec_heartbeat (at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ELIGIBILITY — why a candidate can or cannot be asked right now.
-- ─────────────────────────────────────────────────────────────────────────────
-- A dependency is satisfied when it names either a backlog topic that is done,
-- or a proposal ref that has been DECIDED. That second clause is the whole
-- point of Tyson's instruction: work that only makes sense after a pending vote
-- must wait for the vote, and the waiting must be legible.
create or replace function public.command_dependency_block(p_depends text[])
returns text language plpgsql stable security definer set search_path = public as $$
declare d text; st text;
begin
  foreach d in array coalesce(p_depends, '{}') loop
    if d like 'PROP-%' then
      select status into st from command_proposals where ref = d;
      if st is null then return d || ' does not exist'; end if;
      if st in ('open','changes_requested','draft') then
        return 'waiting on ' || d || ' (' || st || ')';
      end if;
    else
      select status into st from command_backlog where topic_key = d;
      if st is null then return 'unknown dependency ' || d; end if;
      if st <> 'done' then return 'waiting on ' || d || ' (' || st || ')'; end if;
    end if;
  end loop;
  return null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. THE CYCLE. One decision per run, always recorded.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_exec_cycle()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_on boolean; v_cap int; v_gap int; v_cooldown int; v_stale int;
  v_open int; v_last timestamptz; v_waiting text[]; v_blocked jsonb := '[]'::jsonb;
  b record; v_block text; v_res jsonb; v_reason text; v_stale_n int;
begin
  select (value)::text::boolean into v_on   from command_settings where key = 'autopilot';
  select (value)::text::int  into v_cap     from command_settings where key = 'max_open_proposals';
  select (value)::text::int  into v_gap     from command_settings where key = 'min_minutes_between_proposals';
  select (value)::text::int  into v_cooldown from command_settings where key = 'rejected_cooldown_days';
  select (value)::text::int  into v_stale   from command_settings where key = 'stale_task_hours';

  -- Housekeeping the Exec does on every pass regardless of whether it proposes:
  -- lift expired deferrals, and flag work that has gone quiet.
  update command_backlog set status = 'candidate', defer_until = null, updated_at = now()
   where status = 'deferred' and defer_until is not null and defer_until <= now();

  select count(*) into v_stale_n from command_tasks
   where status in ('building','testing','planning') and updated_at < now() - make_interval(hours => v_stale);

  select array_agg(ref order by created_at) into v_waiting
    from command_proposals where status in ('open','changes_requested');
  v_open := coalesce(array_length(v_waiting, 1), 0);

  if not coalesce(v_on, true) then
    insert into command_exec_heartbeat (action, reason, detail)
    values ('paused', 'Autopilot is off — the founders switched it off.',
            jsonb_build_object('open_proposals', v_open, 'stale_tasks', v_stale_n))
    returning jsonb_build_object('action','paused') into v_res;
    return v_res;
  end if;

  if v_open >= v_cap then
    v_reason := 'Council queue is full (' || v_open || '/' || v_cap ||
                '). Nothing new is rational until the founders decide ' ||
                array_to_string(v_waiting, ', ') || '.';
    insert into command_exec_heartbeat (action, reason, detail)
    values ('idle', v_reason, jsonb_build_object('waiting_on', v_waiting, 'stale_tasks', v_stale_n));
    return jsonb_build_object('action','idle','reason',v_reason,'waiting_on',v_waiting);
  end if;

  select max(created_at) into v_last from command_proposals;
  if v_last is not null and v_last > now() - make_interval(mins => v_gap) then
    v_reason := 'Pacing — last proposal was ' ||
                round(extract(epoch from (now() - v_last)) / 60) || ' minutes ago, minimum gap is ' || v_gap || '.';
    insert into command_exec_heartbeat (action, reason, detail)
    values ('idle', v_reason, jsonb_build_object('last_proposal_at', v_last));
    return jsonb_build_object('action','idle','reason',v_reason);
  end if;

  -- The best eligible candidate, in priority order, skipping any whose
  -- dependencies are unresolved and any topic the council recently rejected.
  for b in
    select * from command_backlog
     where status = 'candidate' and (defer_until is null or defer_until <= now())
     order by ((value_score * confidence_score * 10) / greatest(effort_score,1)) desc, created_at
  loop
    v_block := command_dependency_block(b.depends_on);

    if v_block is null and exists (
      select 1 from command_proposals p
       where p.status = 'rejected'
         and p.decided_at > now() - make_interval(days => v_cooldown)
         and p.id = b.proposal_id) then
      v_block := 'rejected within the ' || v_cooldown || '-day cooldown';
    end if;

    if v_block is null then
      v_res := command_create_proposal(
        (b.document || jsonb_build_object(
          'title', b.title, 'category', b.category,
          'departments', to_jsonb(b.departments),
          'author_kind', 'agent', 'author_key', 'exec', 'status', 'open')));

      update command_backlog
         set status = 'proposed', proposal_id = (v_res->>'id')::uuid, updated_at = now()
       where id = b.id;

      insert into command_exec_heartbeat (action, reason, topic_key, proposal_id, detail)
      values ('proposed',
              'Raised ' || (v_res->>'ref') || ' — ' || b.title,
              b.topic_key, (v_res->>'id')::uuid,
              jsonb_build_object('priority', (b.value_score * b.confidence_score * 10) / greatest(b.effort_score,1),
                                 'source', b.source));
      return jsonb_build_object('action','proposed','ref',v_res->>'ref','topic',b.topic_key);
    end if;

    v_blocked := v_blocked || jsonb_build_object('topic', b.topic_key, 'title', b.title, 'blocked_by', v_block);
  end loop;

  -- Nothing was promotable. Say which of the two reasons it was, precisely,
  -- because "the AI is idle" and "the AI is waiting on you" are very different
  -- messages to put in front of a founder.
  if jsonb_array_length(v_blocked) > 0 then
    v_reason := 'Every remaining improvement depends on a decision that has not been made: ' ||
                (select string_agg(x->>'topic' || ' → ' || (x->>'blocked_by'), '; ')
                   from jsonb_array_elements(v_blocked) x);
  else
    v_reason := 'No rational improvement is available. The backlog holds no scored candidate; ' ||
                'the Exec needs a fresh scan of the product before it can honestly recommend anything.';
  end if;

  insert into command_exec_heartbeat (action, reason, detail)
  values ('idle', v_reason, jsonb_build_object('blocked', v_blocked, 'stale_tasks', v_stale_n, 'waiting_on', v_waiting));
  return jsonb_build_object('action','idle','reason',v_reason,'blocked',v_blocked);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. BACKLOG WRITE PATH
-- ─────────────────────────────────────────────────────────────────────────────
-- Agents call this through the service role when a scan turns up something
-- worth doing. Upsert on topic_key so a re-scan sharpens a candidate instead of
-- duplicating it — the same reason the council never sees the same question
-- twice in one queue.
create or replace function public.command_backlog_upsert(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_key text;
begin
  if auth.uid() is not null and not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  v_key := coalesce(p->>'topic_key', command_slug(p->>'title'));
  if v_key = '' or v_key is null then raise exception 'command: backlog needs a topic_key'; end if;

  insert into command_backlog (topic_key, title, source, category, departments,
                               value_score, effort_score, confidence_score, rationale,
                               document, depends_on, created_by)
  values (v_key, coalesce(p->>'title','Untitled'), coalesce(p->>'source','exec_scan'),
          coalesce(p->>'category','prototype'),
          coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'departments','[]'::jsonb))),'{}'),
          coalesce((p->>'value_score')::int, 5),
          coalesce((p->>'effort_score')::int, 5),
          coalesce((p->>'confidence_score')::int, 5),
          coalesce(p->>'rationale',''),
          coalesce(p->'document','{}'::jsonb),
          coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p->'depends_on','[]'::jsonb))),'{}'),
          coalesce(p->>'created_by','exec'))
  on conflict (topic_key) do update set
    title = excluded.title, category = excluded.category, departments = excluded.departments,
    value_score = excluded.value_score, effort_score = excluded.effort_score,
    confidence_score = excluded.confidence_score, rationale = excluded.rationale,
    document = excluded.document, depends_on = excluded.depends_on, updated_at = now()
  where command_backlog.status = 'candidate'   -- never rewrite a question already asked
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'topic_key', v_key);
end $$;

-- Founder controls over the queue: defer, dismiss, or force one to the front.
create or replace function public.command_backlog_set(p_topic text, p_status text, p_reason text default '', p_days int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('candidate','deferred','dismissed','done') then
    raise exception 'command: unknown backlog status %', p_status;
  end if;
  update command_backlog
     set status = p_status,
         defer_until = case when p_status = 'deferred' then now() + make_interval(days => coalesce(p_days, 7)) else null end,
         defer_reason = coalesce(p_reason,''), updated_at = now()
   where topic_key = p_topic;
  perform command_log('backlog_' || p_status, 'backlog', null, p_topic,
                      p_topic || ' → ' || p_status || case when p_reason <> '' then ' — ' || p_reason else '' end);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.command_set_autopilot(p_on boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  update command_settings set value = to_jsonb(p_on), updated_at = now() where key = 'autopilot';
  perform command_log('autopilot', 'settings', null, 'autopilot',
                      case when p_on then 'Autopilot resumed' else 'Autopilot paused' end);
  return jsonb_build_object('ok', true, 'autopilot', p_on);
end $$;

-- Run a cycle on demand, from the site, and record who asked.
create or replace function public.command_run_cycle()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  v := command_exec_cycle();
  perform command_log('exec_cycle', 'system', null, null,
                      'Exec cycle run by hand → ' || (v->>'action'), v);
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. THE STUDIO PULSE — what the site shows to prove the AI is working.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.command_pulse()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object(
    'generated_at', now(),
    'autopilot', (select value from command_settings where key = 'autopilot'),
    'last', (select to_jsonb(h) from command_exec_heartbeat h order by at desc limit 1),
    'recent', coalesce((select jsonb_agg(to_jsonb(h) order by h.at desc)
                          from (select * from command_exec_heartbeat order by at desc limit 20) h), '[]'::jsonb),
    'backlog', coalesce((select jsonb_agg(x order by (x->>'priority')::int desc) from (
        select jsonb_build_object('topic_key', b.topic_key, 'title', b.title, 'status', b.status,
                                  'category', b.category, 'departments', b.departments,
                                  'rationale', b.rationale, 'source', b.source,
                                  'value', b.value_score, 'effort', b.effort_score,
                                  'confidence', b.confidence_score,
                                  'priority', (b.value_score * b.confidence_score * 10) / greatest(b.effort_score,1),
                                  'depends_on', b.depends_on,
                                  'blocked_by', command_dependency_block(b.depends_on),
                                  'defer_until', b.defer_until, 'defer_reason', b.defer_reason,
                                  'proposal_id', b.proposal_id) as x
          from command_backlog b where b.status in ('candidate','deferred','proposed')) s), '[]'::jsonb),
    'stale_tasks', coalesce((select jsonb_agg(to_jsonb(t)) from (
        select id, agent_key, title, status, updated_at from command_tasks
         where status in ('building','testing','planning')
           and updated_at < now() - make_interval(hours => (select (value)::text::int from command_settings where key='stale_task_hours'))
         order by updated_at limit 10) t), '[]'::jsonb)
  );
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS + GRANTS + SCHEDULE
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['command_settings','command_backlog','command_exec_heartbeat'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (public.is_founder())', t || '_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

grant execute on function public.command_pulse() to authenticated;
grant execute on function public.command_run_cycle() to authenticated;
grant execute on function public.command_set_autopilot(boolean) to authenticated;
grant execute on function public.command_backlog_set(text, text, text, int) to authenticated;
grant execute on function public.command_backlog_upsert(jsonb) to authenticated;
grant execute on function public.command_dependency_block(text[]) to authenticated;
-- The cycle itself is NOT granted to authenticated: founders reach it through
-- command_run_cycle, which audits the caller. cron runs as the table owner.
revoke all on function public.command_exec_cycle() from public, anon, authenticated;

-- Every ten minutes, forever. Direct SQL — no edge gateway, no JWT, nothing to
-- be silently 401'd by (the 086 lesson).
select cron.unschedule('command-exec-cycle') where exists (select 1 from cron.job where jobname = 'command-exec-cycle');
select cron.schedule('command-exec-cycle', '*/10 * * * *', $cron$select public.command_exec_cycle();$cron$);

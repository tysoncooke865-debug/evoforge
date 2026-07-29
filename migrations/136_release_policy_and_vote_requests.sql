-- 136 — SHIP ON COMPLETION BY DEFAULT, AND ASK THE OTHERS TO VOTE
--
-- TWO FOUNDER REQUESTS, BOTH SMALLER THAN THEY LOOK.
--
-- 1. "Once approved it should automatically release upon completion unless
--    voted otherwise upon approval."
--
--    command_settings.default_deploy_policy is ALREADY 'auto'. Approving a
--    proposal already authorises the studio to build it and ship it once the
--    review gate clears, with no second vote — that is what deploy_policy='auto'
--    has meant since migration 090.
--
--    What was missing is the "unless": there was no way for a founder to say
--    "this one I want to see again before it ships". The toggle existed for
--    significance and for architect authority, and not for the one decision that
--    actually puts code in front of athletes. So this adds
--    command_set_deploy_policy, editable only while the proposal is open, and it
--    is logged with the founder's name against it.
--
--    WHAT THIS DOES NOT REMOVE. The independent review gate still blocks a
--    release it judges unsafe, and a block is not a vote — it cannot be
--    outvoted, only cleared deliberately. Founder approval short-circuits the
--    second FOUNDER vote; it does not short-circuit QA.
--
-- 2. "Add an option to send a link to my friend / other founder to vote."
--
--    Jesse and Charlie already have founder accounts — is_founder() is what
--    gates voting, so a link to /council/PROP-016 is all either of them needs.
--    What was missing is the nudge: nothing told them a decision was waiting.
--
--    command_request_vote writes to command_outbox, which the existing
--    command-notify cron drains every minute into a real web push. It notifies
--    only founders who have NOT yet voted — pinging someone who already voted is
--    how a notification channel gets muted, and a muted channel is worse than no
--    channel because it looks like it works.

begin;

/* ── 1. The "unless voted otherwise" toggle ─────────────────────────────── */

create or replace function public.command_set_deploy_policy(
  p_proposal uuid, p_policy text, p_reason text default '')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare pr record; v_name text;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  if p_policy not in ('auto','gated') then
    raise exception 'command: deploy policy is auto or gated — got "%"', p_policy;
  end if;

  select * into pr from command_proposals where id = p_proposal for update;
  if pr is null then raise exception 'command: no such proposal'; end if;

  -- Only while it is still a question. Changing what a vote authorised AFTER
  -- the vote would rewrite what people agreed to.
  if pr.status not in ('open','changes_requested','draft') then
    raise exception 'command: % is % — the deployment policy is part of what was voted on and is locked with it', pr.ref, pr.status;
  end if;

  -- A non-engineering proposal ships nothing, so 'auto' would be a claim about
  -- a deployment that cannot happen.
  if p_policy = 'auto' and pr.execution <> 'engineering' then
    raise exception 'command: % is a % proposal — there is no deployment for auto to authorise', pr.ref, pr.execution;
  end if;

  select name into v_name from command_founders where user_id = auth.uid();

  update command_proposals
     set deploy_policy = p_policy, updated_at = now()
   where id = p_proposal;

  perform command_log(
    'deploy_policy_set', 'proposal', p_proposal, pr.ref,
    v_name || ' set ' || pr.ref || ' to ' ||
      case when p_policy = 'auto'
           then 'ship on completion — approving it authorises deployment with no second vote'
           else 'hold for a release vote — approving it authorises development only' end ||
      case when coalesce(trim(p_reason),'') <> '' then ' — ' || p_reason else '' end,
    jsonb_build_object('from', pr.deploy_policy, 'to', p_policy, 'reason', p_reason));

  return jsonb_build_object('ok', true, 'deploy_policy', p_policy);
end $$;

revoke all on function public.command_set_deploy_policy(uuid, text, text) from public, anon;
grant execute on function public.command_set_deploy_policy(uuid, text, text) to authenticated;

/* ── 2. Ask the other founders to vote ──────────────────────────────────── */

create table if not exists command_vote_requests (
  id           bigserial primary key,
  proposal_id  uuid not null references command_proposals(id) on delete cascade,
  requested_by uuid,
  requested_of uuid[] not null default '{}',
  note         text not null default '',
  at           timestamptz not null default now()
);

alter table command_vote_requests enable row level security;
drop policy if exists command_vote_requests_read on command_vote_requests;
create policy command_vote_requests_read on command_vote_requests for select using (is_founder());

create or replace function public.command_request_vote(p_proposal uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare pr record; v_name text; v_pending uuid[]; v_names text; v_url text;
begin
  if not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;

  select * into pr from command_proposals where id = p_proposal;
  if pr is null then raise exception 'command: no such proposal'; end if;
  if pr.status not in ('open','changes_requested') then
    raise exception 'command: % is % — voting is closed, so there is nobody to ask', pr.ref, pr.status;
  end if;

  select name into v_name from command_founders where user_id = auth.uid();
  v_url := '/council/' || pr.ref;

  -- ONLY the founders who have not voted. Notifying someone who already voted
  -- teaches them the channel is noise, and then they stop reading the one that
  -- matters.
  select coalesce(array_agg(f.user_id), '{}'), string_agg(f.name, ' and ')
    into v_pending, v_names
    from command_founders f
   where f.active
     and f.user_id <> auth.uid()
     and not exists (select 1 from command_votes v
                      where v.proposal_id = p_proposal and v.founder_id = f.user_id);

  if coalesce(array_length(v_pending, 1), 0) = 0 then
    return jsonb_build_object('ok', true, 'notified', 0, 'url', v_url,
                              'reason', 'Every other founder has already voted on this.');
  end if;

  insert into command_outbox (user_id, kind, title, body, url)
  select u, 'vote_requested',
         coalesce(v_name, 'A founder') || ' asked for your vote',
         pr.ref || ' — ' || pr.title ||
           case when coalesce(trim(p_note),'') <> '' then E'\n' || p_note else '' end,
         v_url
    from unnest(v_pending) u;

  insert into command_vote_requests (proposal_id, requested_by, requested_of, note)
  values (p_proposal, auth.uid(), v_pending, coalesce(p_note, ''));

  perform command_log('vote_requested', 'proposal', p_proposal, pr.ref,
                      coalesce(v_name, 'A founder') || ' asked ' || coalesce(v_names, 'the others') ||
                      ' to vote on ' || pr.ref,
                      jsonb_build_object('notified', array_length(v_pending, 1), 'note', p_note));

  return jsonb_build_object('ok', true, 'notified', array_length(v_pending, 1),
                            'who', v_names, 'url', v_url);
end $$;

revoke all on function public.command_request_vote(uuid, text) from public, anon;
grant execute on function public.command_request_vote(uuid, text) to authenticated;

/* ── 3. Make the default explicit rather than inherited ─────────────────── */

-- It is already 'auto'. Written here so the value is in the migration history
-- rather than only in a settings row somebody could change without a trace,
-- and so the next person reading this file knows the default is deliberate.
insert into command_settings (key, value, note)
values ('default_deploy_policy', '"auto"'::jsonb,
        'Approving a proposal authorises deployment on completion. A founder may set an individual proposal to "gated" before voting, which requires a separate release vote. The independent review gate still blocks either way.')
on conflict (key) do update set value = '"auto"'::jsonb, note = excluded.note;

commit;

-- EvoForge 126 — the lab's own account must not appear in the product's numbers.
--
-- The Dev Lab now signs in to the deployed app to photograph real screens. That
-- required a real account, and a real account emits real analytics: within
-- minutes of provisioning it had produced 120 session_start events, an
-- onboarding_started, an evo_rating_revealed and an origin_selected.
--
-- activation_rate is REL-001's baseline metric and it is a RATIO over athletes
-- who reached home. One synthetic athlete walking the whole funnel moves the
-- denominator AND the numerator, and the release gate reads that number to
-- decide whether a release ships. A screenshot tool must not be able to pass a
-- release gate.
--
-- WHY A REGISTRY AND NOT A HARDCODED ID. There will be more of these — a
-- second lab account for a different persona, an account for browser journeys,
-- whatever the next tool needs. A list in a table can be added to; an id
-- written into six queries cannot, and the seventh query is the one that gets
-- forgotten.
--
-- WHY A VIEW AND NOT A FILTER IN EACH QUERY. Every metric query that forgets
-- the filter is silently wrong and looks fine. Reading analytics_events_real
-- makes the exclusion the default and the raw table the deliberate choice —
-- the raw table stays, because "how much traffic did the lab generate" is a
-- real question and deleting the rows would destroy the answer.
--
-- FALSIFICATION (scripts/_falsify126.mjs):
--   1. an event from a synthetic account is absent from the view.
--   2. an event from a real account is present.
--   3. activation_rate over the view differs from the raw table while the lab
--      account is in the funnel — the actual harm, demonstrated.
--   4. registering an account requires a reason.
--   5. a founder can list what is excluded and why.

create table if not exists public.command_synthetic_accounts (
  user_id     uuid primary key,
  email       text,
  reason      text not null check (length(btrim(reason)) > 8),
  registered_by text not null default 'system',
  created_at  timestamptz not null default now()
);

alter table public.command_synthetic_accounts enable row level security;

drop policy if exists command_synthetic_read on public.command_synthetic_accounts;
create policy command_synthetic_read on public.command_synthetic_accounts
  for select using (is_founder());

comment on table public.command_synthetic_accounts is
  'Accounts owned by tooling, not by athletes. Excluded from every product metric via analytics_events_real.';

-- The view every metric reads. Same columns, minus the tooling.
create or replace view public.analytics_events_real as
  select e.*
    from public.analytics_events e
   where not exists (
     select 1 from public.command_synthetic_accounts s where s.user_id = e.user_id
   );

comment on view public.analytics_events_real is
  'analytics_events with tooling accounts removed. Read this, not the raw table, for anything that decides something.';

grant select on public.analytics_events_real to authenticated, service_role;

create or replace function public.command_register_synthetic(
  p_user_id uuid, p_email text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;
  -- The reason is checked by the column, not here, so a direct insert cannot
  -- route around it.
  insert into command_synthetic_accounts (user_id, email, reason, registered_by)
  values (p_user_id, p_email, p_reason, coalesce(auth.uid()::text, 'system'))
  on conflict (user_id) do update set email = excluded.email, reason = excluded.reason;

  -- Column names read from the live table, not remembered. The first version
  -- of this guessed (actor, entity) and the function raised 42703 on its first
  -- real call.
  insert into command_audit (actor_kind, actor_id, actor_label, action,
                             entity_kind, entity_ref, summary, detail)
  values (case when auth.uid() is null then 'system' else 'founder' end,
          auth.uid(), coalesce(auth.uid()::text, 'system'),
          'synthetic_account_registered',
          'analytics', p_email,
          'Excluded ' || coalesce(p_email, p_user_id::text) || ' from every product metric',
          jsonb_build_object('email', p_email, 'reason', p_reason, 'user_id', p_user_id));

  return jsonb_build_object('ok', true, 'user_id', p_user_id);
end $$;

revoke all on function public.command_register_synthetic(uuid, text, text) from public, anon;
grant execute on function public.command_register_synthetic(uuid, text, text) to authenticated;

-- Point the metric catalogue at the view. These templates ARE the metrics —
-- 105 stores the query, so correcting the query here corrects every experiment
-- readout that has not run yet.
--
-- WRITTEN TO SURVIVE BEING RUN TWICE. The first version used
-- replace('from analytics_events', 'from analytics_events_real'), which matches
-- its own output: applying the migration a second time produced
-- analytics_events_real_real and every metric query started raising 42P01. The
-- regex below collapses any number of _real suffixes to exactly one, so it is
-- both the fix and the repair.
update public.command_metric_defs
   set sql_template = regexp_replace(sql_template, 'analytics_events(_real)*', 'analytics_events_real', 'g'),
       source = 'analytics_events_real'
 where sql_template like '%analytics_events%';

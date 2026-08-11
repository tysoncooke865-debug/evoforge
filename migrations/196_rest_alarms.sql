-- EvoForge 196 — THE REST ALARM THAT SURVIVES A SUSPENDED PWA
-- (2026-08-11). Requires 053 (push_subscriptions) and the VAPID secrets.
--
-- THE GAP THIS CLOSES, stated exactly.
--
-- The rest timer notifies through the service worker (public/sw.js holds one
-- timeout and calls showNotification). That works whenever the worker is
-- alive, which on desktop and Android is nearly always. On iOS it is not: the
-- system may terminate a PWA's service worker while the app is backgrounded,
-- and a terminated worker has no timers. The athlete puts the phone in their
-- pocket, and the buzz that was the whole point never comes.
--
-- There is no client-side fix. The ONLY delivery iOS guarantees to a suspended
-- PWA is a REMOTE push — which is why this table exists rather than another
-- attempt at keeping JavaScript alive.
--
-- ---- WHY THIS IS NOT "REQUIRING PUSH FOR A REST TIMER" ----
--
-- The spec's §14 says not to require remote push infrastructure just to say a
-- rest ended, and this obeys that: the service-worker notification is still
-- the primary path and still fires first when it can. This is a BACKSTOP for
-- the one platform that eats it, on infrastructure that already exists (053's
-- VAPID rail, 085's cron pattern). An athlete who never grants notification
-- permission never gets a row here, and the in-app timer is untouched either
-- way.
--
-- ---- ONE ROW PER ATHLETE, AND WHY THAT IS THE WHOLE DEDUP STORY ----
--
-- A person has one rest at a time. `user_id` is the PRIMARY KEY, so starting a
-- rest while one is running REPLACES it, and there is no state in which two
-- alarms are pending for one athlete. That is the same trick 085 used with
-- `push_reminder_log`'s composite key: the only duplicate-send guarantee worth
-- having is one a scheduler's retry cannot break.
--
-- The web notification `tag` ('evoforge-rest') is the second half: if the
-- service worker DID fire and the push lands too, the browser collapses them
-- onto one notification rather than stacking two. And the client cancels the
-- row the moment it buzzes in the foreground, so an athlete watching the
-- countdown never receives a push at all.
--
-- ---- WHAT IS DELIBERATELY NOT STORED ----
--
-- No exercise id, no workout, no set number. The body text is composed by the
-- client and stored as the literal string to send, because this table is a
-- delivery queue and not a second record of the workout. It carries the least
-- that will do the job.
--
-- FALSIFICATION CHECKLIST (ALPHA/BRAVO):
--  1. insert as A, select as B                       -> 0 rows.        [RLS]
--  2. insert with an explicit user_id of B, as A     -> rejected. [with check]
--  3. two inserts as A                               -> ONE row (PK upsert).
--  4. delete A's row as B                            -> 0 affected.    [RLS]
--  5. `rest_alarms_due()` as an ordinary user        -> rejected (definer,
--     service-role only) — an athlete must not be able to read the queue.
--  6. a row with fire_at in the FUTURE is not returned by rest_alarms_due().
--  7. a row already marked sent is not returned twice.

begin;

create table if not exists public.rest_alarms (
  -- ONE pending alarm per athlete, enforced by the key itself.
  user_id  uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  fire_at  timestamptz not null,
  body     text not null default 'Rest complete. Time for your next set.'
           check (length(body) between 1 and 140),
  sent_at  timestamptz,
  created_at timestamptz not null default now()
);

-- The sender's only query: what is due and unsent.
create index if not exists rest_alarms_due_idx
  on public.rest_alarms (fire_at)
  where sent_at is null;

alter table public.rest_alarms enable row level security;

drop policy if exists rest_alarms_owner_select on public.rest_alarms;
create policy rest_alarms_owner_select on public.rest_alarms
  for select to authenticated using (user_id = auth.uid());

drop policy if exists rest_alarms_owner_insert on public.rest_alarms;
create policy rest_alarms_owner_insert on public.rest_alarms
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists rest_alarms_owner_update on public.rest_alarms;
create policy rest_alarms_owner_update on public.rest_alarms
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists rest_alarms_owner_delete on public.rest_alarms;
create policy rest_alarms_owner_delete on public.rest_alarms
  for delete to authenticated using (user_id = auth.uid());

/**
 * What is due right now, with the subscriptions to deliver it to.
 *
 * SERVICE ROLE ONLY. This returns other athletes' endpoints, so it refuses
 * anyone else outright rather than relying on the caller being trusted — the
 * 030/033 lesson about SECURITY DEFINER functions, applied.
 *
 * Marks the rows sent IN THE SAME STATEMENT it returns them, so two overlapping
 * ticks of a ten-second scheduler cannot both pick up the same alarm.
 *
 * A GRACE WINDOW, not an open past: an alarm more than five minutes overdue is
 * abandoned rather than delivered. A phone that was off, or a worker that was
 * down, should not buzz somebody about a rest they finished during a meeting.
 */
create or replace function public.rest_alarms_due()
returns table (user_id uuid, body text, endpoint text, p256dh text, auth_key text)
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'rest_alarms_due: service role only.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with due as (
    update public.rest_alarms a
       set sent_at = now()
     where a.sent_at is null
       and a.fire_at <= now()
       and a.fire_at > now() - interval '5 minutes'
    returning a.user_id, a.body
  )
  select d.user_id, d.body, s.endpoint, s.p256dh, s.auth
    from due d
    join public.push_subscriptions s on s.user_id = d.user_id;
end; $$;

revoke all on function public.rest_alarms_due() from public, anon, authenticated;

commit;

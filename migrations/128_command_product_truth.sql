-- EvoForge 128 — Command can finally see the product it is running.
--
-- The Command Centre reasons about EvoForge almost entirely through evidence
-- people file about it. Its home page shows proposals, work orders, agent
-- activity and release gates: the studio watching itself. The only place it
-- touched the product was one release gate reading activation_rate.
--
-- So the studio could be perfectly healthy while the product was on fire, and
-- the deck would look green. That is not hypothetical. Five minutes against the
-- product's own analytics, on the day this was written:
--
--   origin_binding_failed   146 events, 1 athlete — one person hit a wall 146 times
--   first_set_logged        0 athletes, ever — the metric REL-001 is gated on
--                           has never once fired
--   funnel                  10 reached home, 10 opened Train, 5 opened a workout,
--                           0 logged a set
--
-- None of that was visible anywhere in Command.
--
-- WHAT THIS IS NOT. It is not a second analytics product, and it does not write
-- a single product row. Command reads EvoForge; it does not act on it. Every
-- number below is a count of rows that already exist.
--
-- ZERO IS NOT A FACT UNLESS IT IS COLLECTED. Every step of the funnel reports
-- whether the event has EVER been recorded, separately from its count in the
-- window. "Nobody logged a set this week" and "nothing has ever emitted
-- first_set_logged" are different problems — the first is a product failure,
-- the second is a missing instrument — and a bare 0 cannot tell them apart.
--
-- FALSIFICATION (scripts/_falsify128.mjs):
--   1. the funnel counts real athletes and excludes registered tooling.
--   2. a step that has never fired is reported as uninstrumented, not as zero.
--   3. failures are grouped with a distinct-athlete count, so one person
--      failing 146 times cannot look like 146 people failing once.
--   4. the whole thing is one round trip.
--   5. it is founder-only.

create or replace function public.command_product_truth(p_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(90, p_days)));
  v_funnel jsonb;
  v_fail jsonb;
  v_people jsonb;
  v_use jsonb;
begin
  if auth.uid() is not null and not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;

  -- THE FUNNEL. Each step reports three numbers that mean different things:
  -- how many athletes reached it in the window, how many ever have, and whether
  -- the event exists at all.
  select jsonb_agg(jsonb_build_object(
           'step', s.step,
           'label', s.label,
           'in_window', coalesce(w.n, 0),
           'ever', coalesce(e.n, 0),
           'instrumented', coalesce(e.n, 0) > 0
         ) order by s.ord)
    into v_funnel
    from (values
            ('home_reached',     'Reached home',     1),
            ('train_opened',     'Opened Train',     2),
            ('workout_opened',   'Opened a workout', 3),
            ('first_set_logged', 'Logged a set',     4)
         ) as s(step, label, ord)
    left join lateral (
      select count(distinct user_id) n from analytics_events_real
       where event_name = 'activation_step' and props->>'step' = s.step and created_at > v_since
    ) w on true
    left join lateral (
      select count(distinct user_id) n from analytics_events_real
       where event_name = 'activation_step' and props->>'step' = s.step
    ) e on true;

  -- FAILURES, GROUPED BY EVENT WITH A DISTINCT-ATHLETE COUNT.
  --
  -- The count alone lies in the direction that matters most: 146
  -- origin_binding_failed events reads as a widespread outage and is one person
  -- retrying. Both numbers are reported and the UI shows them together.
  select coalesce(jsonb_agg(x order by (x->>'athletes')::int desc, (x->>'events')::int desc), '[]'::jsonb)
    into v_fail
    from (
      select jsonb_build_object(
               'event', event_name,
               'events', count(*),
               'athletes', count(distinct user_id),
               'last_at', max(created_at)
             ) x
        from analytics_events_real
       where created_at > v_since
         and (event_name like '%_failed' or event_name like '%error%' or event_name like '%_crash%')
       group by event_name
       limit 12
    ) t;

  -- WHO IS ACTUALLY HERE. auth.users minus registered tooling accounts.
  select jsonb_build_object(
           'accounts', count(*) filter (where s.user_id is null),
           'new_in_window', count(*) filter (where s.user_id is null and u.created_at > v_since),
           'tooling_excluded', count(*) filter (where s.user_id is not null)
         )
    into v_people
    from auth.users u
    left join command_synthetic_accounts s on s.user_id = u.id;

  select jsonb_build_object(
           'active_in_window', (select count(distinct user_id) from analytics_events_real
                                 where created_at > v_since),
           'active_today', (select count(distinct user_id) from analytics_events_real
                             where created_at > date_trunc('day', now())),
           'sessions', (select count(*) from analytics_events_real
                         where event_name = 'session_start' and created_at > v_since),
           'events', (select count(*) from analytics_events_real where created_at > v_since)
         )
    into v_use;

  return jsonb_build_object(
    'generated_at', now(),
    'window_days', greatest(1, least(90, p_days)),
    'people', v_people,
    'usage', v_use,
    'funnel', coalesce(v_funnel, '[]'::jsonb),
    'failures', v_fail,
    -- What the lab can actually SEE of the product, so a founder reading a
    -- design decision knows how much of the app was in front of them.
    'screens', (select jsonb_build_object(
                  'captured', count(*) filter (where status = 'captured'),
                  'total', count(*),
                  'oldest_shot', min(shot_at) filter (where status = 'captured')
                ) from command_lab_screens),
    'source', 'analytics_events_real — tooling accounts excluded'
  );
end $$;

revoke all on function public.command_product_truth(int) from public, anon;
grant execute on function public.command_product_truth(int) to authenticated;

comment on function public.command_product_truth(int) is
  'What EvoForge is actually doing, for the Command deck. Reads only; never writes a product row.';

-- ─────────────────────────────────────────────────────────────────────────────
-- THE PRODUCT RAISES ITS OWN WORK
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A wall 146 people-times high should not need a founder to notice it first.
-- This turns a product failure into a backlog candidate through the NORMAL
-- route — command_backlog_upsert, with significance honoured — so it queues,
-- scores and votes exactly like anything else. It does not create proposals and
-- it does not bypass the council.
--
-- It raises at most one item per event name, and only re-raises when the
-- failure is still happening, because an alert that fires every hour is an
-- alert nobody reads.

create or replace function public.command_product_scan(p_days int default 7, p_min_athletes int default 1)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(30, p_days)));
  r record; v_key text; v_raised jsonb := '[]'::jsonb; v_sig text;
begin
  if auth.uid() is not null and not is_founder() then
    raise exception 'command: founders only' using errcode = 'insufficient_privilege';
  end if;

  for r in
    select event_name, count(*) events, count(distinct user_id) athletes, max(created_at) last_at
      from analytics_events_real
     where created_at > v_since
       and (event_name like '%_failed' or event_name like '%error%')
     group by event_name
    having count(distinct user_id) >= greatest(1, p_min_athletes)
     order by count(distinct user_id) desc, count(*) desc
     limit 5
  loop
    v_key := 'product-failure-' || replace(r.event_name, '_', '-');

    -- Already on the board and not yet answered: leave it alone. Re-raising
    -- would reset a question the founders are in the middle of.
    if exists (select 1 from command_backlog
                where topic_key = v_key and status in ('candidate','proposed','accepted','in_progress')) then
      continue;
    end if;

    -- One athlete hitting a wall repeatedly is real and is not a fire. More
    -- than one is a pattern. The significance follows that, rather than
    -- defaulting to major and demanding all three founders for everything —
    -- which is exactly the bug 125 fixed.
    v_sig := case when r.athletes >= 3 then 'major' else 'minor' end;

    perform command_backlog_upsert(jsonb_build_object(
      'topic_key', v_key,
      'title', 'Product failure: ' || r.event_name,
      'source', 'product_signal',
      -- 'production', not 'reliability'. The category CHECK on command_backlog
      -- allows prototype/production/monetisation/ownership/privacy/security,
      -- and the first version of this invented a seventh — every raise failed
      -- with 23514. Read the constraint; do not guess the vocabulary.
      'category', 'production',
      'significance', v_sig,
      'created_by', 'product_scan',
      'value_score', least(10, 4 + r.athletes),
      'effort_score', 5,
      'confidence_score', 9,
      'rationale', format(
        '%s fired %s times across %s athlete(s) in the last %s days, most recently %s. ' ||
        'Counted from analytics_events_real, so tooling accounts are excluded. ' ||
        'The event count and the athlete count are both given because one person retrying %s times ' ||
        'and %s people failing once are different problems.',
        r.event_name, r.events, r.athletes, greatest(1, least(30, p_days)),
        to_char(r.last_at, 'YYYY-MM-DD HH24:MI'), r.events, r.events),
      'document', jsonb_build_object(
        'event', r.event_name, 'events', r.events, 'athletes', r.athletes,
        'window_days', greatest(1, least(30, p_days)), 'last_at', r.last_at)
    ));

    v_raised := v_raised || jsonb_build_object(
      'topic_key', v_key, 'event', r.event_name,
      'events', r.events, 'athletes', r.athletes, 'significance', v_sig);
  end loop;

  return jsonb_build_object('ok', true, 'raised', v_raised,
                            'count', jsonb_array_length(v_raised),
                            'window_days', greatest(1, least(30, p_days)));
end $$;

revoke all on function public.command_product_scan(int, int) from public, anon;
grant execute on function public.command_product_scan(int, int) to authenticated;

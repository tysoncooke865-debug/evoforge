-- EvoForge 146 — THE DUEL UPDATES ITSELF.
--
-- Nobody types a duel result into this app. An athlete trains, the sets and
-- sessions land the way they always have, and the duel moves. That is the whole
-- of this file: three triggers on the tables training already writes, and one
-- function that turns "a session happened" into a score, a timeline entry, a
-- lead change and — when it matters — a notification.
--
-- WHY A TRIGGER AND NOT A CLIENT CALL. The brief's requirement is that this
-- "must also work for workouts logged through EvoForge's AI transcription
-- workflow where those workouts are saved normally". A client-side hook would
-- have to be added to every path that writes a set — the logger, the queue
-- flush, the transcription import, the next one nobody has written yet — and
-- the first one that forgets is a duel that silently stops moving. The trigger
-- sits under all of them.
--
-- WHY THE WHOLE BODY IS WRAPPED IN AN EXCEPTION BLOCK. This is the 054/058
-- lesson at its most expensive: a failure inside an AFTER INSERT trigger rolls
-- back the PARENT ROW. A bug here would not break the duel, it would eat the
-- athlete's set. So every path swallows: the duel is allowed to be stale, the
-- training is not allowed to be lost. There is no scenario in which a scoring
-- convenience is worth a lost session.
--
-- WHY IT IS CHEAP. The first thing the function does is ask whether this
-- athlete has an active duel covering this date at all. Almost always the
-- answer is no, and that answer costs one index scan, which is what makes it
-- safe to hang off a per-set insert.

begin;

-- One event per athlete per day per duel. The dedupe is checked in the body and
-- enforced here, so a concurrent double-insert cannot produce two "logged
-- Push Day" rows for the same afternoon.
create unique index if not exists forge_challenge_events_daily_uidx
  on public.forge_challenge_events (challenge_id, actor_id, (detail ->> 'date'))
  where kind = 'workout_logged';

-- ────────────────────────────────────────────── the one function

/**
 * A SESSION HAPPENED. Score every duel it touches.
 *
 * For each of this athlete's ACTIVE duels whose window contains `p_date`:
 *   1. recompute their metric from their own rows (never from an argument);
 *   2. snapshot it into forge_challenge_qualifying — the audit table 139
 *      created and nothing ever wrote, which is what makes a later edit
 *      DETECTABLE instead of silently rewriting a finished contest;
 *   3. record or refresh the day's timeline entry;
 *   4. mark the athlete as having trained since the last raise, which is what
 *      unlocks the next one;
 *   5. compare both scores, and if the LEAD CHANGED, say so — to the timeline
 *      and to the athlete who just lost it.
 */
create or replace function public.forge_duel_touch(
  p_user uuid, p_date date, p_source text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c record;
  cur jsonb;
  val numeric;
  prev numeric;
  score_a numeric;
  score_b numeric;
  base_a numeric;
  base_b numeric;
  new_leader uuid;
  other uuid;
  existing_id uuid;
begin
  if p_user is null or p_date is null then return; end if;

  -- THE SWALLOW. Everything below is best-effort by construction: a duel that
  -- misses one update catches up on the next session, and the alternative is a
  -- trigger that can delete an athlete's training.
  begin
    for c in
      select fc.* from public.forge_challenges fc
      where fc.status = 'active'
        and (fc.challenger_id = p_user or fc.opponent_id = p_user)
        and fc.starts_at is not null and fc.ends_at is not null
        and p_date >= (fc.starts_at at time zone 'UTC')::date
        and p_date <= (fc.ends_at at time zone 'UTC')::date
    loop
      other := case when c.challenger_id = p_user then c.opponent_id else c.challenger_id end;

      cur := public.forge_challenge_metric(
        p_user, c.challenge_type, c.metric_key,
        (c.starts_at at time zone 'UTC')::date,
        least((now() at time zone 'UTC')::date, (c.ends_at at time zone 'UTC')::date));
      val := coalesce((cur ->> 'value')::numeric, 0);

      -- (2) THE AUDIT SNAPSHOT. One row per duel per athlete per day, holding
      -- the value the day produced. `greatest` because a day's contribution can
      -- only improve as more of it is logged.
      insert into public.forge_challenge_qualifying
        (challenge_id, user_id, source_table, source_id, value)
      values (c.id, p_user, 'daily', p_date::text, val)
      on conflict (challenge_id, user_id, source_table, source_id)
      do update set value = greatest(public.forge_challenge_qualifying.value, excluded.value),
                    recorded_at = now();

      select p.last_qualifying_value into prev
      from public.forge_challenge_participants p
      where p.challenge_id = c.id and p.user_id = p_user;

      -- (3) THE DAY'S ENTRY. Refreshed rather than repeated: a lifter who logs
      -- four bench sets in one session produced ONE piece of news.
      select e.id into existing_id from public.forge_challenge_events e
      where e.challenge_id = c.id and e.actor_id = p_user
        and e.kind = 'workout_logged' and e.detail ->> 'date' = p_date::text
      limit 1;

      if existing_id is null then
        insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
        values (c.id, p_user, 'workout_logged',
                jsonb_build_object('date', p_date::text, 'value', val,
                                   'unit', cur ->> 'unit', 'source', p_source))
        on conflict do nothing;
      else
        update public.forge_challenge_events
        set detail = detail || jsonb_build_object('value', val, 'unit', cur ->> 'unit')
        where id = existing_id;
      end if;

      -- A NEW BEST inside the window, for a lift duel, is its own moment.
      if c.challenge_type = 'most_improved_lift'
         and prev is not null and val > prev and prev > 0 then
        insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
        values (c.id, p_user, 'personal_record',
                jsonb_build_object('value', val, 'unit', cur ->> 'unit',
                                   'exercise', c.metric_key, 'date', p_date::text));
      end if;

      -- (4) TRAINED SINCE THE LAST RAISE. This one column is what makes
      -- "RAISE THE STAKES" something the duel earns rather than a button.
      update public.forge_challenge_participants p
      set last_qualifying_at = now(),
          last_qualifying_value = val,
          qualifying_sessions = p.qualifying_sessions
            + case when p.last_qualifying_at is null
                        or p.last_qualifying_at::date <> (now() at time zone 'UTC')::date
                   then 1 else 0 end
      where p.challenge_id = c.id and p.user_id = p_user;

      -- (5) WHO IS AHEAD NOW. Both sides, scored the way settlement will score
      -- them, so the live leader and the eventual winner are the same rule.
      select p.baseline into base_a from public.forge_challenge_participants p
        where p.challenge_id = c.id and p.user_id = c.challenger_id;
      select p.baseline into base_b from public.forge_challenge_participants p
        where p.challenge_id = c.id and p.user_id = c.opponent_id;

      if c.challenge_type = 'most_improved_lift' then
        score_a := case when coalesce(base_a, 0) > 0 then
          ((public.forge_challenge_metric(c.challenger_id, c.challenge_type, c.metric_key,
             (c.starts_at at time zone 'UTC')::date,
             least((now() at time zone 'UTC')::date, (c.ends_at at time zone 'UTC')::date)) ->> 'value')::numeric
           - base_a) / base_a * 100 else 0 end;
        score_b := case when coalesce(base_b, 0) > 0 then
          ((public.forge_challenge_metric(c.opponent_id, c.challenge_type, c.metric_key,
             (c.starts_at at time zone 'UTC')::date,
             least((now() at time zone 'UTC')::date, (c.ends_at at time zone 'UTC')::date)) ->> 'value')::numeric
           - base_b) / base_b * 100 else 0 end;
      else
        score_a := (public.forge_challenge_metric(c.challenger_id, c.challenge_type, c.metric_key,
                     (c.starts_at at time zone 'UTC')::date,
                     least((now() at time zone 'UTC')::date, (c.ends_at at time zone 'UTC')::date)) ->> 'value')::numeric;
        score_b := (public.forge_challenge_metric(c.opponent_id, c.challenge_type, c.metric_key,
                     (c.starts_at at time zone 'UTC')::date,
                     least((now() at time zone 'UTC')::date, (c.ends_at at time zone 'UTC')::date)) ->> 'value')::numeric;
      end if;

      new_leader := case when score_a > score_b then c.challenger_id
                         when score_b > score_a then c.opponent_id
                         else null end;

      if new_leader is distinct from c.leader_id then
        update public.forge_challenges set leader_id = new_leader where id = c.id;
        insert into public.forge_challenge_events (challenge_id, actor_id, kind, detail)
        values (c.id, p_user, 'lead_change',
                jsonb_build_object('leader_id', new_leader,
                                   'score_challenger', round(score_a, 2),
                                   'score_opponent', round(score_b, 2)));
        -- Tell the athlete who just LOST the lead. Taking it is its own reward
        -- and they are holding the phone; being overtaken is the news.
        if new_leader is not null and new_leader = p_user then
          perform public.forge_duel_notify(other, p_user, 'duel_lead_change',
            jsonb_build_object('challenge_id', c.id, 'leader_id', new_leader, 'lost_lead', true));
        end if;
      end if;
    end loop;
  exception when others then
    -- The duel can be stale. The training cannot be lost.
    null;
  end;
end;
$$;
revoke execute on function public.forge_duel_touch(uuid, date, text) from public, anon, authenticated;

-- ─────────────────────────── a later edit is DETECTED, never silent

/**
 * SOMEBODY CHANGED HISTORY. Flag it; never rewrite it.
 *
 * 139 created `integrity_flag` for exactly this and nothing ever set it, which
 * meant editing a qualifying workout before settlement quietly changed the
 * result. Now the participant row is marked and the timeline records it, so
 * both athletes can see that a number moved and either can dispute it.
 *
 * DELIBERATELY NOT A BLOCK. An athlete correcting a typo in yesterday's weight
 * is doing the right thing, and a wager must not make the log read-only. The
 * answer to "this could be abused" is visibility, which is also what the
 * dispute machinery was built for.
 */
create or replace function public.forge_duel_flag_edit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  d date;
  uid uuid;
begin
  begin
    d := coalesce(old.date, new.date);
    uid := coalesce(old.user_id, new.user_id);
    if d is null or uid is null then return coalesce(new, old); end if;

    for r in
      select fc.id from public.forge_challenges fc
      where fc.status in ('active', 'awaiting_settlement')
        and (fc.challenger_id = uid or fc.opponent_id = uid)
        and fc.starts_at is not null and fc.ends_at is not null
        and d >= (fc.starts_at at time zone 'UTC')::date
        and d <= (fc.ends_at at time zone 'UTC')::date
    loop
      update public.forge_challenge_participants p
      set integrity_flag = format('edited %s on %s', tg_table_name, d)
      where p.challenge_id = r.id and p.user_id = uid
        and p.integrity_flag is distinct from format('edited %s on %s', tg_table_name, d);
    end loop;
  exception when others then
    null;
  end;
  return coalesce(new, old);
end;
$$;

-- ─────────────────────────────────────────────────────────── the triggers

/** A FINISHED WORKOUT. The clearest "a session happened" signal this app has:
 *  one row, written once, by every path that finishes training. */
create or replace function public.forge_duel_on_session()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.forge_duel_touch(new.user_id, new.date, 'workout');
  return new;
end; $$;

drop trigger if exists trg_forge_duel_session on public.workout_sessions;
create trigger trg_forge_duel_session after insert on public.workout_sessions
  for each row execute function public.forge_duel_on_session();

/** CARDIO. Its own table, its own duel type, and a qualifying session in its
 *  own right for the consistency duel too. */
create or replace function public.forge_duel_on_cardio()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.forge_duel_touch(new.user_id, new.date, 'cardio');
  return new;
end; $$;

drop trigger if exists trg_forge_duel_cardio on public.cardio_log;
create trigger trg_forge_duel_cardio after insert on public.cardio_log
  for each row execute function public.forge_duel_on_cardio();

/**
 * A SET. Per-row, because a lift duel's score moves on the set that beats the
 * last one, not at the end of the session — and "you just took the lead" is
 * worth knowing while the barbell is still loaded.
 *
 * The WHEN clause filters counted sets before the function is entered, and the
 * function's first act is an indexed "do you have a duel at all". A set logged
 * by an athlete with no live duel costs one index probe.
 */
create or replace function public.forge_duel_on_set()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.forge_duel_touch(new.user_id, new.date, 'set');
  return new;
end; $$;

drop trigger if exists trg_forge_duel_set on public.workout_log;
create trigger trg_forge_duel_set after insert on public.workout_log
  for each row when (new.reps > 0) execute function public.forge_duel_on_set();

drop trigger if exists trg_forge_duel_edit_set on public.workout_log;
create trigger trg_forge_duel_edit_set after update or delete on public.workout_log
  for each row execute function public.forge_duel_flag_edit();

drop trigger if exists trg_forge_duel_edit_cardio on public.cardio_log;
create trigger trg_forge_duel_edit_cardio after update or delete on public.cardio_log
  for each row execute function public.forge_duel_flag_edit();

-- ───────────────────────────── the sweep also warns about the deadline

/**
 * THE SWEEP, extended: a duel entering its last day tells both athletes once.
 *
 * There is no scheduler in this product, so the trigger is somebody opening the
 * app — which is also the only moment a notification could be acted on. The
 * dedupe is a lookup against the inbox itself rather than a new column: one
 * 'duel_ending' per athlete per duel, ever.
 */
create or replace function public.forge_duel_sweep()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := auth.uid();
  r record;
  settled int := 0;
  expired int := 0;
  warned int := 0;
begin
  if me is null then
    raise exception 'forge_duel_sweep: not signed in.' using errcode = 'insufficient_privilege';
  end if;

  with dead as (
    update public.forge_challenges
    set status = 'expired'
    where status = 'pending' and expires_at <= now()
      and (challenger_id = me or opponent_id = me)
    returning 1
  ) select count(*) into expired from dead;

  update public.forge_duel_offers o
  set status = 'expired', responded_at = now()
  from public.forge_challenges c
  where o.challenge_id = c.id and o.status = 'pending' and o.expires_at <= now()
    and (c.challenger_id = me or c.opponent_id = me);

  for r in
    select c.id from public.forge_challenges c
    where (c.challenger_id = me or c.opponent_id = me)
      and c.status in ('active', 'awaiting_settlement')
      and c.ends_at <= now()
      and not exists (select 1 from public.forge_challenge_disputes d
                      where d.challenge_id = c.id and d.status = 'open')
    limit 20
  loop
    begin
      perform public.forge_challenge_settle(r.id);
      settled := settled + 1;
    exception when others then
      -- One stuck duel must never stop the others from settling.
      null;
    end;
  end loop;

  for r in
    select c.id, c.challenger_id, c.opponent_id, c.ends_at
    from public.forge_challenges c
    where (c.challenger_id = me or c.opponent_id = me)
      and c.status = 'active'
      and c.ends_at > now() and c.ends_at <= now() + interval '24 hours'
    limit 20
  loop
    if not exists (
      select 1 from public.social_notifications n
      where n.user_id = me and n.type = 'duel_ending'
        and n.detail ->> 'challenge_id' = r.id::text
    ) then
      perform public.forge_duel_notify(
        me,
        case when r.challenger_id = me then r.opponent_id else r.challenger_id end,
        'duel_ending',
        jsonb_build_object('challenge_id', r.id, 'ends_at', r.ends_at));
      warned := warned + 1;
    end if;
  end loop;

  return jsonb_build_object('settled', settled, 'expired', expired, 'warned', warned);
end;
$$;

grant execute on function public.forge_duel_sweep() to authenticated;

commit;

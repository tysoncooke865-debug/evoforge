-- EvoForge 153 — the logger answers the call.
--
-- THE POINT OF THIS FILE: logging a called set is the SAME TAP as logging any
-- other set. No SUBMIT WAGER RESULT button, no extra request, no extra
-- confirmation, no added latency on the app's hottest control. The athlete
-- presses LOG, the rest timer starts, XP grants, PR detection runs — and a
-- trigger on workout_log notices that this row answers a call out.
--
-- WHY A TRIGGER AND NOT A CLIENT CALL, in four parts:
--   1. workout_log is already the source of truth for a performed set. Anything
--      else the client sent would be a SECOND claim about the same event, and
--      the server would have to either trust it (fatal) or ignore it (pointless).
--   2. Durable inserts are QUEUED (data/set-queue.ts). A client call would fire
--      before the row exists; a trigger fires when it lands, however late.
--   3. It sits UNDER every write path rather than beside one of them — the AI
--      transcript importer writes workout_log too, and it scores identically.
--   4. The athlete cannot type their own wager result. There is nothing to type.
--
-- AND THE RULE 146 PAID FOR: a failure inside an AFTER trigger rolls back the
-- PARENT ROW. A bug in here would not break a call out — it would eat the
-- athlete's set. So the whole body is wrapped in `exception when others then
-- null`. THE CALL OUT IS ALLOWED TO BE STALE. THE TRAINING IS NOT ALLOWED TO
-- BE LOST. Do not remove that block, and do not narrow it to named exceptions.

begin;

/**
 * DID THE LOGGED SET MEET THE CALL?
 *
 * Pure arithmetic over the snapshot and the row, kept apart from the trigger so
 * it can be asked directly in a test and mirrored exactly by the client's
 * `judgeCallout` (domain/callouts.ts) for the "BELOW YOUR CALL" hint.
 *
 * The rule, in one sentence: enough reps AND at least the load that was called.
 *
 * Doing MORE always counts — more reps, more weight, less assistance. Doing the
 * reps at a lighter load does NOT: "100 × 5" is not answered by "60 × 5", and a
 * system that accepted it would be measuring typing rather than lifting.
 *
 * 133's modes are compared as modes, never as a single number. A bodyweight set
 * has no honest kilogram, and an assisted one improves as its number goes DOWN.
 *
 * ── MIGRATION 133 IS NOT APPLIED IN PRODUCTION (found 2026-08-08) ──
 *
 * `workout_log` still carries the legacy 13 columns; `load_mode`,
 * `external_load_kg` and `assistance_kg` do not exist there yet. The CLIENT
 * already knows (set-save.ts's isMissingLoadColumn retries the insert without
 * them), so every set in production today is the legacy pair — `weight` is the
 * EXTERNAL load, and 0 means bodyweight, which is exactly what
 * `legacyWeightFor()` writes and what every other reader in this app assumes.
 *
 * So a NULL actual mode is not "unknown", it is "this database has not learned
 * modes yet", and it takes the legacy branch below. The day 133 lands, rows
 * start arriving with a real mode and the mode-aware branches take over with no
 * further change here. Both paths are asserted in the falsification harness.
 */
create or replace function public.callout_judge(
  p_target_mode text, p_target_kg numeric, p_target_reps int,
  p_actual_mode text, p_actual_weight numeric, p_actual_assistance numeric,
  p_actual_external numeric, p_actual_reps int
)
returns text
language plpgsql
immutable
as $$
declare
  eps numeric := 0.01;
  load_ok boolean := false;
  a_mode text := p_actual_mode;
begin
  if coalesce(p_actual_reps, 0) < p_target_reps then
    return 'miss';
  end if;

  if a_mode is null then
    -- PRE-133 DATABASE. Only (weight, reps) exist, so only they may decide.
    -- A bodyweight or assisted call is judged on its reps — the assistance was
    -- never recorded, and inventing a number for it would be worse than
    -- admitting the row cannot answer that question. A weighted-bodyweight call
    -- still compares correctly, because the legacy weight of such a set IS its
    -- added load.
    load_ok := case
      when p_target_mode in ('bodyweight', 'repetition_only', 'assisted_bodyweight') then true
      else coalesce(p_actual_weight, 0) >= coalesce(p_target_kg, 0) - eps
    end;
    return case when load_ok then 'hit' else 'miss' end;
  end if;

  if p_target_mode = 'external' then
    -- workout_log.weight IS the external load (legacyWeightFor), so this is a
    -- straight comparison for every ordinary lift.
    load_ok := a_mode = 'external' and coalesce(p_actual_weight, 0) >= coalesce(p_target_kg, 0) - eps;

  elsif p_target_mode = 'repetition_only' then
    load_ok := true;

  elsif p_target_mode = 'bodyweight' then
    -- Adding weight to a bodyweight call is strictly harder, so it counts.
    load_ok := a_mode in ('bodyweight', 'weighted_bodyweight');

  elsif p_target_mode = 'weighted_bodyweight' then
    load_ok := a_mode = 'weighted_bodyweight'
               and coalesce(p_actual_external, 0) >= coalesce(p_target_kg, 0) - eps;

  elsif p_target_mode = 'assisted_bodyweight' then
    -- LESS assistance is MORE work. Needing none at all is more still.
    load_ok := (a_mode = 'assisted_bodyweight'
                and coalesce(p_actual_assistance, 0) <= coalesce(p_target_kg, 0) + eps)
               or a_mode in ('bodyweight', 'weighted_bodyweight');
  end if;

  return case when load_ok then 'hit' else 'miss' end;
end;
$$;

/**
 * The set landed. Find the call it answers, if any.
 *
 * INSERT and UPDATE both, because editing a logged set before the opponent has
 * verified must correct the result rather than leave a stale one on the card.
 * A SETTLED call out is untouchable — the 150 lock guard refuses it anyway, and
 * the status filter here means we never even try.
 */
create or replace function public.callout_on_set_write()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c public.workout_callouts%rowtype;
  verdict text;
  -- READ THE LOAD COLUMNS THROUGH jsonb, NOT AS FIELDS.
  --
  -- `new.load_mode` on a database without that column is a runtime error, and
  -- this function's exception block would swallow it — the callout would simply
  -- never resolve, silently, for every athlete. A guard that fails open is
  -- worse than no guard. `to_jsonb(new) ->> 'load_mode'` returns NULL for an
  -- absent key instead, so this trigger is correct both before and after
  -- migration 133 is applied.
  j jsonb;
begin
  begin
    j := to_jsonb(new);
    select * into c
    from public.workout_callouts wc
    where wc.athlete_id = new.user_id
      and wc.workout_date = new.date
      and wc.workout_name = new.workout
      and wc.exercise = new.exercise
      and wc.set_no = new."set"
      and wc.status in ('offered', 'accepted', 'awaiting_verification')
    limit 1;

    if not found then
      return null;
    end if;

    -- AN UNANSWERED OFFER DIES THE MOMENT THE SET IS DONE. Otherwise the
    -- opponent could sit on the notification, watch the reps land, and then
    -- accept a bet whose outcome they already know. Nothing has moved, so
    -- nothing is refunded.
    if c.status = 'offered' then
      update public.workout_callouts set status = 'expired' where id = c.id and status = 'offered';
      return null;
    end if;

    verdict := public.callout_judge(
      c.target_load_mode, c.target_weight_kg, c.target_reps,
      j ->> 'load_mode', new.weight,
      nullif(j ->> 'assistance_kg', '')::numeric,
      nullif(j ->> 'external_load_kg', '')::numeric,
      new.reps);

    update public.workout_callouts
    set status = 'awaiting_verification',
        result = verdict,
        actual_reps = new.reps,
        actual_weight_kg = new.weight,
        actual_load_mode = j ->> 'load_mode',
        workout_log_id = new.id,
        set_logged_at = coalesce(set_logged_at, now()),
        -- Re-arm the clock for the state we just entered.
        expires_at = now() + make_interval(
          hours => (select verify_hours from public.workout_callout_config where id))
    where id = c.id
      and status in ('accepted', 'awaiting_verification');

    -- Only announce the FIRST landing. An edit corrects the numbers on a card
    -- the opponent is already looking at; it does not deserve a second buzz.
    if c.status = 'accepted' then
      perform public.forge_duel_notify(
        c.opponent_id, c.athlete_id, 'callout_logged',
        jsonb_build_object('callout_id', c.id, 'amount', c.stake, 'pot', c.stake * 2,
                           'exercise', c.exercise, 'target', c.target_label,
                           'reps', new.reps));
    end if;
  exception when others then
    -- THE CALL OUT IS ALLOWED TO BE STALE. THE TRAINING IS NOT ALLOWED TO BE
    -- LOST. The sweep's attempt_hours timeout refunds both sides if this ever
    -- silently fails, so the worst case is a returned stake, never a lost set.
    null;
  end;
  return null;
end;
$$;

drop trigger if exists trg_callout_on_set on public.workout_log;
create trigger trg_callout_on_set
  after insert or update on public.workout_log
  for each row
  when (new.reps > 0)
  execute function public.callout_on_set_write();

commit;

-- ─────────────────────────────────────────────────────────── rollback
--
-- begin;
--   drop trigger if exists trg_callout_on_set on public.workout_log;
--   drop function if exists public.callout_on_set_write();
--   drop function if exists public.callout_judge(text, numeric, int, text, numeric,
--     numeric, numeric, int);
-- commit;

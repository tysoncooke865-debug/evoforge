-- EvoForge 195 — PR CROSSINGS FOLLOW THE EXERCISE, NOT ITS SPELLING
-- (2026-08-11). Requires 192 (workout_log.exercise_id) and 193 (backfill).
--
-- THE BUG. `report_pr_crossings` (072, hardened by 079) tells a friend you
-- have passed their best on a lift. It matched `w.exercise = p_exercise` in
-- three places, so the whole feature was blind across spellings:
--
--   * YOUR anchor. You bench 120 under `Barbell Bench Press`; today's AI plan
--     says `Bench Press (Strength Focused)`. `v_base` came back null and the
--     function returned '[]' — a real PR notified nobody.
--   * THEIR best. Your friend logs `Bench Press`; you log `Barbell Bench
--     Press`. You could never cross them, whatever either of you lifted.
--   * THE 12-HOUR DEDUP, which keyed on the literal name in `detail`. Two
--     spellings of one lift were two independent dedup buckets, so the
--     anti-spam window could be walked straight through by renaming.
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT.
--
-- The three predicates now match on `exercise_id` when the caller supplies
-- one. EVERY SECURITY PROPERTY 079 ADDED IS PRESERVED, unchanged:
--
--   * `v_base` is still the CALLER'S OWN server-side best, read from their
--     owner-only log. It is now the best across every spelling of that lift,
--     which is more correct and no more permissive — it is still their real
--     training and nothing else.
--   * the clamps are byte-identical: new ≤ 1.6×base + 25, prev ∈ [0.5×base,
--     base], and `v_new <= v_prev` still returns '[]'.
--   * no history (`v_base` null or ≤ 0) still returns '[]'.
--   * the 25-target anti-spam cap is unchanged.
--   * the 12h dedup is STRENGTHENED: it now matches on the id as well as the
--     name, closing the rename bypass described above.
--
-- ---- THE COHERENCE CHECK, AND WHY IT IS HERE ----
--
-- The caller sends both the name and the id, and the server cannot recompute
-- the id (the canonical catalogue is generated from the client's TypeScript
-- exercise library; there is no copy in Postgres, on purpose — a second copy
-- is a second thing to drift). An unchecked pair would let somebody anchor on
-- one lift while NAMING another: `('Bench Press', 'barbell_back_squat')`
-- would compute the band from their squat and send a friend a notification
-- about a bench. That is not a data leak — the band is still bounded by their
-- own real training — but it is a spoof, and it is cheap to close.
--
-- So the pair must be one THE CALLER HAS ACTUALLY LOGGED TOGETHER. A genuine
-- save always satisfies it (the client derives the id from the very row it
-- just wrote). Anything else silently falls back to name matching, i.e. to
-- exactly today's behaviour. The id can therefore never point somewhere the
-- caller's own log does not already put it.
--
-- ---- WHY DROP AND RECREATE RATHER THAN `CREATE OR REPLACE` ----
--
-- The new parameter has a DEFAULT. `create or replace` cannot change a
-- signature, and creating `f(text,numeric,numeric,text default null)` beside
-- the existing `f(text,numeric,numeric)` makes a three-argument call
-- AMBIGUOUS — PostgREST would start failing with "function is not unique" on
-- every set save that beats a PR. Dropping first, in the same transaction,
-- is the only way to end with exactly one function.
--
-- A CLIENT THAT PASSES ONLY THREE ARGUMENTS STILL WORKS and behaves exactly
-- as it does today, which matters because the client deploys and the
-- migration is applied by hand, in either order.
--
-- FALSIFICATION CHECKLIST (ALPHA and BRAVO, as friends):
--  1. ALPHA benches 120 as 'Barbell Bench Press'; BRAVO's best is 110 as
--     'Bench Press'. ALPHA calls with the canonical id -> BRAVO is returned.
--     Before this migration the same call returned '[]'.
--  2. The same call twice inside 12h -> the second returns '[]' (dedup).
--  3. Calling with a DIFFERENT spelling inside 12h -> still '[]' (the rename
--     bypass is closed).
--  4. ('Bench Press', 'barbell_back_squat') where ALPHA has never logged that
--     pair -> the id is ignored, behaviour is name-matching, no squat data is
--     used.
--  5. A caller with NO history for the lift -> '[]' (v_base guard intact).
--  6. ('Bench', 99999, 0.01) -> clamped exactly as 079 asserts; not everyone.
--  7. A three-argument call -> works, and matches pre-195 behaviour.

begin;

drop function if exists public.report_pr_crossings(text, numeric, numeric);

create function public.report_pr_crossings(
  p_exercise    text,
  p_new_e1rm    numeric,
  p_prev_e1rm   numeric,
  p_exercise_id text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me      uuid := auth.uid();
  v_base  numeric;
  v_new   numeric;
  v_prev  numeric;
  v_id    text;
  v_result jsonb;
begin
  if me is null then raise exception 'report_pr_crossings: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_exercise is null or btrim(p_exercise) = '' then return '[]'::jsonb; end if;

  -- THE COHERENCE CHECK (see the header). An id the caller has not actually
  -- logged under this name is discarded, and everything below falls back to
  -- matching by name — today's behaviour, exactly.
  v_id := nullif(btrim(coalesce(p_exercise_id, '')), '');
  if v_id is not null and not exists (
    select 1 from workout_log
    where user_id = me and exercise_id = v_id and exercise = p_exercise
  ) then
    v_id := null;
  end if;

  -- The caller's REAL best for this lift, from their own owner-only log (the
  -- server-authoritative anchor; queue lag can't inflate it). With a verified
  -- id this spans every spelling of the lift; the `exercise_id is null` arm
  -- keeps rows written before 192 was applied in scope.
  select max(estimated_1rm) into v_base
    from workout_log
   where user_id = me
     and (case when v_id is null then exercise = p_exercise
               else exercise_id = v_id or (exercise_id is null and exercise = p_exercise) end);
  if v_base is null or v_base <= 0 then return '[]'::jsonb; end if;  -- no history → no legit crossing

  -- Clamp the client's claim to a realistic PR band around v_base:
  --   new  ≤ 1.6×base + 25   (a single PR never jumps to 99999)
  --   prev ∈ [0.5×base, base] (can't be dropped to ~0 to catch everyone)
  v_new  := least(coalesce(p_new_e1rm, 0), v_base * 1.6 + 25);
  v_prev := greatest(least(coalesce(p_prev_e1rm, 0), v_base), v_base * 0.5);
  if v_new <= v_prev or v_prev <= 0 then return '[]'::jsonb; end if;

  with my_friends as (
    select case when user_a = me then user_b else user_a end as fid
    from friendships where user_a = me or user_b = me
  ),
  crossed as (
    select mf.fid,
           (select max(w.estimated_1rm) from workout_log w
             where w.user_id = mf.fid
               and (case when v_id is null then w.exercise = p_exercise
                         else w.exercise_id = v_id or (w.exercise_id is null and w.exercise = p_exercise) end)
           ) as friend_best
    from my_friends mf
  ),
  targets as (
    select c.fid from crossed c
    where c.friend_best is not null
      and c.friend_best > 0
      and c.friend_best < v_new
      and c.friend_best >= v_prev
      and not exists (
        select 1 from social_notifications n
        where n.user_id = c.fid and n.actor_id = me and n.type = 'pr_beaten'
          -- Dedup on the IDENTITY when we have one, and on the name either
          -- way: two spellings of one lift are one anti-spam bucket now.
          and (n.detail->>'exercise' = p_exercise
               or (v_id is not null and n.detail->>'exercise_id' = v_id))
          and n.created_at > now() - interval '12 hours'
      )
    limit 25   -- never notify more than 25 friends per crossing (anti-spam cap)
  ),
  ins as (
    insert into social_notifications (user_id, actor_id, type, detail)
    select t.fid, me, 'pr_beaten',
           -- `exercise` stays the DISPLAY name the athlete saw, so existing
           -- notification copy is untouched; `exercise_id` rides alongside so
           -- the dedup above can key on identity from here on.
           jsonb_strip_nulls(jsonb_build_object(
             'exercise', p_exercise,
             'exercise_id', v_id,
             'e1rm', round(v_new::numeric, 1)
           ))
    from targets t
    returning user_id
  )
  select coalesce(jsonb_agg(user_id), '[]'::jsonb) into v_result from ins;
  return v_result;
end; $$;

commit;

-- EvoForge 079 — HARDEN report_pr_crossings (audit finding 1) (Tyson, 2026-07-21).
--
-- 072 trusted the client's p_new_e1rm / p_prev_e1rm outright. Two exploits:
--   A) FABRICATION/SPAM: report_pr_crossings('Bench', 99999, 0.01) makes EVERY
--      friend with any bench log fall in the band → a real pr_beaten notification
--      + push per friend, exercise string attacker-controlled. Iterate names = spam.
--   B) PRIVATE-LIFT ORACLE: the returned friend-id array reveals which friends have
--      a best in the chosen band for a chosen lift — leaking otherwise owner-only
--      workout_log numbers by binary-searching the band.
--
-- Fix: ANCHOR to the caller's REAL server-side best for the lift (v_base) and
-- CLAMP the client's claim to a realistic PR band around it — so an attacker can't
-- claim an absurd e1rm or probe an arbitrary band. We can't purely server-derive
-- the new PR because set-saves are often durable/queued and not yet synced when
-- this fires; but any GENUINE crossing needs prior history (is_pr requires a
-- positive previous best), so v_base > 0 always holds for a real one — and a fresh
-- account with no history is rejected outright. Plus a 25-target cap and the 12h
-- dedup already present. Signature unchanged (the client still passes its values;
-- they are now validated, not trusted).
--
-- FALSIFICATION:
--  1. A with NO bench history calls ('Bench',99999,0.01) → [] (v_base=0, rejected).
--  2. A with a real 120kg bench best calls ('Bench',99999,0.01) → the claim is
--     capped to ~1.6×120 and the floor lifts prev to ~0.6×120, so only friends
--     within a realistic band are ever crossed — never "everyone".
--  3. a genuine PR (prev≈base, new a few % over) behaves EXACTLY as before.

create or replace function public.report_pr_crossings(p_exercise text, p_new_e1rm numeric, p_prev_e1rm numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_base numeric; v_new numeric; v_prev numeric; v_result jsonb;
begin
  if me is null then raise exception 'report_pr_crossings: not signed in.' using errcode='insufficient_privilege'; end if;
  if p_exercise is null or btrim(p_exercise) = '' then return '[]'::jsonb; end if;

  -- The caller's REAL best for this lift, from their own owner-only log (the
  -- server-authoritative anchor; queue lag can't inflate it).
  select max(estimated_1rm) into v_base from workout_log where user_id = me and exercise = p_exercise;
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
             where w.user_id = mf.fid and w.exercise = p_exercise) as friend_best
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
          and n.detail->>'exercise' = p_exercise
          and n.created_at > now() - interval '12 hours'
      )
    limit 25   -- never notify more than 25 friends per crossing (anti-spam cap)
  ),
  ins as (
    insert into social_notifications (user_id, actor_id, type, detail)
    select t.fid, me, 'pr_beaten',
           jsonb_build_object('exercise', p_exercise, 'e1rm', round(v_new::numeric, 1))
    from targets t
    returning user_id
  )
  select coalesce(jsonb_agg(user_id), '[]'::jsonb) into v_result from ins;
  return v_result;
end; $$;

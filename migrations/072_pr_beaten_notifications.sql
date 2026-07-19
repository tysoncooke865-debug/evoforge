-- EvoForge 072 — RIVALRY "PR BEATEN" NOTIFICATIONS (Tyson, 2026-07-20).
--
-- "Implement rivalry/friends notifications such as 'USERNAME just destroyed your
-- PR — reclaim your status.'" When you log a set whose estimated-1RM surpasses a
-- FRIEND's best for that exercise for the FIRST time, that friend gets a
-- 'pr_beaten' notification (+ a push twin). It's the rivalry loop: you take their
-- lift, they get pinged to reclaim it.
--
-- DESIGN — RPC, not a workout_log trigger. Detection runs in report_pr_crossings,
-- which the ACTOR's client calls (fire-and-forget) right after a confirmed PR.
-- Two reasons over an AFTER-INSERT trigger on workout_log:
--   (1) SAFETY — the 054/058 lesson: a bad insert into social_notifications from
--       a trigger rolls back the PARENT row silently. Here a failure fails only
--       the RPC, never the set save. (We STILL widen the type CHECK first, below,
--       so even the RPC's insert can't be refused.)
--   (2) COST — a trigger would scan every friend's whole log on EVERY set; the
--       RPC fires only on an actual PR (is_pr, client-side), which is rare.
--
-- FALSIFICATION (ALPHA beats BRAVO's bench):
--   1. ALPHA logs a bench e1rm above BRAVO's best → BRAVO gets ONE 'pr_beaten'
--      row (detail.exercise = 'Bench Press'); CAROL (not friends) gets nothing.
--   2. ALPHA logs another, higher bench → NO second row (already past BRAVO —
--      p_prev >= friend_best now), and the 12h dedup also guards a double-call.
--   3. inserting the notification does NOT roll back (CHECK admits 'pr_beaten').
--   4. a non-friend is never notified; the caller never notifies themselves.

-- (0) Widen the type domain FIRST — a trigger/RPC inserting an unlisted type
--     raises and (in a trigger) rolls back the parent. Keep all 7 existing +
--     'pr_beaten'. (matches 058's current live set.)
alter table public.social_notifications drop constraint if exists social_notifications_type_check;
alter table public.social_notifications
  add constraint social_notifications_type_check
  check (type in ('reaction','comment','friend_request','friend_accepted','mention',
                  'comment_reaction','comment_reply','pr_beaten'));

-- (1) A free-form detail payload so a notification can carry type-specific data
--     (here: which lift + the new e1rm). Nullable — every existing type ignores it.
alter table public.social_notifications add column if not exists detail jsonb;

-- (2) The inbox RPC re-created to also return `detail` (everything else verbatim
--     from 052 — same shape, same ordering, same hydration).
create or replace function public.my_notifications(p_limit int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); lim int := least(greatest(coalesce(p_limit,30),1),60);
begin
  if me is null then raise exception 'my_notifications: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select n.id, n.type, n.post_id, n.created_at, n.read_at, n.detail,
             coalesce(pp.display_name, 'Someone') as actor_name,
             left(coalesce(sp.caption, ''), 60) as post_peek
      from social_notifications n
      left join public_profile pp on pp.user_id = n.actor_id
      left join social_posts sp on sp.id = n.post_id
      where n.user_id = me
      order by n.created_at desc
      limit lim
    ) t
  ), '[]'::jsonb);
end; $$;
grant execute on function public.my_notifications(int) to authenticated;

-- (3) Detection + insert. Called by the ACTOR after a confirmed PR with their
--     new e1rm and their PREVIOUS best (the is_pr basis). For each friend whose
--     current best for this lift sits in (p_prev, p_new] — i.e. this set just
--     crossed them for the FIRST time — insert a 'pr_beaten' row and return that
--     friend's id so the client can fire the push twin.
create or replace function public.report_pr_crossings(p_exercise text, p_new_e1rm numeric, p_prev_e1rm numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); v_result jsonb;
begin
  if me is null then raise exception 'report_pr_crossings: not signed in.' using errcode='insufficient_privilege'; end if;
  -- Only a genuine PR (new strictly above a positive previous) can cross anyone.
  if p_exercise is null or coalesce(p_new_e1rm,0) <= coalesce(p_prev_e1rm,0) or coalesce(p_prev_e1rm,0) <= 0 then
    return '[]'::jsonb;
  end if;
  -- A data-modifying CTE must sit at the STATEMENT top level (not inside a
  -- subquery expression), so the INSERT drives the SELECT ... INTO directly.
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
      and c.friend_best < p_new_e1rm     -- my new set beats their best
      and c.friend_best >= p_prev_e1rm   -- ...and I hadn't already beaten them
      and not exists (                   -- dedup: don't re-tell them this lift within 12h
        select 1 from social_notifications n
        where n.user_id = c.fid and n.actor_id = me and n.type = 'pr_beaten'
          and n.detail->>'exercise' = p_exercise
          and n.created_at > now() - interval '12 hours'
      )
  ),
  ins as (
    insert into social_notifications (user_id, actor_id, type, detail)
    select t.fid, me, 'pr_beaten',
           jsonb_build_object('exercise', p_exercise, 'e1rm', round(p_new_e1rm::numeric, 1))
    from targets t
    returning user_id
  )
  select coalesce(jsonb_agg(user_id), '[]'::jsonb) into v_result from ins;
  return v_result;
end; $$;
grant execute on function public.report_pr_crossings(text, numeric, numeric) to authenticated;

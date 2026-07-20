-- EvoForge 078 — PERFORMANCE: indexes + discover_gyms rewrite (Tyson, 2026-07-21).
--
-- From the perf audit of the new social/multiplayer code:
--  1. report_pr_crossings (072) does a correlated max(estimated_1rm) per friend
--     over workout_log with only a (user_id, date) index — a leading-column-only
--     scan per friend on the hottest write path (every PR). A covering
--     (user_id, exercise, estimated_1rm) index turns each into a first-row read.
--     Bonus: the existing per-SET PR/coin lookups (013/030/033/061) all filter
--     workout_log by (user_id, exercise) and gain from it too.
--  2. The typeahead LIKE '%q%' on display_name / gym name can't use a btree
--     (leading wildcard). A pg_trgm GIN index makes it index-backed.
--  3. discover_gyms computed member_count THREE times per row (select, is_full,
--     order by) — collapse to one lateral aggregate.

-- (1) Covering index for per-(user,exercise) e1rm lookups.
create index if not exists workout_log_user_ex_e1rm
  on public.workout_log (user_id, exercise, estimated_1rm desc);

-- (2) Trigram indexes for the name typeaheads (leading-wildcard LIKE).
create extension if not exists pg_trgm;
create index if not exists public_profile_name_trgm
  on public.public_profile using gin (lower(display_name) gin_trgm_ops);
create index if not exists gyms_name_trgm
  on public.gyms using gin (lower(name) gin_trgm_ops);

-- (3) discover_gyms: one lateral aggregate instead of 3× correlated count(*).
--     SECURITY (audit finding 2): roster_power now GATES each member's rating on
--     their show_evo flag — a solo public gym's roster_power previously equalled
--     the owner's exact rating, leaking a show_evo=false athlete's Evo score to
--     anyone browsing. Matches the individual-rating rule everywhere else.
create or replace function public.discover_gyms(p_query text default '', p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); q text := lower(btrim(coalesce(p_query,''))); lim int := least(greatest(coalesce(p_limit,20),1),40);
begin
  if me is null then raise exception 'discover_gyms: not signed in.' using errcode='insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(t)) from (
      select g.id as gym_id, g.name, g.description,
             coalesce(pp.display_name, 'Athlete') as owner_name,
             agg.member_count,
             agg.member_count >= 30 as is_full,
             public.is_gym_member(g.id, me) as is_member,
             agg.roster_power
      from gyms g
      left join public_profile pp on pp.user_id = g.owner_id
      join lateral (
        select count(*)::int as member_count,
               coalesce(sum(case when coalesce(mpp.show_evo, true) then coalesce(evo.displayed_rating,0) else 0 end),0) as roster_power
        from gym_members m
        left join evo_rating_current evo on evo.user_id = m.user_id
        left join public_profile mpp on mpp.user_id = m.user_id
        where m.gym_id = g.id
      ) agg on true
      where g.is_public and (q = '' or lower(g.name) like '%'||q||'%')
      order by agg.member_count desc, g.created_at desc
      limit lim
    ) t
  ), '[]'::jsonb);
end; $$;
grant execute on function public.discover_gyms(text, int) to authenticated;

-- (4) gym_detail.roster_power: same show_evo gate (members-only, but consistent).
--     Only the roster_power expression changes from 076; the rest is verbatim.
create or replace function public.gym_detail(p_gym uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g gyms%rowtype; my_role text;
begin
  if me is null then raise exception 'gym_detail: not signed in.' using errcode='insufficient_privilege'; end if;
  if not public.is_gym_member(p_gym, me) then return jsonb_build_object('ok', true, 'can_view', false); end if;
  select * into g from gyms where id = p_gym;
  select role into my_role from gym_members where gym_id = p_gym and user_id = me;
  return jsonb_build_object(
    'ok', true, 'can_view', true,
    'gym', jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description, 'is_public', g.is_public, 'my_role', my_role,
      'roster_power', (select coalesce(sum(case when coalesce(mpp.show_evo,true) then coalesce(evo.displayed_rating,0) else 0 end),0)
                       from gym_members m
                       left join evo_rating_current evo on evo.user_id = m.user_id
                       left join public_profile mpp on mpp.user_id = m.user_id
                       where m.gym_id = p_gym)),
    'members', coalesce((
      select jsonb_agg(row_to_json(t) order by t.role desc, t.forge_level desc nulls last) from (
        select m.user_id, coalesce(pp.display_name, 'Athlete') as display_name, m.role,
               public.forge_level_for_xp(coalesce(up.lifetime_xp,0)) as forge_level,
               case when coalesce(pp.show_evo, true) then evo.displayed_rating else null end as evo_rating
        from gym_members m
        left join public_profile pp on pp.user_id = m.user_id
        left join user_progression up on up.user_id = m.user_id
        left join evo_rating_current evo on evo.user_id = m.user_id
        where m.gym_id = p_gym
      ) t
    ), '[]'::jsonb),
    'battles', coalesce((
      select jsonb_agg(row_to_json(b) order by b.created_at desc) from (
        select gb.id, gb.a_gym, gb.b_gym, gb.a_score, gb.b_score, gb.winner_gym, gb.created_at,
               ga.name as a_name, gbn.name as b_name
        from gym_battles gb join gyms ga on ga.id = gb.a_gym join gyms gbn on gbn.id = gb.b_gym
        where gb.a_gym = p_gym or gb.b_gym = p_gym
        order by gb.created_at desc limit 10
      ) b
    ), '[]'::jsonb)
  );
end; $$;

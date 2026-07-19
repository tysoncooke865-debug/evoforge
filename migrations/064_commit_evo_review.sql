-- EvoForge 064 — commit_evo_review(): the review lands in ONE call
-- (audit C6 + C1, 2026-07-19).
--
-- The weekly Evo review used to persist through ~15 sequential client
-- writes (snapshot, current, evidence, chapters, player stats, class ×2,
-- traits loop, audit, analytics loop) — chatty, and the snapshot/current
-- pair could drift when a write in the middle failed (audit C1). The RULE
-- MATH STAYS CLIENT-SIDE in the pinned domain functions; this RPC is pure
-- atomic persistence of the computed payload:
--
--   p := {
--     today: 'YYYY-MM-DD',
--     snapshot:  {…evo_rating_snapshots columns…},
--     current:   {…evo_rating_current columns…},
--     evo_class: text | null,
--     stats:     {…player_stats columns…} | null,
--     traits:    [{trait_key,trait_tier,source_pillar,rule_version}, …],
--     audit:     {old_rating,new_rating,trigger_type,flags} | null,
--     analytics: [{event_name,props}, …]
--   }
--
-- Sections: CORE (snapshot + current + evidence) runs unguarded — a core
-- failure fails the call. RIDERS (chapters, stats/class, traits, audit,
-- analytics) each sit in their own exception block: "best-effort riders
-- that can never fail a review" (the P8 doctrine), now server-side.
-- evo_class is written ONCE to evo_rating_current (the authority) and
-- mirrored into player_stats in the same transaction — C1's two-write
-- drift window is gone. Existing peak-ratchet / write-once / immutability
-- triggers keep guarding every row this touches.
--
-- SECURITY: definer, but every row lands under auth.uid() (the tables'
-- DEFAULT auth.uid() resolves the CALLER inside a definer fn). No client
-- input decides user_id.
--
-- FALSIFICATION CHECKLIST (as ALPHA, snapshots checked before/after):
--  1. a forced review commits: snapshot + current + stats + audit rows in
--     one call; evo_class identical on current and player_stats.
--  2. rerun idempotence stays the CALLER's job (due-gating) — the RPC
--     appends a snapshot per call by design; verify the client still
--     gates on next_review_at.
--  3. a malformed rider section (e.g. traits with a bad column) does NOT
--     lose the snapshot/current write.
--  4. peak-ratchet: a lower displayed_rating cannot drag peak_displayed
--     down (existing trigger fires inside the RPC).

create or replace function public.commit_evo_review(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_snapshot_id uuid;
  v_today date;
  v_newest record;
  v_age integer;
  v_start record;
  v_end record;
  v_summary jsonb;
  t jsonb;
  e jsonb;
begin
  if me is null then
    raise exception 'commit_evo_review: not signed in.' using errcode = 'insufficient_privilege';
  end if;
  v_today := coalesce((p->>'today')::date, current_date);

  -- ===== CORE (unguarded — a failure here fails the review) =====
  insert into evo_rating_snapshots (
    user_id, raw_rating, displayed_rating, evolution_progress,
    size_score, aesthetics_score, strength_score, cardio_score,
    confidence, descriptor, trigger_type, changes, recommendations, model_version
  ) values (
    me,
    (p->'snapshot'->>'raw_rating')::numeric,
    (p->'snapshot'->>'displayed_rating')::numeric,
    (p->'snapshot'->>'evolution_progress')::numeric,
    (p->'snapshot'->>'size_score')::numeric,
    (p->'snapshot'->>'aesthetics_score')::numeric,
    (p->'snapshot'->>'strength_score')::numeric,
    (p->'snapshot'->>'cardio_score')::numeric,
    (p->'snapshot'->>'confidence')::numeric,
    p->'snapshot'->>'descriptor',
    p->'snapshot'->>'trigger_type',
    coalesce(p->'snapshot'->'changes', '[]'::jsonb),
    coalesce(p->'snapshot'->'recommendations', '[]'::jsonb),
    p->'snapshot'->>'model_version'
  ) returning id into v_snapshot_id;

  insert into evo_rating_current as cur (
    user_id, raw_rating, displayed_rating, evolution_progress,
    starting_raw_rating, starting_displayed, peak_raw_rating, peak_displayed,
    lifetime_evolution, size_score, aesthetics_score, strength_score, cardio_score,
    size_confidence, aesthetics_confidence, strength_confidence, cardio_confidence,
    overall_confidence, confidence_label, descriptor, status, limiting_pillar,
    last_review_at, next_review_at, model_version, evo_class
  ) values (
    me,
    (p->'current'->>'raw_rating')::numeric,
    (p->'current'->>'displayed_rating')::numeric,
    (p->'current'->>'evolution_progress')::numeric,
    (p->'current'->>'starting_raw_rating')::numeric,
    (p->'current'->>'starting_displayed')::numeric,
    (p->'current'->>'peak_raw_rating')::numeric,
    (p->'current'->>'peak_displayed')::numeric,
    (p->'current'->>'lifetime_evolution')::numeric,
    (p->'current'->>'size_score')::numeric,
    (p->'current'->>'aesthetics_score')::numeric,
    (p->'current'->>'strength_score')::numeric,
    (p->'current'->>'cardio_score')::numeric,
    (p->'current'->>'size_confidence')::numeric,
    (p->'current'->>'aesthetics_confidence')::numeric,
    (p->'current'->>'strength_confidence')::numeric,
    (p->'current'->>'cardio_confidence')::numeric,
    (p->'current'->>'overall_confidence')::numeric,
    p->'current'->>'confidence_label',
    p->'current'->>'descriptor',
    p->'current'->>'status',
    p->'current'->>'limiting_pillar',
    (p->'current'->>'last_review_at')::timestamptz,
    (p->'current'->>'next_review_at')::timestamptz,
    p->'current'->>'model_version',
    p->>'evo_class'
  )
  on conflict (user_id) do update set
    raw_rating = excluded.raw_rating,
    displayed_rating = excluded.displayed_rating,
    evolution_progress = excluded.evolution_progress,
    starting_raw_rating = excluded.starting_raw_rating,
    starting_displayed = excluded.starting_displayed,
    peak_raw_rating = excluded.peak_raw_rating,
    peak_displayed = excluded.peak_displayed,
    lifetime_evolution = excluded.lifetime_evolution,
    size_score = excluded.size_score,
    aesthetics_score = excluded.aesthetics_score,
    strength_score = excluded.strength_score,
    cardio_score = excluded.cardio_score,
    size_confidence = excluded.size_confidence,
    aesthetics_confidence = excluded.aesthetics_confidence,
    strength_confidence = excluded.strength_confidence,
    cardio_confidence = excluded.cardio_confidence,
    overall_confidence = excluded.overall_confidence,
    confidence_label = excluded.confidence_label,
    descriptor = excluded.descriptor,
    status = excluded.status,
    limiting_pillar = excluded.limiting_pillar,
    last_review_at = excluded.last_review_at,
    next_review_at = excluded.next_review_at,
    model_version = excluded.model_version,
    evo_class = coalesce(excluded.evo_class, cur.evo_class),
    updated_at = now();

  update pending_evo_evidence
    set status = 'confirmed', reviewed_at = now(), reason = 'review ' || v_snapshot_id
    where user_id = me and status = 'pending';

  -- ===== RIDERS (each guarded — can never fail the review) =====

  -- Chapters (ported verbatim from the client's maintainChapters).
  begin
    select id, chapter_number, started_at, ended_at, starting_snapshot_id
      into v_newest
      from evolution_chapters
      where user_id = me
      order by chapter_number desc
      limit 1;
    if v_newest is null then
      insert into evolution_chapters (user_id, chapter_number, started_at, starting_snapshot_id)
      values (me, 1, v_today, v_snapshot_id);
    elsif v_newest.ended_at is null then
      v_age := v_today - v_newest.started_at::date;
      if v_age >= 84 then
        select id, displayed_rating, size_score, aesthetics_score, strength_score, cardio_score
          into v_start from evo_rating_snapshots where id = v_newest.starting_snapshot_id;
        select id, displayed_rating, size_score, aesthetics_score, strength_score, cardio_score
          into v_end from evo_rating_snapshots where id = v_snapshot_id;
        if v_start is not null and v_end is not null then
          v_summary := jsonb_build_object(
            'startingRating', v_start.displayed_rating,
            'endingRating', v_end.displayed_rating,
            'change', v_end.displayed_rating - v_start.displayed_rating,
            'pillars', jsonb_build_object(
              'size', jsonb_build_array(v_start.size_score, v_end.size_score),
              'aesthetics', jsonb_build_array(v_start.aesthetics_score, v_end.aesthetics_score),
              'strength', jsonb_build_array(v_start.strength_score, v_end.strength_score),
              'cardio', jsonb_build_array(v_start.cardio_score, v_end.cardio_score)
            )
          );
        else
          v_summary := '{}'::jsonb;
        end if;
        update evolution_chapters
          set ended_at = v_today, ending_snapshot_id = v_snapshot_id, summary = v_summary
          where id = v_newest.id;
        insert into evolution_chapters (user_id, chapter_number, started_at, starting_snapshot_id)
        values (me, v_newest.chapter_number + 1, v_today, v_snapshot_id);
      end if;
    end if;
  exception when others then null; -- next review retries
  end;

  -- Player stats + the evo_class mirror (ONE transaction — no drift window).
  begin
    if p->'stats' is not null and jsonb_typeof(p->'stats') = 'object' then
      insert into player_stats as ps (
        user_id, power, vitality, stamina, balance, technique,
        evo_class, class_rule_version, updated_at
      )
      select me,
             (p->'stats'->>'power')::numeric,
             (p->'stats'->>'vitality')::numeric,
             (p->'stats'->>'stamina')::numeric,
             (p->'stats'->>'balance')::numeric,
             (p->'stats'->>'technique')::numeric,
             p->>'evo_class',
             p->'stats'->>'class_rule_version',
             now()
      on conflict (user_id) do update set
        power = excluded.power,
        vitality = excluded.vitality,
        stamina = excluded.stamina,
        balance = excluded.balance,
        technique = excluded.technique,
        evo_class = excluded.evo_class,
        class_rule_version = excluded.class_rule_version,
        updated_at = now();
    end if;
  exception when others then null;
  end;

  -- Traits (append-only; duplicates ignored like the client's upsert).
  begin
    for t in select * from jsonb_array_elements(coalesce(p->'traits', '[]'::jsonb)) loop
      insert into player_traits (user_id, trait_key, trait_tier, source_pillar, rule_version)
      values (me, t->>'trait_key', t->>'trait_tier', t->>'source_pillar', t->>'rule_version')
      on conflict (user_id, trait_key) do nothing;
    end loop;
  exception when others then null;
  end;

  -- Audit + analytics.
  begin
    if p->'audit' is not null and jsonb_typeof(p->'audit') = 'object' then
      insert into evo_rating_audit (user_id, old_rating, new_rating, trigger_type, snapshot_id, flags)
      values (
        me,
        (p->'audit'->>'old_rating')::numeric,
        (p->'audit'->>'new_rating')::numeric,
        p->'audit'->>'trigger_type',
        v_snapshot_id,
        coalesce(p->'audit'->'flags', '[]'::jsonb)
      );
    end if;
    for e in select * from jsonb_array_elements(coalesce(p->'analytics', '[]'::jsonb)) loop
      insert into analytics_events (user_id, event_name, props)
      values (me, e->>'event_name', coalesce(e->'props', '{}'::jsonb));
    end loop;
  exception when others then null;
  end;

  return jsonb_build_object('ok', true, 'snapshot_id', v_snapshot_id);
end;
$$;

grant execute on function public.commit_evo_review(jsonb) to authenticated;

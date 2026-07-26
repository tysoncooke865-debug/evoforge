-- EvoForge 114 — variants that DO something, and variants of screens that exist.
--
-- Two gaps, and they are the same gap seen from either end.
--
-- 1. A PREVIEW WAS A PICTURE. The generator was told "no <script> tags", so
--    every generated design was a still life: buttons that could not be
--    pressed, tabs that did not switch, counters that did not count. You cannot
--    judge whether a first-workout flow works by looking at a photograph of it,
--    and the Challenge Arena was judging exactly that.
--
--    The sandbox already permitted this. `sandbox="allow-scripts"` WITHOUT
--    allow-same-origin gives a null origin: script can run, and can reach
--    nothing — not the parent page, not the session, not storage, not the
--    network. The restriction was in the prompt, not in the security model.
--
-- 2. "EDIT THE HOME SCREEN" HAD NOWHERE TO START. Variants could only be
--    generated from a goal or written by hand. There was no way to say "this
--    screen, but the CTA is bigger and the stats move above the card", because
--    there was no faithful representation of the screen to say it about.
--
-- THE TWO HONEST WAYS TO GET A REAL SCREEN IN HERE, AND WHY THERE ARE TWO
--
--   'imported'    — a true DOM capture of the running app via Playwright.
--                   Only possible where the app renders without a session.
--                   Checked, not assumed: every route on the deployed build
--                   redirects to /sign-in today, so this currently reaches the
--                   auth screens and nothing else.
--
--   'transcribed' — a model reads the real React Native source from the product
--                   repo and reconstructs the screen in the lab's HTML and
--                   token vocabulary. This is a RECONSTRUCTION, not a capture,
--                   and the distinction is kept in the origin column rather
--                   than in a comment, because a reconstruction that gets
--                   mistaken for a capture is how a design decision gets made
--                   against a screen nobody has actually seen.
--
--   'edited'      — a previous variant plus a written instruction. Carries
--                   parent_id, so the lineage from a real screen through five
--                   revisions is a chain of rows, not a memory.
--
-- FALSIFICATION (scripts/_falsify114.mjs):
--   1. a variant can carry behaviour, and it survives a round trip.
--   2. an edited variant must name the variant it came from.
--   3. an edit with no instruction is refused.
--   4. a transcription must record the source file it was read from.
--   5. the origin vocabulary still refuses an unknown value.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. BEHAVIOUR
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_lab_variants
  add column if not exists js text not null default '';

comment on column public.command_lab_variants.js is
  'Behaviour for the variant, executed in a null-origin sandbox. It can animate, '
  'count, switch tabs and open sheets; it cannot reach the parent page, the '
  'Supabase session, storage or the network. A design nobody can press is not a '
  'design anyone can judge.';

-- What this variant was derived from: a real source file, or a real URL.
alter table public.command_lab_variants
  add column if not exists source_ref text;

comment on column public.command_lab_variants.source_ref is
  'The file path or URL this variant was derived from. A transcription that '
  'cannot say what it was transcribed FROM cannot be checked against it.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. THE WIDER VOCABULARY
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.command_lab_variants drop constraint if exists command_lab_variants_origin_check;
alter table public.command_lab_variants
  add constraint command_lab_variants_origin_check
  check (origin = any (array['hand', 'generated', 'imported', 'transcribed', 'edited']));

alter table public.command_lab_jobs drop constraint if exists command_lab_jobs_kind_check;
alter table public.command_lab_jobs
  add constraint command_lab_jobs_kind_check
  check (kind = any (array['bench','judge','capture','perf','generate','simulate',
                           'arena','predict','import','edit','transcribe']));

-- BACKFILL, AND AN ADMISSION.
--
-- 110's `import` job wrote origin='imported' for what was actually a generic
-- starting point built from the design tokens — it was not imported from
-- anything, and calling it that was the exact mislabelling the new vocabulary
-- exists to prevent. Those rows are relabelled 'hand', which is what they are.
-- The constraint below would otherwise refuse to apply, which is the guard
-- doing its job on the first row it ever saw.
update public.command_lab_variants
   set origin = 'hand'
 where origin = 'imported' and source_ref is null;

-- An edited or transcribed variant has to say what it came from. Without it the
-- chain "real screen -> five revisions" becomes five unrelated drafts, and the
-- question "is this still the screen we ship?" has no answer.
do $$ begin
  alter table public.command_lab_variants add constraint command_variant_derives_honestly
    check (
      (origin <> 'edited' or parent_id is not null)
      and (origin not in ('transcribed', 'imported') or source_ref is not null)
    );
exception when duplicate_object then null; end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. SAVE, NOW CARRYING BEHAVIOUR AND LINEAGE
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Rebuilt on 110's version rather than from an older copy — it still refuses a
 * variant with no stated reason, still assigns the version number itself, and
 * still logs. What is added is js, source_ref, and the lineage the new origins
 * require.
 */
create or replace function public.command_lab_save_variant(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_version int; v_key text := p->>'subject_key'; v_author text; v_origin text;
begin
  if not is_founder() then raise exception 'command: founders only'; end if;
  if coalesce(trim(p->>'reason'),'') = '' then
    raise exception 'command: say why this variant exists — an unexplained variant cannot be judged later';
  end if;
  if not exists (select 1 from command_lab_subjects where key = v_key) then
    raise exception 'command: no lab subject %', v_key;
  end if;

  v_origin := coalesce(p->>'origin','hand');
  if v_origin = 'edited' and coalesce(p->>'parent_id','') = '' then
    raise exception 'command: an edited variant must name the variant it was edited from';
  end if;

  v_author := coalesce(p->>'author', (select name from command_founders where user_id = auth.uid()), 'founder');
  select coalesce(max(version),0) + 1 into v_version from command_lab_variants where subject_key = v_key;

  insert into command_lab_variants (subject_key, version, label, origin, reason, author,
                                    html, css, js, tokens, goal, model, parent_id, source_ref)
  values (v_key, v_version, coalesce(p->>'label', 'v' || v_version),
          v_origin, p->>'reason', v_author,
          coalesce(p->>'html',''), coalesce(p->>'css',''), coalesce(p->>'js',''),
          coalesce(p->'tokens','{}'::jsonb), p->>'goal', p->>'model',
          nullif(p->>'parent_id','')::uuid, nullif(p->>'source_ref',''))
  returning id into v_id;

  perform command_log('lab_variant_saved', 'settings', v_id, v_key,
    format('%s v%s saved by %s (%s) — %s', v_key, v_version, v_author, v_origin, p->>'reason'),
    jsonb_build_object('origin', v_origin, 'goal', p->>'goal', 'source_ref', p->>'source_ref',
                       'interactive', coalesce(length(p->>'js'),0) > 0));

  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_version);
end $$;
revoke all on function public.command_lab_save_variant(jsonb) from public, anon;
grant execute on function public.command_lab_save_variant(jsonb) to authenticated;

-- The subject detail must carry behaviour and lineage through to the browser,
-- or the editor opens a variant and silently drops the half of it that moves.
create or replace function public.command_lab_subject_detail(p_key text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'subject', (select to_jsonb(s) from command_lab_subjects s where s.key = p_key),
    'variants', (select coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object(
                    'parent_version', (select p.version from command_lab_variants p where p.id = v.parent_id),
                    'captures', (select coalesce(jsonb_agg(jsonb_build_object(
                                   'id', c.id, 'viewport', c.viewport, 'path', c.storage_path,
                                   'at', c.captured_at) order by c.captured_at desc), '[]'::jsonb)
                                   from command_lab_captures c where c.variant_id = v.id),
                    'perf', (select coalesce(jsonb_agg(jsonb_build_object(
                                'id', pr.id, 'lcp_ms', pr.lcp_ms, 'cls', pr.cls, 'tbt_ms', pr.tbt_ms,
                                'fps_mean', pr.fps_mean, 'dom_nodes', pr.dom_nodes,
                                'js_heap_bytes', pr.js_heap_bytes, 'error', pr.error,
                                'at', pr.ran_at) order by pr.ran_at desc), '[]'::jsonb)
                                from command_perf_runs pr where pr.variant_id = v.id),
                    'experiment', (select jsonb_build_object('ref', e.ref, 'status', e.status)
                                     from command_experiments e where e.id = v.experiment_id))
                  order by v.version desc), '[]'::jsonb)
                  from command_lab_variants v where v.subject_key = p_key and not v.archived));
$$;
grant execute on function public.command_lab_subject_detail(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. THE FEATURE PLAYGROUND'S FIRST TENANT
-- ─────────────────────────────────────────────────────────────────────────────

/**
 * Champion Battles V2 — the case the Dev Lab was described for.
 *
 * "Want to build Champion Battles V2? Build it entirely inside Dev Lab. Real
 * app stays untouched. When you're happy, one click, create experiment."
 *
 * Grounded in what actually shipped, not invented: BATTLE_ARENA_DESIGN.md and
 * the live implementation give three rounds (Strength / Cardio / Physique), a
 * BLITZ format of roughly 20-30 minutes with both players online, a FULL format
 * in one shared 90-minute window, server-authoritative scoring, realtime
 * spectating of the opponent's progress, trophies and an XP payout. V2 is a
 * redesign of that experience, so a prototype that ignores those constraints is
 * prototyping a different product.
 *
 * The purpose line is deliberately a question rather than a spec. The lab's job
 * is to produce several answers to it and let them compete.
 */
insert into public.command_lab_subjects (key, kind, label, purpose, surface, sort) values
  ('feature_champion_battle_v2','feature','Champion Battles V2',
   'The next version of 1v1 champion battles. Three rounds (Strength / Cardio / Physique), BLITZ ~20-30 min with both players online or FULL across one shared 90-minute window, server-authoritative scoring, realtime spectating, trophies and XP. The open question: what should the battle screen feel like moment to moment, when the opponent is training at the same time and neither can see the other lift?',
   'client/src/app/(main)/forge-arena/battle.tsx', 200),
  ('feature_champion_battle_v2_result','feature','Champion Battles V2 — the result',
   'The moment a battle ends. Who won, by how much, what it cost the loser, and what makes either athlete start another one. The shipped version settles server-side and pays out XP and trophies; this asks what the athlete should SEE.',
   'client/src/app/(main)/forge-arena/battle-log.tsx', 210)
on conflict (key) do update set label = excluded.label, purpose = excluded.purpose,
  surface = excluded.surface, sort = excluded.sort;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. REGISTRY — what each import path can and cannot reach
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.command_integrations (key,label,category,status,detail,setup_required) values
  ('devlab_interactive','Dev Lab — interactive previews','devlab','live',
   'Variants carry behaviour and run it in a null-origin sandbox: buttons press, tabs switch, counters count, sheets open. Script can execute and can reach nothing — not the parent page, the Supabase session, storage or the network.',
   'None.'),
  ('devlab_import_dom','Dev Lab — capture a real screen','devlab','configured_unavailable',
   'Playwright can capture the running app''s real DOM and computed styles into an editable variant. Verified against the deployed build: every route redirects to /sign-in without a session, so today this reaches the auth screens only. Authenticated screens come in as transcriptions instead, and are labelled as such.',
   'Set LAB_APP_EMAIL and LAB_APP_PASSWORD in the worker environment and every screen becomes capturable.'),
  ('devlab_transcribe','Dev Lab — transcribe a real screen','devlab','live',
   'A model reads the actual React Native source from the product repo and reconstructs the screen in the lab''s HTML and token vocabulary. This is a RECONSTRUCTION, not a capture — it is labelled origin=transcribed and records the file it was read from, so it can be checked against the real thing rather than mistaken for it.',
   'The product repo must be on the worker machine (COMMAND_REPO).')
on conflict (key) do update set status=excluded.status, label=excluded.label,
  detail=excluded.detail, setup_required=excluded.setup_required, updated_at=now();

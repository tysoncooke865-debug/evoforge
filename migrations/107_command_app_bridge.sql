-- EvoForge 107 — the bridge: /exec and /insights in the Expo app read Command.
--
-- The two systems have answered different questions in isolation:
--
--   /exec + /insights (Expo app)   — how is the PRODUCT doing?
--   Command Centre                 — what are we building, and who approved it?
--
-- A founder standing in the app looking at a 0% activation figure has had no
-- way to see that an opportunity was already raised from that exact number, or
-- that a work order is in flight against it. So the same fact gets rediscovered,
-- and sometimes re-decided, in the other tool.
--
-- This is ONE read-only RPC, deliberately.
--
-- WHY NOT MIRROR THE TABLES INTO THE APP. Command is governed: founders hold
-- SELECT and nothing else, every mutation is an audited SECURITY DEFINER RPC,
-- and three accounts can see it. Exposing the tables to the app would mean
-- maintaining that boundary twice and getting it wrong once. A single function
-- that returns a summary, gated on is_founder(), keeps exactly one copy of the
-- rule — and an athlete who is not a founder gets an empty object rather than
-- an error, because a 403 in a product screen is a bug report waiting to happen.
--
-- FALSIFICATION CHECKLIST:
--   1. a founder receives populated counts.
--   2. a non-founder receives {available:false} and NO command data.
--   3. it never raises — a product screen must not break because governance said no.

create or replace function public.command_app_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_is_founder boolean;
begin
  -- NOT an exception. This is called from a product screen that an athlete may
  -- open; refusing loudly would surface as a crash in the app rather than as
  -- the absence of a panel.
  select is_founder() into v_is_founder;
  if not coalesce(v_is_founder, false) then
    return jsonb_build_object('available', false, 'reason', 'founders only');
  end if;

  return jsonb_build_object(
    'available', true,
    'generated_at', now(),

    -- What needs a human, which is the only part that is genuinely urgent.
    'awaiting_founder', jsonb_build_object(
      'proposals', (select count(*) from command_proposals where status in ('open','changes_requested')),
      'releases',  (select count(*) from command_releases where status = 'open'),
      'tasks',     (select count(*) from command_tasks where status = 'awaiting_founder')
    ),

    -- What the studio is doing right now.
    'in_flight', jsonb_build_object(
      'work_orders', (select count(*) from command_work_orders where stage = 'IMPLEMENTING'),
      'tasks_building', (select count(*) from command_tasks where status in ('building','planning','testing')),
      'runner_online', exists (
        select 1 from command_runners
         where kind = 'runner' and last_seen_at > now() - interval '2 minutes' and state <> 'stopped')
    ),

    -- The measurement loop: what shipped and whether it helped.
    'outcomes', jsonb_build_object(
      'measuring', (select count(*) from command_releases where baseline_at is not null and outcome is null),
      'validated', (select count(*) from command_releases where outcome = 'VALIDATED'),
      'regressed', (select count(*) from command_releases where outcome = 'REGRESSED'),
      'neutral',   (select count(*) from command_releases where outcome = 'NEUTRAL')
    ),

    'experiments', jsonb_build_object(
      'running', (select count(*) from command_experiments where status = 'RUNNING'),
      'total',   (select count(*) from command_experiments)
    ),

    -- THE BRIDGE THAT MATTERS. /insights shows an activation number; this says
    -- whether anything is already being done about it, so the same figure is
    -- not investigated twice in two tools.
    'top_opportunities', coalesce((
      select jsonb_agg(x order by (x->>'score')::numeric desc) from (
        select jsonb_build_object(
          'ref', o.ref, 'title', o.title, 'classification', o.classification,
          'category', o.category, 'status', o.status, 'metric', o.metric,
          'baseline', o.baseline, 'target', o.target,
          'score', command_opportunity_score(o),
          'evidence_count', (select count(*) from command_opportunity_evidence oe where oe.opportunity_id = o.id)
        ) x
        from command_opportunities o
        where o.status in ('DISCOVERED','EVIDENCE_REQUIRED','PROPOSED','ACCEPTED')
        limit 5) s), '[]'::jsonb),

    -- Findings drawn from the app's OWN analytics, so /insights can show what
    -- Pulse concluded from the same rows the screen is rendering.
    'recent_evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'summary', e.summary, 'excerpt', e.excerpt,
        'confidence', e.confidence, 'collected_at', e.collected_at)
        order by e.collected_at desc)
      from (select * from command_evidence
             where source = 'internal_analytics' and superseded_by is null
               and (expires_at is null or expires_at > now())
             order by collected_at desc limit 5) e), '[]'::jsonb)
  );
end $$;

-- Any signed-in athlete may CALL it; only founders get data back. The gate is
-- inside the function, so there is exactly one copy of the rule.
grant execute on function public.command_app_summary() to authenticated;

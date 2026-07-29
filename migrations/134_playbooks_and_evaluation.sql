-- 134 — PLAYBOOKS THAT ONLY IMPROVE ON EVIDENCE, AND AN ACADEMY THAT EVALUATES
--
-- TWO THINGS THAT SOUNDED INTELLIGENT AND WERE NOT.
--
-- "The Academy" implied that running it made the underlying model better. It
-- cannot. Nothing in this repository fine-tunes anything; command_bench_runs
-- records eleven cases against prompt versions and that is the whole mechanism.
-- Called what it is, it is useful: an evaluation harness that decides whether
-- version 3 of a prompt is actually better than version 2. Called "training", it
-- is a claim the system cannot cash.
--
-- "The Professor" was going to rewrite the knowledge base after every event.
-- command_knowledge_objects has zero rows, which is the honest outcome of a
-- design where the bar for writing was "an event happened". Knowledge that
-- accumulates on every event is not knowledge, it is a log with opinions.
--
-- WHAT THIS ADDS.
--
--   command_playbooks         per-agent operational guidance, versioned.
--   command_playbook_versions promoted only by a founder or by a crossed
--                             evidence threshold — never because it reads better.
--   command_knowledge_conflicts  two validated objects that contradict, held as
--                             a conflict rather than silently overwritten.
--   command_eval_suites / command_eval_results  the Academy, doing evaluation.
--   command_eval_fixtures     the ten representative cases §23 asks for: strong,
--                             weak, unsupported, duplicate, already implemented,
--                             high risk, low confidence, conflicting evidence,
--                             and one succeeded/one failed historical decision.
--
-- The fixtures matter more than they look. Without a KNOWN-BAD proposal in the
-- suite, a quality gate that passes everything scores 100%.

begin;

/* ── 1. Playbooks — the Professor's real job ────────────────────────────── */

create table if not exists command_playbooks (
  key            text primary key,
  agent_key      text not null references command_agents(key),
  title          text not null,
  purpose        text not null,
  live_version   int not null default 0,
  updated_at     timestamptz not null default now()
);

create table if not exists command_playbook_versions (
  id             uuid primary key default gen_random_uuid(),
  playbook_key   text not null references command_playbooks(key) on delete cascade,
  version        int not null,
  body           text not null,
  reason         text not null,
  -- WHY IT CHANGED, as rows rather than as a claim. A playbook edit citing no
  -- decision and no lesson is someone's preference wearing a version number.
  from_decisions uuid[] not null default '{}',
  from_lessons   bigint[] not null default '{}',
  evidence_count int not null default 0,
  author         text not null default 'knowledge',
  author_kind    text not null default 'agent',
  promoted       boolean not null default false,
  promoted_at    timestamptz,
  promoted_by    text,
  promotion_note text not null default '',
  created_at     timestamptz not null default now(),
  unique (playbook_key, version)
);

-- THE PROMOTION RULE. A new playbook version goes live only when a founder says
-- so, or when it cites at least two validated decisions. "It sounds better" is
-- not a code path.
create or replace function public.command_promote_playbook(
  p_key text, p_version int, p_note text default '')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v record; v_founder boolean; v_validated int;
begin
  v_founder := auth.uid() is not null and is_founder();

  select * into v from command_playbook_versions where playbook_key = p_key and version = p_version;
  if v is null then raise exception 'command: no version % of playbook %', p_version, p_key; end if;

  -- How many of the cited decisions actually turned out well. Citing two
  -- decisions that both FAILED is not evidence for the change; it is evidence
  -- against it, and this counts only the validated ones.
  select count(*) into v_validated
    from command_decisions d
   where d.id = any(v.from_decisions) and d.outcome_verdict = 'validated';

  if not v_founder and v_validated < 2 then
    raise exception 'command: playbook %v% cites % validated decision(s) and no founder approved it. Two validated outcomes or a founder — a version is not promoted because it reads better',
      p_key, p_version, v_validated using errcode = 'insufficient_privilege';
  end if;

  update command_playbook_versions set promoted = false
   where playbook_key = p_key and promoted;
  update command_playbook_versions
     set promoted = true, promoted_at = now(),
         promoted_by = case when v_founder then coalesce((select name from command_founders where user_id = auth.uid()), 'founder')
                            else 'evidence threshold' end,
         promotion_note = coalesce(nullif(p_note,''),
           case when v_founder then 'Promoted by a founder.'
                else v_validated || ' validated decisions supported this change.' end)
   where playbook_key = p_key and version = p_version;
  update command_playbooks set live_version = p_version, updated_at = now() where key = p_key;

  perform command_log('playbook_promoted', 'playbook', null, p_key,
                      p_key || ' v' || p_version || ' is live',
                      jsonb_build_object('validated_decisions', v_validated, 'by_founder', v_founder),
                      case when v_founder then 'founder' else 'system' end, 'knowledge');
  return jsonb_build_object('ok', true, 'playbook', p_key, 'version', p_version,
                            'validated_decisions', v_validated);
end $$;

insert into command_playbooks (key, agent_key, title, purpose) values
  ('strategy_playbook','strategy','How to raise a proposal',
   'The checks the strategy agent runs before proposing, and the shape its output must take.'),
  ('research_playbook','research','How to turn feedback into a problem statement',
   'The evidence bar for promoting a comment to a problem statement, and how to record frequency and severity.'),
  ('analytics_playbook','analytics','How to read the funnel honestly',
   'Which table to query, how to handle an uninstrumented metric, and when to refuse a conclusion.'),
  ('market_playbook','market','How to record a competitor observation',
   'Sourcing, dating, and the difference between a verified fact and an inference.'),
  ('engineering_playbook','engineering','How to implement a work order',
   'Branch discipline, acceptance criteria, and what to do when a criterion cannot be met.'),
  ('review_playbook','reviewer','How to challenge a proposal',
   'The questions every review must ask, and the verdicts available.')
on conflict (key) do update set title = excluded.title, purpose = excluded.purpose;

insert into command_playbook_versions (playbook_key, version, body, reason, author, author_kind, promoted, promoted_at, promoted_by, promotion_note)
values
('strategy_playbook', 1,
'BEFORE YOU WRITE ANYTHING, call command_prior_art(topic, areas). If it returns an
active work order or an open proposal on this topic, stop and report the duplicate.
If it returns a prior decision with outcome=failed, you must address why this
attempt differs.

A proposal is not ready unless every one of these is true:
  - change_summary names what will be different afterwards, in one or two sentences,
    concretely enough that someone could check it.
  - At least one evidence item, each with a source and a date.
  - affected_areas names a file, screen, table or journey.
  - success_metrics names a metric that command_metric_defs can actually compute.
  - confidence is justified in confidence_reason by the amount, quality and
    recency of the evidence — not by how convincing the idea feels.

Never assert user demand that no evidence item supports. If you want a number you
do not have, say what would produce it and mark the proposal more_evidence_required
rather than estimating.',
'Initial playbook.', 'founder', 'founder', true, now(), 'Tyson', 'Seeded with the architecture.'),

('review_playbook', 1,
'You are trying to DISPROVE this proposal. A review that agrees with everything has
not been performed.

Work through, in order:
  1. Does every factual claim trace to an attached evidence item? Name the ones that
     do not, individually.
  2. Is the evidence about EvoForge, or about fitness apps in general? Generic advice
     is a rejection, not a quibble.
  3. Is it recent enough to still be true?
  4. Does command_prior_art show this already shipped, already decided, or already
     in flight? Those are verdicts: already_implemented, duplicate.
  5. Does the proposed action actually solve the stated problem, or does it solve an
     adjacent one that is easier?
  6. Is there a cheaper way to learn the same thing?
  7. Has correlation been read as causation?
  8. Is the success metric something the system can compute today?
  9. Is the stated confidence justified by what is attached?
 10. Which affected user group is not mentioned?

Verdicts: supported, supported_with_revisions, more_evidence_required, rejected,
duplicate, already_implemented, strategically_misaligned.

You have no authority to execute anything and you do not write proposals. Say what
is wrong; do not rewrite it into what you would have proposed.',
'Initial playbook.', 'founder', 'founder', true, now(), 'Tyson', 'Seeded with the architecture.'),

('analytics_playbook', 1,
'Every query that decides something reads analytics_events_real, never
analytics_events. The raw table includes the Dev Lab account, which walked the whole
activation funnel and moved activation_rate on its own.

An uninstrumented metric is reported as uninstrumented. It is never reported as
zero, because "nobody did this" and "nothing records this" produce the same 0 and
mean opposite things — first_set_logged has never once fired, and the gate computed
from it was reading a number nothing produces.

A failure count without an athlete count is not a finding. 146 events across 1
athlete is one person retrying; across 146 athletes it is an outage.

State alternative explanations before your preferred one. With no feature flags
there is no control group, so every before/after reading has confounders and you
name them.',
'Initial playbook.', 'founder', 'founder', true, now(), 'Tyson', 'Seeded with the architecture.'),

('research_playbook', 1,
'Label every item as one of: direct user evidence, behavioural evidence,
interpretation, hypothesis, unsupported assumption. The first two are the only ones
that may support a problem statement on their own.

One comment is one comment. Three independent sources are needed before a complaint
becomes a problem statement above hypothesis, and the count goes in the output.

Record frequency, severity and the affected segment. A problem affecting 2 of 13
athletes and one affecting all of them are different problems even when the sentence
describing them is identical.',
'Initial playbook.', 'founder', 'founder', true, now(), 'Tyson', 'Seeded with the architecture.'),

('market_playbook', 1,
'Every claim carries the URL it was fetched from and the date it was observed. A
claim you could not fetch is discarded, not downgraded to low confidence — a
plausible competitor fact with no source is indistinguishable from a fabricated one,
and it will be quoted later as if it were checked.

Separate: verified fact / user opinion / your inference / strategic hypothesis.

Never recommend copying a feature without stating whether it fits EvoForge''s
strategy. "Competitor X has it" is an observation, not an argument.',
'Initial playbook.', 'founder', 'founder', true, now(), 'Tyson', 'Seeded with the architecture.'),

('engineering_playbook', 1,
'Before implementing: produce the plan. Affected files, migrations, dependencies,
risks, rollback, test plan. If the work order has no acceptance criteria, stop and
write a line beginning "BLOCKED:" — an order with no checkable definition of done is
not implementable and guessing at criteria is how scope creeps.

Change only what the objectives require. Widening scope without a new founder vote
is the one thing this studio must never do.

After implementing, report what you ACTUALLY did, including any deviation from the
approved proposal. A deviation reported is a decision; a deviation discovered later
is a breach of the approval.',
'Initial playbook.', 'founder', 'founder', true, now(), 'Tyson', 'Seeded with the architecture.')
on conflict (playbook_key, version) do nothing;

update command_playbooks set live_version = 1 where live_version = 0;

/* ── 2. Knowledge quality — contradictions held, not overwritten ─────────── */

create table if not exists command_knowledge_conflicts (
  id            uuid primary key default gen_random_uuid(),
  object_a      uuid not null references command_knowledge_objects(id) on delete cascade,
  object_b      uuid not null references command_knowledge_objects(id) on delete cascade,
  claim_a       text not null,
  claim_b       text not null,
  detected_by   text not null default 'knowledge',
  status        text not null default 'open',
  resolution    text not null default '',
  resolved_at   timestamptz,
  at            timestamptz not null default now(),
  constraint command_knowledge_conflicts_status_ck check (status in ('open','resolved','both_true','stale'))
);

-- A lesson may only become authoritative knowledge with evidence behind it.
-- §14: "Prevent low-confidence AI output from entering validated knowledge."
create or replace function public.command_validate_knowledge(p_id uuid, p_note text default '')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare k record; v_founder boolean;
begin
  v_founder := auth.uid() is not null and is_founder();
  select * into k from command_knowledge_objects where id = p_id;
  if k is null then raise exception 'command: no such knowledge object'; end if;

  if not v_founder and coalesce(k.confidence, 0) < 0.8 then
    raise exception 'command: % has confidence % — validated knowledge needs 0.8 or a founder. Low-confidence output becoming authoritative is how a guess turns into a rule nobody can trace',
      k.key, coalesce(k.confidence, 0) using errcode = 'insufficient_privilege';
  end if;

  update command_knowledge_objects
     set validation_status = 'validated', updated_at = now()
   where id = p_id;
  perform command_log('knowledge_validated', 'knowledge', p_id, k.key,
                      k.title || ' is now authoritative',
                      jsonb_build_object('confidence', k.confidence, 'by_founder', v_founder, 'note', p_note),
                      case when v_founder then 'founder' else 'system' end, 'knowledge');
  return jsonb_build_object('ok', true, 'key', k.key);
end $$;

/* ── 3. The Academy — evaluation, named honestly ────────────────────────── */

create table if not exists command_eval_suites (
  key         text primary key,
  label       text not null,
  purpose     text not null,
  agent_key   text references command_agents(key),
  created_at  timestamptz not null default now()
);

-- The fixtures. Each carries the verdict a correct system MUST reach, which is
-- what makes this a test rather than a demo.
create table if not exists command_eval_fixtures (
  key           text primary key,
  suite_key     text not null references command_eval_suites(key) on delete cascade,
  label         text not null,
  category      text not null,
  input         jsonb not null,
  expected_verdict text not null,
  expected_reason  text not null,
  ord           int not null default 100,
  constraint command_eval_fixtures_category_ck check (category in
    ('strong','weak','unsupported','duplicate','already_implemented','high_risk',
     'low_confidence','conflicting_evidence','historical_success','historical_failure'))
);

create table if not exists command_eval_results (
  id            bigserial primary key,
  suite_key     text not null references command_eval_suites(key) on delete cascade,
  fixture_key   text not null references command_eval_fixtures(key) on delete cascade,
  run_key       text not null,
  config        jsonb not null default '{}'::jsonb,
  actual_verdict text,
  passed        boolean,
  detail        text not null default '',
  model         text,
  cost_usd      numeric,
  latency_ms    int,
  at            timestamptz not null default now()
);

create index if not exists command_eval_results_run_idx on command_eval_results (run_key, at desc);

insert into command_eval_suites (key, label, purpose, agent_key) values
  ('review_gate', 'Independent review gate',
   'Ten representative proposals with a known-correct verdict. Measures whether the review agent and the quality gate reject what should be rejected — a gate that passes everything scores 100% without one bad fixture in the set.',
   'reviewer')
on conflict (key) do update set label = excluded.label, purpose = excluded.purpose;

insert into command_eval_fixtures (key, suite_key, label, category, input, expected_verdict, expected_reason, ord) values
('fx_strong', 'review_gate', 'Well-evidenced, specific, measurable', 'strong',
 jsonb_build_object(
   'title','Instrument first_set_logged in the workout logging path',
   'change_summary','client/src/features/workout/log.tsx emits analytics_step {"step":"first_set_logged"} the first time an athlete completes a set in a session.',
   'affected_areas', jsonb_build_array('client/src/features/workout/log.tsx'),
   'evidence', jsonb_build_array(jsonb_build_object('type','analytics','summary','first_set_logged has never been emitted by any athlete','source','analytics_events_real','reliability','high')),
   'success_metrics', jsonb_build_array(jsonb_build_object('metric','first_set_logged','measurementMethod','count of distinct athletes emitting the event in 14 days')),
   'confidence', 0.9,
   'confidence_reason','The event is verifiably absent from the event table; the fix is an instrumentation change with no behavioural risk.'),
 'supported', 'Concrete change, real evidence, a computable metric and a justified confidence.', 10),

('fx_weak', 'review_gate', 'Vague benefit, no specifics', 'weak',
 jsonb_build_object(
   'title','Improve onboarding',
   'change_summary','This will create a more streamlined and engaging onboarding experience that delights users.',
   'affected_areas', jsonb_build_array(),
   'evidence', jsonb_build_array(),
   'success_metrics', jsonb_build_array()),
 'rejected', 'States a benefit, not a change. No area, no evidence, no metric.', 20),

('fx_unsupported', 'review_gate', 'Claims not supported by the attached evidence', 'unsupported',
 jsonb_build_object(
   'title','Add social sharing because users are asking for it',
   'change_summary','Add a share button to the workout summary screen.',
   'affected_areas', jsonb_build_array('client/src/app/(main)/summary.tsx'),
   'evidence', jsonb_build_array(jsonb_build_object('type','analytics','summary','Session length rose 4% last week','source','analytics_events_real','reliability','medium')),
   'success_metrics', jsonb_build_array(jsonb_build_object('metric','shares','measurementMethod','count')),
   'confidence', 0.85),
 'rejected', 'The claim is that users are asking; the only evidence is an unrelated session-length reading.', 30),

('fx_duplicate', 'review_gate', 'Same change as an active work order', 'duplicate',
 jsonb_build_object(
   'title','Fix the origin binding failure',
   'change_summary','Fix whatever causes origin_binding_failed during the origin ceremony.',
   'affected_areas', jsonb_build_array('client/src/ui/origin/origin-flow.tsx'),
   'evidence', jsonb_build_array(jsonb_build_object('type','analytics','summary','origin_binding_failed fired 146 times','source','analytics_events_real','reliability','high')),
   'success_metrics', jsonb_build_array(jsonb_build_object('metric','origin_binding_failed','measurementMethod','event count'))),
 'duplicate', 'command_prior_art returns WO-010, already in progress on exactly this event.', 40),

('fx_already', 'review_gate', 'Already shipped', 'already_implemented',
 jsonb_build_object(
   'title','Add two-factor authentication to sign-in',
   'change_summary','Add an optional TOTP second factor to the sign-in flow.',
   'affected_areas', jsonb_build_array('client/src/app/sign-in.tsx'),
   'evidence', jsonb_build_array(jsonb_build_object('type','inference','summary','Fitness apps generally offer 2FA','reliability','low'))),
 'already_implemented', '2FA and email confirmation shipped on 2026-07-21; the evidence is an inference about apps in general.', 50),

('fx_high_risk', 'review_gate', 'Irreversible, needs approval regardless of confidence', 'high_risk',
 jsonb_build_object(
   'title','Drop the legacy progression columns',
   'change_summary','Migration drops xp_legacy, rating_legacy and evo_legacy from athletes after backfilling the new columns.',
   'affected_areas', jsonb_build_array('supabase/migrations','athletes'),
   'evidence', jsonb_build_array(jsonb_build_object('type','technical','summary','The new columns have been populated for every row since migration 029','source','schema','reliability','high')),
   'success_metrics', jsonb_build_array(jsonb_build_object('metric','schema_size','measurementMethod','table size')),
   'confidence', 0.95,
   'reversibility','difficult'),
 'supported_with_revisions', 'Sound, but dropping columns is irreversible: it needs a rollback plan and a retention window before it can proceed. High confidence must not bypass approval on an irreversible change.', 60),

('fx_low_conf', 'review_gate', 'Thin evidence, honestly stated', 'low_confidence',
 jsonb_build_object(
   'title','Shorten the origin ceremony',
   'change_summary','Combine the candidate-selection and confirmation steps of the origin ceremony into one screen.',
   'affected_areas', jsonb_build_array('client/src/ui/origin/origin-flow.tsx'),
   'evidence', jsonb_build_array(jsonb_build_object('type','user_feedback','summary','One beta tester said the ceremony felt long','source','beta feedback','reliability','low')),
   'success_metrics', jsonb_build_array(jsonb_build_object('metric','origin_completed','measurementMethod','funnel step')),
   'confidence', 0.35,
   'confidence_reason','A single comment, no behavioural corroboration.'),
 'more_evidence_required', 'One comment is one comment. Honest about it, but not yet actionable.', 70),

('fx_conflict', 'review_gate', 'Two sources disagree', 'conflicting_evidence',
 jsonb_build_object(
   'title','Move the primary CTA above the upload row',
   'change_summary','On the AI screen, RUN ANALYSIS moves above the three physique upload slots.',
   'affected_areas', jsonb_build_array('client/src/app/(main)/ai.tsx'),
   'evidence', jsonb_build_array(
     jsonb_build_object('type','user_feedback','summary','A founder reported the button is off screen on a phone','reliability','medium'),
     jsonb_build_object('type','analytics','summary','The AI screen has the highest completion rate of any screen','source','analytics_events_real','reliability','high')),
   'success_metrics', jsonb_build_array(jsonb_build_object('metric','ai_analysis_started','measurementMethod','event count'))),
 'supported_with_revisions', 'The two sources point opposite ways. Proceed only with the disagreement recorded and a measurement that could settle it.', 80),

('fx_hist_success', 'review_gate', 'A historical decision that worked', 'historical_success',
 jsonb_build_object(
   'title','Excluded the lab account from activation_rate',
   'change_summary','analytics_events_real excludes accounts in command_synthetic_accounts.',
   'outcome','validated',
   'evidence', jsonb_build_array(jsonb_build_object('type','analytics','summary','The lab account produced 120 session_start events and walked the whole funnel','source','analytics_events','reliability','high'))),
 'supported', 'Kept as a positive example: a specific change, a measured effect, a named mechanism.', 90),

('fx_hist_failure', 'review_gate', 'A historical decision that did not work', 'historical_failure',
 jsonb_build_object(
   'title','Home: Primary CTA shift',
   'change_summary','Make the mission CTA larger and left-aligned, and add a Train shortcut.',
   'outcome','rejected',
   'evidence', jsonb_build_array(jsonb_build_object('type','inference','summary','A model looking at a screenshot judged the CTA insufficiently dominant','reliability','low'))),
 'rejected', 'PROP-013. Rejected because the premise — that the CTA was not already dominant — was wrong on inspection. Kept so the same suggestion is not re-raised.', 100)
on conflict (key) do update set
  input = excluded.input, expected_verdict = excluded.expected_verdict,
  expected_reason = excluded.expected_reason, category = excluded.category, ord = excluded.ord;

/* ── 4. Prompt promotion must beat the incumbent ────────────────────────── */

create or replace function public.command_promote_prompt_on_evidence(
  p_prompt text, p_version int, p_run_key text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_new numeric; v_live numeric; v_live_ver int; v_n int;
begin
  select version into v_live_ver from command_prompt_versions
   where prompt_key = p_prompt and is_live limit 1;

  select avg(quality), count(*) into v_new, v_n
    from command_bench_runs r
    join command_prompt_versions v on v.id = r.version_id
   where v.prompt_key = p_prompt and v.version = p_version and r.quality is not null;

  select avg(quality) into v_live
    from command_bench_runs r
    join command_prompt_versions v on v.id = r.version_id
   where v.prompt_key = p_prompt and v.version = v_live_ver and r.quality is not null;

  if v_n < 5 then
    raise exception 'command: %v% has only % scored run(s). A promotion on fewer than 5 is an anecdote',
      p_prompt, p_version, v_n;
  end if;
  if v_live is not null and v_new <= v_live then
    raise exception 'command: %v% scored % against the live v%''s % — not promoted. A version is promoted on measurement, never because it reads better',
      p_prompt, p_version, round(v_new,3), v_live_ver, round(v_live,3);
  end if;

  update command_prompt_versions set is_live = false where prompt_key = p_prompt and is_live;
  update command_prompt_versions
     set is_live = true, promoted_at = now(), promoted_over = v_live_ver,
         promotion_note = 'Mean quality ' || round(v_new,3) || ' over ' || v_n ||
                          ' scored runs vs ' || coalesce(round(v_live,3)::text, 'no incumbent') || ' (' || p_run_key || ')'
   where prompt_key = p_prompt and version = p_version;

  return jsonb_build_object('ok', true, 'prompt', p_prompt, 'version', p_version,
                            'mean_quality', round(v_new,3), 'beat', v_live_ver, 'runs', v_n);
end $$;

alter table command_playbooks         enable row level security;
alter table command_playbook_versions enable row level security;
alter table command_eval_suites       enable row level security;
alter table command_eval_fixtures     enable row level security;
alter table command_eval_results      enable row level security;
alter table command_knowledge_conflicts enable row level security;

drop policy if exists command_playbooks_read on command_playbooks;
create policy command_playbooks_read on command_playbooks for select using (is_founder());
drop policy if exists command_playbook_versions_read on command_playbook_versions;
create policy command_playbook_versions_read on command_playbook_versions for select using (is_founder());
drop policy if exists command_eval_suites_read on command_eval_suites;
create policy command_eval_suites_read on command_eval_suites for select using (is_founder());
drop policy if exists command_eval_fixtures_read on command_eval_fixtures;
create policy command_eval_fixtures_read on command_eval_fixtures for select using (is_founder());
drop policy if exists command_eval_results_read on command_eval_results;
create policy command_eval_results_read on command_eval_results for select using (is_founder());
drop policy if exists command_knowledge_conflicts_read on command_knowledge_conflicts;
create policy command_knowledge_conflicts_read on command_knowledge_conflicts for select using (is_founder());

grant execute on function public.command_promote_playbook(text, int, text) to authenticated;
grant execute on function public.command_validate_knowledge(uuid, text) to authenticated, service_role;
grant execute on function public.command_promote_prompt_on_evidence(text, int, text) to authenticated, service_role;

commit;

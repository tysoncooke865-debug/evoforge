-- 138 — A HOLE THE GATE OPENED, AND WHAT THE FIRST EVALUATION MEASURED
--
-- HOLE. Migration 137 routed originating_agent through command_agent_route, so
-- proposals raised by the SQL exec cycle stopped being attributed to the
-- archived 'exec' and started being attributed to 'orchestrator'. Correct.
--
-- But the orchestrator carries requires_review=false, because it is defined as
-- the layer that routes work and authors no conclusions. That is true of the
-- NEW pipeline and false of the OLD one: command_exec_cycle still promotes
-- backlog items into proposals under that key, and the moment 137 landed,
-- PROP-016's gate flipped from "not independently reviewed" to ok — not because
-- anything reviewed it, but because the agent it was attributed to had been
-- excused from review.
--
-- A refactor that silently drops a safety requirement is worse than the bug it
-- fixed. The orchestrator requires review for as long as it can raise a
-- proposal at all.
--
--
-- WHAT THE FIRST EVALUATION RUN MEASURED, RECORDED HONESTLY.
--
--   4/10 fixtures correct. 4/8 of the ones that SHOULD be caught were caught.
--
--   The failure is one-directional and diagnosable: the reviewer returned
--   more_evidence_required for six of the ten, including the deliberately
--   STRONG fixture. It is not agreeable — the failure mode LLM reviewers
--   usually have — it is indiscriminately severe, which is the same problem
--   wearing the opposite costume. A reviewer that says "more evidence" to
--   everything carries exactly as much information as one that says "supported"
--   to everything.
--
--   The cause is visible in review_playbook v1: it lists ten questions to ask
--   and never says which verdict a given answer implies. Faced with any gap at
--   all, the safest-sounding verdict wins.
--
--   v2 below adds the verdict-selection rules. It is written as a version and
--   is deliberately NOT promoted. command_promote_prompt_on_evidence and
--   command_promote_playbook both refuse a promotion without measurement, and
--   this file is not going to route around its own rule: v2 goes live when an
--   evaluation run beats 4/10, and not because it reads better.

begin;

/* ── 1. Close the hole ──────────────────────────────────────────────────── */

update command_agents
   set requires_review = true,
       limitations = limitations ||
         ' While command_exec_cycle can still raise proposals under this key, its output requires independent review like any other.'
 where key = 'orchestrator' and requires_review = false;

/* ── 2. The playbook that the evaluation says is wrong ──────────────────── */

insert into command_playbook_versions
  (playbook_key, version, body, reason, from_decisions, from_lessons, evidence_count, author, author_kind, promoted)
values
('review_playbook', 2,
'You are trying to DISPROVE this proposal. A review that agrees with everything
has not been performed — and neither has one that asks for more evidence every
time. Both carry the same amount of information as saying nothing.

WORK THROUGH, IN ORDER:
  1. Does every factual claim trace to an attached evidence item? Name the ones
     that do not, individually, quoting them.
  2. Is the evidence about EvoForge, or about fitness apps in general?
  3. Is it recent enough to still be true?
  4. Does PRIOR ART show this already shipped, already decided, or already in
     flight?
  5. Does the proposed action solve the stated problem, or an adjacent easier one?
  6. Is there a cheaper way to learn the same thing?
  7. Has correlation been read as causation?
  8. Is the success metric something the system can compute today?
  9. Is the stated confidence justified by what is attached?
 10. Which affected user group is not mentioned?

THEN PICK THE VERDICT BY THESE RULES, IN THIS ORDER. The first one that matches
is the verdict. Do not fall through to a safer-sounding one.

  duplicate — PRIOR ART shows an open proposal or an active work order covering
    the same change. This outranks every other consideration: say so and stop.

  already_implemented — PRIOR ART shows a shipped release covering it, or the
    capability demonstrably exists today.

  strategically_misaligned — it would work, and it is not what EvoForge is for.

  rejected — a central claim is unsupported and the proposal collapses without
    it, OR the change summary states a benefit rather than a change, OR the
    advice would read identically for any fitness app.

  more_evidence_required — the proposal is COHERENT and might well be right, but
    the decisive fact is absent and could be obtained. Use this when you would
    change your mind on one specific piece of evidence, and NAME that piece.
    Do not use it because a proposal is merely imperfect.

  supported_with_revisions — sound, and something specific must change first: a
    missing rollback plan, an unmeasurable metric, an unstated affected group, a
    disagreement between two sources that must be recorded before proceeding.
    An irreversible change with a sound case belongs here, not in
    more_evidence_required — the case is made, the safeguards are not.

  supported — the claims trace to the evidence, the metric is computable, the
    confidence matches what is attached. It need not be perfect. Name what you
    checked in validatedStrengths.

CALIBRATION. You were given a mechanical estimate of the confidence the attached
evidence supports. If your verdict disagrees with it by a wide margin, say why in
notes. A proposal whose claimed confidence far exceeds its supported confidence is
a rejection candidate; one where they agree is not automatically supported.

You have no authority to execute anything and you do not write proposals. Say what
is wrong; do not rewrite it into what you would have proposed.',
'Evaluation run eval-1785248161359 scored 4/10 on the review_gate suite. Six of ten came back more_evidence_required, including the strong fixture — the playbook lists questions and never says which verdict an answer implies, so the safest-sounding one won every time. v2 adds ordered verdict-selection rules.',
'{}', '{}', 0, 'Tyson', 'founder', false)
on conflict (playbook_key, version) do update set
  body = excluded.body, reason = excluded.reason;

comment on table command_playbook_versions is
  'Versioned operational guidance per agent. A version goes live only through command_promote_playbook, which requires a founder or two validated decisions — never because it reads better. v2 of review_playbook is authored and unpromoted pending an evaluation run that beats 4/10.';

commit;

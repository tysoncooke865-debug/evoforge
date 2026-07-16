/**
 * PROGRESSION_OVERHAUL P3 — the review's IO seam. `assembleReviewInputs`
 * is PURE over row shapes (vitest hits it directly); `runDueEvoReview`
 * does the reads/writes around domain/progression/evo-review.
 *
 * TRUST BOUNDARY (recorded in HANDOVER): the review computes client-side;
 * the DATABASE enforces the invariants that matter (peak ratchet +
 * starting write-once by trigger, snapshots immutable, bounds by check
 * constraints, RLS isolation). A user can only mis-rate THEMSELVES.
 * Competitive surfaces must NEVER read evo_rating_current as authority —
 * P7's rival-settle recomputes server-side, and any future Evo
 * leaderboard needs the same server recomputation + audit before launch
 * (the xp_drift-refusal doctrine, applied to ratings).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { calculateAestheticsScore } from '@/domain/progression/aesthetics-score';
import type { AerobicTestType } from '@/domain/progression/cardio-score';
import { runEvoReview, type ReviewInputs, type ReviewOutcome } from '@/domain/progression/evo-review';
import type { EvoState } from '@/domain/progression/evo-state';
import { EVO_RATING_MODEL_VERSION } from '@/domain/progression/model-versions';
import { deriveEvoDisplay } from '@/domain/progression/evo-rating';
import { applyConfirmedRating } from '@/domain/progression/evo-state';
import { calculatePlayerStats, determineEvoClass } from '@/domain/progression/player-stats';
import { calculateSizeScore } from '@/domain/progression/size-score';
import { determineTraitEligibility } from '@/domain/progression/traits';
import type { EvoPillars } from '@/domain/progression/types';
import { pyFloat } from '@/domain/py';
import { normaliseWorkoutLog, type WorkoutRow } from '@/domain/summary';
import { todayIso as calendarToday } from '@/domain/today';

export interface ReviewSourceRows {
  profile: {
    sex?: string | null;
    height_cm?: unknown;
    bodyweight_kg?: unknown;
  } | null;
  workoutRows: WorkoutRow[];
  latestBodyweightKg: number | null;
  latestBodyfat: { bf_low?: unknown; bf_high?: unknown; date?: unknown } | null;
  latestPhysique: {
    physique_score?: unknown;
    leanness_score?: unknown;
    symmetry_score?: unknown;
    muscularity_score?: unknown;
  } | null;
  cardioTests: { test_type: string; value: unknown; occurred_at: string; verified?: boolean }[];
  hasCardioTrainingHistory: boolean;
  priorState: EvoState | null;
  priorPillars: EvoPillars | null;
  /** The newest CONFIRMED guided scan SINCE the last review, if any —
   *  the only thing allowed to move Size/Aesthetics (spec §15B/§15C). */
  freshAssessment: {
    size_score?: unknown;
    aesthetics_score?: unknown;
    regional_scores?: unknown;
    proportions_score?: unknown;
    distribution_score?: unknown;
    symmetry_score?: unknown;
    confidence?: unknown;
    assessment_date?: unknown;
  } | null;
}

const AEROBIC_TYPES: ReadonlySet<string> = new Set([
  'run_1_5km', 'run_2_4km', 'run_5km', 'cooper_12min', 'row_2km', 'vo2max_wearable',
]);

/** Rows → ReviewInputs. Pure; every conversion defensive. */
export function assembleReviewInputs(rows: ReviewSourceRows, todayIso: string): ReviewInputs {
  const sex = rows.profile?.sex === 'female' ? ('female' as const) : ('male' as const);
  const bodyweight =
    rows.latestBodyweightKg ?? pyFloat(rows.profile?.bodyweight_kg) ?? (sex === 'female' ? 62 : 77);

  // Strength observations from the confirmed log — valid sets only.
  const strengthObservations = normaliseWorkoutLog(rows.workoutRows)
    .map((r) => ({
      exercise: String(r.exercise ?? ''),
      weightKg: pyFloat(r.weight) ?? 0,
      reps: Math.trunc(pyFloat(r.reps) ?? 0),
      date: String(r.date ?? ''),
    }))
    .filter((o) => o.exercise !== '' && o.weightKg > 0 && o.reps > 0 && o.date !== '');
  const lastStrengthIso =
    strengthObservations.length > 0
      ? strengthObservations.reduce((m, o) => (o.date > m ? o.date : m), '')
      : null;

  const bfLow = pyFloat(rows.latestBodyfat?.bf_low) ?? null;
  const bfHigh = pyFloat(rows.latestBodyfat?.bf_high) ?? null;

  const provisionalSize = calculateSizeScore({
    sex,
    heightCm: pyFloat(rows.profile?.height_cm) ?? null,
    bodyweightKg: bodyweight,
    bfLow,
    bfHigh,
    legacyMuscularity15: pyFloat(rows.latestPhysique?.muscularity_score) ?? null,
  });
  const provisionalAesthetics = calculateAestheticsScore({
    sex,
    bfLow,
    bfHigh,
    legacyPhysique15: pyFloat(rows.latestPhysique?.physique_score) ?? null,
    legacySymmetry15: pyFloat(rows.latestPhysique?.symmetry_score) ?? null,
    legacyLeanness15: pyFloat(rows.latestPhysique?.leanness_score) ?? null,
  });

  const aerobicTests = rows.cardioTests
    .filter((t) => AEROBIC_TYPES.has(t.test_type))
    .map((t) => ({
      testType: t.test_type as AerobicTestType,
      value: pyFloat(t.value) ?? 0,
      date: t.occurred_at,
      verified: t.verified === true,
    }))
    .filter((t) => t.value > 0);
  const capacity = rows.cardioTests.find((t) => t.test_type === 'work_capacity');
  const hrr = rows.cardioTests.find((t) => t.test_type === 'hr_recovery_1m');
  const lastCardioIso =
    rows.cardioTests.length > 0
      ? rows.cardioTests.reduce((m, t) => (t.occurred_at > m ? t.occurred_at : m), '')
      : null;

  return {
    todayIso,
    sex,
    fallbackBodyweightKg: bodyweight,
    priorState: rows.priorState,
    priorPillars: rows.priorPillars,
    strengthObservations,
    cardioEvidence: {
      sex,
      aerobicTests,
      workCapacityScore: capacity ? pyFloat(capacity.value) : null,
      hrRecovery1minBpm: hrr ? pyFloat(hrr.value) : null,
      hasCardioTrainingHistory: rows.hasCardioTrainingHistory,
      todayIso,
    },
    // A fresh guided scan re-derives Size/Aesthetics THROUGH the pillar
    // calculators (regional + FFMI evidence together); without one they
    // ride provisional-then-preserved.
    scanSize: rows.freshAssessment
      ? calculateSizeScore({
          sex,
          heightCm: pyFloat(rows.profile?.height_cm) ?? null,
          bodyweightKg: bodyweight,
          bfLow,
          bfHigh,
          regionalScores: (rows.freshAssessment.regional_scores ?? null) as Record<string, number> | null,
          scanCount: 1,
        })
      : null,
    scanAesthetics: rows.freshAssessment
      ? calculateAestheticsScore({
          sex,
          bfLow,
          bfHigh,
          proportionsScore: pyFloat(rows.freshAssessment.proportions_score),
          distributionScore: pyFloat(rows.freshAssessment.distribution_score),
          symmetryScore: pyFloat(rows.freshAssessment.symmetry_score),
          scanConsistent: true,
          scanCount: 1,
        })
      : null,
    provisionalSize,
    provisionalAesthetics,
    lastStrengthEvidenceIso: lastStrengthIso,
    lastCardioEvidenceIso: lastCardioIso,
  };
}

/** The stored current row → prior state + pillar stand-ins. */
export function priorFromCurrentRow(row: Record<string, unknown> | null): {
  state: EvoState | null;
  pillars: EvoPillars | null;
} {
  if (!row) return { state: null, pillars: null };
  const n = (k: string) => pyFloat(row[k]) ?? 0;
  const pillar = (score: number, confidence: number) => ({
    score,
    confidence,
    confidenceLabel: 'moderate' as const,
    evidenceCount: 0,
    missingEvidence: [],
    limitingFactors: [],
  });
  return {
    state: {
      currentRaw: n('raw_rating'),
      currentDisplayed: Math.trunc(n('displayed_rating')),
      evolutionProgress: Math.trunc(n('evolution_progress')),
      startingRaw: n('starting_raw_rating'),
      startingDisplayed: Math.trunc(n('starting_displayed')),
      peakRaw: n('peak_raw_rating'),
      peakDisplayed: Math.trunc(n('peak_displayed')),
      lifetimeEvolution: Math.trunc(n('lifetime_evolution')),
    },
    pillars: {
      size: pillar(n('size_score'), Math.trunc(n('size_confidence'))),
      aesthetics: pillar(n('aesthetics_score'), Math.trunc(n('aesthetics_confidence'))),
      strength: pillar(n('strength_score'), Math.trunc(n('strength_confidence'))),
      cardio: pillar(n('cardio_score'), Math.trunc(n('cardio_confidence'))),
    },
  };
}

export interface ReviewRunResult {
  ran: boolean;
  outcome: ReviewOutcome | null;
  reason: 'due' | 'first' | 'not_due' | 'forced';
}

/** Run the official review when due (or forced), persist everything. */
export async function runDueEvoReview(
  supabase: SupabaseClient,
  opts: { force?: boolean } = {}
): Promise<ReviewRunResult> {
  const today = calendarToday();

  const { data: currentRows } = await supabase.from('evo_rating_current').select('*').limit(1);
  const current = currentRows?.[0] ?? null;
  const due =
    !current ||
    !current.next_review_at ||
    Date.parse(current.next_review_at as string) <= Date.now();
  if (!due && !opts.force) return { ran: false, outcome: null, reason: 'not_due' };

  const [profileQ, workoutsQ, bodyweightQ, bodyfatQ, physiqueQ, cardioTestsQ, cardioLogQ, assessQ] =
    await Promise.all([
      supabase.from('profile').select('sex,height_cm,bodyweight_kg').limit(1),
      supabase.from('workout_log').select('date,workout,exercise,set,weight,reps,timestamp'),
      supabase.from('bodyweight_log').select('bodyweight,date').order('date', { ascending: false }).limit(1),
      supabase.from('bodyfat_log').select('bf_low,bf_high,date').order('date', { ascending: false }).limit(1),
      supabase.from('physique_ratings').select('physique_score,leanness_score,symmetry_score,muscularity_score').order('date', { ascending: false }).limit(1),
      supabase.from('cardio_evidence').select('test_type,value,occurred_at,verified'),
      supabase.from('cardio_log').select('date').limit(1),
      supabase
        .from('physique_assessments')
        .select('size_score,aesthetics_score,regional_scores,proportions_score,distribution_score,symmetry_score,confidence,assessment_date')
        .eq('status', 'confirmed')
        .order('assessment_date', { ascending: false })
        .limit(1),
    ]);

  // A scan only counts as FRESH when it postdates the last review.
  const lastReviewIso = current?.last_review_at ? String(current.last_review_at).slice(0, 10) : null;
  const newestAssessment = assessQ.data?.[0] ?? null;
  const freshAssessment =
    newestAssessment &&
    (!lastReviewIso || String(newestAssessment.assessment_date) >= lastReviewIso)
      ? newestAssessment
      : null;

  const prior = priorFromCurrentRow(current);
  const inputs = assembleReviewInputs(
    {
      profile: profileQ.data?.[0] ?? null,
      workoutRows: workoutsQ.data ?? [],
      latestBodyweightKg: pyFloat(bodyweightQ.data?.[0]?.bodyweight) ?? null,
      latestBodyfat: bodyfatQ.data?.[0] ?? null,
      latestPhysique: physiqueQ.data?.[0] ?? null,
      cardioTests: (cardioTestsQ.data ?? []) as ReviewSourceRows['cardioTests'],
      hasCardioTrainingHistory: (cardioLogQ.data ?? []).length > 0,
      priorState: prior.state,
      priorPillars: prior.pillars,
      freshAssessment,
    },
    today
  );

  const outcome = runEvoReview(inputs);
  const p = outcome.pillars;
  let r = outcome.rating;
  let s = outcome.state;
  const isFirst = current === null;

  // P9 IMPOSSIBLE-JUMP GATE (spec §46): a body does not move more than
  // ~8 rating points in one review period. Never secret: the clamp is
  // named in the changes AND flagged in the audit.
  const auditFlags: string[] = [];
  const MAX_JUMP = 8;
  if (!isFirst && prior.state && Math.abs(r.rawRating - prior.state.currentRaw) > MAX_JUMP) {
    const clamped =
      prior.state.currentRaw + Math.sign(r.rawRating - prior.state.currentRaw) * MAX_JUMP;
    auditFlags.push(`impossible_jump:${r.rawRating.toFixed(2)}->clamped:${clamped.toFixed(2)}`);
    const d = deriveEvoDisplay(clamped);
    r = { ...r, rawRating: clamped, displayedRating: d.displayedRating, evolutionProgress: d.evolutionProgress };
    s = applyConfirmedRating(prior.state, clamped);
    outcome.changes.push({
      pillar: r.limitingPillar,
      before: prior.state.currentRaw,
      after: clamped,
      note: 'Change capped this review — large movements confirm over consecutive reviews',
    });
  }

  const { data: snap, error: snapErr } = await supabase
    .from('evo_rating_snapshots')
    .insert({
      raw_rating: r.rawRating,
      displayed_rating: r.displayedRating,
      evolution_progress: r.evolutionProgress,
      size_score: p.size.score,
      aesthetics_score: p.aesthetics.score,
      strength_score: p.strength.score,
      cardio_score: p.cardio.score,
      confidence: r.overallConfidence,
      descriptor: r.descriptor,
      trigger_type: isFirst ? 'initial' : 'weekly_review',
      changes: outcome.changes,
      recommendations: outcome.recommendations,
      model_version: EVO_RATING_MODEL_VERSION,
    })
    .select('id')
    .limit(1);
  if (snapErr) throw snapErr;

  const nextReview = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const currentPayload = {
    raw_rating: r.rawRating,
    displayed_rating: r.displayedRating,
    evolution_progress: r.evolutionProgress,
    starting_raw_rating: s.startingRaw,
    starting_displayed: s.startingDisplayed,
    peak_raw_rating: s.peakRaw,
    peak_displayed: s.peakDisplayed,
    lifetime_evolution: s.lifetimeEvolution,
    size_score: p.size.score,
    aesthetics_score: p.aesthetics.score,
    strength_score: p.strength.score,
    cardio_score: p.cardio.score,
    size_confidence: p.size.confidence,
    aesthetics_confidence: p.aesthetics.confidence,
    strength_confidence: p.strength.confidence,
    cardio_confidence: p.cardio.confidence,
    overall_confidence: r.overallConfidence,
    confidence_label: r.confidenceLabel,
    descriptor: r.descriptor,
    status: r.overallConfidence >= 40 ? 'confirmed' : 'provisional',
    limiting_pillar: r.limitingPillar,
    last_review_at: new Date().toISOString(),
    next_review_at: nextReview,
    model_version: EVO_RATING_MODEL_VERSION,
  };
  const { error: upErr } = await supabase
    .from('evo_rating_current')
    .upsert(currentPayload, { onConflict: 'user_id' });
  if (upErr) throw upErr;

  // Pending evidence: this review consumed everything outstanding.
  await supabase
    .from('pending_evo_evidence')
    .update({ status: 'confirmed', reviewed_at: new Date().toISOString(), reason: `review ${snap?.[0]?.id ?? ''}` })
    .eq('status', 'pending');

  // Evolution Chapters (spec §15D): open the first on the first review;
  // close + roll over every 84 days. Failures never fail the review.
  try {
    await maintainChapters(supabase, String(snap?.[0]?.id ?? ''), today);
  } catch {
    /* next review retries */
  }

  // P8: Player Stats, Class, Traits refresh with every review; P9: the
  // audit row + analytics. All best-effort — never fail the review.
  try {
    const workoutRows = workoutsQ.data ?? [];
    const exposure = new Map<string, number>();
    const recentDays = new Set<string>();
    const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    let totalValidSets = 0;
    for (const row of workoutRows) {
      const w = pyFloat(row.weight) ?? 0;
      const reps = pyFloat(row.reps) ?? 0;
      if (!(w > 0 && reps > 0)) continue;
      totalValidSets += 1;
      const name = String(row.exercise ?? '');
      exposure.set(name, (exposure.get(name) ?? 0) + 1);
      const d = String(row.date ?? '').slice(0, 10);
      if (d >= cutoff) recentDays.add(d);
    }
    const technique = {
      totalValidSets,
      familiarExercises: [...exposure.values()].filter((n) => n >= 3).length,
      recentTrainingDays: recentDays.size,
    };
    const stats = calculatePlayerStats(p, technique);
    const cls = determineEvoClass({ pillars: p, technique: stats.technique });
    await supabase.from('player_stats').upsert(
      { ...stats, evo_class: cls.evoClass, class_rule_version: cls.ruleVersion, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    await supabase
      .from('evo_rating_current')
      .update({ evo_class: cls.evoClass })
      .not('user_id', 'is', null);

    const { data: forgeRow } = await supabase
      .from('user_progression')
      .select('current_momentum_weeks')
      .limit(1);
    const eligible = determineTraitEligibility(p, stats, Number(forgeRow?.[0]?.current_momentum_weeks ?? 0));
    for (const t of eligible) {
      await supabase
        .from('player_traits')
        .upsert(
          { trait_key: t.key, trait_tier: t.tier, source_pillar: t.sourcePillar, rule_version: t.ruleVersion },
          { onConflict: 'user_id,trait_key', ignoreDuplicates: true }
        );
    }

    await supabase.from('evo_rating_audit').insert({
      old_rating: prior.state?.currentRaw ?? null,
      new_rating: r.rawRating,
      trigger_type: isFirst ? 'initial' : 'weekly_review',
      snapshot_id: snap?.[0]?.id ?? null,
      flags: auditFlags,
    });
    const events: { event_name: string; props: Record<string, unknown> }[] = [
      { event_name: 'evo_review_completed', props: { rating: r.displayedRating, first: isFirst } },
    ];
    if (prior.state && r.displayedRating > prior.state.currentDisplayed) {
      events.push({ event_name: 'evo_rating_increased', props: { to: r.displayedRating } });
    }
    if (prior.state && r.displayedRating < prior.state.currentDisplayed) {
      events.push({ event_name: 'evo_rating_decreased', props: { to: r.displayedRating } });
    }
    if (s.peakRaw === r.rawRating && !isFirst) {
      events.push({ event_name: 'peak_rating_reached', props: { peak: s.peakDisplayed } });
    }
    for (const e of events) await supabase.from('analytics_events').insert(e);
  } catch {
    /* stats/audit/analytics are best-effort riders */
  }

  return { ran: true, outcome, reason: opts.force ? 'forced' : isFirst ? 'first' : 'due' };
}

const CHAPTER_DAYS = 84;

async function maintainChapters(supabase: SupabaseClient, snapshotId: string, todayIso: string): Promise<void> {
  if (!snapshotId) return;
  const { data } = await supabase
    .from('evolution_chapters')
    .select('id,chapter_number,started_at,ended_at,starting_snapshot_id')
    .order('chapter_number', { ascending: false })
    .limit(1);
  const newest = data?.[0] ?? null;

  if (!newest) {
    await supabase.from('evolution_chapters').insert({
      chapter_number: 1,
      started_at: todayIso,
      starting_snapshot_id: snapshotId,
    });
    return;
  }
  if (newest.ended_at) return; // already rolled; the open chapter is elsewhere

  const ageDays = Math.floor(
    (Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${String(newest.started_at).slice(0, 10)}T00:00:00Z`)) / 86_400_000
  );
  if (ageDays < CHAPTER_DAYS) return;

  // Close with an honest before/after summary from the two snapshots.
  const { data: snaps } = await supabase
    .from('evo_rating_snapshots')
    .select('id,displayed_rating,size_score,aesthetics_score,strength_score,cardio_score')
    .in('id', [String(newest.starting_snapshot_id), snapshotId]);
  const start = snaps?.find((s) => s.id === newest.starting_snapshot_id);
  const end = snaps?.find((s) => s.id === snapshotId);
  const summary =
    start && end
      ? {
          startingRating: start.displayed_rating,
          endingRating: end.displayed_rating,
          change: Number(end.displayed_rating) - Number(start.displayed_rating),
          pillars: {
            size: [start.size_score, end.size_score],
            aesthetics: [start.aesthetics_score, end.aesthetics_score],
            strength: [start.strength_score, end.strength_score],
            cardio: [start.cardio_score, end.cardio_score],
          },
        }
      : {};
  await supabase
    .from('evolution_chapters')
    .update({ ended_at: todayIso, ending_snapshot_id: snapshotId, summary })
    .eq('id', newest.id);
  await supabase.from('evolution_chapters').insert({
    chapter_number: Number(newest.chapter_number) + 1,
    started_at: todayIso,
    starting_snapshot_id: snapshotId,
  });
}

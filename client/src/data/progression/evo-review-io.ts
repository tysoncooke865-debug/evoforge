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
import { calculateSizeScore } from '@/domain/progression/size-score';
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
    // A guided scan (P6) supplies these; until then Size/Aesthetics ride
    // the provisional path on first review and are preserved afterwards.
    scanSize: null,
    scanAesthetics: null,
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

  const [profileQ, workoutsQ, bodyweightQ, bodyfatQ, physiqueQ, cardioTestsQ, cardioLogQ] =
    await Promise.all([
      supabase.from('profile').select('sex,height_cm,bodyweight_kg').limit(1),
      supabase.from('workout_log').select('date,workout,exercise,set,weight,reps,timestamp'),
      supabase.from('bodyweight_log').select('bodyweight,date').order('date', { ascending: false }).limit(1),
      supabase.from('bodyfat_log').select('bf_low,bf_high,date').order('date', { ascending: false }).limit(1),
      supabase.from('physique_ratings').select('physique_score,leanness_score,symmetry_score,muscularity_score').order('date', { ascending: false }).limit(1),
      supabase.from('cardio_evidence').select('test_type,value,occurred_at,verified'),
      supabase.from('cardio_log').select('date').limit(1),
    ]);

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
    },
    today
  );

  const outcome = runEvoReview(inputs);
  const p = outcome.pillars;
  const r = outcome.rating;
  const s = outcome.state;
  const isFirst = current === null;

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

  return { ran: true, outcome, reason: opts.force ? 'forced' : isFirst ? 'first' : 'due' };
}

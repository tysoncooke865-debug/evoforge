/**
 * ORIGIN ONBOARDING — the C-series (docs/ORIGIN_TEST_PLAN.md §C).
 *
 * Pins the pure candidate engine (domain/origin/candidates.ts) against the
 * calibration spec: determinism, exactly-three-distinct, resonant/destined/
 * anomaly semantics, shredder auto-resonance, invalid-input normalisation,
 * reason copy, and the recommendation rule.
 *
 * Falsification note (house doctrine): each behavioural block was verified
 * red by mutating the engine (e.g. dropping the tier-E outrank, the
 * adjacency walk, and the shredder age gate), then restored.
 */

import { describe, expect, it } from 'vitest';

import { generateCandidates } from '../candidates';
import { reasonText } from '../reasons';
import type { CalibrationInput, OriginId } from '../types';

const EMPTY: CalibrationInput = {
  sex: null,
  heightCm: null,
  bodyweightKg: null,
  benchE1rm: null,
  squatE1rm: null,
  deadliftE1rm: null,
  trainingYears: null,
  bfMid: null,
  bfAgeDays: null,
  nutritionPhase: null,
  primaryGoal: null,
  battleStyle: null,
  pillars: {},
};

/** Strong self-report male: bench 140 @ 80kg → strength affinity 18.8. */
const STRONG_SELF_REPORT: CalibrationInput = {
  ...EMPTY,
  sex: 'male',
  heightCm: 180,
  bodyweightKg: 80,
  benchE1rm: 140,
  nutritionPhase: 'maintaining',
};

function ids(result: ReturnType<typeof generateCandidates>): OriginId[] {
  return result.candidates.map((c) => c.originId);
}

function byType(result: ReturnType<typeof generateCandidates>, type: 'resonant' | 'destined' | 'anomaly') {
  const c = result.candidates.find((x) => x.recommendationType === type);
  if (!c) throw new Error(`missing ${type}`);
  return c;
}

describe('C-1 determinism', () => {
  it('identical inputs → deep-equal results, 3 runs', () => {
    const a = generateCandidates(STRONG_SELF_REPORT);
    const b = generateCandidates(STRONG_SELF_REPORT);
    const c = generateCandidates({ ...STRONG_SELF_REPORT, pillars: { ...STRONG_SELF_REPORT.pillars } });
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });
});

describe('C-2 exactly three DISTINCT candidates for every user shape', () => {
  const shapes: [string, CalibrationInput][] = [
    ['full-evidence', { ...EMPTY, pillars: { titan: { score: 72, confidence: 60 }, mass: { score: 55, confidence: 40 } } }],
    ['self-report-only', STRONG_SELF_REPORT],
    ['goal-only', { ...EMPTY, primaryGoal: 'fat_loss' }],
    ['empty', EMPTY],
  ];
  it.each(shapes)('%s', (_name, input) => {
    const r = generateCandidates(input);
    expect(r.candidates).toHaveLength(3);
    expect(new Set(ids(r)).size).toBe(3);
    expect(r.candidates.map((c) => c.recommendationType)).toEqual(['resonant', 'destined', 'anomaly']);
  });
});

describe('C-3 resonant reflects strengths', () => {
  it('high-strength self-report → titan resonant, HIGH_RELATIVE_STRENGTH', () => {
    const r = generateCandidates(STRONG_SELF_REPORT);
    const res = byType(r, 'resonant');
    expect(res.originId).toBe('titan');
    expect(res.reasonCodes[0]).toBe('HIGH_RELATIVE_STRENGTH');
    expect(res.score).toBeCloseTo(18.8, 1);
    expect(r.resonantSource).toBe('self_report');
  });

  it('tier E evidence outranks contradictory self-report', () => {
    const r = generateCandidates({
      ...STRONG_SELF_REPORT,
      pillars: { cardio: { score: 70, confidence: 30 } }, // affinity +22 > self-report titan +18.75
    });
    const res = byType(r, 'resonant');
    expect(res.originId).toBe('cardio');
    expect(res.reasonCodes[0]).toBe('HIGH_CARDIO_CAPACITY');
    expect(r.resonantSource).toBe('evidence');
  });

  it('evidence below the confidence gate does not compete', () => {
    const r = generateCandidates({
      ...STRONG_SELF_REPORT,
      pillars: { cardio: { score: 95, confidence: 24 } }, // below the 25 gate
    });
    expect(byType(r, 'resonant').originId).toBe('titan');
  });
});

describe('C-4 destined reflects goals', () => {
  it.each([
    ['strength', 'titan'],
    ['muscle_gain', 'mass'],
    ['fat_loss', 'shredder'],
    ['cardio', 'cardio'],
    ['aesthetics', 'aesthetic'],
  ] as const)('goal %s → %s offered', (goal, origin) => {
    const r = generateCandidates({ ...EMPTY, primaryGoal: goal });
    expect(ids(r)).toContain(origin);
    expect(new Set(ids(r)).size).toBe(3);
  });

  it('destined equals the mapped origin when resonant is elsewhere', () => {
    // resonant titan (self-report), goal muscle_gain → destined mass
    const r = generateCandidates({ ...STRONG_SELF_REPORT, primaryGoal: 'muscle_gain' });
    expect(byType(r, 'resonant').originId).toBe('titan');
    expect(byType(r, 'destined').originId).toBe('mass');
    expect(byType(r, 'destined').reasonCodes[0]).toBe('MUSCLE_GAIN_PRIMARY_GOAL');
  });

  it('collision with resonant walks the adjacency row', () => {
    // resonant titan (self-report) + goal strength → destined mass (strength row: titan, mass, aesthetic)
    const r = generateCandidates({ ...STRONG_SELF_REPORT, primaryGoal: 'strength' });
    expect(byType(r, 'resonant').originId).toBe('titan');
    expect(byType(r, 'destined').originId).toBe('mass');
    expect(byType(r, 'destined').reasonCodes[0]).toBe('STRENGTH_PRIMARY_GOAL');
  });

  it('missing goal → nutrition_phase fallback with PHASE_INFERRED_GOAL', () => {
    const r = generateCandidates({
      ...STRONG_SELF_REPORT, nutritionPhase: 'cutting', bfMid: 15, bfAgeDays: 10,
    });
    // resonant titan (self-report); no goal → cutting infers fat_loss → shredder
    expect(byType(r, 'destined').originId).toBe('shredder');
    expect(byType(r, 'destined').reasonCodes[0]).toBe('PHASE_INFERRED_GOAL');
  });
});

describe('C-5 anomaly is distinct and plausible', () => {
  it('secondary pillar case → UNTAPPED_*', () => {
    const r = generateCandidates({ ...STRONG_SELF_REPORT, primaryGoal: 'cardio' });
    // resonant titan (affinity 18.75), destined cardio, second affinity is mass (-1.0)
    expect(byType(r, 'anomaly').originId).toBe('mass');
    expect(byType(r, 'anomaly').reasonCodes[0]).toBe('UNTAPPED_SIZE');
  });

  it('battle_style case → style map + playstyle reason', () => {
    const r = generateCandidates({ ...EMPTY, primaryGoal: 'cardio', battleStyle: 'force' });
    // resonant cardio (fallback), destined walks cardio row → shredder, anomaly force → titan
    expect(byType(r, 'anomaly').originId).toBe('titan');
    expect(byType(r, 'anomaly').reasonCodes[0]).toBe('POWER_PLAYSTYLE');
  });

  it('ladder fallback case → CONTRAST_PATH', () => {
    const r = generateCandidates(EMPTY);
    expect(byType(r, 'anomaly').originId).toBe('cardio'); // ladder head
    expect(byType(r, 'anomaly').reasonCodes[0]).toBe('CONTRAST_PATH');
  });

  it('never equals resonant or destined across a sweep', () => {
    const goals = [null, 'strength', 'muscle_gain', 'fat_loss', 'cardio', 'aesthetics'] as const;
    const styles = [null, 'force', 'form', 'flow'] as const;
    const phases = [null, 'cutting', 'maintaining', 'bulking', 'flexible'] as const;
    for (const primaryGoal of goals) {
      for (const battleStyle of styles) {
        for (const nutritionPhase of phases) {
          const r = generateCandidates({
            ...STRONG_SELF_REPORT, primaryGoal, battleStyle, nutritionPhase,
          });
          expect(new Set(ids(r)).size).toBe(3);
        }
      }
    }
  });
});

describe('C-6 shredder auto-resonance', () => {
  it('cutting + fresh bf 24 male → shredder resonant, overriding evidence', () => {
    const r = generateCandidates({
      ...STRONG_SELF_REPORT, nutritionPhase: 'cutting', bfMid: 24, bfAgeDays: 5,
      pillars: { titan: { score: 80, confidence: 60 } },
    });
    const res = byType(r, 'resonant');
    expect(res.originId).toBe('shredder');
    expect(res.reasonCodes[0]).toBe('CUTTING_PHASE_HIGH_BF');
    expect(r.resonantSource).toBe('rule');
  });

  it('bf 15 → no auto (titan resonant)', () => {
    const r = generateCandidates({ ...STRONG_SELF_REPORT, nutritionPhase: 'cutting', bfMid: 15, bfAgeDays: 5 });
    expect(byType(r, 'resonant').originId).toBe('titan');
  });

  it('bulking → no auto', () => {
    const r = generateCandidates({ ...STRONG_SELF_REPORT, nutritionPhase: 'bulking', bfMid: 24, bfAgeDays: 5 });
    expect(byType(r, 'resonant').originId).not.toBe('shredder');
  });

  it('stale bf (>90d) → no auto', () => {
    const r = generateCandidates({ ...STRONG_SELF_REPORT, nutritionPhase: 'cutting', bfMid: 24, bfAgeDays: 120 });
    expect(byType(r, 'resonant').originId).toBe('titan');
  });
});

describe('C-7 missing/invalid inputs', () => {
  it('empty profile → three cards, BALANCED_ATHLETE present, no throw', () => {
    const r = generateCandidates(EMPTY);
    expect(new Set(ids(r)).size).toBe(3);
    expect(byType(r, 'resonant').reasonCodes[0]).toBe('BALANCED_ATHLETE');
  });

  it('negative lifts / bf 90 / height 0 normalise to absent', () => {
    const r = generateCandidates({
      ...EMPTY,
      heightCm: 0,
      bodyweightKg: -80,
      benchE1rm: -100,
      squatE1rm: Number.NaN,
      bfMid: 90,
      nutritionPhase: 'cutting',
      primaryGoal: 'aesthetics',
    });
    expect(new Set(ids(r)).size).toBe(3);
    expect(byType(r, 'resonant').reasonCodes[0]).toBe('BALANCED_ATHLETE');
  });

  it('cardio is NEVER resonant without evidence', () => {
    const r = generateCandidates(STRONG_SELF_REPORT); // self-report only
    expect(byType(r, 'resonant').originId).not.toBe('cardio');
  });
});

describe('C-8 reason copy', () => {
  it('every reason code has non-empty reasonText', () => {
    const codes = [
      'HIGH_RELATIVE_STRENGTH', 'HIGH_MUSCLE_SIZE', 'HIGH_CARDIO_CAPACITY', 'HIGH_LEANNESS',
      'HIGH_AESTHETIC_BALANCE', 'BALANCED_ATHLETE', 'CUTTING_PHASE_HIGH_BF',
      'STRENGTH_PRIMARY_GOAL', 'MUSCLE_GAIN_PRIMARY_GOAL', 'FAT_LOSS_PRIMARY_GOAL',
      'CARDIO_PRIMARY_GOAL', 'AESTHETIC_PRIMARY_GOAL', 'PHASE_INFERRED_GOAL',
      'POWER_PLAYSTYLE', 'PRECISION_PLAYSTYLE', 'TEMPO_PLAYSTYLE',
      'UNTAPPED_STRENGTH', 'UNTAPPED_SIZE', 'UNTAPPED_CARDIO', 'UNTAPPED_LEANNESS',
      'UNTAPPED_AESTHETICS', 'CONTRAST_PATH',
    ] as const;
    for (const code of codes) {
      expect(reasonText(code).length).toBeGreaterThan(0);
    }
  });
});

describe('C-9 recommendation rule', () => {
  it('recommended ∈ candidates, requiresChoice always true', () => {
    for (const input of [EMPTY, STRONG_SELF_REPORT]) {
      const r = generateCandidates(input);
      expect(ids(r)).toContain(r.recommendedOrigin);
      expect(r.requiresChoice).toBe(true);
      expect(r.version).toBe(5);
    }
  });

  it('recommended is resonant iff tier E backed it, else destined', () => {
    const evidence = generateCandidates({ ...EMPTY, pillars: { titan: { score: 70, confidence: 30 } } });
    expect(evidence.resonantSource).toBe('evidence');
    expect(evidence.recommendedOrigin).toBe(byType(evidence, 'resonant').originId);

    const selfReport = generateCandidates(STRONG_SELF_REPORT);
    expect(selfReport.resonantSource).toBe('self_report');
    expect(selfReport.recommendedOrigin).toBe(byType(selfReport, 'destined').originId);
  });
});

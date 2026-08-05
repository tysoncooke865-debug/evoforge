import { describe, expect, it } from 'vitest';

import { avatarRarity } from '../avatar-stats';
import { seedPlanForSplit } from '../exercise-library';
import {
  EXPERIENCE_LEVELS,
  GOAL_TO_PRIMARY,
  ONBOARDING_GOALS,
  recommendSplit,
  firstMissionDay,
  scheduleForSplit,
  splitDays,
  startingLevelV3,
  trainingYearsFor,
  type ExperienceLevel,
  type OnboardingGoal,
} from '../onboarding-v3';

describe('placement v3 — the claim is never worth more than the training', () => {
  it('rises with the experience band and never inverts', () => {
    const levels = EXPERIENCE_LEVELS.map(startingLevelV3);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels).size).toBe(levels.length);
  });

  it('never places an athlete above RARE — everything past that is earned', () => {
    for (const e of EXPERIENCE_LEVELS) {
      const rarity = avatarRarity(startingLevelV3(e)).name;
      expect(['COMMON', 'RARE']).toContain(rarity);
    }
  });

  it('a null experience places at the floor rather than throwing', () => {
    expect(startingLevelV3(null)).toBe(startingLevelV3('new'));
    expect(startingLevelV3('nonsense' as ExperienceLevel)).toBe(startingLevelV3('new'));
  });

  /**
   * THE POINT OF THE WHOLE REWRITE. V2 took physique from the AI scan or, on
   * a skip, from a derived default that capped at 10 — so declining a photo
   * cost real levels. V3 cannot express that, because it has no photo input
   * and no lift input at all. This test pins the ABSENCE.
   */
  it('depends on nothing but experience — no photo or lift can move it', () => {
    expect(startingLevelV3.length).toBe(1);
    for (const e of EXPERIENCE_LEVELS) {
      expect(startingLevelV3(e)).toBe(startingLevelV3(e));
    }
  });

  it('derives a training-years estimate that tracks the band', () => {
    const years = EXPERIENCE_LEVELS.map(trainingYearsFor);
    expect(years).toEqual([...years].sort((a, b) => a - b));
    expect(trainingYearsFor(null)).toBe(0);
  });
});

describe('goal vocabulary', () => {
  it('maps every goal, and maps the two origin-less goals to null', () => {
    for (const g of ONBOARDING_GOALS) {
      expect(GOAL_TO_PRIMARY).toHaveProperty(g);
    }
    expect(GOAL_TO_PRIMARY.be_consistent).toBeNull();
    expect(GOAL_TO_PRIMARY.track_program).toBeNull();
  });

  it('POSITIVE CONTROL: the four origin-relevant goals do map', () => {
    expect(GOAL_TO_PRIMARY.build_muscle).toBe('muscle_gain');
    expect(GOAL_TO_PRIMARY.get_stronger).toBe('strength');
    expect(GOAL_TO_PRIMARY.lose_fat).toBe('fat_loss');
    expect(GOAL_TO_PRIMARY.improve_fitness).toBe('cardio');
  });
});

describe('the plan recommender', () => {
  const every: { goal: OnboardingGoal | null; exp: ExperienceLevel | null; days: number }[] = [];
  for (const goal of [...ONBOARDING_GOALS, null]) {
    for (const exp of [...EXPERIENCE_LEVELS, null]) {
      for (let days = 1; days <= 7; days += 1) every.push({ goal, exp, days });
    }
  }

  it('always returns a split that can actually be seeded', () => {
    for (const c of every) {
      const key = recommendSplit({ goal: c.goal, experience: c.exp, daysPerWeek: c.days, equipment: 'full_gym' });
      expect(seedPlanForSplit(key), `${key} for ${JSON.stringify(c)}`).not.toBeNull();
    }
  });

  it('never hands a beginner a 5- or 6-day split', () => {
    for (let days = 1; days <= 7; days += 1) {
      const key = recommendSplit({ goal: 'build_muscle', experience: 'new', daysPerWeek: days, equipment: 'full_gym' });
      expect(splitDays(key).length).toBeLessThanOrEqual(4);
    }
  });

  it('keeps equipment-light athletes on full-body or upper/lower', () => {
    for (const equipment of ['bodyweight', 'home_basic'] as const) {
      for (let days = 1; days <= 7; days += 1) {
        const key = recommendSplit({ goal: 'build_muscle', experience: 'experienced', daysPerWeek: days, equipment });
        expect(['fb3', 'ul4']).toContain(key);
      }
    }
  });

  it('POSITIVE CONTROL: a full-gym experienced athlete DOES get the bigger splits', () => {
    expect(recommendSplit({ goal: 'build_muscle', experience: 'experienced', daysPerWeek: 6, equipment: 'full_gym' })).toBe('arnold6');
    expect(recommendSplit({ goal: 'get_stronger', experience: 'experienced', daysPerWeek: 4, equipment: 'full_gym' })).toBe('phul4');
  });

  it('survives a missing answer instead of returning nothing', () => {
    const key = recommendSplit({ goal: null, experience: null, daysPerWeek: null, equipment: null });
    expect(seedPlanForSplit(key)).not.toBeNull();
  });
});

describe('the week the split implies', () => {
  it('honours preferred days rather than asking and ignoring', () => {
    const plan = scheduleForSplit('fb3', [2, 4, 6]);
    expect(plan).not.toBeNull();
    const training = Object.entries(plan!).filter(([, d]) => d !== 'Rest').map(([dow]) => dow);
    expect(training.sort()).toEqual(['2', '4', '6']);
  });

  it('still produces a COMPLETE week when fewer days were chosen than the split needs', () => {
    const plan = scheduleForSplit('ppl3', [6]);
    expect(plan).not.toBeNull();
    const placed = Object.values(plan!).filter((d) => d !== 'Rest');
    expect(placed.sort()).toEqual(splitDays('ppl3').slice().sort());
    expect(plan!['6']).toBe(splitDays('ppl3')[0]);
  });

  it('falls back to the split default when no preference was given', () => {
    expect(scheduleForSplit('ul4', null)).toEqual(scheduleForSplit('ul4', []));
  });

  it('ignores impossible weekdays instead of writing them', () => {
    const plan = scheduleForSplit('fb3', [9, -1]);
    expect(plan).toEqual(scheduleForSplit('fb3', null));
  });

  it('returns null for a split that has no week', () => {
    expect(scheduleForSplit('custom', [1, 2])).toBeNull();
  });
});

describe('the first mission the reveal promises', () => {
  const week = scheduleForSplit('fb3', null)!; // Mon/Wed/Fri

  it('hands over TODAY when today is a training day', () => {
    expect(firstMissionDay(week, 1)).toEqual({ day: week['1'], inDays: 0 });
  });

  it('walks forward to the next training day, never back to the split start', () => {
    expect(firstMissionDay(week, 2)).toEqual({ day: week['3'], inDays: 1 });
    // Saturday: the next session is Monday, two days out — not last Monday.
    expect(firstMissionDay(week, 6)).toEqual({ day: week['1'], inDays: 2 });
  });

  it('survives a week with nothing in it', () => {
    const empty = Object.fromEntries([...Array(7).keys()].map((d) => [String(d), 'Rest']));
    expect(firstMissionDay(empty, 0)).toBeNull();
    expect(firstMissionDay(null, 0)).toBeNull();
  });
});

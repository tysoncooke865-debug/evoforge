/**
 * PAGE LAB pins:
 *  - registry metadata is well-formed (unique slugs, defaultMode ∈ modes) —
 *    a duplicate slug would silently shadow a variant in the URL space;
 *  - seedLabCache plants EVERY key in LAB_SEEDED_KEYS under [name, LAB_USER_ID]
 *    — an unseeded key silently degrades a mock variant to a network fetch,
 *    which is exactly the class of quiet rot this file exists to catch;
 *  - fixture history stays behind today, and every fully-logged day carries
 *    its finish marker (COMPLETED bars depend on it);
 *  - the lab workout href keeps the ONE-door param contract.
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { todayIso } from '../../domain/today';
import { LAB_SEEDED_KEYS, LAB_SEEDED_PARAM_KEYS, seedLabCache } from '../fixtures';
import { labEvoRating } from '../fixtures/athlete';
import { LAB_LEADERBOARD } from '../fixtures/social';
import { labSessionMarkers, labWorkoutLog } from '../fixtures/training';
import { LAB_USER_ID } from '../lab-user';
import { labWorkoutHref } from '../links';
import {
  labNutritionDates,
  labNutritionLog,
  labNutritionTargets,
  labNutritionTriple,
} from '../fixtures/nutrition';
import { LAB_PAGE_META } from '../registry-meta';
import { LAB_RESERVED_PARAMS, switcherExtras, switcherHref } from '../switcher-model';

describe('lab registry metadata', () => {
  it('page ids and variant slugs are unique and URL-safe', () => {
    const pageIds = LAB_PAGE_META.map((p) => p.id);
    expect(new Set(pageIds).size).toBe(pageIds.length);
    for (const page of LAB_PAGE_META) {
      const slugs = page.variants.map((v) => v.id);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('every variant defaults to a mode it supports', () => {
    for (const page of LAB_PAGE_META) {
      for (const v of page.variants) {
        expect(v.modes.length).toBeGreaterThan(0);
        expect(v.modes).toContain(v.defaultMode);
      }
    }
  });
});

describe('seedLabCache', () => {
  it('plants every required key under the lab user id', () => {
    const qc = new QueryClient();
    seedLabCache(qc);
    for (const name of LAB_SEEDED_KEYS) {
      expect(qc.getQueryData([name, LAB_USER_ID]), name).not.toBeUndefined();
    }
  });

  it('the seeded profile disarms Home\'s mount-time profile writes', () => {
    // Two live components write profile ON MOUNT when their field is null —
    // PhysiqueBaselineCard fires track('photo_baseline_prompted') without a
    // physique_baseline_at, and useReforgeDay lazily PATCHes a null
    // reforge_anchor_at. The second is the nastier one: signed out the
    // PATCH "succeeds" against zero rows and its onSuccess invalidation
    // refetches the seeded profile into RLS-empty null, un-hiding every
    // profile-gated surface mid-comparison. Non-null fields disarm both at
    // their own write-once gates.
    const qc = new QueryClient();
    seedLabCache(qc);
    const profile = qc.getQueryData(['profile', LAB_USER_ID]) as Record<string, unknown>;
    expect(profile.physique_baseline_at).not.toBeNull();
    expect(profile.reforge_anchor_at).not.toBeNull();
    expect(profile.last_reforge_at).not.toBeNull();
  });

  it('plants the param-carrying keys in full', () => {
    const qc = new QueryClient();
    seedLabCache(qc);
    for (const key of LAB_SEEDED_PARAM_KEYS) {
      // A near-miss (right name, wrong metric or row count) is the failure
      // this catches: the hook would silently fetch instead.
      expect(qc.getQueryData([...key]), JSON.stringify(key)).not.toBeUndefined();
    }
  });
});

describe('lab home fixtures', () => {
  const today = todayIso();

  it('the evo review countdown stays ahead of today (a stale one reads REVIEW READY)', () => {
    const row = labEvoRating(today);
    const next = Date.parse(String(row.next_review_at));
    const todayStart = Date.parse(`${today}T00:00:00Z`);
    expect(next).toBeGreaterThan(todayStart);
    expect(Date.parse(String(row.last_review_at))).toBeLessThan(todayStart);
  });

  it('the seeded board is numbered in the order it is rendered', () => {
    // rank_position is the RPC's server-side window numbering; rankByMetric
    // prefers it over array order, so a fixture that disagrees would paint a
    // board whose numbers jump.
    LAB_LEADERBOARD.forEach((row, i) => {
      expect(row.rank_position, String(row.display_name)).toBe(i + 1);
    });
  });
});

describe('lab training fixtures', () => {
  const today = todayIso();

  it('history stays strictly behind today (today must be fresh to log)', () => {
    for (const row of labWorkoutLog(today)) {
      expect(String(row.date) < today, String(row.date)).toBe(true);
    }
  });

  it('every logged day carries its finish marker, and vice versa', () => {
    const loggedDays = new Set(
      labWorkoutLog(today).map((r) => `${String(r.date)}|${String(r.workout)}`)
    );
    const markedDays = new Set(labSessionMarkers(today).map((m) => `${m.date}|${m.workout}`));
    expect(markedDays).toEqual(loggedDays);
  });
});

describe('lab fuel fixtures', () => {
  const today = todayIso();

  it('the stored triple IS the dual-rate computation (fixture and math cannot disagree)', () => {
    const [row] = labNutritionTargets(today);
    const triple = labNutritionTriple();
    expect(row.kcal_lose).toBe(triple.lose);
    expect(row.kcal_maintain).toBe(triple.maintain);
    expect(row.kcal_gain).toBe(triple.gain);
    expect(row.daily_kcal).toBe(triple.lose);
  });

  it('the target row is effective strictly behind today (targetInForce must find it)', () => {
    const [row] = labNutritionTargets(today);
    expect(row.effective_from < today).toBe(true);
  });

  it('every log entry is dated today (the meter reads the day key)', () => {
    for (const e of labNutritionLog(today)) expect(e.date).toBe(today);
  });

  it('the streak run is unbroken and ends at today', () => {
    const dates = labNutritionDates(today);
    expect(dates[dates.length - 1]).toBe(today);
    for (let i = 1; i < dates.length; i += 1) {
      const prev = Date.parse(`${dates[i - 1]}T00:00:00Z`);
      const cur = Date.parse(`${dates[i]}T00:00:00Z`);
      expect(cur - prev).toBe(86_400_000);
    }
  });
});

describe('labWorkoutHref', () => {
  it('keeps the ONE-door contract and encodes the workout name', () => {
    const href = labWorkoutHref(
      'baseline',
      { date: '2026-07-20', workout: 'Push 1 - Strength', source: 2 },
      'mock'
    );
    expect(href).toBe(
      '/lab/workout/baseline?date=2026-07-20&workout=Push%201%20-%20Strength&source=2&data=mock'
    );
  });
});

describe('switcher model', () => {
  it('forwards page-contract params, strips its own routing triple', () => {
    // The workout page's ONE-door params must ride a variant swap unchanged —
    // page/variant/data are the switcher's to rewrite, nothing else is.
    const href = switcherHref('workout', 'compact', 'mock', {
      page: 'workout',
      variant: 'baseline',
      data: 'mock',
      date: '2026-07-20',
      workout: 'Push 1 - Strength',
      source: '2',
    });
    expect(href).toBe(
      '/lab/workout/compact?date=2026-07-20&workout=Push%201%20-%20Strength&source=2&data=mock'
    );
  });

  it('keeps the CURRENT data mode on the swapped URL', () => {
    expect(switcherHref('home', 'baseline', 'real', {})).toBe(
      '/lab/home/baseline?data=real'
    );
  });

  it('collapses repeated params to their first value and drops undefined', () => {
    expect(switcherExtras({ date: ['a', 'b'], workout: undefined, source: '2' })).toEqual({
      date: 'a',
      source: '2',
    });
  });

  it('reserves exactly the routing triple', () => {
    // Reserving MORE than the triple would silently eat a page-contract
    // param; reserving less would duplicate routing state onto the query.
    expect([...LAB_RESERVED_PARAMS].sort()).toEqual(['data', 'page', 'variant']);
  });
});

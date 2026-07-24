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
import { LAB_SEEDED_KEYS, seedLabCache } from '../fixtures';
import { labSessionMarkers, labWorkoutLog } from '../fixtures/training';
import { LAB_USER_ID } from '../lab-user';
import { labWorkoutHref } from '../links';
import { LAB_PAGE_META } from '../registry-meta';

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

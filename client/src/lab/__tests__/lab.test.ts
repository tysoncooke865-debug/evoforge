/**
 * PAGE LAB pins:
 *  - registry metadata is well-formed (every page keeps its baseline anchor,
 *    codenames unique lab-wide, URL-safe slugs) — a duplicate slug would
 *    silently shadow a variant in the URL space;
 *  - seedLabCache plants EVERY key in LAB_SEEDED_KEYS under [name, LAB_USER_ID]
 *    — an unseeded key silently degrades a mock variant to a network fetch,
 *    which is exactly the class of quiet rot this file exists to catch;
 *  - fixture history stays behind today, and every fully-logged day carries
 *    its finish marker (COMPLETED bars depend on it);
 *  - the lab workout href keeps the ONE-door param contract;
 *  - the cull model is total — it parses during the gallery's render, so a
 *    corrupt localStorage entry must answer "nothing is culled", never throw.
 */
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import {
  LAB_CULL_STORAGE_KEY,
  batchCullKey,
  isBatchCulled,
  parseCulled,
  serializeCulled,
  withCulledBatch,
  withoutCulledBatch,
} from '../cull-model';
import { todayIso } from '../../domain/today';
import { LAB_SEEDED_KEYS, LAB_SEEDED_PARAM_KEYS, seedLabCache } from '../fixtures';
import { labEvoRating } from '../fixtures/athlete';
import { LAB_LEADERBOARD } from '../fixtures/social';
import { labScheduledWorkoutFor, labSessionMarkers, labWorkoutLog } from '../fixtures/training';
import { LAB_RECOVERY_RUN, LAB_REVEAL_STATE, labForgeCacheState } from '../fixtures/economy';
import { DEFAULT_REVEAL_TABLE, REVEAL_WEIGHT_TOTAL } from '../../domain/forge-reveal';
import { LAB_USER_ID } from '../lab-user';
import { labVariantHref, labWorkoutHref } from '../links';
import {
  labNutritionDates,
  labNutritionLog,
  labNutritionTargets,
  labNutritionTriple,
} from '../fixtures/nutrition';
import { LAB_AUTHOR_MODELS, LAB_PAGE_META } from '../registry-meta';
import {
  LAB_RESERVED_PARAMS,
  resolveBatchNumber,
  switcherExtras,
  switcherHref,
} from '../switcher-model';

describe('lab registry metadata', () => {
  const allVariants = (page: (typeof LAB_PAGE_META)[number]) => [
    page.baseline,
    ...page.batches.flatMap((b) => b.variants),
  ];

  it('page ids and variant slugs are unique and URL-safe', () => {
    const pageIds = LAB_PAGE_META.map((p) => p.id);
    expect(new Set(pageIds).size).toBe(pageIds.length);
    for (const page of LAB_PAGE_META) {
      const slugs = allVariants(page).map((v) => v.id);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('every page keeps its baseline as CURRENT, outside every batch', () => {
    // CURRENT is the comparison anchor: always present, never cullable,
    // never a member of a batch. A batch variant named `baseline` would
    // shadow it in the URL space.
    for (const page of LAB_PAGE_META) {
      expect(page.baseline.id, page.id).toBe('baseline');
      for (const batch of page.batches) {
        expect(batch.variants.map((v) => v.id), `${page.id} batch ${batch.number}`).not.toContain(
          'baseline'
        );
      }
    }
  });

  it('codenames are unique across the WHOLE lab, not just their page', () => {
    // The naming doctrine: only `baseline` repeats (it is namespaced by page
    // and means the same thing on each). Every other slug is a codename, so
    // "the compact one" names exactly one design in a review.
    const codenames = LAB_PAGE_META.flatMap((p) =>
      p.batches.flatMap((b) => b.variants.map((v) => v.id))
    );
    expect(new Set(codenames).size).toBe(codenames.length);
  });

  it('the batch counter contract holds on every page', () => {
    // Numbers are per-page, 1-based, unique, and never exceed the counter;
    // the counter is 0 EXACTLY when the page holds no batches — that is the
    // mechanical form of the reset rule: the deletion commit that empties a
    // page must zero lastBatchNumber in the same edit, and no commit may
    // zero it any earlier.
    for (const page of LAB_PAGE_META) {
      const numbers = page.batches.map((b) => b.number);
      expect(new Set(numbers).size, page.id).toBe(numbers.length);
      for (const n of numbers) {
        expect(Number.isInteger(n), `${page.id} batch ${n}`).toBe(true);
        expect(n, page.id).toBeGreaterThanOrEqual(1);
        expect(n, page.id).toBeLessThanOrEqual(page.lastBatchNumber);
      }
      if (page.batches.length === 0) {
        expect(page.lastBatchNumber, page.id).toBe(0);
      } else {
        expect(page.lastBatchNumber, page.id).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('batches list newest first and carry honest authorship', () => {
    const models = new Set<string>(Object.values(LAB_AUTHOR_MODELS));
    for (const page of LAB_PAGE_META) {
      for (let i = 1; i < page.batches.length; i += 1) {
        // Strictly descending: the gallery renders registry order verbatim.
        expect(page.batches[i].number, page.id).toBeLessThan(page.batches[i - 1].number);
      }
      for (const batch of page.batches) {
        const label = `${page.id} batch ${batch.number}`;
        expect(batch.dateIso, label).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(models.has(batch.model), `${label}: model must come from LAB_AUTHOR_MODELS`).toBe(
          true
        );
        expect(batch.description.length, label).toBeGreaterThan(0);
        expect(batch.variants.length, label).toBeGreaterThan(0);
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

describe('lab economy fixtures', () => {
  const today = todayIso();

  it('the cache state agrees with the schedule the week bars are drawn from', () => {
    // Both must answer "is today a rest day" the same way, or the card says
    // REST while the bars show a planned session. Derived, so it cannot drift.
    const s = labForgeCacheState(today);
    expect(s.today_is_rest).toBe(labScheduledWorkoutFor(today) === null);
    expect(s.today_plan).toBe(labScheduledWorkoutFor(today));
  });

  it('offers no action the lab would send to the real backend', () => {
    // CLAIM, CONFIRM REST DAY and the recovery claim are all un-shimmed real
    // mutations. The card's affordances are driven by exactly these fields,
    // so a fixture that flipped one would put a live write on screen.
    const s = labForgeCacheState(today);
    expect(s.claimable).toBe(false);
    expect(s.today_is_rest && !s.today_rest_confirmed).toBe(false);
    expect(LAB_RECOVERY_RUN.armed).toBe(false);
    expect(LAB_REVEAL_STATE.banked).toEqual([]);
  });

  it('the rung is a real count of the cycle, and never past the ladder', () => {
    const s = labForgeCacheState(today);
    expect(s.rung).toBe(s.adherent_this_cycle);
    expect(s.rung).toBeGreaterThan(0);
    expect(s.rung).toBeLessThanOrEqual(7);
    expect(s.trained_this_cycle).toBeLessThanOrEqual(s.adherent_this_cycle);
    expect(s.floor_met).toBe(s.trained_this_cycle >= s.training_floor);
  });

  it('the reveal odds ARE the shipped table, never a copy of it', () => {
    // Spec v5 §3: the odds on screen must be the odds the server offers.
    expect(LAB_REVEAL_STATE.table).toBe(DEFAULT_REVEAL_TABLE);
    expect(LAB_REVEAL_STATE.tableTotal).toBe(REVEAL_WEIGHT_TOTAL);
  });
});

describe('labWorkoutHref', () => {
  it('keeps the ONE-door contract and encodes the workout name', () => {
    const href = labWorkoutHref('baseline', {
      date: '2026-07-20',
      workout: 'Push 1 - Strength',
      source: 2,
    });
    expect(href).toBe(
      '/lab/workout/baseline?date=2026-07-20&workout=Push%201%20-%20Strength&source=2'
    );
  });
});

describe('labVariantHref', () => {
  it('carries no query string when the page has no contract params', () => {
    // The retired data-mode flag used to hang a `?` on every lab URL.
    expect(labVariantHref('home', 'baseline')).toBe('/lab/home/baseline');
  });
});

describe('switcher model', () => {
  it('forwards page-contract params, strips its own routing params', () => {
    // The workout page's ONE-door params must ride a variant swap unchanged —
    // page/variant are the switcher's to rewrite, nothing else is. A stale
    // ?data= from the two-mode era is dropped, never forwarded as an extra.
    const href = switcherHref('workout', 'compact', {
      page: 'workout',
      variant: 'baseline',
      data: 'mock',
      date: '2026-07-20',
      workout: 'Push 1 - Strength',
      source: '2',
    });
    expect(href).toBe(
      '/lab/workout/compact?date=2026-07-20&workout=Push%201%20-%20Strength&source=2'
    );
  });

  it('collapses repeated params to their first value and drops undefined', () => {
    expect(switcherExtras({ date: ['a', 'b'], workout: undefined, source: '2' })).toEqual({
      date: 'a',
      source: '2',
    });
  });

  it('reserves exactly the routing quadruple', () => {
    // Reserving MORE would silently eat a page-contract param; reserving
    // less would duplicate routing state onto the query. `data` is retired
    // but still reserved; `batch` is the strip's scope — both documented in
    // switcher-model.ts.
    expect([...LAB_RESERVED_PARAMS].sort()).toEqual(['batch', 'data', 'page', 'variant']);
  });

  it('re-appends the batch scope and never forwards a raw ?batch as an extra', () => {
    // The scope must survive the hop onto CURRENT and back, and a stale
    // ?batch from the URL must never ride as a page-contract param when the
    // strip has no scope.
    expect(
      switcherHref('home', 'baseline', { page: 'home', variant: 'glass', batch: '3' }, 3)
    ).toBe('/lab/home/baseline?batch=3');
    expect(switcherHref('home', 'baseline', { page: 'home', variant: 'glass', batch: '3' })).toBe(
      '/lab/home/baseline'
    );
  });

  it('resolveBatchNumber: membership wins, baseline trusts a valid param, garbage is null', () => {
    const page = {
      batches: [
        { number: 2, variants: [{ id: 'glass' }] },
        { number: 1, variants: [{ id: 'ember' }] },
      ],
    };
    // A codename's owning batch is the truth, whatever the URL claims.
    expect(resolveBatchNumber(page, 'glass', '1')).toBe(2);
    expect(resolveBatchNumber(page, 'ember', undefined)).toBe(1);
    // CURRENT belongs to no batch: the param decides, when it names a real one.
    expect(resolveBatchNumber(page, 'baseline', '2')).toBe(2);
    expect(resolveBatchNumber(page, 'baseline', ['1', '2'])).toBe(1);
    // TOTAL over garbage — this runs during the host's render.
    expect(resolveBatchNumber(page, 'baseline', undefined)).toBeNull();
    expect(resolveBatchNumber(page, 'baseline', '9')).toBeNull();
    expect(resolveBatchNumber(page, 'baseline', '0')).toBeNull();
    expect(resolveBatchNumber(page, 'baseline', '-1')).toBeNull();
    expect(resolveBatchNumber(page, 'baseline', 'x')).toBeNull();
  });
});

describe('cull model', () => {
  it('the storage key is the one the lab has always used', () => {
    // A rename would silently un-cull every design on every device.
    expect(LAB_CULL_STORAGE_KEY).toBe('evoforge-lab-culled');
  });

  it('reads back what it wrote', () => {
    const keys = withCulledBatch(withCulledBatch([], 'home', 3), 'fuel', 1);
    expect(parseCulled(serializeCulled(keys))).toEqual(['home/batch-3', 'fuel/batch-1']);
  });

  it('culling twice is idempotent', () => {
    const once = withCulledBatch([], 'home', 3);
    expect(withCulledBatch(once, 'home', 3)).toEqual(['home/batch-3']);
  });

  it('restoring removes only its own key', () => {
    const keys = withCulledBatch(withCulledBatch([], 'home', 3), 'home', 4);
    expect(withoutCulledBatch(keys, 'home', 3)).toEqual(['home/batch-4']);
    expect(isBatchCulled(withoutCulledBatch(keys, 'home', 3), 'home', 4)).toBe(true);
  });

  it('a same-numbered batch on another page is a different round', () => {
    // The keys are page-scoped: culling HOME's batch 1 must not hide
    // FUEL's batch 1.
    const keys = withCulledBatch([], 'home', 1);
    expect(isBatchCulled(keys, 'home', 1)).toBe(true);
    expect(isBatchCulled(keys, 'fuel', 1)).toBe(false);
  });

  it('the key grammar is exactly page/batch-<n>', () => {
    expect(batchCullKey('home', 12)).toBe('home/batch-12');
  });

  it('silently retires every pre-batch variant-scoped key', () => {
    // The 2026-09-04 grammar migration: the old era stored 'page/variant'
    // keys ('home/clarity'; even a hand-typed 'workout/baseline'). Nothing
    // legitimate lives in that shape any more — batches did not exist, and
    // baselines were never meant to be culled — so the parser drops them
    // without a storage version bump.
    const legacy = JSON.stringify(['home/clarity', 'workout/baseline', 'home/batch-2']);
    expect(parseCulled(legacy)).toEqual(['home/batch-2']);
  });

  it('rejects malformed batch keys individually', () => {
    // batch-0 (numbers are 1-based), a bare 'batch-', zero-padded and
    // non-numeric tails are all hand-edit shapes that must never widen
    // into a match.
    const raw = JSON.stringify([
      'home/batch-0',
      'home/batch-',
      'home/batch-01',
      'home/batch-x',
      'home/batch-3',
    ]);
    expect(parseCulled(raw)).toEqual(['home/batch-3']);
  });

  it('survives every shape of corrupt storage without throwing', () => {
    // This parses during the gallery's render — anything that throws here
    // blanks the lab, so every failure has to answer "nothing is culled".
    expect(parseCulled(null)).toEqual([]);
    expect(parseCulled('')).toEqual([]);
    expect(parseCulled('not json')).toEqual([]);
    expect(parseCulled('{"page":"home"}')).toEqual([]);
    expect(parseCulled('"home/batch-1"')).toEqual([]);
    expect(parseCulled(JSON.stringify(['home/batch-1', 42, null, 'a/b/c']))).toEqual([
      'home/batch-1',
    ]);
  });
});

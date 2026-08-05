import { describe, expect, it } from 'vitest';

import { FUEL_PROBES } from '../fixtures/fuel-probes';
// Same cross-root import the food-match suite already proves viable: the
// edge function's deterministic layer is pure and import-free.
import { matchFood } from '../../../../supabase/functions/meal-scan/food-match';

describe('FUEL_PROBES — the model-duel bench answer key', () => {
  it('is a non-empty list (a bench with no probes grades nothing)', () => {
    expect(FUEL_PROBES.length).toBeGreaterThan(0);
  });

  it('ids are unique and url-safe', () => {
    const ids = FUEL_PROBES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it('bands are sane: 0 < min < max, label and text present', () => {
    for (const p of FUEL_PROBES) {
      expect(p.kcal.min, p.id).toBeGreaterThan(0);
      expect(p.kcal.max, p.id).toBeGreaterThan(p.kcal.min);
      expect(p.label.length, p.id).toBeGreaterThan(0);
      expect(p.text.length, p.id).toBeGreaterThanOrEqual(3); // server 400s below 3
    }
  });

  it('every dbAnchor hits the deterministic table and lands inside its band', () => {
    const anchored = FUEL_PROBES.filter((p) => p.dbAnchor);
    expect(anchored.length).toBeGreaterThan(0); // the answer key must anchor SOMETHING
    for (const p of anchored) {
      const hit = matchFood(p.dbAnchor!.name);
      expect(hit, `${p.id}: matchFood('${p.dbAnchor!.name}') must hit`).not.toBeNull();
      // The server's own multiplication, exactly (meal-scan/index.ts totals).
      const kcal = Math.round((p.dbAnchor!.grams * hit!.per100.kcal) / 100);
      expect(kcal, `${p.id}: table says ${kcal}`).toBeGreaterThanOrEqual(p.kcal.min);
      expect(kcal, `${p.id}: table says ${kcal}`).toBeLessThanOrEqual(p.kcal.max);
    }
  });

  it('the headline raw-mince probe pins the historical bug band', () => {
    const p = FUEL_PROBES.find((x) => x.id === 'raw-mince')!;
    expect(p).toBeDefined();
    // 1250 (the old cooked-row failure) must FAIL this band; 880 must pass.
    expect(p.kcal.max).toBeLessThan(1250);
    expect(880).toBeGreaterThanOrEqual(p.kcal.min);
    expect(880).toBeLessThanOrEqual(p.kcal.max);
  });
});

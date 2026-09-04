import type { ComponentType } from 'react';

import { BUILT_IN_DAYS } from '@/data/use-day-plan';

import { LAB_PAGE_META } from './registry-meta';
import type { LabBatch, LabPage, LabPageId, LabVariant } from './types';
import { HomeBaseline } from './variants/home/baseline';
import { TrainBaseline } from './variants/train/baseline';
import { FuelBaseline } from './variants/fuel/baseline';
import { WorkoutBaseline } from './variants/workout/baseline';

/**
 * THE REGISTRY — every page the lab can fork, every batch and variant it
 * holds. Metadata lives in registry-meta.ts (pure, vitest-pinned); this file
 * joins it to the components. Static imports on purpose: tsc, expo lint and
 * verify-motion keep every registered variant honest on every CI run, and
 * the whole graph hangs off the async (lab) route chunks, so the entry
 * bundle never carries it.
 *
 * Adding a batch = fork the screen(s) (src/lab/README.md), a batch entry in
 * registry-meta.ts (number = the page's lastBatchNumber + 1, bump it in the
 * same edit), and one component entry below per take. A meta entry with no
 * component throws HERE, at lab load — in the gated dev surface, loudly,
 * never in production.
 */
const COMPONENTS: Record<string, ComponentType> = {
  'home/baseline': HomeBaseline,
  'train/baseline': TrainBaseline,
  'workout/baseline': WorkoutBaseline,
  'fuel/baseline': FuelBaseline,
};

/** Query params the gallery appends per page — the workout page's ONE-door
 *  contract (/workout?date&workout&source) must ride the lab URL too.
 *  BUILT_IN_DAYS[0] matches the seeded schedule's Monday. */
const EXAMPLE_PARAMS: Partial<Record<LabPageId, (todayIso: string) => Record<string, string>>> = {
  workout: (todayIso) => ({
    date: todayIso,
    workout: BUILT_IN_DAYS[0] ?? 'Push 1 - Strength',
    source: '2',
  }),
};

function join(pageId: string, meta: { id: string; title: string; description: string }): LabVariant {
  const component = COMPONENTS[`${pageId}/${meta.id}`];
  if (!component) {
    throw new Error(`PAGE LAB: no component registered for ${pageId}/${meta.id}`);
  }
  return { ...meta, component };
}

export const LAB_PAGES: readonly LabPage[] = LAB_PAGE_META.map((page) => {
  const baseline = join(page.id, page.baseline);
  const batches: readonly LabBatch[] = page.batches.map((batch) => ({
    ...batch,
    variants: batch.variants.map((v) => join(page.id, v)),
  }));
  return {
    id: page.id,
    title: page.title,
    exampleParams: EXAMPLE_PARAMS[page.id],
    baseline,
    batches,
    // Baseline first: the flat surface findLabVariant routes over, and the
    // order the strip's CURRENT-first rule mirrors.
    variants: [baseline, ...batches.flatMap((b) => b.variants)],
  };
});

export function findLabPage(page: string | undefined): LabPage | null {
  return LAB_PAGES.find((p) => p.id === page) ?? null;
}

export function findLabVariant(
  page: string | undefined,
  variant: string | undefined
): { page: LabPage; variant: LabVariant } | null {
  const p = findLabPage(page);
  const v = p?.variants.find((x) => x.id === variant);
  return p && v ? { page: p, variant: v } : null;
}

export function findLabBatch(page: LabPage, n: number): LabBatch | null {
  return page.batches.find((b) => b.number === n) ?? null;
}

/** The batch a variant belongs to — null for `baseline` (CURRENT belongs to
 *  none) and for unknown slugs. Membership is the truth the switcher scopes
 *  its strip by; the URL's ?batch is only needed when CURRENT is viewed. */
export function batchOfVariant(page: LabPage, variantId: string): LabBatch | null {
  return page.batches.find((b) => b.variants.some((v) => v.id === variantId)) ?? null;
}

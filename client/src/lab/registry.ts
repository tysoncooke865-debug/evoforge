import type { ComponentType } from 'react';

import { BUILT_IN_DAYS } from '@/data/use-day-plan';

import { LAB_PAGE_META } from './registry-meta';
import type { LabPage, LabPageId, LabVariant } from './types';
import { HomeBaseline } from './variants/home/baseline';
import { HomeClarity } from './variants/home/clarity';
import { HomeCommand } from './variants/home/command';
import { HomeSaga } from './variants/home/saga';
import { HomeStillness } from './variants/home/stillness';
import { TrainBaseline } from './variants/train/baseline';
import { WorkoutBaseline } from './variants/workout/baseline';
import { WorkoutCompact } from './variants/workout/compact';

/**
 * THE REGISTRY — every page the lab can fork, every variant it holds.
 * Metadata lives in registry-meta.ts (pure, vitest-pinned); this file joins
 * it to the components. Static imports on purpose: tsc, expo lint and
 * verify-motion keep every registered variant honest on every CI run, and
 * the whole graph hangs off the async (lab) route chunks, so the entry
 * bundle never carries it.
 *
 * Adding a variant = fork the screen (src/lab/README.md) + a meta entry +
 * a component entry below. A meta entry with no component throws HERE, at
 * lab load — in the gated dev surface, loudly, never in production.
 */
const COMPONENTS: Record<string, ComponentType> = {
  'home/baseline': HomeBaseline,
  'home/clarity': HomeClarity,
  'home/stillness': HomeStillness,
  'home/command': HomeCommand,
  'home/saga': HomeSaga,
  'train/baseline': TrainBaseline,
  'workout/baseline': WorkoutBaseline,
  'workout/compact': WorkoutCompact,
};

/** Query params the gallery appends per page — the workout page's ONE-door
 *  contract (/workout?date&workout&source) must ride the lab URL too.
 *  BUILT_IN_DAYS[0] matches the mock schedule's Monday and exists in every
 *  data mode. */
const EXAMPLE_PARAMS: Partial<Record<LabPageId, (todayIso: string) => Record<string, string>>> = {
  workout: (todayIso) => ({
    date: todayIso,
    workout: BUILT_IN_DAYS[0] ?? 'Push 1 - Strength',
    source: '2',
  }),
};

export const LAB_PAGES: readonly LabPage[] = LAB_PAGE_META.map((page) => ({
  ...page,
  exampleParams: EXAMPLE_PARAMS[page.id],
  variants: page.variants.map((variant): LabVariant => {
    const component = COMPONENTS[`${page.id}/${variant.id}`];
    if (!component) {
      throw new Error(`PAGE LAB: no component registered for ${page.id}/${variant.id}`);
    }
    return { ...variant, component };
  }),
}));

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

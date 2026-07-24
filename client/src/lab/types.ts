import type { ComponentType } from 'react';

/**
 * PAGE LAB — the dev-only variant gallery's registry types.
 *
 * A variant is a FORK of a live screen (see src/lab/README.md for the fork
 * workflow) registered under /lab/<page>/<variant>. Variants are committed to
 * the normal working branch — CI typechecks and lints them like any screen —
 * but the (lab) route group renders nothing outside __DEV__ / the lab deploy.
 */

/** REAL rides the app's own providers untouched (a lab workout IS a real
 *  workout); MOCK swaps in a seeded QueryClient + a fake session so the
 *  variant is interactive without a network or an account. */
export type LabDataMode = 'real' | 'mock';

export type LabPageId = 'train' | 'workout';

export interface LabVariant {
  /** URL slug, unique within its page: /lab/<page>/<id>. */
  id: string;
  title: string;
  /** One line: what is different about this take. */
  description: string;
  /** Which modes the variant supports. MOCK belongs here only when the
   *  variant's write paths are shimmed (lab/mock/mutations.ts) — an
   *  un-shimmed write in mock mode still talks to the real backend. */
  modes: readonly LabDataMode[];
  defaultMode: LabDataMode;
  component: ComponentType;
}

export interface LabPage {
  id: LabPageId;
  title: string;
  /** Query params the gallery appends when opening a variant — the workout
   *  page's /workout?date&workout&source contract must ride the lab URL too. */
  exampleParams?: (todayIso: string) => Record<string, string>;
  variants: readonly LabVariant[];
}

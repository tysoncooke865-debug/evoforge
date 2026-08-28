import type { ComponentType } from 'react';

/**
 * PAGE LAB — the dev-only variant gallery's registry types.
 *
 * A variant is a FORK of a live screen (see src/lab/README.md for the fork
 * workflow) registered under /lab/<page>/<variant>. Variants are committed to
 * the normal working branch — CI typechecks and lints them like any screen —
 * but the (lab) route group renders nothing outside __DEV__ / the lab deploy.
 *
 * Every variant runs on MOCK data: a seeded QueryClient under a fake session,
 * interactive with no network and no account. The old REAL mode (ride the
 * app's own providers) is gone — signed out it rendered empty states nobody
 * could judge a design by, and signed in a lab workout was a REAL workout.
 */

export type LabPageId = 'home' | 'train' | 'workout' | 'fuel';

export interface LabVariant {
  /** URL slug, unique within its page: /lab/<page>/<id>. Every page carries
   *  a `baseline` (the diff-anchor fork of the live screen); every other
   *  slug is a codename unique across the WHOLE lab, so a design is never
   *  confused with a same-named take on another page. Pinned by lab.test.ts. */
  id: string;
  title: string;
  /** One line: what is different about this take. */
  description: string;
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

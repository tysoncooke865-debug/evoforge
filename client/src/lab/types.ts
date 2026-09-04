import type { ComponentType } from 'react';

/**
 * PAGE LAB — the dev-only variant gallery's registry types.
 *
 * A variant is a FORK of a live screen (see src/lab/README.md for the fork
 * workflow) registered under /lab/<page>/<variant>. Variants are committed to
 * the normal working branch — CI typechecks and lints them like any screen —
 * but the (lab) route group renders nothing outside __DEV__ / the lab deploy.
 *
 * Since 2026-09-04 the unit of review is the BATCH: a group of takes on one
 * page authored together (one session's output). Every page carries exactly
 * one `baseline` fork — CURRENT, the deployed design, pinned to its live
 * source by scripts/lab-sync.mjs — and zero or more batches of redesigns.
 * CURRENT belongs to no batch and can never be culled.
 *
 * Every variant runs on MOCK data: a seeded QueryClient under a fake session,
 * interactive with no network and no account. The old REAL mode (ride the
 * app's own providers) is gone — signed out it rendered empty states nobody
 * could judge a design by, and signed in a lab workout WAS a real workout.
 */

export type LabPageId = 'home' | 'train' | 'workout' | 'fuel';

export interface LabVariant {
  /** URL slug, /lab/<page>/<id>: `baseline` for CURRENT, else a codename
   *  unique across the WHOLE lab, so a design is never confused with a
   *  same-named take on another page. Pinned by lab.test.ts. */
  id: string;
  title: string;
  /** One line: what is different about this take. */
  description: string;
  component: ComponentType;
}

/** One authored round of redesigns for one page — registry-meta.ts documents
 *  the numbering contract (per-page, monotonic, remembered across culls). */
export interface LabBatch {
  number: number;
  dateIso: string;
  model: string;
  description: string;
  variants: readonly LabVariant[];
}

export interface LabPage {
  id: LabPageId;
  title: string;
  /** Query params the gallery appends when opening a variant — the workout
   *  page's /workout?date&workout&source contract must ride the lab URL too. */
  exampleParams?: (todayIso: string) => Record<string, string>;
  /** CURRENT — the pinned fork of the deployed page. Never cullable. */
  baseline: LabVariant;
  /** Newest first (numbers strictly descending; lab.test.ts pins it). */
  batches: readonly LabBatch[];
  /** Flat lookup surface, baseline first — findLabVariant and the host key
   *  on slugs alone, so batch membership never complicates routing. */
  variants: readonly LabVariant[];
}

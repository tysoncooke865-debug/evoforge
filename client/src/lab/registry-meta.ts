import type { LabPageId } from './types';

/**
 * The registry's PURE half: everything about a variant except its component.
 * Split from registry.ts so the vitest suite can pin it (every page has a
 * baseline, codenames unique lab-wide, URL-safe slugs) without dragging the
 * React Native component graph into node — the same reason domain/ modules
 * import relatively.
 */

export interface LabVariantMeta {
  /** URL slug: /lab/<page>/<id>. `baseline` on every page; any other slug is
   *  a codename unique across the WHOLE lab (lab.test.ts pins both). */
  id: string;
  title: string;
  description: string;
}

export interface LabPageMeta {
  id: LabPageId;
  title: string;
  variants: readonly LabVariantMeta[];
}

export const LAB_PAGE_META: readonly LabPageMeta[] = [
  {
    id: 'home',
    title: 'HOME',
    variants: [
      {
        id: 'baseline',
        title: 'BASELINE',
        description:
          'Verbatim fork of the live character hub — the mission door opens the lab workout, and both mount-time writes are shimmed.',
      },
    ],
  },
  {
    id: 'train',
    title: 'TRAIN',
    variants: [
      {
        id: 'baseline',
        title: 'BASELINE',
        description:
          'Verbatim fork of the live Train hub — the diff-zero starting point for new takes.',
      },
    ],
  },
  {
    id: 'workout',
    title: 'WORKOUT',
    variants: [
      {
        id: 'baseline',
        title: 'BASELINE',
        description:
          'Verbatim fork of the live workout page — logging, finish and reopen are mock-safe.',
      },
    ],
  },
  {
    id: 'fuel',
    title: 'FUEL',
    variants: [
      {
        id: 'baseline',
        title: 'BASELINE',
        description:
          'Verbatim fork of the live Fuel page — target/log/delete writes shimmed; the AI intake is disabled in the lab.',
      },
    ],
  },
];

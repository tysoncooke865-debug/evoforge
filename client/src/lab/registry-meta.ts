import type { LabDataMode, LabPageId } from './types';

/**
 * The registry's PURE half: everything about a variant except its component.
 * Split from registry.ts so the vitest suite can pin it (unique slugs,
 * defaultMode ∈ modes) without dragging the React Native component graph
 * into node — the same reason domain/ modules import relatively.
 */

export interface LabVariantMeta {
  /** URL slug, unique within its page: /lab/<page>/<id>. */
  id: string;
  title: string;
  description: string;
  modes: readonly LabDataMode[];
  defaultMode: LabDataMode;
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
        modes: ['real', 'mock'],
        defaultMode: 'mock',
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
        modes: ['real', 'mock'],
        defaultMode: 'mock',
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
        modes: ['real', 'mock'],
        defaultMode: 'mock',
      },
      {
        id: 'compact',
        title: 'COMPACT',
        description:
          'Density redesign — collapsible cards, horizontal steppers, three-state LOG, no rest timer.',
        modes: ['real', 'mock'],
        defaultMode: 'mock',
      },
    ],
  },
];

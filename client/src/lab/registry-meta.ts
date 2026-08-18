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
      {
        id: 'clarity',
        title: 'CLARITY',
        description:
          'Legibility rebuilt, structure untouched — 10px type floor, AA contrast for every small label, a drawn pixel flame, honest drift copy, a visible crest affordance.',
        modes: ['real', 'mock'],
        defaultMode: 'mock',
      },
      {
        id: 'stillness',
        title: 'STILLNESS',
        description:
          'Motion halved to two living things — the champion breathes and today beats; every other idle loop is gone so the rating entrance is the only ceremony.',
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
          'Density redesign — collapsible cards, three-state LOG, prominent inline labels, no rest timer.',
        modes: ['real', 'mock'],
        defaultMode: 'mock',
      },
    ],
  },
];

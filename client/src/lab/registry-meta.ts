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
    id: 'fuel',
    title: 'FUEL',
    variants: [
      {
        id: 'model-duel',
        title: 'MODEL DUEL',
        description:
          'Describe/recipe accuracy bench — the same text through gpt-5.1 (live) and gpt-5.6 (test) in parallel, with latency, DB/AI provenance and known-answer probe grading. Display-only; nothing logs.',
        modes: ['real'],
        defaultMode: 'real',
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

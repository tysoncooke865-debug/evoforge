import type { LabPageId } from './types';

/**
 * The registry's PURE half: everything about a page and its batches except
 * the components. Split from registry.ts so the vitest suite can pin it
 * (the counter contract, baseline invariants, codenames unique lab-wide,
 * URL-safe slugs) without dragging the React Native component graph into
 * node — the same reason domain/ modules import relatively.
 *
 * ── THE BATCH NUMBERING CONTRACT (2026-09-04, vitest-pinned) ──
 *
 * Numbers are PER PAGE, 1-based, and MONOTONIC: `lastBatchNumber` is the
 * highest number ever used on that page, INCLUDING batches since culled and
 * deleted. If REDESIGN 8 and 9 existed and both were culled, the next batch
 * is 10 — a number names one historical round forever, so a review thread
 * that says "batch 8's second take" stays meaningful after the cull.
 *
 * The counter resets ONLY when a page's batch list becomes completely
 * empty, and the reset is enacted by the DELETION COMMIT that empties the
 * list (set `lastBatchNumber: 0` in the same edit) — the on-device cull
 * never touches this file. lab.test.ts pins `lastBatchNumber === 0` exactly
 * when `batches` is empty, so the commit that forgets either half goes red.
 */

export interface LabVariantMeta {
  /** URL slug: /lab/<page>/<id>. `baseline` is reserved for CURRENT; any
   *  other slug is a codename unique across the WHOLE lab (lab.test.ts
   *  pins both). */
  id: string;
  title: string;
  description: string;
}

/** One authored round of redesigns for one page. */
export interface LabBatchMeta {
  /** Per-page monotonic number — see the contract above. */
  number: number;
  /** The day the batch was authored, YYYY-MM-DD. Rendered verbatim in the
   *  gallery title: REDESIGN <number> FROM <dateIso>. */
  dateIso: string;
  /** The authoring model's display name — a value of LAB_AUTHOR_MODELS,
   *  never a freehand string (the pin keeps the gallery's "Made with …"
   *  line consistent across sessions). */
  model: string;
  /** One line: what this round was trying to achieve. When the authoring
   *  session cannot infer one, LAB_BATCH_DEFAULT_DESCRIPTION. */
  description: string;
  /** The takes. Codenames only — never `baseline`. */
  variants: readonly LabVariantMeta[];
}

export interface LabPageMeta {
  id: LabPageId;
  title: string;
  /** CURRENT — always present, never cullable, never inside a batch. Its
   *  file is pinned to the live source by scripts/lab-sync.mjs. */
  baseline: LabVariantMeta;
  /** The numbering contract's memory — doc comment at the top of this file. */
  lastBatchNumber: number;
  /** Newest first (numbers strictly descending). */
  batches: readonly LabBatchMeta[];
}

/** The models that have authored batches. Reference these from batch meta —
 *  adding a new model here is part of that batch's commit. */
export const LAB_AUTHOR_MODELS = {
  fable5: 'Claude Fable 5',
  opus5: 'Claude Opus 5',
} as const;

/** The honest shrug — used when a batch's goal genuinely cannot be put in
 *  one line. Prefer writing the line. */
export const LAB_BATCH_DEFAULT_DESCRIPTION = 'testing massive redesigns';

export const LAB_PAGE_META: readonly LabPageMeta[] = [
  {
    id: 'home',
    title: 'HOME',
    baseline: {
      id: 'baseline',
      title: 'CURRENT',
      description:
        'Verbatim fork of the live character hub — the mission door opens the lab workout, and both mount-time writes are shimmed.',
    },
    lastBatchNumber: 0,
    batches: [],
  },
  {
    id: 'train',
    title: 'TRAIN',
    baseline: {
      id: 'baseline',
      title: 'CURRENT',
      description:
        'Verbatim fork of the live Train hub — the diff-zero starting point for new takes.',
    },
    lastBatchNumber: 0,
    batches: [],
  },
  {
    id: 'workout',
    title: 'WORKOUT',
    baseline: {
      id: 'baseline',
      title: 'CURRENT',
      description:
        'Verbatim fork of the live workout page — logging, finish and reopen are mock-safe.',
    },
    lastBatchNumber: 0,
    batches: [],
  },
  {
    id: 'fuel',
    title: 'FUEL',
    baseline: {
      id: 'baseline',
      title: 'CURRENT',
      description:
        'Verbatim fork of the live Fuel page — target/log/delete writes shimmed; the AI intake is disabled in the lab.',
    },
    lastBatchNumber: 0,
    batches: [],
  },
];

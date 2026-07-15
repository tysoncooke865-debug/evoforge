/**
 * THE ADD-EXERCISE TAXONOMY (Tyson, 2026-07-14).
 *
 * The library is ~960 exercises. Nobody browses 960 of anything mid-set, so
 * everything here exists to NARROW: muscle groups (with subgroups), equipment,
 * category, difficulty — plus the aliases and abbreviations people actually
 * type ("rdl", "db incline", "skullcrusher").
 *
 * THE MUSCLE TAGS (19 since 2026-07-15: Tyson added Erectors and Abductors —
 * the muscle map has hand-drawn regions for both) are what every logged row
 * carries and what the substitution engine matches on. The avatar heat map is
 * UNAFFECTED by tag changes: it recomputes via the parity-pinned
 * inferMuscleGroup(name), never the stored tag. This file GROUPS the tags for
 * the UI; it does not redefine them.
 */

export type Equipment =
  | 'Barbell'
  | 'Dumbbell'
  | 'Cable'
  | 'Machine'
  | 'Smith Machine'
  | 'Bodyweight'
  | 'Band'
  | 'Kettlebell'
  | 'EZ Bar'
  | 'Other';

export type Category = 'Compound' | 'Isolation' | 'Other';
export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export interface LibraryExercise {
  name: string;
  /** One of the 17 tags. THE contract with the log and the heat map. */
  muscle: string;
  equipment?: Equipment;
  category?: Category;
  difficulty?: Difficulty;
  /** Other tags it also trains — used for ranking, never for attribution. */
  secondary?: readonly string[];
  /** 1–100, derived. Breaks ties in ranking; hides nothing. */
  popularity?: number;
}

/**
 * The primary chips. Each maps to the fine-grained tags it contains, and to the
 * SUBGROUPS shown only once it is selected — the spec's rule: do not show every
 * subgroup until its group is chosen.
 *
 * NOTE ON HONESTY: subgroups here are exactly the tags that EXIST — a chip
 * that always returns nothing teaches the athlete to ignore chips. Erectors
 * and Abductors joined 2026-07-15 WITH retagged exercises in the same commit;
 * Obliques / Rotator Cuff / Lower Abs still have no tagged exercises and so
 * still earn no chip.
 */
export interface MuscleGroup {
  key: string;
  label: string;
  /** The 17-tag values this group covers. Empty = matches everything. */
  muscles: readonly string[];
  /** Shown only when this group is selected. */
  subgroups: readonly { key: string; label: string; muscles: readonly string[] }[];
}

export const MUSCLE_GROUPS: readonly MuscleGroup[] = [
  { key: 'all', label: 'All', muscles: [], subgroups: [] },
  {
    key: 'chest',
    label: 'Chest',
    muscles: ['Chest', 'Upper Chest'],
    subgroups: [
      { key: 'chest-all', label: 'All Chest', muscles: ['Chest', 'Upper Chest'] },
      { key: 'chest-upper', label: 'Upper Chest', muscles: ['Upper Chest'] },
      { key: 'chest-mid', label: 'Mid Chest', muscles: ['Chest'] },
    ],
  },
  {
    key: 'back',
    label: 'Back',
    muscles: ['Back Width', 'Back Thickness', 'Traps', 'Rear Delts', 'Erectors'],
    subgroups: [
      { key: 'back-all', label: 'All Back', muscles: ['Back Width', 'Back Thickness', 'Traps', 'Rear Delts', 'Erectors'] },
      { key: 'back-lats', label: 'Lats', muscles: ['Back Width'] },
      { key: 'back-upper', label: 'Upper Back', muscles: ['Back Thickness'] },
      { key: 'back-traps', label: 'Traps', muscles: ['Traps'] },
      { key: 'back-rear', label: 'Rear Delts', muscles: ['Rear Delts'] },
      { key: 'back-erectors', label: 'Erectors', muscles: ['Erectors'] },
    ],
  },
  {
    key: 'shoulders',
    label: 'Shoulders',
    muscles: ['Front Delts', 'Side Delts', 'Rear Delts'],
    subgroups: [
      { key: 'sh-all', label: 'All Shoulders', muscles: ['Front Delts', 'Side Delts', 'Rear Delts'] },
      { key: 'sh-front', label: 'Front Delts', muscles: ['Front Delts'] },
      { key: 'sh-side', label: 'Side Delts', muscles: ['Side Delts'] },
      { key: 'sh-rear', label: 'Rear Delts', muscles: ['Rear Delts'] },
    ],
  },
  {
    key: 'arms',
    label: 'Arms',
    muscles: ['Biceps', 'Triceps', 'Forearms'],
    subgroups: [
      { key: 'arms-all', label: 'All Arms', muscles: ['Biceps', 'Triceps', 'Forearms'] },
      { key: 'arms-bi', label: 'Biceps', muscles: ['Biceps'] },
      { key: 'arms-tri', label: 'Triceps', muscles: ['Triceps'] },
      { key: 'arms-fore', label: 'Forearms', muscles: ['Forearms'] },
    ],
  },
  {
    key: 'legs',
    label: 'Legs',
    muscles: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors', 'Abductors'],
    subgroups: [
      { key: 'legs-all', label: 'All Legs', muscles: ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors', 'Abductors'] },
      { key: 'legs-quads', label: 'Quads', muscles: ['Quads'] },
      { key: 'legs-ham', label: 'Hamstrings', muscles: ['Hamstrings'] },
      { key: 'legs-glutes', label: 'Glutes', muscles: ['Glutes'] },
      { key: 'legs-calves', label: 'Calves', muscles: ['Calves'] },
      { key: 'legs-add', label: 'Adductors', muscles: ['Adductors'] },
      { key: 'legs-abd', label: 'Abductors', muscles: ['Abductors'] },
    ],
  },
  {
    key: 'core',
    label: 'Core',
    muscles: ['Abs'],
    subgroups: [{ key: 'core-all', label: 'All Core', muscles: ['Abs'] }],
  },
];

export const EQUIPMENT_OPTIONS: readonly Equipment[] = [
  'Barbell',
  'Dumbbell',
  'Cable',
  'Machine',
  'Smith Machine',
  'Bodyweight',
  'Band',
  'Kettlebell',
  'EZ Bar',
  'Other',
];

export const CATEGORY_OPTIONS: readonly Category[] = ['Compound', 'Isolation'];
export const DIFFICULTY_OPTIONS: readonly Difficulty[] = ['Beginner', 'Intermediate', 'Advanced'];

/**
 * What people TYPE versus what the exercise is CALLED. Every entry is a phrase
 * that should find a name it does not literally contain.
 *
 * Keys are matched as whole tokens against the normalised query; values are
 * substrings that must all appear in the exercise's searchable text.
 */
export const ALIASES: Readonly<Record<string, readonly string[]>> = {
  // abbreviations
  db: ['dumbbell'],
  bb: ['barbell'],
  ohp: ['overhead', 'press'],
  rdl: ['romanian', 'deadlift'],
  sldl: ['stiff-leg', 'deadlift'],
  bor: ['bent-over', 'row'],
  bp: ['bench', 'press'],
  dl: ['deadlift'],
  sq: ['squat'],
  pullup: ['pull-up'],
  pullups: ['pull-up'],
  chinup: ['chin-up'],
  chinups: ['chin-up'],
  pushup: ['push-up'],
  pushups: ['push-up'],
  situp: ['sit-up'],
  hs: ['hack', 'squat'],
  bss: ['bulgarian', 'split', 'squat'],
  // gym vernacular
  skullcrusher: ['skull crusher'],
  skullcrushers: ['skull crusher'],
  tricep: ['triceps'],
  bicep: ['biceps'],
  lats: ['lat'],
  quad: ['quads'],
  ham: ['hamstrings'],
  hams: ['hamstrings'],
  hammies: ['hamstrings'],
  delt: ['delts'],
  pecs: ['chest'],
  abs: ['abs'],
  calf: ['calves'],
  glute: ['glutes'],
  'lat machine': ['lat', 'pulldown'],
  latmachine: ['lat', 'pulldown'],
  pulldown: ['pulldown'],
  facepull: ['face pull'],
  hipthrust: ['hip thrust'],
  legpress: ['leg press'],
  legcurl: ['leg curl'],
  legext: ['leg extension'],
  latraise: ['lateral raise'],
  lateralraise: ['lateral raise'],
  reardelt: ['rear delts'],
  upperchest: ['upper chest'],
  incline: ['incline'],
  machine: ['machine'],
  cable: ['cable'],
};

/**
 * Search normalisation: lowercase, strip punctuation people do not type, fold
 * hyphens to spaces, and singularise the plurals that matter. "Dumbbell Bench
 * Press" and "db bench presses" must reach each other.
 */
export function normaliseTerm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[-_/(),.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens, with plurals folded. */
export function tokenise(s: string): string[] {
  return normaliseTerm(s)
    .split(' ')
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

/**
 * The muscle tags the CREATE flow offers, under their gym-familiar headings.
 * These are exactly the 17 tags that EXIST — offering a tag no exercise can
 * carry would be a chip that always returns nothing.
 */
export function muscleOptionsForCreate(): { label: string; muscles: readonly string[] }[] {
  return MUSCLE_GROUPS.filter((g) => g.key !== 'all').map((g) => ({
    label: g.label,
    muscles: g.muscles,
  }));
}

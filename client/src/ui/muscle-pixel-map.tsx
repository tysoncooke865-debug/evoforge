import Svg, { Rect } from 'react-native-svg';

import tokens from '@/theme/tokens';

/**
 * TRAIN_OVERHAUL — the hero card's pixel body: a front silhouette whose
 * regions light up for the sections today's workout targets.
 *
 * Purely presentational over a set of the six section labels
 * (Chest/Back/Shoulders/Arms/Legs/Abs — exercise-library's LIBRARY_SECTIONS
 * vocabulary, the same strings musclePillsFor emits). No data plumbing.
 *
 * The grid is hand-authored art (iterate against screenshots; the API is
 * stable): each cell carries a region code. Back gets the lat cells peeking
 * at the torso's edges — a front view is what a mirror shows, and lats are
 * the one back muscle a mirror admits to.
 */

// H head/neck (silhouette only) · S shoulders · C chest · A arms · B back
// (lat edges) · W abs/waist · L legs · '.' empty
const BODY = [
  '.....####.....',
  '.....####.....',
  '.....####.....',
  '......HH......',
  '.SSSCCCCCCSSS.',
  '.AACCCCCCCCAA.',
  '.AACCCCCCCCAA.',
  '.AABCCCCCCBAA.',
  '.AABCCCCCCBAA.',
  '.AABWWWWWWBAA.',
  '.AA.WWWWWW.AA.',
  '.AA.WWWWWW.AA.',
  '.AA.WWWWWW.AA.',
  '..A.WWWWWW.A..',
  '....LLLLLL....',
  '....LLLLLL....',
  '....LLLLLL....',
  '....LL..LL....',
  '....LL..LL....',
  '....LL..LL....',
  '....LL..LL....',
  '....LL..LL....',
  '....LL..LL....',
  '....LL..LL....',
  '....LL..LL....',
  '...LLL..LLL...',
] as const;

const REGION_SECTION: Readonly<Record<string, string>> = {
  S: 'Shoulders',
  C: 'Chest',
  A: 'Arms',
  B: 'Back',
  W: 'Abs',
  L: 'Legs',
};

const ROWS = BODY.length;
const COLS = BODY[0].length;

export function MusclePixelMap({
  targeted,
  height = 156,
  testID = 'muscle-pixel-map',
}: {
  /** Section labels today's workout trains — musclePillsFor's output. */
  targeted: ReadonlySet<string>;
  height?: number;
  testID?: string;
}) {
  const cell = height / ROWS;
  const width = cell * COLS;

  const base: { x: number; y: number }[] = [];
  const lit: { x: number; y: number }[] = [];
  BODY.forEach((row, y) => {
    for (let x = 0; x < COLS; x++) {
      const code = row[x];
      if (code === '.') continue;
      const section = REGION_SECTION[code];
      if (section && targeted.has(section)) lit.push({ x, y });
      else base.push({ x, y });
    }
  });

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${COLS} ${ROWS}`} testID={testID}>
      {base.map((c) => (
        <Rect key={`b${c.x},${c.y}`} x={c.x} y={c.y} width={1.06} height={1.06} fill={tokens.colors['surface-3']} />
      ))}
      {/* Soft halo UNDER the lit cell — the cell-shade glow. */}
      {lit.map((c) => (
        <Rect
          key={`h${c.x},${c.y}`}
          x={c.x - 0.22}
          y={c.y - 0.22}
          width={1.5}
          height={1.5}
          fill={`${tokens.colors.accent}59`}
        />
      ))}
      {lit.map((c) => (
        <Rect key={`l${c.x},${c.y}`} x={c.x} y={c.y} width={1.06} height={1.06} fill={tokens.colors.accent} />
      ))}
    </Svg>
  );
}

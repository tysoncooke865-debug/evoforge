/**
 * EvoForge Arena visual direction: dark cyberpunk, cyan / electric-blue
 * highlights, strong readable typography, pixel-inspired accents.
 * All colors come from here — no inline hex values in screens.
 *
 * P7: the pixel display faces are EvoForge's own Jersey 10/25 — loaded
 * app-wide by the root layout from src/theme/fonts.ts. The FAMILY NAMES are
 * pinned here as strings rather than importing that module: fonts.ts
 * require()s .ttf assets, which the node test environment cannot parse, and
 * the arena package deliberately keeps its out-of-package import surface
 * minimal (see the P13 isolation inventory). If src/theme/fonts.ts ever
 * renames a family, update these two strings.
 */
const PIXEL = 'Jersey10';
const PIXEL_BOLD = 'Jersey25';

export const colors = {
  // Base surfaces
  bg: '#070B12',
  surface: '#0D1420',
  surfaceRaised: '#131C2C',
  border: '#1E2C42',

  // Brand
  cyan: '#22D3EE',
  electricBlue: '#3B82F6',
  cyanDim: '#0E7490',

  // Text
  text: '#E6F1FF',
  textDim: '#8FA3BF',
  textFaint: '#5A6B85',

  // Semantic
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  /** Shield-absorbed damage (P4): pale steel-blue — cool like the team cyan
   *  family but visibly "not a health hit" next to danger red / warn amber. */
  shield: '#A9C6E8',

  // Team colors in battle
  player: '#22D3EE',
  opponent: '#F87171',

  // Path identity colors — one per official Avatar Path (BranchV2 slugs).
  // Mass is fuchsia: readable on bg #070B14 and clearly distinct from both
  // titan amber and the opponent/danger red.
  pathAesthetic: '#34D399',
  pathTitan: '#F59E0B',
  pathMass: '#E879F9',
  pathShredder: '#A78BFA',
  // P7 readability fix: was '#22D3EE', IDENTICAL to `cyan`/`player` — a
  // Cardio champion fielded by the OPPONENT wore the exact hue that means
  // "this is my team" everywhere else on the screen (the champion sprite is
  // path-tinted, not team-tinted; only the thin border/health-bar ring
  // carried team color). Indigo keeps a cool "cardio" feel while reading as
  // clearly distinct from both team colors and every other path.
  pathCardio: '#818CF8',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
} as const;

export const typography = {
  title: { fontSize: 28, fontWeight: '800' as const, letterSpacing: 1 },
  heading: { fontSize: 20, fontWeight: '700' as const, letterSpacing: 0.5 },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const, letterSpacing: 0.5 },
  mono: { fontSize: 12, fontFamily: 'monospace' },
  /** P7 — the EvoForge pixel display faces, for game-feel moments (timer,
   *  banners, big numerals). Jersey has no bold cut: weight lives in the
   *  face itself, so fontWeight stays 'normal' wherever these are used. */
  pixel: { fontFamily: PIXEL, fontWeight: 'normal' as const },
  pixelBold: { fontFamily: PIXEL_BOLD, fontWeight: 'normal' as const },
} as const;

export function pathColor(path: string): string {
  switch (path) {
    case 'aesthetic':
      return colors.pathAesthetic;
    case 'titan':
      return colors.pathTitan;
    case 'mass':
      return colors.pathMass;
    case 'shredder':
      return colors.pathShredder;
    case 'cardio':
      return colors.pathCardio;
    default:
      return colors.textDim;
  }
}

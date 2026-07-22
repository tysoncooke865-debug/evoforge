/**
 * EvoForge Arena visual direction: dark cyberpunk, cyan / electric-blue
 * highlights, strong readable typography, pixel-inspired accents.
 * All colors come from here — no inline hex values in screens.
 */

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

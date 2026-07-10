/**
 * EvoForge design tokens — the 56 custom properties of `assets/styles.css :root`,
 * value-for-value. THE MIGRATION CONTRACT SAYS EVERY TOKEN *VALUE* SURVIVES
 * UNCHANGED; this file is where that promise is kept.
 *
 * CommonJS on purpose: `tailwind.config.js` (Node) requires it and TypeScript
 * imports it (allowJs is on in expo/tsconfig.base), so every colour, radius and
 * duration exists in exactly one place. The Streamlit app had four :root blocks
 * once; never again.
 *
 * `client/scripts/verify-tokens.mjs` diffs this file against the live
 * `assets/styles.css :root` and fails CI on any mismatch, either direction.
 * Change a value there, change it here, or the build goes red.
 *
 * Two rarity palettes knowingly coexist (see MIGRATION_PLAN.md "What stays
 * exactly as-is"): `colors.rarity` below is the CSS aura palette; the badge
 * palette lives in the ported `domain/avatarStats.ts` (`avatarRarity`), exactly
 * as it does in Python today. Unifying them is a product decision, not a port.
 */

const colors = {
  // surfaces
  bg: '#070b14',
  'bg-deep': '#04070e',
  surface: '#0d1524',
  'surface-2': '#131d31',
  'surface-3': '#1a2740',
  border: '#22314f',
  'border-soft': 'rgba(120, 170, 220, 0.12)',
  'border-strong': 'rgba(34, 211, 238, 0.34)',

  // text
  text: '#e8f2fb',
  'text-dim': '#93a6c4',
  'text-mute': '#64758f',

  // accent
  accent: '#22d3ee',
  'accent-strong': '#67e8f9',
  'accent-deep': '#0891b2',
  'accent-ink': '#04121a',

  // rarity (the CSS aura palette — see header note)
  common: '#94a3b8',
  rare: '#38bdf8',
  epic: '#a855f7',
  legendary: '#fbbf24',
  mythic: '#f472b6',

  // semantic
  success: '#34d399',
  warn: '#fbbf24',
  danger: '#fb7185',
};

// spacing (4px base). Identical to Tailwind's default numeric scale at these
// keys (s4 = 16px = Tailwind `4`), kept named so a grep for s6 finds both sides.
const spacing = {
  s1: '4px',
  s2: '8px',
  s3: '12px',
  s4: '16px',
  s5: '20px',
  s6: '24px',
  s8: '32px',
  s10: '40px',
  s12: '48px',
};

const radius = {
  sm: '8px',
  md: '12px',
  lg: '18px',
  xl: '26px',
  pill: '999px',
};

// type scale (mobile-first). At >=640px the CSS bumps 2xl -> 2.1rem and
// 3xl -> 2.8rem; that lives in fontSizeDesktop, applied by the sm: variant.
const fontSize = {
  '2xs': '.68rem',
  xs: '.75rem',
  sm: '.85rem',
  base: '1rem',
  lg: '1.18rem',
  xl: '1.5rem',
  '2xl': '1.9rem',
  '3xl': '2.4rem',
};

const fontSizeDesktop = {
  '2xl': '2.1rem',
  '3xl': '2.8rem',
};

const shadow = {
  1: '0 2px 8px rgba(0, 0, 0, .3)',
  2: '0 8px 24px rgba(0, 0, 0, .42)',
  3: '0 20px 48px rgba(0, 0, 0, .55)',
};

// Neon policy — glow is a signal, not decoration. ALLOWED: primary CTAs, active
// nav, XP/progress fills, rarity badges, avatar aura, unlock moments. BANNED:
// body text, table rows, form inputs, labels, captions.
const glow = {
  sm: '0 0 12px rgba(34, 211, 238, .28)',
  md: '0 0 22px rgba(34, 211, 238, .38)',
  lg: '0 0 40px rgba(34, 211, 238, .48)',
};

// motion (durations in ms, numeric for Reanimated; easings as cubic-bezier pairs)
const duration = {
  fast: 120,
  base: 220,
  slow: 420,
};

const easing = {
  // --ease
  base: [0.22, 0.61, 0.36, 1],
  // --ease-out
  out: [0.16, 1, 0.3, 1],
};

module.exports = {
  colors,
  spacing,
  radius,
  fontSize,
  fontSizeDesktop,
  shadow,
  glow,
  duration,
  easing,
};

const tokens = require('./src/theme/tokens');

// THE PALETTE SHOP (2026-07-17): every colour utility resolves through a CSS
// custom property with the standard value as its fallback. Unset vars = the
// standard look, byte-identical; ThemeRoot sets the vars when an athlete
// equips (or previews) a bought palette, and every already-mounted screen
// restyles without a re-render. NativeWind v4 resolves var()+fallback on
// native too, so this holds on both platforms.
// CONSTRAINT this creates: Tailwind cannot alpha-transform a var() colour, so
// colour classes with opacity modifiers (e.g. `border-danger/40`) silently
// stop generating — use an inline hex-alpha suffix instead (the app idiom).
// Pinned by src/theme/__tests__/palettes.test.ts.
const themedColors = Object.fromEntries(
  Object.entries(tokens.colors).map(([k, v]) => [k, `var(--c-${k}, ${v})`])
);

/** @type {import('tailwindcss').Config} */
module.exports = {
  // NativeWind v4 compiles Tailwind 3. Only files listed here are scanned for
  // class names -- a class used in a file outside these globs silently produces
  // no style rather than an error.
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      // Every value comes from src/theme/tokens.js -- one copy, verified against
      // assets/styles.css :root by scripts/verify-tokens.mjs. Extend, not replace:
      // Tailwind's default numeric spacing scale already equals the EvoForge
      // 4px-base s-scale (s4 = 16px = `4`), so both spellings work.
      colors: themedColors,
      spacing: tokens.spacing,
      borderRadius: tokens.radius,
      fontSize: tokens.fontSize,
      boxShadow: {
        1: tokens.shadow[1],
        2: tokens.shadow[2],
        3: tokens.shadow[3],
        'glow-sm': tokens.glow.sm,
        'glow-md': tokens.glow.md,
        'glow-lg': tokens.glow.lg,
      },
      transitionDuration: {
        fast: `${tokens.duration.fast}ms`,
        DEFAULT: `${tokens.duration.base}ms`,
        slow: `${tokens.duration.slow}ms`,
      },
      transitionTimingFunction: {
        DEFAULT: `cubic-bezier(${tokens.easing.base.join(', ')})`,
        out: `cubic-bezier(${tokens.easing.out.join(', ')})`,
      },
    },
  },
  plugins: [],
};

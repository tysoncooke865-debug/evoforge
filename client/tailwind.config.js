const tokens = require('./src/theme/tokens');

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
      colors: tokens.colors,
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

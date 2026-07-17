import { describe, expect, it } from 'vitest';

import { PALETTE_COLOURS, PALETTE_META, THEME_PALETTE_IDS, varsFor } from '../palettes';
import tokens from '../tokens';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tailwindConfig = require('../../../tailwind.config.js') as {
  theme: { extend: { colors: Record<string, string> } };
};

const TOKEN_KEYS = Object.keys(tokens.colors).sort();
const STABLE_KEYS = [
  'common',
  'rare',
  'epic',
  'legendary',
  'mythic',
  'success',
  'warn',
  'danger',
] as const;

function relLuminance(hex: string): number {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [la, lb] = [relLuminance(a), relLuminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('the palette registry', () => {
  it('has palettes to test (a guard over nothing guards nothing)', () => {
    expect(THEME_PALETTE_IDS.length).toBeGreaterThanOrEqual(7); // standard + 6
  });

  it('every palette defines exactly the token colour keys', () => {
    for (const id of THEME_PALETTE_IDS) {
      expect(Object.keys(PALETTE_COLOURS[id]).sort(), id).toEqual(TOKEN_KEYS);
    }
  });

  it('standard IS tokens.colors (the identity, not a copy)', () => {
    expect(PALETTE_COLOURS.standard).toBe(tokens.colors);
  });

  it('rarity and semantic colours never change with the theme', () => {
    for (const id of THEME_PALETTE_IDS) {
      for (const key of STABLE_KEYS) {
        expect(PALETTE_COLOURS[id][key], `${id}.${key}`).toBe(tokens.colors[key]);
      }
    }
  });

  it('every palette stays dark mode (no accidental light theme)', () => {
    for (const id of THEME_PALETTE_IDS) {
      expect(relLuminance(PALETTE_COLOURS[id].bg), `${id}.bg`).toBeLessThan(0.03);
      expect(relLuminance(PALETTE_COLOURS[id].surface), `${id}.surface`).toBeLessThan(0.05);
    }
  });

  it('text stays readable in every palette (WCAG)', () => {
    for (const id of THEME_PALETTE_IDS) {
      const c = PALETTE_COLOURS[id];
      expect(contrast(c.text, c.surface), `${id} text/surface`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c['text-mute'], c.surface), `${id} text-mute/surface`).toBeGreaterThanOrEqual(3);
      expect(contrast(c.accent, c.bg), `${id} accent/bg`).toBeGreaterThanOrEqual(3);
      expect(contrast(c['accent-ink'], c.accent), `${id} accent-ink/accent`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every palette has store-card metadata', () => {
    for (const id of THEME_PALETTE_IDS) {
      expect(PALETTE_META[id].name.length, id).toBeGreaterThan(0);
      expect(PALETTE_META[id].swatch, id).toHaveLength(4);
    }
  });
});

describe('varsFor', () => {
  it('standard applies NO vars — the CSS fallbacks ARE the standard values', () => {
    expect(varsFor('standard')).toEqual({});
  });

  it('every other palette sets --c-<key> for every token colour', () => {
    for (const id of THEME_PALETTE_IDS) {
      if (id === 'standard') continue;
      const applied = varsFor(id);
      expect(Object.keys(applied).sort(), id).toEqual(TOKEN_KEYS.map((k) => `--c-${k}`).sort());
    }
  });
});

describe('the tailwind var() wrapper', () => {
  it('every colour utility resolves through --c-<key> with the standard value as fallback', () => {
    const colors = tailwindConfig.theme.extend.colors;
    expect(Object.keys(colors).sort()).toEqual(TOKEN_KEYS);
    for (const [k, v] of Object.entries(tokens.colors)) {
      expect(colors[k]).toBe(`var(--c-${k}, ${v})`);
    }
  });
});

// The companion guard against opacity-modified colour classes (which
// silently die under the var() wrapper) lives in scripts/verify-tokens.mjs —
// file-walking guards are scripts here, not vitest.

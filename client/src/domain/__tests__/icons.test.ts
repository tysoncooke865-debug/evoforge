import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ICONS } from '../../../scripts/pixellab/icon-manifest.mjs';

/**
 * THE ICON SYSTEM'S GUARDS.
 *
 * Deliberately NOT a render test. `ui/core/icons.tsx` pulls in expo-image and
 * react-native, which this vitest environment cannot parse — and a render test
 * would in any case only prove that React can call a function. The failures
 * that actually reach a user are different, and every one of them is checkable
 * from the filesystem:
 *
 *   - an icon in the registry whose PNG is not in the repo (a blank square in
 *     production, and only in production, because a dev build has the file);
 *   - a manifest entry with no provenance (an asset nobody can regenerate);
 *   - the PixelLab API key or its host reachable from `src/` (a paid key in
 *     the shipped bundle, or a network call during a workout);
 *   - a replaced emoji creeping back into a swept file.
 */

const CLIENT = join(__dirname, '..', '..', '..');
const ICON_ROOT = join(CLIENT, 'assets', 'pixel-lab', 'icons');
const REGISTRY = join(CLIENT, 'src', 'ui', 'core', 'icons.tsx');

const registrySource = readFileSync(REGISTRY, 'utf8');

/** Source with comments stripped. Comments are not code, and every file this
 *  suite inspects DOCUMENTS the rule being enforced — a naive substring search
 *  fails on the explanation of the very thing it checks. */
const code = (p: string): string =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');


describe('the icon manifest', () => {
  it('is not empty — a gate over nothing passes trivially', () => {
    expect(ICONS.length).toBeGreaterThan(0);
  });

  it('has a real PNG for every entry', () => {
    for (const icon of ICONS) {
      const p = join(ICON_ROOT, icon.category, `${icon.name}.png`);
      expect(existsSync(p), `${icon.name}: missing ${p}`).toBe(true);
      expect(statSync(p).size, `${icon.name}: empty file`).toBeGreaterThan(200);
    }
  });

  it('records provenance for every entry, with the pinned seed', () => {
    const manifest = JSON.parse(readFileSync(join(ICON_ROOT, 'manifest.json'), 'utf8'));
    for (const icon of ICONS) {
      const p = manifest[icon.name];
      expect(p, `${icon.name}: no provenance row`).toBeTruthy();
      expect(p.prompt.length).toBeGreaterThan(20);
      expect(p.seed).toBe(icon.seed);
      expect(p.endpoint).toContain('pixellab.ai');
      expect(p.size).toBe(`${icon.size}x${icon.size}`);
    }
  });

  it('generates nothing that is not used — every entry names its call sites', () => {
    // The brief's rule: "Do not create unused asset bloat." An entry that
    // cannot name where it is drawn is bloat by definition.
    for (const icon of ICONS) {
      expect(Array.isArray(icon.sites) && icon.sites.length > 0, `${icon.name}: no sites`).toBe(true);
    }
  });
});

describe('the registry', () => {
  it('requires every generated icon, so a missing file breaks the BUILD', () => {
    // `require` puts the asset in the bundle graph. A path typo is then a build
    // error rather than a blank square that only shows up in production.
    for (const icon of ICONS) {
      expect(
        registrySource.includes(`icons/${icon.category}/${icon.name}.png`),
        `${icon.name} is generated but the registry never requires it`
      ).toBe(true);
    }
  });

  it('renders rasters with nearest-neighbour scaling', () => {
    // Bilinear on 32x32 pixel art is exactly the mush the style exists to
    // avoid, and it is the browser default.
    expect(registrySource).toContain('imageRendering');
    expect(registrySource).toContain('pixelated');
  });

  it('forces every caller to make an accessibility decision', () => {
    // `label` is required and null-able: a caller must say "this is the name"
    // or "this is decorative". Both failure modes come from it being optional.
    expect(registrySource).toMatch(/label:\s*string \| null/);
  });
});

describe('the PixelLab key never reaches the app', () => {
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      // __tests__ is excluded because test files are not bundled — and
      // because THIS file necessarily contains both search strings, so
      // including it would make the check fail on itself forever.
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') walk(p, out);
      } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(p);
    }
    return out;
  };
  const files = walk(join(CLIENT, 'src'));

  it('scans a real number of files', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('never references PIXELLAB_AI_KEY in shipped code', () => {
    const bad = files.filter((f) => code(f).includes('PIXELLAB_AI_KEY'));
    expect(bad, 'the key would be inlined into the bundle').toEqual([]);
  });

  it('never calls api.pixellab.ai at runtime', () => {
    const bad = files.filter((f) => code(f).includes('api.pixellab.ai'));
    expect(bad, 'assets are generated at build time and committed').toEqual([]);
  });
});

describe('the swept call sites stay swept', () => {
  const SWEPT: [string, string][] = [
    ['src/ui/arena/leaderboard-row.tsx', '🥇'],
    ['src/ui/arena/leaderboard-teaser.tsx', '🥈'],
    ['src/ui/home/week-strip.tsx', '🔥'],
    ['src/ui/customise/cosmetic-tabs.tsx', '🔒'],
    ['src/ui/battle/champion-picker.tsx', '🔒'],
    ['src/ui/train/exercise-picker.tsx', '🔍'],
  ];

  it('no replaced emoji has crept back', () => {
    for (const [rel, glyph] of SWEPT) {
      // Comments are not code. Each swept file explains in prose WHICH emoji
      // it used to draw, and that sentence is the most useful thing in the
      // diff — a check that banned it would delete its own documentation.
      const text = code(join(CLIENT, rel));
      expect(text.includes(glyph), `${rel} still renders ${glyph}`).toBe(false);
    }
  });
});

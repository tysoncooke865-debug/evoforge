import { describe, expect, it } from 'vitest';

import { entryHashFromSrcs, runningBuildId } from '../build-id';

describe('build-id — the persisted-cache buster (the lockout postmortem)', () => {
  it('extracts the entry hash from a production script list', () => {
    expect(
      entryHashFromSrcs([
        'https://expo-rewrite.evoforge.pages.dev/entry-fbcddad8123456789abcdef012345678.js',
      ])
    ).toBe('fbcddad8123456789abcdef012345678');
  });

  it('finds the entry among other scripts, first match wins', () => {
    expect(
      entryHashFromSrcs([
        'https://host/some-vendor-abc.js',
        'https://host/_expo/static/js/web/entry-00ff11aa.js',
        'https://host/entry-deadbeef.js',
      ])
    ).toBe('00ff11aa');
  });

  it('no entry script (dev server, native) → null', () => {
    expect(entryHashFromSrcs([])).toBeNull();
    expect(entryHashFromSrcs(['https://host/index.bundle?platform=web&dev=true'])).toBeNull();
    expect(entryHashFromSrcs(['https://host/AppEntry.js'])).toBeNull();
  });

  it('rejects non-hex hashes — the regex is the version-guard contract', () => {
    expect(entryHashFromSrcs(['https://host/entry-NOTHEX.js'])).toBeNull();
  });

  it('runningBuildId falls back when no document exists (node/native/static render)', () => {
    // vitest runs in node: no DOM. The fallback is the pre-fix buster, so
    // dev and native keep their warm cache exactly as before.
    expect(runningBuildId()).toBe('v1');
    expect(runningBuildId('custom')).toBe('custom');
  });
});

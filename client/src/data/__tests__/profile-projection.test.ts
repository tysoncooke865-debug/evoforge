import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * EVERY ProfileRow FIELD MUST ACTUALLY BE SELECTED.
 *
 * `useProfile` projects an explicit column list. When migration 136 added
 * `photo_consent_at`, the column was created, the mutation wrote it, the type
 * declared it — and the SELECT was never updated. So `usePhotoPrefs().hasConsent`
 * read `undefined` forever, the consent gate never passed, and an athlete who
 * agreed was asked again, and again, with no way through to the photo screen.
 *
 * Nothing caught it: the types were consistent, the write worked, and the row
 * in the database was correct. Only the projection was wrong, and a projection
 * is invisible to TypeScript.
 *
 * This reads the source and compares the two lists.
 */

const HOOKS = fs.readFileSync(
  path.join(__dirname, '..', 'hooks.ts'),
  'utf8'
);

function profileRowFields(src: string): string[] {
  const start = src.indexOf('export interface ProfileRow {');
  const end = src.indexOf('\n}', start);
  const body = src.slice(start, end);
  return [...body.matchAll(/^\s{2}([a-z_][a-z0-9_]*)\??:/gim)].map((m) => m[1]);
}

function selectedColumns(src: string): string[] {
  // The `.from('profile').select('…')` inside useProfile.
  const m = src.match(/\.from\('profile'\)\s*\n?\s*\.select\('([^']+)'\)/);
  if (!m) throw new Error('could not find the profile select list');
  return m[1].split(',').map((c) => c.trim());
}

describe('the profile projection', () => {
  const fields = profileRowFields(HOOKS);
  const selected = selectedColumns(HOOKS);

  it('finds both lists (a broken parser must not silently pass)', () => {
    expect(fields.length).toBeGreaterThan(20);
    expect(selected.length).toBeGreaterThan(20);
  });

  it('selects every field ProfileRow declares', () => {
    const missing = fields.filter((f) => !selected.includes(f));
    expect(missing, `declared on ProfileRow but never SELECTed: ${missing.join(', ')}`).toEqual([]);
  });

  it('declares every column it selects — no silent extras', () => {
    const extra = selected.filter((c) => !fields.includes(c));
    expect(extra, `selected but not on ProfileRow: ${extra.join(', ')}`).toEqual([]);
  });
});

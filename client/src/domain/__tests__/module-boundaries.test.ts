import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname, extname } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * THE WALL BETWEEN CHANCE AND PLEDGE, ENFORCED BY THE BUILD.
 *
 * Spec v5 invariant 2 (docs/ENGAGEMENT_V5.md): stakes exist only in skill-resolved
 * mechanics with zero RNG; chance exists only in no-pledge additive reveals; and no
 * mechanic or transaction chain may bridge them.
 *
 * An invariant that lives only in a design document is a convention, and conventions
 * lose to a deadline. This is the acceptance test the rest of the migration is built
 * behind, which is why it lands BEFORE the modules it guards: the module lists below
 * name files that do not exist yet, deliberately, so the guard is already standing when
 * they arrive.
 *
 * WHAT THIS DOES NOT BAN, AND WHY IT MATTERS.
 *
 * `poolPhysics` — the gravity/tilt/stack/drag engine the brief requires be preserved
 * wholesale — is FULL of `Math.random()`: audio grain, screen shake, chip scatter
 * velocity, spawn jitter. None of it can move a coin. A blanket "no RNG near pledges"
 * rule would fail on the first run against the one engine we are told not to touch, and
 * the response to a guard that fails for the wrong reason is to weaken it.
 *
 * So the rule is drawn where the risk actually is: **no randomness may reach a decision
 * or an amount.** Presentation may jitter all it likes, but it may not hand a value back
 * to a trial — which is what rule 3 enforces by making the dependency one-way.
 */

const SRC = resolve(__dirname, '..', '..');

/** Path prefixes that define each module. Relative to `client/src`, forward slashes. */
const MODULES: Record<string, string[]> = {
  // The pledge side. Zero RNG in anything that decides or settles.
  forgeTrials: [
    'domain/callout', 'domain/forge-trial', 'domain/golden-dot',
    'data/callout', 'data/forge-trial',
    'ui/callouts/', 'ui/trial/',
  ],
  // The chance side. RNG lives here and nowhere else that touches coins.
  //
  // `forge-drop` is deliberately still listed. The staked board is deleted, and
  // leaving its prefixes here means that if anybody ever recreates a file under one
  // of those names it lands INSIDE the guarded module rather than outside every
  // rule — which is the difference between a re-introduction being caught and it
  // being invisible. The non-empty check in rule 5 is satisfied by forge-reveal.
  chanceReveals: [
    'domain/forge-drop', 'domain/forge-reveal',
    'data/forge-drop', 'data/forge-reveal',
    'ui/forge-drop/', 'ui/forge-reveal/',
  ],
  // Presentation for the pledge pool. Values flow IN; nothing flows out.
  poolPhysics: ['ui/duel/physics/'],
  coinLedger: ['data/coins', 'domain/coin-claims'],
  streaksAndCaches: ['domain/scheduled-streak', 'domain/forge-cache', 'data/forge-cache'],
  verification: ['domain/verification', 'data/verification'],
  deterministicRewards: ['domain/deterministic-rewards', 'data/deterministic-rewards'],
};

/** Randomness that can decide something. `randomUUID` is deliberately absent — an
 *  idempotency key is an identifier, not an outcome, and pledge creation needs one. */
const OUTCOME_RNG = [
  /\bMath\s*\.\s*random\s*\(/,
  /\bgetRandomValues\s*\(/,
  /\bgetRandomBytes(?:Async)?\s*\(/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(p, out);
    } else if (['.ts', '.tsx'].includes(extname(p))) {
      out.push(p);
    }
  }
  return out;
}

const FILES = walk(SRC).map((abs) => ({
  abs,
  rel: relative(SRC, abs).replace(/\\/g, '/'),
  src: readFileSync(abs, 'utf8'),
}));

function moduleOf(rel: string): string | null {
  for (const [name, prefixes] of Object.entries(MODULES)) {
    if (prefixes.some((p) => rel.startsWith(p))) return name;
  }
  return null;
}

/** Every module specifier a file imports or re-exports, resolved to a `client/src` path
 *  where it points inside the tree. Covers `import`, `export … from`, and `require`. */
function importsOf(file: { rel: string; src: string }): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bimport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const m of file.src.matchAll(re)) specs.push(m[1]);
  }
  return specs
    .map((s) => {
      if (s.startsWith('@/')) return s.slice(2);
      if (s.startsWith('.')) {
        return relative(SRC, resolve(dirname(join(SRC, file.rel)), s)).replace(/\\/g, '/');
      }
      return null; // a package, not our tree
    })
    .filter((s): s is string => s !== null);
}

/** Strip comments so prose explaining a ban does not trip it. */
const codeOf = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const inModule = (name: string) => FILES.filter((f) => moduleOf(f.rel) === name);

describe('chance and pledge cannot reach each other (v5 invariant 2)', () => {
  it('the module map actually matches files — a guard over nothing is not a guard', () => {
    // If a rename silently empties a module, every rule below passes vacuously.
    expect(inModule('poolPhysics').length, 'poolPhysics').toBeGreaterThan(0);
    expect(inModule('chanceReveals').length, 'chanceReveals').toBeGreaterThan(0);
    expect(inModule('forgeTrials').length, 'forgeTrials').toBeGreaterThan(0);
  });

  /** RULE 1 — nothing that decides or settles a pledge may consult randomness. */
  it('no outcome RNG anywhere in forgeTrials', () => {
    const offenders: string[] = [];
    for (const f of inModule('forgeTrials')) {
      const code = codeOf(f.src);
      for (const re of OUTCOME_RNG) {
        const hit = code.match(re);
        if (hit) offenders.push(`${f.rel} — ${hit[0].trim()}`);
      }
    }
    expect(offenders, 'a pledge must resolve on logged performance alone').toEqual([]);
  });

  /** RULE 2 — the two sides may not import each other, in either direction. */
  it('chanceReveals and forgeTrials never import each other', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const mine = moduleOf(f.rel);
      if (mine !== 'chanceReveals' && mine !== 'forgeTrials') continue;
      const forbidden = mine === 'chanceReveals' ? 'forgeTrials' : 'chanceReveals';
      for (const spec of importsOf(f)) {
        if (moduleOf(spec) === forbidden) offenders.push(`${f.rel} → ${spec} (${forbidden})`);
      }
    }
    expect(offenders, 'a pledge win cannot grant a reveal; a reveal cannot feed a pledge')
      .toEqual([]);
  });

  /**
   * RULE 3 — the physics is a ONE-WAY presentation layer.
   *
   * This is what lets the engine keep its `Math.random()`. Jitter is harmless precisely
   * because nothing it produces can travel back into a decision, and that is only true
   * while poolPhysics imports neither side. The moment it reads a trial, its randomness
   * is upstream of a settlement.
   */
  it('poolPhysics imports neither side — jitter can never reach an amount', () => {
    const offenders: string[] = [];
    for (const f of inModule('poolPhysics')) {
      for (const spec of importsOf(f)) {
        const target = moduleOf(spec);
        if (target === 'forgeTrials' || target === 'chanceReveals') {
          offenders.push(`${f.rel} → ${spec} (${target})`);
        }
      }
    }
    expect(offenders, 'physics renders a pledge; it must never compute one').toEqual([]);
  });

  /** RULE 4 — no shared resolver. The brief forbids a generic reward resolver because a
   *  module imported by both sides is the bridge, whatever it is called. */
  it('no module that resolves or settles is imported by both sides', () => {
    const importedBy = (name: string) =>
      new Set(inModule(name).flatMap((f) => importsOf(f)));
    const chance = importedBy('chanceReveals');
    const trials = importedBy('forgeTrials');
    const shared = [...chance].filter((s) => trials.has(s));
    const resolvers = shared.filter((s) => /resolv|settl|reward|payout|outcome/i.test(s));
    expect(resolvers, 'chance and pledge may share types and UI, never a resolver')
      .toEqual([]);
  });
});

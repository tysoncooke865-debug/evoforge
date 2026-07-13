/**
 * TRANSFORM P8 — the reduced-motion guard.
 *
 * `withRepeat` is Reanimated's ONLY looping primitive, and an ambient loop
 * that ignores the OS "reduce motion" setting is exactly the accessibility
 * bug this guard exists to catch. Rule: any component that calls withRepeat
 * must also consult useReducedMotion (directly, or by rendering nothing /
 * holding still when it is on).
 *
 * It found two real offenders the day it was written — the toast's XP pulse
 * (looped for the toast's whole life) and the HEADS OR TAILS coin (spun a
 * fast rotating object at a vestibular-sensitive athlete). Both fixed.
 *
 * The doctrine this obeys (client/CLAUDE.md): a guard that cannot fail is
 * not a guard. So:
 *   - it asserts the scanned set is NON-EMPTY (an empty glob would otherwise
 *     "pass" by having nothing to check),
 *   - it asserts the positive control: at least one file genuinely gates,
 *   - and it was falsified once by deleting a gate and watching it go red.
 *
 * Web note: CSS-driven loops (the sprite strips) are ALSO covered, because
 * the components that own them are the same ones that consult the hook.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });

const sources = walk(ROOT).filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'));
if (sources.length === 0) {
  console.error('verify-motion: scanned ZERO source files — the glob is broken, not the code.');
  process.exit(2);
}

const LOOP = /withRepeat\s*\(/;
// The gate must be a real CALL. Matching the bare identifier `reducedMotion`
// let `const reducedMotion = false` pass — the first falsification run stayed
// green with the gate deliberately removed, which is precisely the vacuous
// guard the doctrine warns about. Only `useReducedMotion(` counts.
const GATE = /useReducedMotion\s*\(/;

const loopers = [];
const gated = [];
const offenders = [];

for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  if (!LOOP.test(text)) continue;
  loopers.push(file);
  if (GATE.test(text)) gated.push(file);
  else offenders.push(file);
}

// Positive controls: the scan must actually have found loops, and at least
// one of them must genuinely gate — otherwise "no offenders" would be the
// same observation as "nothing was tested".
if (loopers.length === 0) {
  console.error('verify-motion: found NO withRepeat callers. Either the animation layer was rewritten (update this guard) or the scan is broken.');
  process.exit(2);
}
if (gated.length === 0) {
  console.error('verify-motion: not one looping component consults useReducedMotion — the detector is matching nothing.');
  process.exit(2);
}

const rel = (f) => f.slice(f.indexOf('src'));

if (offenders.length > 0) {
  console.error(
    `verify-motion: ${offenders.length} component(s) loop an animation without honouring reduced motion:\n` +
      offenders.map((f) => `  - ${rel(f)}`).join('\n') +
      '\n\nGate the LOOP on useReducedMotion (hold it still or render nothing).\n' +
      'Never fast-forward a ONE-SHOT to comply — a fast-forwarded toast ends at\n' +
      'opacity 0, which is an invisible toast.'
  );
  process.exit(1);
}

console.log(
  `OK: ${loopers.length} looping components, all ${gated.length} honour reduced motion.`
);

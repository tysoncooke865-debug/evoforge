/**
 * DETERMINISTIC PRNG for online live matches (Tyson, 2026-07-20).
 *
 * A live PvP turn must resolve to the SAME state on both players' devices with
 * no server referee. The battle engine is already pure and takes an injected
 * `Rng = () => number` — so if both clients feed it the SAME sequence, they
 * compute identical outcomes. Single-player battles keep `Math.random`; ONLY the
 * online path uses this, seeded from the server-issued match seed + the turn
 * number, so turn N draws the same crits/hit-rolls/order on both sides.
 *
 * mulberry32 — a tiny, fast, well-distributed 32-bit generator. Not
 * cryptographic (it doesn't need to be — nothing farmable is at stake, matching
 * the existing client-authoritative casual-battle posture), just reproducible.
 */

/** A 32-bit string hash (FNV-1a) → a numeric seed for mulberry32. */
export function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: seed → an rng closure yielding floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The rng for one turn of a match: derived from the match seed and the turn
 * number, so both clients resolving turn N draw the identical sequence. A fresh
 * closure per turn keeps turns independent (a re-render mid-turn can't desync).
 */
export function turnRng(matchSeed: string, turn: number): () => number {
  return mulberry32(hashSeed(`${matchSeed}:${turn}`));
}

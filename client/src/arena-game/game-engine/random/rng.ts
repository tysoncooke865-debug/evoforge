/**
 * Deterministic seeded RNG (mulberry32).
 *
 * Every source of randomness in the battle simulation MUST flow through a
 * SeededRng instance owned by the battle state. Never use Math.random()
 * inside the game engine — it would break replay determinism.
 */

export class SeededRng {
  private state: number;

  constructor(seed: number) {
    // Force to uint32; a seed of 0 is valid for mulberry32.
    this.state = seed >>> 0;
  }

  /** Returns a float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns an integer in [min, max] inclusive. */
  nextInt(min: number, max: number): number {
    if (max < min) throw new Error(`nextInt: max (${max}) < min (${min})`);
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** Returns true with probability p (clamped to [0, 1]). */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  /** Picks one element. Throws on an empty array rather than returning undefined. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('SeededRng.pick: empty array');
    return items[this.nextInt(0, items.length - 1)];
  }

  /** Returns a new shuffled copy (Fisher-Yates). Does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /** Current internal state — recorded in battle debug info. */
  getState(): number {
    return this.state;
  }
}

/** Derives a numeric seed from a string (FNV-1a), for e.g. player-id based seeds. */
export function seedFromString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic seeded random number generator utilities.
 * 
 * Uses mulberry32 algorithm for fast, high-quality 32-bit randomness.
 * All game randomness MUST flow through these functions to ensure determinism.
 */

/**
 * Mulberry32 - A fast, high-quality 32-bit seeded PRNG.
 * Period: 2^32. Passes BigCrush tests.
 * 
 * @param seed - 32-bit unsigned integer seed
 * @returns Function that returns random floats in [0, 1)
 */
export function mulberry32(seed: number): () => number {
  return function() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * SFC32 (Simple Fast Counter) - Alternative high-quality PRNG.
 * Uses 4 state variables for longer period and better distribution.
 * 
 * @param a - First seed component
 * @param b - Second seed component  
 * @param c - Third seed component
 * @param d - Fourth seed component (counter)
 * @returns Function that returns random floats in [0, 1)
 */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return function() {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (a + b | 0) + d | 0;
    d = d + 1 | 0;
    a = b ^ (b >>> 9);
    b = c + (c << 3) | 0;
    c = (c << 21) | (c >>> 11);
    c = c + t | 0;
    return (t >>> 0) / 4294967296;
  };
}

/**
 * Xorshift32 - Simple and fast PRNG.
 * Slightly lower quality but very fast.
 * 
 * @param seed - 32-bit unsigned integer seed (must be non-zero)
 * @returns Function that returns random floats in [0, 1)
 */
export function xorshift32(seed: number): () => number {
  let state = seed >>> 0 || 1; // Ensure non-zero
  return function() {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

/**
 * RNG wrapper class for convenient usage with various utility methods.
 */
export class SeededRNG {
  private rng: () => number;
  private _seed: number;

  constructor(seed: number) {
    this._seed = seed >>> 0;
    this.rng = mulberry32(this._seed);
  }

  /**
   * Get the original seed used to initialize this RNG.
   */
  get seed(): number {
    return this._seed;
  }

  /**
   * Get next random float in [0, 1).
   */
  next(): number {
    return this.rng();
  }

  /**
   * Get next random float in [min, max).
   */
  range(min: number, max: number): number {
    return min + this.rng() * (max - min);
  }

  /**
   * Get next random integer in [min, max] (inclusive).
   */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Returns true with probability p.
   */
  chance(p: number): boolean {
    return this.rng() < p;
  }

  /**
   * Pick a random element from an array.
   */
  pick<T>(array: T[]): T {
    return array[Math.floor(this.rng() * array.length)];
  }

  /**
   * Shuffle an array in place using Fisher-Yates algorithm.
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /**
   * Get a small perturbation value for physics jitter.
   * Returns a value in [-magnitude, +magnitude].
   */
  jitter(magnitude: number): number {
    return (this.rng() - 0.5) * 2 * magnitude;
  }
}

/**
 * Convert a string to a 32-bit hash for seeding.
 * Uses cyrb53 algorithm for good distribution.
 */
export function stringToSeed(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Combine multiple seed values into one.
 */
export function combineSeeds(...seeds: number[]): number {
  let combined = 0;
  for (const seed of seeds) {
    combined = combined ^ (seed >>> 0);
    combined = Math.imul(combined, 0x5bd1e995);
    combined ^= combined >>> 15;
  }
  return combined >>> 0;
}

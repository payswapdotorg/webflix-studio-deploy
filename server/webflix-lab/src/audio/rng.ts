/**
 * Audio pipeline (WFLX-W2, Stage 2) — deterministic randomness utilities.
 *
 * Binding rules (src/audio/DESIGN.md §10): all stochastic choices draw from a
 * seeded PRNG keyed by (seed, planHash, mode, language, targetDuration, and
 * the stable id of the unit the choice belongs to). Same inputs ⇒ identical
 * outputs. No Math.random and no wall clock anywhere in the compile path
 * (tests/audio hygiene rule 5).
 *
 * The per-choice key pattern (no shared mutable stream) makes each pick a
 * pure function of its key: reordering independent choices can never change a
 * given pick, which keeps regeneration of the smallest failed unit stable.
 */

/** FNV-1a 32-bit hash of a string (stable across runs and platforms). */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hash an arbitrary seed string (number or text) to a 32-bit state. */
export function hashSeed(seed: string | number): number {
  return fnv1a32(`wflx-seed:${String(seed)}`);
}

/**
 * mulberry32 PRNG — small, fast, well-documented. Returns floats in [0, 1).
 * Pure per-call state initialization from the input integer.
 */
export function mulberry32(a: number): () => number {
  let state = a | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic PRNG factory keyed by an arbitrary composite key string. */
export function rngFor(key: string): () => number {
  return mulberry32(fnv1a32(key));
}

/** Deterministic integer in [min, max] (inclusive) keyed by `key`. */
export function intFor(key: string, min: number, max: number): number {
  if (max < min) {
    throw new RangeError(`intFor: max (${max}) < min (${min})`);
  }
  const rand = rngFor(key);
  return min + Math.floor(rand() * (max - min + 1));
}

/** Deterministic element pick keyed by `key`. Throws on empty list. */
export function pickFor<T>(key: string, items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('pickFor: empty items');
  }
  const index = intFor(key, 0, items.length - 1);
  // noUncheckedIndexedAccess: index is provably in range, but the type system
  // cannot see it through pickFor — assert via at().
  const hit = items.at(index);
  if (hit === undefined) {
    throw new Error('pickFor: index out of range (impossible)');
  }
  return hit;
}

/**
 * Video pipeline (WFLX-W3) — deterministic randomness utilities.
 *
 * Mirrors the W2 convention (src/audio/rng.ts, DESIGN.md §10): every
 * stochastic choice is a pure function of a composite key (seed, plan hash,
 * mode, unit id, choice name). Same key ⇒ identical draw; reordering
 * independent choices never changes a given pick, so regenerating the
 * smallest failed unit stays stable.
 *
 * Deliberately self-contained (not imported from src/audio): worker trees
 * must compile independently per docs/work-items/tl2-work-order.md. The
 * primitives are FNV-1a + mulberry32, identical by convention.
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
  return fnv1a32(`wflx-video-seed:${String(seed)}`);
}

/** mulberry32 PRNG — floats in [0, 1). Pure per-call state initialization. */
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
  const hit = items.at(index);
  if (hit === undefined) {
    throw new Error('pickFor: index out of range (impossible)');
  }
  return hit;
}

/** Deterministic float in [min, max) keyed by `key`. */
export function floatFor(key: string, min: number, max: number): number {
  const rand = rngFor(key);
  return min + rand() * (max - min);
}

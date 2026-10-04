// Small shared helpers used across the world-generation modules.
// Previously duplicated in testArea.ts and WorldRoom.ts; centralized here
// when hillyTerrain.ts needed a third copy of hashString.

/** Positive-and-negative-safe modulo (JS's `%` can return negatives). */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Small, deterministic string hash (not cryptographic, doesn't need to be) -- just needs to spread different strings (world ids, salted channel names, ...) across a wide range. */
export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** mulberry32: a tiny, fast, decent-quality seeded PRNG -- used to seed simplex-noise's permutation table deterministically from a world id (see hillyTerrain.ts), not for cryptographic or statistical rigor. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function (): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * R24 fixture — the ONE deterministic randomness source.
 *
 * Every fixture surface (imagery, DEM, MVT features, the ADS-B fleet) draws
 * from these functions, so imagery and vectors AGREE by construction: a road
 * the MVT layer emits is a road the imagery tints, because both ask the same
 * hash the same question.
 *
 * Two hard rules, both load-bearing for the round:
 *  1. Everything is a pure function of GEOGRAPHIC position (or of an integer
 *     cell index derived from it) — never of the requesting tile's z/x/y.
 *     A parent tile and its four children must agree on the height field or
 *     three-tile's LOD refine produces cliffs that are fixture artifacts, and
 *     the neighbouring-tile seam gates would be measuring the fixture.
 *  2. No Math.random anywhere. Re-running a gate must produce byte-identical
 *     tiles; that is the whole reason the fixture exists (HARN-GAP-6).
 */

/** 32-bit integer hash (three rounds of xorshift-multiply). */
export function hash2i(x, y, seed = 0) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** hash2i normalised to [0,1). */
export function rand2(x, y, seed = 0) {
  return hash2i(x, y, seed) / 4294967296;
}

/** A tiny seeded PRNG for per-feature sequences (mulberry32). */
export function prng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise on the unit lattice; continuous everywhere. */
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = rand2(xi, yi, seed);
  const b = rand2(xi + 1, yi, seed);
  const c = rand2(xi, yi + 1, seed);
  const d = rand2(xi + 1, yi + 1, seed);
  return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
}

/** Fractal Brownian motion; `oct` octaves, gain 0.5, lacunarity 2. */
export function fbm(x, y, oct = 4, seed = 0) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < oct; i++) {
    sum += valueNoise(fx, fy, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.0137;
    fy *= 2.0137;
  }
  return sum / norm;
}

/** Ridged variant — gives the hilly scene a believable drainage pattern. */
export function ridged(x, y, oct = 4, seed = 0) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < oct; i++) {
    const v = 1 - Math.abs(valueNoise(fx, fy, seed + i * 211) * 2 - 1);
    sum += v * v * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.0137;
    fy *= 2.0137;
  }
  return sum / norm;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

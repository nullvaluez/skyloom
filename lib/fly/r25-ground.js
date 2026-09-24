// R25 D GROUND — terrain hooks wired by W0. W0 STUBS: applyR25Terrain must
// leave the material byte-identical (no onBeforeCompile / cache-key change)
// unless r25On(R25_GROUND, …) (lib/fly/visuals-profile.js) — Classic = flag-off.

/** Outermost terrain-chain patch (after applyEarthSurface) — live and prewarm twin. */
export function applyR25Terrain(material) {
  return material;
}

/** Called once per frame after the style chain (relief pool, colour ref atlas, quilt retirement). */
export function r25GroundFrame(_runtime, _ctx) {}

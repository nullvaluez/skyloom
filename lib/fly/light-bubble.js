/**
 * ROUND 25 (C LIGHT) — LIGHT_BUBBLE_R25's non-React half: the arithmetic and
 * the runtime-bus writes behind "light that has a source, a moon that is a
 * light, shadows that fit the bubble".
 *
 * ZERO SHADER TEXT IS THE POINT. Every mechanism in this round of C's is a
 * uniform or a property write on an object that already exists: the ONE
 * directional light's shadow camera, the retained N8AO pass's configuration,
 * the ONE hemisphere light's two colours, and three numbers that ride on
 * `runtime.sun` into pure functions that were already being called every
 * frame. No cache key moves, no program is re-keyed, no material is touched.
 *
 * WHY THE WRITES LIVE HERE AND NOT IN THE COMPONENT. The project's
 * react-hooks/immutability rule forbids mutating a prop inside a component or
 * hook body — and it is right to — while `runtime` is the app's shared mutable
 * bus by design. So the component (components/fly/LightBubbleRig.jsx) sequences
 * plain functions that own the contract, exactly as lib/fly/ground-bubble.js
 * does for `runtime.groundBubble` and lib/fly/ground-vis.js does for
 * `runtime.groundElevVis`.
 *
 * WHY THE PURE CONSUMERS ARE FED THROUGH `runtime.sun` AND NOT THROUGH AN
 * IMPORT. `lib/fly/immersive.js` is loaded by scripts/immersive-unit.mjs as a
 * `data:` URL, where a relative specifier cannot resolve at all, and
 * `lib/fly/satellite-atmosphere.js` is loaded the same way by
 * scripts/graphics-unit.mjs, which rewrites exactly ONE specifier
 * (`./immersive`). Adding an import to either file would break a frozen node
 * gate that this round's ownership matrix does not let C edit. So the FLAG is
 * read here (through lib/fly/r25-pins.js, the one R25 accessor) and the
 * resolved numbers are published on the sun object those functions are already
 * handed: `sun.moon`, `sun.grade`, `sun.hazeNightFloor`. With the rig
 * unmounted they are simply absent and both functions run their R24
 * expressions — which is what makes flag-off identity a property of the code
 * rather than of a comparison.
 */

import { moonIllum } from './immersive';
import { r25Block, r25On } from './r25-pins';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

/* -------------------------------------------------------------------------
 * (1) THE SHADOW RUNGS
 * ---------------------------------------------------------------------- */

export function createShadowRungState() {
  return { rung: null, radiusM: null };
}

/**
 * The ONE shadow cascade's ortho radius for a bubble k, QUANTISED.
 *
 * `mix(radiusHighM, radiusLowM, k)` is continuous, and a continuously
 * resizing shadow frustum is a continuously resampling shadow map: every
 * texel covers a different piece of world every frame, which is the same
 * class of crawl R24's texel snap exists to kill (SHADOW_CALM, recon L5).
 * So the radius lands on one of `steps + 1` rungs.
 *
 * THE DEADBAND IS MEASURED FROM THE BOUNDARY, NOT FROM THE RUNG. Written the
 * other way round — "has the continuous value left the CURRENT rung's radius by
 * more than `hysteresisM`" — the test is vacuous by construction: at a rung
 * boundary the continuous value is HALF A RUNG from the rung's own radius
 * ((1500 - 350) / 8 / 2 = 71.9 m), which is already more than the 40 m band, so
 * the switch fires on the very jitter the band exists to hold. That version
 * shipped for one run and scripts/verify-moon-light.mjs (8c) caught it: 7 rung
 * changes across 24 samples of +/-11.5 m of jitter sitting on the 7<->8
 * boundary. A Schmitt trigger measures from the EDGE, so the rung holds until
 * the value has passed the boundary by more than the band, and the 480 m ->
 * 560 m -> 480 m sweep in the charter is held by this AND by GROUND_BUBBLE's
 * 60 m deadband on the INPUT — two deadbands in series, each doing a different
 * job (that one absorbs a DEM refinement step, this one absorbs a hover).
 *
 * Pure; `state` is the caller's. Returns the rung, its radius, and the
 * unquantised value for the ledger.
 */
export function stepShadowRadius(state, k, cfg) {
  const hi = Number.isFinite(cfg?.radiusHighM) ? cfg.radiusHighM : 1500;
  const lo = Number.isFinite(cfg?.radiusLowM) ? cfg.radiusLowM : 350;
  const steps = Math.max(1, Math.round(cfg?.steps ?? 8));
  const hyst = Math.max(0, cfg?.hysteresisM ?? 0);
  const kk = clamp01(k);
  const rawM = hi + (lo - hi) * kk;
  const radiusOf = (rung) => hi + (lo - hi) * (rung / steps);
  const want = Math.round(kk * steps);
  if (state.rung == null) {
    state.rung = want;
  } else if (want !== state.rung) {
    // The boundary ADJACENT to the rung we are on, in the direction of travel.
    const edge = radiusOf(state.rung + Math.sign(want - state.rung) * 0.5);
    if (Math.abs(rawM - edge) > hyst) state.rung = want;
  }
  const radiusM = radiusOf(state.rung);
  state.radiusM = radiusM;
  return { radiusM, rung: state.rung, rawM };
}

/** Metres per shadow texel for a radius and a square map — the number the look depends on. */
export function shadowTexelM(radiusM, mapSize) {
  const n = Math.max(1, mapSize || 1);
  return (2 * radiusM) / n;
}

/* -------------------------------------------------------------------------
 * (2) THE MOON
 * ---------------------------------------------------------------------- */

/**
 * The payload `immersiveLighting()` consumes off `runtime.sun`: the synodic
 * illumination plus the five night knobs, so that function can stay a pure
 * function of its arguments with no constants import of its own.
 *
 * `illumOverride` (set through `window.__flyLightBubble.set({ moon: { … } })`)
 * is the user-machine A/B lever: full moon against new moon in one console
 * line, with no clock to wind forward. `upOverride` does the same for "is the
 * moon up", which is otherwise a fact about the sun's elevation.
 */
export function moonPayload(cfg, nowMs, out) {
  const { illum, phase } = moonIllum(nowMs, cfg?.epochNewMoonMs ?? 0, cfg?.synodicDays ?? 29.530588);
  const forced = Number.isFinite(cfg?.illumOverride) ? clamp01(cfg.illumOverride) : null;
  // `out` is the rig's ONE payload object, rewritten in place: the frame loop
  // allocates nothing (the ground-bubble rule).
  const o = out || {};
  o.illum = forced == null ? illum : forced;
  o.phase = phase;
  o.up = Number.isFinite(cfg?.upOverride) ? clamp01(cfg.upOverride) : undefined;
  o.keyNew = cfg?.keyNew ?? 0.025;
  o.keyFull = cfg?.keyFull ?? 0.16;
  o.envNew = cfg?.envNew ?? 0.05;
  o.envFull = cfg?.envFull ?? 0.1;
  o.fillGain = cfg?.fillGain ?? 0.04;
  return o;
}

/** The SkyDome disc brightness for an illumination — B's `setSkyMoonPhase` argument. */
export function moonDiscBrightness(illum, cfg) {
  const [a, b] = Array.isArray(cfg?.discBrightness) ? cfg.discBrightness : [0.12, 0.5];
  return a + (b - a) * clamp01(illum);
}

/* -------------------------------------------------------------------------
 * (3) THE HEMISPHERE
 * ---------------------------------------------------------------------- */

/**
 * The hemisphere GROUND colour for one time-of-day bucket. `MOODS.satellite
 * .hemi` sets it once at mount to the daytime olive `#5a6b53` and NOTHING ever
 * re-writes it (recon L3), so at midnight every underside — wings, eaves,
 * canopy, the belly of a bridge — is lit by green grass in full daylight
 * while the key is moonlit blue. The buckets are the HDRI cross-blend's own
 * ('day' | 'dawn' | 'dusk' | 'night', lib/fly/sky-dusk.js `resolveSky`); dawn
 * shares dusk's warm ground because the block names three colours, not four.
 */
export function hemiGroundFor(bucket, cfg) {
  const g = cfg?.ground ?? {};
  if (bucket === 'night') return g.night ?? '#1a2030';
  if (bucket === 'dusk' || bucket === 'dawn') return g.dusk ?? '#5a4a3e';
  return g.day ?? '#5a6b53';
}

/* -------------------------------------------------------------------------
 * (4) THE RUNTIME BUS
 * ---------------------------------------------------------------------- */

/** FlyScene's one line: hand the ONE directional light to whoever needs the object. */
export function publishSunLight(runtime, light) {
  if (runtime && light && runtime.sunLight !== light) runtime.sunLight = light;
}

/** Effects' one line: hand the RETAINED N8AO pass over so its radius can follow the bubble. */
export function publishAoPass(runtime, pass) {
  if (runtime) runtime.aoPass = pass ?? undefined;
}

/**
 * The shadow radius the texel snap (FlyScene ~:2966) and the near-receive
 * reach (~:769) read. `undefined` — the flag-off state — sends both back to
 * their frozen literals by `??`.
 */
export function publishShadowRadius(runtime, radiusM) {
  if (!runtime) return;
  if (radiusM == null) {
    if (runtime.shadowRadiusM !== undefined) runtime.shadowRadiusM = undefined;
  } else if (runtime.shadowRadiusM !== radiusM) {
    runtime.shadowRadiusM = radiusM;
  }
}

/** The three fields the pure consumers read off the sun object. Absent ⇒ R24. */
export function publishSunRiders(runtime, { moon, grade, hazeNightFloor }) {
  const sun = runtime?.sun;
  if (!sun) return false;
  const m = moon ?? undefined;
  const g = grade ?? undefined;
  const h = hazeNightFloor ?? undefined;
  if (sun.moon !== m) sun.moon = m;
  if (sun.grade !== g) sun.grade = g;
  if (sun.hazeNightFloor !== h) sun.hazeNightFloor = h;
  return true;
}

/** Every write this feature makes, undone — the unmount path. */
export function detachLightBubble(runtime) {
  publishShadowRadius(runtime, null);
  publishSunRiders(runtime, {});
  if (runtime) runtime.sunLight = undefined;
  if (typeof window !== 'undefined' && window.__flyStats) window.__flyStats.shadow = undefined;
}

/* -------------------------------------------------------------------------
 * (5) THE PIN, for the console and for E's gate
 * ---------------------------------------------------------------------- */

/**
 * Merge `patch` into `window.__flyLightBubbleOverride`, SUB-BLOCK AWARE.
 * r25-pins merges shallowly on purpose (a pin that names a sub-block replaces
 * it whole), so a caller asking for one knob would otherwise silently drop
 * the other four. Returns the resulting pinned block.
 */
export function setLightBubblePin(patch) {
  if (typeof window === 'undefined') return r25Block('LightBubble');
  const cur = r25Block('LightBubble');
  const pin = (window.__flyLightBubbleOverride = window.__flyLightBubbleOverride || {});
  for (const [key, value] of Object.entries(patch || {})) {
    const base = cur[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base === 'object') {
      pin[key] = { ...base, ...value };
    } else {
      pin[key] = value;
    }
  }
  return r25Block('LightBubble');
}

/** Is a sub-switch armed? (The rig's one-line reads, so the flag is spelled once.) */
export function lightBubbleOn(sub) {
  return r25On('LightBubble', sub);
}

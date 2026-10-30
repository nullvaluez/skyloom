/**
 * SHIP PASS CITY (FLY_SHIP_PASS.md 5.3, CT-4) — NIGHT_LITE: city light from
 * altitude where the Enhanced aerial pass's VIIRS lights are off.
 *
 * THE GAP. NIGHT_LIGHTS (lib/fly/night-lights-atlas.js) draws real city light
 * from altitude inside the Enhanced aerial pass, and that pass's city lights
 * are off on phones and at Low. The generated city (road ring, windows,
 * skyline) ends a few kilometres out, so a phone at night saw one lit
 * neighbourhood and black ground to the horizon ("nearly black at night",
 * FLY_SHIP_PASS.md 12.1). SatCityGlow, the R16 fallback, is not mounted in
 * Enhanced: its additive hemispheres stood up against the horizon.
 *
 * THE LOOK. One instanced draw of FLAT light pools lying on the ground at the
 * POI cities: a disc whose vertex colours carry a hot core and a sodium halo
 * falling to black at the rim (no edge, no silhouette), bent per vertex with
 * the ground through the shared 'world-bend' variant so a 60 km pool lies on
 * the curved terrain instead of tilting into it, additive, no depth write
 * (the terrain behind it writes depth, so the cloud composite never mistakes
 * it for sky and the aerial pass hazes it with the ground it lies on). Pools
 * fade in where the road ring hands off and fade out at the policy's reach.
 * By day the mesh is hidden: zero draws.
 *
 * DEVICES: deviceFeature('NIGHT_LITE') (touch devices, or Low) through
 * nightLiteAllowed(); `window.__flyCityDeviceClass` is the cloud venue's
 * harness pin (lib/fly/city-range.js), never set in production.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, InstancedMesh, MeshBasicMaterial } from 'three';
import { applyBend } from './toy-world/world-bend';
import { shipPassBlock, shipPassOn } from './ship-pass';
import { deviceFeature } from './device-policy';

export const NIGHT_LITE_ON = shipPassOn('NIGHT_LITE');
const BLOCK = shipPassBlock('NIGHT_LITE');
const EARTH_R = 6378137;

/** { allowed, budget } for this device at `tier` (budget.reachM, budget.draws). */
export function nightLitePolicy(tier = 'high', win = globalThis.window) {
  const cls = win?.__flyCityDeviceClass;
  return deviceFeature('NIGHT_LITE', typeof cls === 'string' ? { tier, cls } : { tier });
}

/** Mercator scale at a scene z (world units per true metre). */
export function mercK(z) {
  const lat = 2 * Math.atan(Math.exp(-z / EARTH_R)) - Math.PI / 2;
  return 1 / Math.max(1e-6, Math.cos(lat));
}

/** The disc's radial light profile at t = r / R (linear RGB, core + halo, 0 at the rim). */
export function poolProfile(t, block = BLOCK, out = [0, 0, 0]) {
  const core = new Color(block.coreColor);
  const halo = new Color(block.color);
  const c = Math.max(0, 1 - t / Math.max(1e-6, block.coreFrac));
  const ci = block.coreGain * c * c;
  const h = Math.max(0, 1 - t);
  const hi = block.haloGain * h * h;
  out[0] = core.r * ci + halo.r * hi;
  out[1] = core.g * ci + halo.g * hi;
  out[2] = core.b * ci + halo.b * hi;
  return out;
}

/** A unit disc in XZ (radius 1, facing up): centre + rings x segments, profile in `color`. */
export function createNightLiteGeometry(block = BLOCK) {
  const R = Math.max(1, block.rings | 0);
  const S = Math.max(6, block.segments | 0);
  const pos = [0, 0, 0];
  const col = [...poolProfile(0, block)];
  for (let i = 1; i <= R; i++) {
    const t = i / R;
    const p = poolProfile(t, block);
    for (let j = 0; j < S; j++) {
      const a = (j / S) * Math.PI * 2;
      pos.push(Math.cos(a) * t, 0, Math.sin(a) * t);
      col.push(p[0], p[1], p[2]);
    }
  }
  const idx = [];
  for (let j = 0; j < S; j++) idx.push(0, 1 + ((j + 1) % S), 1 + j); // centre fan, CCW from above
  for (let i = 1; i < R; i++) {
    const a0 = 1 + (i - 1) * S;
    const b0 = 1 + i * S;
    for (let j = 0; j < S; j++) {
      const j1 = (j + 1) % S;
      idx.push(a0 + j, a0 + j1, b0 + j, a0 + j1, b0 + j1, b0 + j);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** The one material (and its program): basic, vertex + instance colour, additive, bent per vertex. */
export function createNightLiteMaterial() {
  const m = new MeshBasicMaterial({
    color: '#ffffff',
    vertexColors: true,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide, // a pool seen from below a ridge line never vanishes
  });
  applyBend(m); // 'world-bend': per-vertex, so the flat pool follows the curved ground
  m.name = 'night-lite-pools';
  return m;
}

/** The prewarm build (lib/fly/prewarm-registry.js CITY block): the exact program. */
export function buildNightLitePrewarm() {
  const mesh = new InstancedMesh(createNightLiteGeometry(), createNightLiteMaterial(), 1);
  mesh.setColorAt(0, new Color(1, 1, 1));
  mesh.frustumCulled = false;
  return mesh;
}

/** The γ night ramp the road network, windows and SatCityGlow share (0 by day). */
export function nightRamp(sunFrac, block = BLOCK) {
  const nt = Math.min(1, Math.max(0, 1 - (sunFrac ?? 1) / block.dayFrac));
  return nt ** block.gamma;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / Math.max(1e-6, b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Which pools to draw (pure; the component and the node gate share it).
 * `cities` [{wx, wz, ...}] in scene units; px/pz the aircraft; distances are
 * judged in TRUE metres (scene / mercK). `roadRingM` the satellite road ring
 * radius (true m), `reachM` the policy reach, `edgeStartM` the world edge
 * band's start (true m, Infinity when unknown). Returns the nearest `cap`
 * with their fade (0..1) and radius (true m), nearest first.
 */
export function placeNightLite(cities, px, pz, { roadRingM, reachM, edgeStartM = Infinity, cap = BLOCK.pool, block = BLOCK }) {
  const k = mercK(pz);
  const nearA = block.nearFade[0] * roadRingM;
  const nearB = block.nearFade[1] * roadRingM;
  const farB = Math.min(reachM * block.farFadeK, edgeStartM);
  const farA = Math.min(reachM, farB);
  const out = [];
  for (const c of cities) {
    const d = Math.hypot(c.wx - px, c.wz - pz) / k;
    if (d <= nearA || d >= farB) continue;
    out.push({ c, d });
  }
  out.sort((a, b) => a.d - b.d);
  if (out.length > cap) out.length = cap;
  const fs = block.farScale;
  for (const o of out) {
    o.fade = smooth(nearA, nearB, o.d) * (1 - smooth(farA, farB, o.d));
    o.r = block.radiusM * (1 + (fs.mul - 1) * smooth(fs.startM, fs.endM, o.d));
  }
  return out;
}

/** The resolved block (tunables; harnesses read it). */
export function nightLiteBlock() {
  return BLOCK;
}

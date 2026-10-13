// AIRFIELD LIGHTS — the airfield lighting system as GlowPoints records.
//
// Built from the airfield model (local metres) for one viewer (the lounge):
// every light is { x, z, h (fixture height above the drawn surface), layer
// (which ground lift it stands on), r, g, b, i (intensity), size, minPx, maxPx,
// mode, hz, phase, duty, beam [dx, dy, dz] (local metres) | null, sharp,
// set: 'steady' | 'flash', papi?: { angle, end } }.
//
// Directional fixtures are directional where the eye can tell: threshold/end
// lights, centreline and touchdown-zone lights, PAPI. A bidirectional fixture
// whose colour depends on the direction (runway edge caution zone, centreline
// colour coding) shows the face the lounge actually looks at. Approach lights
// are on stands and read from the side, so they stay omnidirectional.
//
// Pure: no three. Sources: FAA AC 150/5340-30 and ICAO Annex 14 layouts,
// simplified (spacing, colours and sequencing are faithful; exact fixture
// counts per configuration are approximations).
import { AIRFIELD } from '../observation-config.js';
import { runwayCoords, runwayPoint } from './airfield-model.js';

const CFG = AIRFIELD.ground;
// glow-points.js GLOW_MODE, mirrored so this module stays importable in node
// without three/postprocessing (verify-airfield-ground checks they agree).
export const GLOW_MODE = Object.freeze({ STEADY: 0, STROBE: 1, DOUBLE: 2, BEACON: 3 });

// Linear radiance hues (the GlowPoints buffer units; intensity scales them).
export const LIGHT_COLOR = Object.freeze({
  white: [1.0, 0.9, 0.72],
  approach: [1.0, 0.94, 0.82],
  flasher: [0.9, 0.95, 1.0],
  yellow: [1.0, 0.62, 0.12],
  green: [0.18, 1.0, 0.42],
  red: [1.0, 0.1, 0.06],
  blue: [0.12, 0.32, 1.0],
  taxiGreen: [0.25, 1.0, 0.38],
});

function light(list, x, z, color, i, o = {}) {
  list.push({
    x,
    z,
    h: o.h ?? 0.3,
    layer: o.layer ?? 'pavement',
    r: color[0],
    g: color[1],
    b: color[2],
    i,
    size: o.size ?? 0.7,
    minPx: o.minPx ?? 1.7,
    maxPx: o.maxPx ?? 22,
    mode: o.mode ?? GLOW_MODE.STEADY,
    hz: o.hz ?? 0,
    phase: o.phase ?? 0,
    duty: o.duty ?? 0.08,
    beam: o.beam ?? null,
    sharp: o.sharp ?? 0,
    set: o.set ?? 'steady',
    papi: o.papi ?? null,
    group: o.group ?? 'runway',
  });
}

/** Points every `spacing` metres along a flat local polyline (evenly split). */
function along(pts, spacing) {
  let total = 0;
  for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  if (total < spacing * 0.5) return [];
  const n = Math.max(1, Math.round(total / spacing));
  const step = total / n;
  const out = [];
  let seg = 0, segStart = 0;
  for (let k = 0; k <= n; k++) {
    const d = k * step;
    while (seg + 3 < pts.length) {
      const len = Math.hypot(pts[seg + 2] - pts[seg], pts[seg + 3] - pts[seg + 1]);
      if (d <= segStart + len || seg + 5 >= pts.length) {
        const t = len > 0 ? Math.min(1, (d - segStart) / len) : 0;
        out.push([pts[seg] + (pts[seg + 2] - pts[seg]) * t, pts[seg + 1] + (pts[seg + 3] - pts[seg + 1]) * t, (pts[seg + 2] - pts[seg]) / (len || 1), (pts[seg + 3] - pts[seg + 1]) / (len || 1)]);
        break;
      }
      segStart += len;
      seg += 2;
    }
  }
  return out;
}

/**
 * The whole system for one airport model. `viewer` = local { x, z } (the
 * lounge) chooses the visible face of bidirectional fixtures. `paved(x, z)`
 * answers "is this point on other pavement" (edge lights skip junction
 * interiors and runway crossings). At most `capacity` lights (capLights).
 */
export function buildAirfieldLights(model, { viewer = { x: 0, z: 0 }, paved = () => false, capacity = CFG.lights.capacity } = {}) {
  return capLights(systemLights(model, viewer, paved), capacity, viewer);
}

// Taxiway edge and centreline lights are the many (KJFK: thousands along
// every taxiway); past the capacity the farthest of them go first — at that
// range they are single pixels in a carpet. The runway systems, stop bars and
// guard lights go only if the cap is smaller than they are, farthest first.
const SHEDDABLE = new Set(['taxiEdge', 'taxiCenter']);
export function capLights(list, capacity, viewer = { x: 0, z: 0 }) {
  if (!(list.length > capacity)) return list;
  const rank = list.map((l, i) => ({ i, shed: SHEDDABLE.has(l.group) ? 1 : 0, d: (l.x - viewer.x) ** 2 + (l.z - viewer.z) ** 2 }));
  rank.sort((a, b) => a.shed - b.shed || a.d - b.d || a.i - b.i);
  const kept = new Uint8Array(list.length);
  for (let k = 0; k < Math.max(0, capacity); k++) kept[rank[k].i] = 1;
  return list.filter((_, i) => kept[i]); // original order: deterministic, grouped as built
}

function systemLights(model, viewer, paved) {
  const list = [];
  const icao = model.style === 'icao';
  const lighted = model.runways.some((r) => r.lighted);
  for (const r of model.runways) {
    if (!r.lighted) continue;
    const v = runwayCoords(r, viewer.x, viewer.z);
    const L = r.length;
    const ux = r.ux, uz = r.uz;
    // --- edge lights (HIRL/MIRL): white, the last 600 m yellow toward the
    // landing direction; elevated just outside the edge.
    const nEdge = Math.max(2, Math.ceil(L / 60));
    for (let k = 0; k <= nEdge; k++) {
      const s = (L * k) / nEdge;
      const yellow = (s > L - 600 && v.s < s - 20) || (s < 600 && v.s > s + 20);
      for (const side of [1, -1]) {
        const [x, z] = runwayPoint(r, s, side * (r.halfW + 1));
        light(list, x, z, yellow && r.cls <= 1 ? LIGHT_COLOR.yellow : LIGHT_COLOR.white, r.cls === 0 ? 3.2 : 2.4, { h: 0.36, size: 0.8, group: 'edge' });
      }
    }
    // --- per end: threshold (green, outward) / end (red, inward), approach
    // lights, touchdown zone, PAPI.
    for (const end of [0, 1]) {
      const dir = end === 0 ? 1 : -1; // landing direction along +u for end A
      const sEnd = end === 0 ? 0 : L; // pavement end
      const thr = end === 0 ? r.thrA : r.thrB;
      const sThr = sEnd + dir * thr; // landing threshold
      const out = [-ux * dir, 0.05, -uz * dir]; // toward the approach
      const inward = [ux * dir, 0.02, uz * dir];
      const nAcross = Math.max(4, Math.round((2 * r.halfW) / 3));
      for (let k = 0; k <= nAcross; k++) {
        const c = -r.halfW + (2 * r.halfW * k) / nAcross;
        const [tx, tz] = runwayPoint(r, sThr, c);
        light(list, tx, tz, LIGHT_COLOR.green, 3.0, { h: 0.12, size: 0.9, beam: out, sharp: 2.2, group: 'threshold' });
        const [ex, ez] = runwayPoint(r, sEnd, c);
        light(list, ex, ez, LIGHT_COLOR.red, 2.6, { h: 0.12, size: 0.9, beam: inward, sharp: 2.2, group: 'end' });
      }
      // Wing bars beyond the edges on precision runways.
      if (r.cls === 0) {
        for (const side of [1, -1])
          for (let k = 1; k <= 5; k++) {
            const [x, z] = runwayPoint(r, sThr, side * (r.halfW + 2 + k * 1.5));
            light(list, x, z, LIGHT_COLOR.green, 3.0, { h: 0.35, size: 0.9, beam: out, sharp: 2.2, group: 'threshold' });
          }
      }
      // --- approach lighting system beyond the threshold.
      const als = end === 0 ? r.alsA : r.alsB;
      if (als !== 'none') {
        const lenM = als === 'alsf2' ? (icao ? 900 : 730) : 730;
        const pitch = als === 'alsf2' ? 30 : 61;
        const at = (d, c) => runwayPoint(r, sThr - dir * d, c);
        const stand = { h: 0.8, layer: 'grass', size: 1.0, group: 'approach' };
        const nBar = Math.round(lenM / pitch);
        for (let k = 1; k <= nBar; k++) {
          const d = k * pitch;
          // Centreline barrette: five lights across ~4.2 m.
          for (let q = -2; q <= 2; q++) {
            const [x, z] = at(d, q * 1.05);
            light(list, x, z, LIGHT_COLOR.approach, 2.4, stand);
          }
          // Inner 300 m of an ALSF-2: red side-row barrettes.
          if (als === 'alsf2' && d <= 300) {
            for (const side of [1, -1])
              for (let q = 0; q < 3; q++) {
                const [x, z] = at(d, side * (11 + q * 1.5));
                light(list, x, z, LIGHT_COLOR.red, 2.0, stand);
              }
          }
        }
        // Crossbars: 300 m (ALSF-2 also 150 m), ~30 m wide each side.
        for (const d of als === 'alsf2' ? [150, 300] : [300]) {
          for (const side of [1, -1])
            for (let q = 0; q < 8; q++) {
              const [x, z] = at(d, side * (4 + q * 1.6));
              light(list, x, z, LIGHT_COLOR.approach, 2.4, stand);
            }
        }
        // Sequenced flashers ("the rabbit"): outer part, outermost first, twice
        // a second. Each flash is ~2 frames long; the sweep takes ~35% of the
        // period so the ball of light visibly runs toward the runway.
        const from = als === 'alsf2' ? 300 : 488; // MALSR: RAIL beyond the MALS
        const flashers = [];
        for (let d = lenM; d > from - 1; d -= pitch) flashers.push(d);
        if (als === 'malsr') for (let d = 975; d > 730; d -= 61) flashers.unshift(d);
        flashers.sort((a, b) => b - a);
        flashers.forEach((d, idx) => {
          const [x, z] = at(d, 0);
          light(list, x, z, LIGHT_COLOR.flasher, 14, {
            h: 1.2,
            layer: 'grass',
            size: 1.6,
            minPx: 2.4,
            maxPx: 40,
            mode: GLOW_MODE.STROBE,
            hz: 2,
            duty: 0.07,
            phase: -(idx / Math.max(1, flashers.length)) * 0.35,
            set: 'flash',
            group: 'rabbit',
          });
        });
      }
      // --- touchdown zone lights: barrettes of three either side of the
      // centreline from 30 m to 900 m past the threshold, facing the approach.
      if (r.tdzLights) {
        const inner = Math.min(11, r.halfW * 0.42);
        for (let d = 30; d <= Math.min(900, L * 0.45); d += 30) {
          for (const side of [1, -1])
            for (let q = 0; q < 3; q++) {
              const [x, z] = runwayPoint(r, sThr + dir * d, side * (inner + q * 1.5));
              light(list, x, z, LIGHT_COLOR.white, 1.4, { h: 0.03, size: 0.55, beam: out, sharp: 5, group: 'tdz' });
            }
        }
      }
      // --- PAPI: four boxes on the pilot's left, abeam the aiming point.
      if (r.cls <= 1) {
        const sP = sThr + dir * (icao ? (L >= 2400 ? 400 : 300) : 330);
        const angles = [3.5, 3.17, 2.83, 2.5];
        angles.forEach((angle, q) => {
          // Pilot's left of a landing along +u*dir is +c*dir.
          const [x, z] = runwayPoint(r, sP, dir * (r.halfW + 15 + q * 9));
          light(list, x, z, LIGHT_COLOR.white, 9, {
            h: 0.9,
            layer: 'grass',
            size: 1.4,
            minPx: 2.2,
            maxPx: 34,
            beam: [out[0], 0.05, out[2]],
            sharp: 10,
            set: 'flash',
            group: 'papi',
            papi: { angle, dirX: -ux * dir, dirZ: -uz * dir },
          });
        });
      }
    }
    // --- runway centreline lights (precision runways): every 15 m, colour
    // coded toward the far end (white, then red/white from 900 m, red last
    // 300 m) on the face the lounge sees.
    if (r.centerlineLights) {
      for (let s = 15; s < L - 7; s += 15) {
        const facingA = v.s < s; // lounge looks at the A-facing side
        const remaining = facingA ? L - s : s;
        let col = LIGHT_COLOR.white;
        if (remaining < 300) col = LIGHT_COLOR.red;
        else if (remaining < 900) col = Math.round(s / 15) % 2 ? LIGHT_COLOR.red : LIGHT_COLOR.white;
        const [x, z] = runwayPoint(r, s, 0);
        light(list, x, z, col, 1.6, { h: 0.03, size: 0.55, beam: facingA ? [-ux, 0.02, -uz] : [ux, 0.02, uz], sharp: 4, group: 'centerline' });
      }
    }
  }
  if (lighted) {
    // --- taxiway edge lights (blue, elevated, ~45 m; skip where the edge runs
    // inside other pavement) and, on large airports, green centreline lights
    // (yellow/green alternating inside a runway's hold zone).
    for (const t of model.taxiways) {
      for (const side of [1, -1]) {
        const off = t.halfW + 1.5;
        const pts = [];
        const n = t.pts.length / 2;
        for (let i = 0; i < n; i++) {
          let nx = 0, nz = 0;
          for (const j of [i - 1, i]) {
            if (j < 0 || j + 1 >= n) continue;
            const dx = t.pts[(j + 1) * 2] - t.pts[j * 2], dz = t.pts[(j + 1) * 2 + 1] - t.pts[j * 2 + 1];
            const l = Math.hypot(dx, dz) || 1;
            nx += dz / l;
            nz += -dx / l;
          }
          const l = Math.hypot(nx, nz) || 1;
          pts.push(t.pts[i * 2] + (nx / l) * off * side, t.pts[i * 2 + 1] + (nz / l) * off * side);
        }
        for (const [x, z] of along(pts, 45)) {
          if (paved(x, z, t)) continue;
          light(list, x, z, LIGHT_COLOR.blue, 1.6, { h: 0.35, size: 0.6, group: 'taxiEdge' });
        }
      }
      if (model.aClass === 0) {
        for (const [x, z] of along(t.pts, 30)) {
          // Inside a runway's hold zone the lead-on/off lights alternate.
          let zone = false;
          for (const r of model.runways) {
            const q = runwayCoords(r, x, z);
            if (Math.abs(q.c) < r.halfW + 60 && q.s > -30 && q.s < r.length + 30) zone = true;
          }
          if (zone && model.runways.some((r) => {
            const q = runwayCoords(r, x, z);
            return Math.abs(q.c) < r.halfW + 1 && q.s > 0 && q.s < r.length;
          })) continue;
          const col = zone && Math.round((x + z) / 15) % 2 ? LIGHT_COLOR.yellow : LIGHT_COLOR.taxiGreen;
          light(list, x, z, col, 0.9, { h: 0.03, size: 0.45, group: 'taxiCenter' });
        }
      }
    }
    // --- stop bars (red, across the taxiway at the hold line) and runway
    // guard lights (yellow pairs, alternating) at every holding position.
    for (const h of model.holds) {
      const nx = -h.dz, nz = h.dx;
      const n = Math.max(3, Math.round((2 * h.halfW) / 3));
      for (let k = 0; k <= n; k++) {
        const u = -h.halfW + 0.5 + ((2 * h.halfW - 1) * k) / n;
        light(list, h.x + nx * u - h.dx * 0.6, h.z + nz * u - h.dz * 0.6, LIGHT_COLOR.red, 1.8, { h: 0.04, size: 0.55, beam: [-h.dx, 0.03, -h.dz], sharp: 1.5, group: 'stopbar' });
      }
      for (const side of [1, -1]) {
        const u = side * (h.halfW + 3);
        light(list, h.x + nx * u - h.dx * 1.5, h.z + nz * u - h.dz * 1.5, LIGHT_COLOR.yellow, 3.2, {
          h: 0.8,
          layer: 'grass',
          size: 0.8,
          mode: GLOW_MODE.STROBE,
          hz: 0.8,
          duty: 0.45,
          phase: side > 0 ? 0 : 0.5,
          beam: [-h.dx, 0.05, -h.dz],
          sharp: 1.2,
          set: 'flash',
          group: 'guard',
        });
      }
    }
  }
  return list;
}

/**
 * PAPI colour for an eye at elevation angle `deg` above a unit set at
 * `angle`: white above, red below, a short pink transition (the real optics
 * have one, ~0.1°).
 */
export function papiColor(deg, angle, out = [0, 0, 0]) {
  const t = Math.max(0, Math.min(1, (deg - angle + 0.08) / 0.16));
  out[0] = LIGHT_COLOR.red[0] + (LIGHT_COLOR.white[0] - LIGHT_COLOR.red[0]) * t;
  out[1] = LIGHT_COLOR.red[1] + (LIGHT_COLOR.white[1] - LIGHT_COLOR.red[1]) * t;
  out[2] = LIGHT_COLOR.red[2] + (LIGHT_COLOR.white[2] - LIGHT_COLOR.red[2]) * t;
  return out;
}

/** Day/night switch for the system: 1 at night, 0 in daylight (sun elevation in degrees). */
export function airfieldLightLevel(sunElevDeg) {
  const { onDeg, fullDeg } = CFG.lights;
  if (!Number.isFinite(sunElevDeg)) return 1;
  const t = Math.max(0, Math.min(1, (onDeg - sunElevDeg) / (onDeg - fullDeg)));
  return t * t * (3 - 2 * t);
}

// Read-only facts for the airport table and window instruments. No scene
// objects, random traffic, schedules, camera commands or persistent progress.
import { classifyContact, contactLabel, phaseLabel } from '../airport-watch-board.mjs';
import { trackPhase } from '../flight-phase.js';
import { roomVariant } from './room-plan.js';

const RAD = Math.PI / 180;
export const compassDegrees = (v) => ((v % 360) + 360) % 360;

export function worldToObservation(site, point) {
  const k = site.k || 1, c = Math.cos(site.heading || 0), s = Math.sin(site.heading || 0);
  const dx = (point.x - site.x) / k, dz = (point.z - site.z) / k;
  return { x: dx * c - dz * s, y: point.y - (site.groundY + site.floorM), z: dx * s + dz * c };
}
export function observationToWorld(site, point) {
  const k = site.k || 1, c = Math.cos(site.heading || 0), s = Math.sin(site.heading || 0);
  return { x: site.x + (point.x * c + point.z * s) * k, y: site.groundY + site.floorM + point.y, z: site.z + (-point.x * s + point.z * c) * k };
}

function inRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}
const inPiece = (x, z, rings) => inRing(x, z, rings[0]) && !rings.slice(1).some((r) => inRing(x, z, r));

/** Segment vs extruded OSM polygons, including holes and tile-clipped pieces.
 * Heights are relative to the airfield datum (the existing structures' basis).
 * Unknown-height footprints block conservatively instead of inventing clearance.
 */
export function buildingBlocksSegment(eye, target, building, groundY = 0) {
  const dx = target.x - eye.x, dz = target.z - eye.z, dy = target.y - eye.y;
  const y0 = groundY + Math.max(0, building.minHeight || 0);
  const y1 = Number.isFinite(building.height) && building.height > 0 ? groundY + building.height : Infinity;
  if (Math.min(eye.y, target.y) > y1 || Math.max(eye.y, target.y) < y0) return false;
  if (Number.isFinite(building.minX) && (Math.max(eye.x, target.x) < building.minX || Math.min(eye.x, target.x) > building.maxX || Math.max(eye.z, target.z) < building.minZ || Math.min(eye.z, target.z) > building.maxZ)) return false;
  for (const rings of building.pieces || []) {
    if (!rings[0]?.length) continue;
    const ts = [0, 1];
    // Height crossings are interval boundaries too: a ray can enter a tall
    // wall through its roof between two footprint crossings.
    if (Math.abs(dy) > 1e-10) for (const y of [y0, y1]) {
      const t = (y - eye.y) / dy; if (t > 0 && t < 1) ts.push(t);
    }
    for (const ring of rings) for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length, ax = ring[i], az = ring[i + 1], ex = ring[j] - ax, ez = ring[j + 1] - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-10) continue;
      const rx = ax - eye.x, rz = az - eye.z;
      const t = (rx * ez - rz * ex) / den, u = (rx * dz - rz * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) {
      const t = (ts[i - 1] + ts[i]) / 2, y = eye.y + dy * t;
      if (t > 1e-6 && y >= y0 && y <= y1 && inPiece(eye.x + dx * t, eye.z + dz * t, rings)) return true;
    }
  }
  return false;
}

export function airfieldSightline(eye, target, features, groundY = 0) {
  // Missing/partially fetched geometry is never certified as an unobstructed
  // window. The table remains useful with its live dots and explicit status.
  if (!features || !Array.isArray(features.buildings) || (features.tiles?.failed || 0) > 0) return 'unverified';
  return features.buildings.some((b) => buildingBlocksSegment(eye, target, b, groundY)) ? 'blocked' : 'verified-airfield';
}

/** Bounded terrain LOS. Unknown/coarse tiles and rays too long to sample at
 * the fixed maximum spacing stay unverified. `sample` supplies the drawn
 * (earth-bent) elevation, so aircraft and ground are compared in one frame.
 * This is sampled terrain evidence, never a claim to ray-trace every mesh.
 */
export function sampledTerrainSightline(eye, target, sample, { k = 1, stepM = 250, maxSamples = 64, minTileZ = 12, clearanceM = .5 } = {}) {
  const distanceM = Math.hypot(target.x - eye.x, target.z - eye.z) / k;
  const count = Math.max(2, Math.ceil(distanceM / stepM));
  if (typeof sample !== 'function' || count > maxSamples) return 'unverified';
  let unknown = false;
  for (let i = 1; i < count; i++) {
    const t = i / count, x = eye.x + (target.x - eye.x) * t, z = eye.z + (target.z - eye.z) * t;
    const ground = sample(x, z);
    if (!ground || !Number.isFinite(ground.elev) || !Number.isFinite(ground.tileZ) || !(ground.tileZ >= minTileZ)) { unknown = true; continue; }
    if (ground.elev + clearanceM >= eye.y + (target.y - eye.y) * t) return 'blocked';
  }
  return unknown ? 'unverified' : 'clear';
}

/** Mirror the scenery retirement contract and add conservative volumes for
 * the generated terminal, hangars and tower that replace those footprints.
 */
export function observationBuildingFeatures(features, site, plan, apronY = site.groundY) {
  if (!features) return null;
  const buildings = (features.buildings || []).filter((b) => {
    if (b.hide3d) return false;
    if (!plan || !Number.isFinite(b.cx) || !Number.isFinite(b.cz)) return true;
    const p = worldToObservation(site, { x: b.cx, y: 0, z: b.cz });
    return !plan.footprint?.some((r) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1);
  });
  const add = (id, x0, x1, z0, z1, height) => {
    const ring = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].flatMap(([x, z]) => {
      const p = observationToWorld(site, { x, y: 0, z }); return [p.x, p.z];
    });
    buildings.push({ id, minHeight: apronY - site.groundY, height: apronY - site.groundY + height, pieces: [[ring]],
      minX: Math.min(...ring.filter((_, i) => i % 2 === 0)), maxX: Math.max(...ring.filter((_, i) => i % 2 === 0)),
      minZ: Math.min(...ring.filter((_, i) => i % 2 === 1)), maxZ: Math.max(...ring.filter((_, i) => i % 2 === 1)) });
  };
  if (plan?.terminal) { const t = plan.terminal; add('set-terminal', t.x0, t.x1, t.z0, t.z1, t.roofY + .5); }
  for (const h of plan?.hangars || []) add('set-hangar', h.x - h.w / 2 - 3, h.x + h.w / 2 + 3, h.z - h.d / 2 - 1, h.z + h.d / 2 + 1, h.h + 3);
  if (plan?.tower) { const t = plan.tower, r = Math.max(7, t.h * .16); add('set-tower', t.x - r, t.x + r, t.z - r, t.z + r, t.h + 5); }
  return { ...features, buildings };
}

/** Actual registered runway endpoints, in room-local true metres. */
export function observationRunways(records, frameOf, site, runwayLines = []) {
  const result = (records || []).flatMap((r) => {
    let f;
    try { f = frameOf(r); } catch { return []; }
    if (!f || !Number.isFinite(f.length) || !(f.length > 0)) return [];
    const a = worldToObservation(site, { x: f.x, z: f.z, y: site.groundY });
    const b = worldToObservation(site, { x: f.x + f.ux * f.length * f.k, z: f.z + f.uz * f.length * f.k, y: site.groundY });
    return [{ id: r.id, label: [r.runway, r.reciprocal].filter(Boolean).join(' / '), a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, widthM: r.width || 30 }];
  });
  for (const [index, line] of runwayLines.entries()) {
    const p = line.pts;
    if (!p || p.length < 4 || !p.every(Number.isFinite)) continue;
    const a = worldToObservation(site, { x: p[0], z: p[1], y: site.groundY });
    const b = worldToObservation(site, { x: p.at(-2), z: p.at(-1), y: site.groundY });
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 1) continue;
    let row = { id: `osm-runway:${line.id ?? index}`, label: line.ref || 'Runway', a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, widthM: 30 };
    let insertAt = result.length;
    // OSM can split one runway at several taxiway intersections. Join aligned,
    // connected pieces as well as overlapping duplicates; otherwise the table
    // repeats runway labels and can discard the far end of a partial feature.
    // Revisit after each join so a late middle segment joins both outer pieces.
    for (let i = 0; i < result.length;) {
      const r = result[i], rx = r.b.x - r.a.x, rz = r.b.z - r.a.z, rl = Math.hypot(rx, rz);
      const nx = row.b.x - row.a.x, nz = row.b.z - row.a.z, nl = Math.hypot(nx, nz);
      if (!rl || !nl || Math.abs((rx * nx + rz * nz) / (rl * nl)) < .995) { i++; continue; }
      const along = (p) => ((p.x - r.a.x) * rx + (p.z - r.a.z) * rz) / rl;
      const cross = (p) => Math.abs((p.x - r.a.x) * rz - (p.z - r.a.z) * rx) / rl;
      const lo = Math.min(along(row.a), along(row.b)), hi = Math.max(along(row.a), along(row.b));
      if (Math.max(cross(row.a), cross(row.b)) >= 45 || hi < -100 || lo > rl + 100) { i++; continue; }
      const endpoints = [r.a, r.b, row.a, row.b].sort((p, q) => along(p) - along(q));
      row = { ...r, a: endpoints[0], b: endpoints.at(-1) };
      insertAt = Math.min(insertAt, i); result.splice(i, 1); i = 0;
    }
    result.splice(Math.min(insertAt, result.length), 0, row);
  }
  return result;
}

export const OBSERVATION_EYES = Object.freeze({
  front: Object.freeze([{ x: -2.2, y: 1.65, z: -.3 }, { x: 2.2, y: 1.65, z: -.3 }]),
  back: Object.freeze([{ x: -2.15, y: 1.65, z: 12.8 }, { x: 2.15, y: 1.65, z: 12.8 }]),
});

/** Tracks are exclusively runtime.traffic.items. Scenery never enters here.
 * Freshness is the traffic system's authoritative stale state, not the server
 * clock. The aircraft point callback must mirror the render-time world bend.
 */
export function observationContacts(tracks, { site, eye, selected = null, runways = [], features = null, pointOf, apertureFrom, terrainSightline, maxRangeM = 80000 }) {
  if (!site || !eye) return [];
  const eyeWorld = observationToWorld(site, eye), k = site.k || 1;
  const ctx = { k, ref: { x: site.x, z: site.z }, fieldElev: site.groundY, runways };
  const upper = roomVariant(site.variant).upper;
  const viewpointLevel = upper && eye.y > upper.floorY + .75 ? 'upper' : 'lower';
  const viewingEyes = viewpointLevel === 'upper' ? {
    front: [{ x: -2.2, y: upper.floorY + 1.65, z: upper.glazing.frontZ + .65 }, { x: 2.2, y: upper.floorY + 1.65, z: upper.glazing.frontZ + .65 }],
    back: [{ x: -2.15, y: upper.floorY + 1.65, z: upper.glazing.backZ - .65 }, { x: 2.15, y: upper.floorY + 1.65, z: upper.glazing.backZ - .65 }],
  } : OBSERVATION_EYES;
  const result = [], seen = new Set();
  for (const t of tracks || []) {
    if (!t?.hex || !t.fix1 || (t.stale ?? 0) !== 0 || t.scenery || t.isScenery || t.source === 'scenery' || seen.has(t.hex)) continue;
    if ((t.horizonFade ?? 1) < .05) continue;
    const world = pointOf ? pointOf(t) : { x: t.rx, y: t.ryd ?? t.ry, z: t.rz };
    if (![world?.x, world?.y, world?.z].every(Number.isFinite)) continue;
    const local = worldToObservation(site, world), dx = (world.x - eyeWorld.x) / k, dz = (world.z - eyeWorld.z) / k;
    const distanceM = Math.hypot(dx, world.y - eyeWorld.y, dz);
    if (distanceM > maxRangeM) continue;
    seen.add(t.hex);
    const motionKnown = [t.fix1.vE, t.fix1.vN, t.fix1.vUp].every(Number.isFinite);
    const c = motionKnown ? classifyContact(t, ctx) : null;
    const phase = motionKnown ? c?.phase ?? trackPhase(t, site.groundY) : null;
    const viewpoints = [];
    let visibility = features ? 'blocked' : 'unverified';
    for (const side of site.variant === 'pier' ? ['front', 'back'] : ['front']) {
      for (const sample of viewingEyes[side]) {
        const vx = local.x - sample.x, vy = local.y - sample.y, vz = local.z - sample.z, len = Math.hypot(vx, vy, vz);
        const aperture = apertureFrom?.(sample, vx / len, vy / len, vz / len, site.variant);
        if (aperture !== side && !(side === 'front' && (aperture === 'roof' || aperture === 'side'))) continue;
        const observer = observationToWorld(site, sample);
        let state = airfieldSightline(observer, world, features, site.groundY);
        if (state === 'verified-airfield') {
          const terrain = terrainSightline?.(observer, world, t.hex, side) ?? 'unverified';
          if (terrain !== 'clear') state = terrain === 'blocked' ? 'blocked' : 'unverified';
        }
        if (state === 'unverified') visibility = state;
        if (state === 'verified-airfield') { viewpoints.push(side); visibility = state; break; }
      }
    }
    const preferred = local.z > 7 ? 'back' : 'front';
    const bestView = viewpoints.includes(preferred) ? preferred : viewpoints[0] ?? null;
    result.push({ hex: t.hex, label: contactLabel(t.meta, t.hex), x: local.x, z: local.z,
      bearing: compassDegrees(Math.atan2(dx, -dz) / RAD), roomBearing: compassDegrees(Math.atan2(local.x - eye.x, -(local.z - eye.z)) / RAD),
      distanceM, phase, phaseLabel: motionKnown ? c?.phaseLabel ?? phaseLabel(phase) : 'Movement unavailable', category: c?.category ?? 'local',
      stale: 0, viewpoints, bestView, viewpointLevel, bestViewLabel: bestView ? `${viewpointLevel === 'upper' ? 'Upper ' : ''}${bestView === 'back' ? 'rear' : 'front'} window` : null, visibility, selected: selected === t.hex,
    });
  }
  return result.sort((a, b) => Number(b.selected) - Number(a.selected) || a.distanceM - b.distanceM || a.hex.localeCompare(b.hex));
}

export function createSuggestionMemory() {
  return { front: { hex: null, candidate: null, since: 0 }, back: { hex: null, candidate: null, since: 0 } };
}

/** Hold a valid suggestion until a better candidate persists, but immediately
 * remove stale/lost/blocked contacts. No quiet-feed filler or invented events.
 */
export function windowSuggestions(contacts, memory, nowSec, { eyeSide = 'front', holdSec = 5 } = {}) {
  const out = { front: null, back: null };
  for (const side of ['front', 'back']) {
    const candidates = contacts.filter((c) => c.stale === 0 && c.viewpoints.includes(side)).flatMap((c) => {
      const opposite = c.selected && side !== eyeSide && !c.viewpoints.includes(eyeSide);
      const kind = opposite ? 'opposite' : c.category === 'arrivals' ? 'approach' : c.category === 'departures' ? 'departure' : c.category === 'overhead' ? 'overhead' : null;
      if (!kind) return [];
      const priority = { opposite: 100, approach: 60, departure: 55, overhead: 40 }[kind];
      const text = { opposite: 'Selected aircraft at the other window', approach: 'An approaching aircraft', departure: 'A departure', overhead: 'An overhead crossing' }[kind];
      return [{ hex: c.hex, label: c.label, kind, text, side, score: priority + 10 / (1 + c.distanceM / 1000) }];
    }).sort((a, b) => b.score - a.score || a.hex.localeCompare(b.hex));
    const m = memory[side], best = candidates[0];
    const current = candidates.find((c) => c.hex === m.hex);
    if (!best) { m.hex = m.candidate = null; continue; }
    if (!current) { m.hex = best.hex; m.candidate = null; }
    else if (best.hex === current.hex || best.score < current.score + 1) m.candidate = null;
    else if (m.candidate !== best.hex) { m.candidate = best.hex; m.since = nowSec; }
    else if (nowSec - m.since >= holdSec) { m.hex = best.hex; m.candidate = null; }
    const chosen = candidates.find((c) => c.hex === m.hex);
    if (chosen) { const { score: _score, ...visible } = chosen; out[side] = visible; }
  }
  return out;
}

/** A visual activity meter, not an audio measurement or a fabricated voice. */
export function listeningActivity(contacts, roomBearing) {
  let energy = 0;
  for (const c of contacts) {
    const angle = (c.roomBearing - roomBearing) * RAD;
    const directional = Math.pow(Math.max(0, Math.cos(angle)), 4);
    energy += directional / (1 + (c.distanceM / 1800) ** 2);
  }
  return Math.min(1, energy);
}

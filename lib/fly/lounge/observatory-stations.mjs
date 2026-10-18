// Shared room-local instrument contract. Rendering, picking and the HUD use
// these same bounds; no station owns a camera or a locomotion controller.
import { roomVariant } from './room-plan.js';
import { deckRayHit } from './room-elevation.mjs';
import { RESERVED_STATIONS } from './upper-dressing.mjs';

const cache = new Map();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function observatoryStations(variant = 'classic') {
  const key = variant === 'pier' ? 'pier' : 'classic';
  if (cache.has(key)) return cache.get(key);
  const station = (id, kind, label, position, side = null, half = [.22, .16, .19], floorY = 0) => Object.freeze({
    id, kind, label, side, variant: key, floorY, floorId: floorY > 0 ? 'upper' : 'lower', position: Object.freeze(position),
    prompt: { table: 'Open airport table', listen: 'Listen through this window', support: 'Rest binoculars on the rail', compass: 'Read window compass', night: 'Toggle Night Watch' }[kind],
    reachM: kind === 'table' ? 1.85 : 1.65,
    bounds: Object.freeze({ min: Object.freeze(position.map((v, i) => v - half[i])), max: Object.freeze(position.map((v, i) => v + half[i])) }),
  });
  const list = [
    station('airport-table', 'table', 'Airport table', [roomVariant(key).communalTableX, .8, 6.6], null, [1.95, .07, .47]),
    station('front-listen', 'listen', 'Front listening window', [-2.2, 1.12, -.83], 'front'),
    station('front-support', 'support', 'Front observation rail', [2.2, 1.02, -.83], 'front', [.5, .12, .12]),
    station('front-compass', 'compass', 'Front window compass', [6.8, 1.12, -.83], 'front'),
    station('night', 'night', 'Night Watch', [3, 1.08, -.83]),
  ];
  if (key === 'pier') list.push(
    station('back-listen', 'listen', 'Rear listening window', [-2.15, 1.12, 13.78], 'back'),
    station('back-support', 'support', 'Rear observation rail', [2.15, 1.02, 13.78], 'back', [.5, .12, .12]),
    station('back-compass', 'compass', 'Rear window compass', [3.7, 1.12, 13.78], 'back'),
  );
  const upper = roomVariant(key).upper;
  if (upper) list.push(
    station('upper-front-support', 'support', 'Upper front observation rail', [1.0, upper.floorY + 1.02, upper.glazing.frontZ + .28], 'front', [.5, .12, .12], upper.floorY),
    station('upper-back-support', 'support', 'Upper rear observation rail', [-1.0, upper.floorY + 1.02, upper.glazing.backZ - .35], 'back', [.5, .12, .12], upper.floorY),
    // The upstairs listening window (second-level pass, LIFE), exactly where
    // the dressing contract reserved it: mid-bay on the upper front glazing,
    // the lower windows' instrument on the upper floor. Appended last, so
    // every existing station keeps its place (and its display tile).
    ...RESERVED_STATIONS.map((r) => station(r.id, r.kind, r.label, [...r.position], r.side, undefined, r.floorY)),
  );
  cache.set(key, Object.freeze(list));
  return cache.get(key);
}

/** Distance along a unit ray to an AABB, or Infinity. */
export function rayBox(origin, direction, min, max) {
  const o = [origin.x, origin.y, origin.z], d = [direction.x, direction.y, direction.z];
  let near = -Infinity, far = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-10) {
      if (o[i] < min[i] || o[i] > max[i]) return Infinity;
      continue;
    }
    const a = (min[i] - o[i]) / d[i], b = (max[i] - o[i]) / d[i];
    near = Math.max(near, Math.min(a, b)); far = Math.min(far, Math.max(a, b));
  }
  return far >= Math.max(near, 0) ? Math.max(near, 0) : Infinity;
}

const heights = { wall: 6.2, door: 4, planter: 2.2, seat: 1.05, sofa: 1.08, table: .8, bar: 1.18, counter: 1.18 };

/** Conservative LOS against the same oriented furniture/wall blockers as walking. */
export function stationLineClear(station, eye, target, blockers = []) {
  const distance = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
  if (distance < .01) return true;
  const dir = { x: (target.x - eye.x) / distance, y: (target.y - eye.y) / distance, z: (target.z - eye.z) / distance };
  if (deckRayHit(eye, dir, roomVariant(station.variant).upper, distance - .04) < Infinity) return false;
  for (const b of blockers) {
    // The diagram is part of its host table. Its own collision proxy includes
    // the chairs; rejecting that proxy would make the real top unclickable.
    if (station.kind === 'table' && b.kind === 'table' && Math.hypot(b.c[0] - station.position[0], b.c[1] - station.position[2]) < .1) continue;
    const c = Math.cos(b.rot || 0), s = Math.sin(b.rot || 0);
    const dx = eye.x - b.c[0], dz = eye.z - b.c[1];
    const local = { x: dx * c - dz * s, y: eye.y, z: dx * s + dz * c };
    const ld = { x: dir.x * c - dir.z * s, y: dir.y, z: dir.x * s + dir.z * c };
    const base = b.y0 ?? 0, top = b.y1 ?? b.topM ?? heights[b.kind] ?? 2;
    // Disc blockers use their circumscribing box: conservative and never see
    // through foliage whose individual leaves are intentionally not colliders.
    if (rayBox(local, ld, [-b.h[0], base, -(b.h[1] ?? b.h[0])], [b.h[0], top, b.h[1] ?? b.h[0]]) < distance - .04) return false;
  }
  return true;
}

/** Availability is separate from targeting, allowing equivalent HUD controls. */
export function stationState(station, { eye, yaw = 0, active = true, validated = true, posture = 'standing', blockers = [] }) {
  const p = station.position;
  const target = { x: clamp(eye.x, station.bounds.min[0], station.bounds.max[0]), y: p[1], z: clamp(eye.z, station.bounds.min[2], station.bounds.max[2]) };
  const distanceM = Math.hypot(eye.x - target.x, eye.z - target.z);
  const nearby = distanceM <= station.reachM && Math.abs(eye.y - ((station.floorY ?? 0) + 1.65)) <= 1.05 && stationLineClear(station, eye, target, blockers);
  const facing = Math.abs(wrap(Math.atan2(-(target.x - eye.x), -(target.z - eye.z)) - yaw)) <= Math.PI * .24;
  const enabled = active && validated && posture !== 'gliding';
  const remote = station.kind === 'table' || station.kind === 'compass' || station.kind === 'night';
  const available = enabled && (station.kind !== 'support' || posture === 'standing') && (remote || nearby);
  const reason = !enabled ? 'Wait until the lounge is ready.' : station.kind === 'support' && posture !== 'standing' ? 'Stand beside the rail to rest your binoculars.' : !remote && !nearby ? 'Walk beside this window to use it.' : '';
  return { ...station, available, nearby, facing, distanceM, reason };
}

export function stationPrompt(states) {
  const best = states.filter((s) => s.available && s.nearby && s.facing).sort((a, b) => a.distanceM - b.distanceM)[0];
  return best ? { id: best.id, label: best.label, action: best.prompt, distanceM: best.distanceM } : null;
}

export function stationOnRay(stations, eye, direction, blockers = []) {
  let result = null, best = Infinity;
  for (const station of stations) {
    const state = stationState(station, { eye, blockers });
    if (!state.nearby) continue;
    const t = rayBox(eye, direction, station.bounds.min, station.bounds.max);
    if (t >= best) continue;
    const target = { x: eye.x + direction.x * t, y: eye.y + direction.y * t, z: eye.z + direction.z * t };
    if (stationLineClear(station, eye, target, blockers)) { best = t; result = station.id; }
  }
  return result;
}

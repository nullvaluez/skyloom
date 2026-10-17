// The airport set's PLAN: where every structure, marking and vehicle of the
// observation lounge's diorama goes. Pure and deterministic (same site ->
// same plan, byte for byte): no three.js objects, no DOM, no runtime. The
// builders in this folder turn it into geometry; scripts/verify-airport-set.mjs
// checks it in node.
//
// Frame: room-local metres (lib/fly/observation-config.js): +X = the seated
// observer's right, +Y = up from the APRON (not the lounge floor), -Z = toward
// the observed runway. The set group carries rotation.y = site.heading and
// scale (k, 1, k), exactly like the lounge, so these numbers are true metres.
//
// Yaw convention for everything that faces somewhere: three's rotation.y in
// room-local space, models built facing -Z (forward = (-sin yaw, 0, -cos yaw)).
// yaw 0 faces the runway, PI faces the pier, -PI/2 faces +X.
import { STAND_CLASS, SET_SIZE } from '../airport-layout.js';
import { AIRFIELD, LOUNGE_ROOM, PIER_SET } from '../observation-config.js';
import { siteToWorld, worldToSite } from '../lounge-site.js';
import { airportFrame, airportPoint, projectAirportPoint } from '../operations-airports.js';

const cfg = () => AIRFIELD.structures;

/** FNV-1a over a string: the set's only source of variety. */
export function setHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** Small deterministic PRNG (mulberry32) seeded from a hash. */
export function setRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Forward vector of a yaw (models face -Z). */
export const yawForward = (yaw) => [-Math.sin(yaw), -Math.cos(yaw)];
/** Yaw that faces along (dx, dz). */
export const yawToward = (dx, dz) => Math.atan2(-dx, -dz);

// --- jet bridges ---------------------------------------------------------------

/**
 * One apron-drive bridge in one pose. Rotunda on a column beyond the
 * head-of-stand road, three telescoping tunnel sections (growing toward the
 * cab, each outer one slides over the inner), a drive column with its wheel
 * bogie under the outer section, and a cab whose mouth faces the fuselage.
 */
const NEST_M = 0.45; // retracted sections stagger by this much

/** Physical section length for a bridge that docks at `len` from the rotunda. */
function sectionLength(len) {
  const B = cfg().bridge;
  return (Math.max(4, len - B.rotundaR) + 2 * B.overlapM) / 3;
}

function bridgePose(rot, cab, cabYaw, floorA, floorB, secLen, docked) {
  const dx = cab.x - rot.x, dz = cab.z - rot.z;
  const len = Math.hypot(dx, dz);
  const yaw = yawToward(dx, dz);
  const B = cfg().bridge;
  // Sections run from the rotunda's skin to the cab centre. Extended they
  // overlap by B.overlapM; retracted they nest, staggered by NEST_M. The
  // section lengths are physical, so they are the same in both poses.
  const sections = [];
  for (let i = 0; i < 3; i++) {
    const s0 = B.rotundaR + (docked ? i * (secLen - B.overlapM) : i * NEST_M);
    sections.push({ s0, s1: s0 + secLen, w: B.sectionW[i], h: B.sectionH[i] });
  }
  const columnS = Math.max(B.rotundaR + 2.5, len - B.columnFromCabM);
  return { rot, cab, cabYaw, yaw, len, floorA, floorB, sections, columnS, docked };
}

function planBridges(stand, gateY, roadZ0) {
  const c = STAND_CLASS[stand.cls];
  const B = cfg().bridge;
  const out = [];
  const doors = c.door2 ? [c.door, c.door2] : [c.door];
  doors.forEach((door, i) => {
    const rot = { x: stand.x + (i === 0 ? (c.door2 ? B.rotundaXWide : B.rotundaX) : B.rotundaX2), z: roadZ0 - B.rotundaBeyondRoadM };
    // Cab centre: mouth on the fuselage skin at the door, a bumper gap off it.
    // The mouth faces the fuselage (-X): cab yaw +PI/2.
    const doorPt = { x: stand.x + door.half, z: stand.noseZ - door.aft };
    const cab = { x: doorPt.x + B.cabDepth / 2 + B.bumperM, z: doorPt.z };
    const secLen = sectionLength(Math.hypot(cab.x - rot.x, cab.z - rot.z));
    const docked = bridgePose(rot, cab, Math.PI / 2, gateY, door.sill, secLen, true);
    // Retracted: pulled back toward the head of stand along a slightly swung
    // axis, cab turned toward the arrival line, wheels in the painted parking
    // box. The cab centre sits at the outer end of the fully nested tunnel.
    const parkDir = yawForward(docked.yaw + (i === 0 ? 0.24 : 0.14));
    const parkLen = B.rotundaR + 2 * NEST_M + secLen;
    const parkCab = { x: rot.x + parkDir[0] * parkLen, z: rot.z + parkDir[1] * parkLen };
    const retracted = bridgePose(rot, parkCab, Math.PI / 2 - 0.55, gateY, Math.max(door.sill, gateY - 0.5), secLen, false);
    out.push({ door: doorPt, sill: door.sill, docked, retracted, gate: i });
  });
  return out;
}

// --- turnaround equipment around a parked aircraft ------------------------------

/**
 * Servicing equipment for an occupied stand, positioned around where the
 * class's representative aircraft sits (nose on noseZ, left side = +X).
 * `t` picks the turnaround phase so neighbouring stands are not identical.
 */
function planTurnaround(stand, rand, withBridge) {
  const c = STAND_CLASS[stand.cls];
  const nz = stand.noseZ, sx = stand.x, half = c.door.half;
  const items = [];
  const add = (type, x, z, yaw, extra = {}) => items.push({ type, x, z, yaw, stand: stand.id, servicing: true, ...extra });
  const R = -Math.PI / 2; // facing +X (toward the fuselage from the right side)
  if (stand.cls === 'wide') {
    add('pushback-heavy', sx + (rand() - 0.5) * 2, nz + 7.2, 0);
    add('uld-loader', sx - half - 4.6, nz - 12.5, R);
    for (let i = 0; i < 3; i++) add('dolly', sx - half - 13 - i * 0.2, nz - 6 - i * 3.6, 0.04 * i);
    add('tug', sx - half - 13, nz - 1.8, 0);
    if (rand() > 0.3) add('uld-loader', sx - half - 4.6, nz - 45.5, R);
    if (rand() > 0.35) add('belt-loader', sx - half - 4.2, nz - 58, R + 0.32);
    add('catering-up-wide', sx - half - 2.7, nz - 21.5, R, { lift: 5.0 });
    if (rand() > 0.45) add('catering-up-wide', sx - half - 2.7, nz - 52.5, R, { lift: 5.1 });
    if (rand() > 0.3) add('hydrant', sx - 15.5, nz - 30.5, 0.05);
    add('cone', sx + 33.5, nz - 40.5, 0); add('cone', sx - 33.5, nz - 40.5, 0);
    add('cone', sx + 9.7, nz - 18.5, 0); add('cone', sx - 9.7, nz - 18.5, 0); add('cone', sx, nz - 77.5, 0);
    add('chock', sx, nz - 6.0, 0); add('chock', sx + 5.5, nz - 31.5, 0); add('chock', sx - 5.5, nz - 31.5, 0);
    if (!withBridge) add('stairs', sx + half + 2.2, nz - 8.6, Math.PI / 2);
    return items;
  }
  if (stand.cls === 'narrow') {
    add('pushback', sx + (rand() - 0.5) * 1.5, nz + 6.2, 0);
    add('belt-loader', sx - half - 3.9, nz - 8.6, R + 0.38);
    const carts = 2 + Math.floor(rand() * 3);
    add('tug', sx - half - 11.5, nz - 2.6, 0.02);
    for (let i = 0; i < carts; i++) add('cart', sx - half - 11.5, nz - 6.6 - i * 3.9, 0.02);
    if (rand() > 0.25) {
      add('belt-loader', sx - half - 3.9, nz - 25.5, R + 0.38);
      if (rand() > 0.4) { add('tug', sx - half - 15, nz - 21, Math.PI); add('cart', sx - half - 15, nz - 17, Math.PI); add('cart', sx - half - 15, nz - 13.1, Math.PI); }
    }
    if (rand() > 0.35) add('catering-up', sx - half - 2.6, nz - 32.5, R, { lift: 3.4 });
    if (rand() > 0.45) add('hydrant', sx - 10.5, nz - 19.5, 0.03);
    add('cone', sx + 18.2, nz - 21.5, 0); add('cone', sx - 18.2, nz - 21.5, 0);
    add('cone', sx + 5.75, nz - 10.2, 0); add('cone', sx - 5.75, nz - 10.2, 0); add('cone', sx, nz - 39, 0);
    add('chock', sx, nz - 5.6, 0); add('chock', sx + 3.8, nz - 17.4, 0); add('chock', sx - 3.8, nz - 17.4, 0);
    if (!withBridge) add('stairs', sx + half + 2.0, nz - 5.2, Math.PI / 2);
    return items;
  }
  // Regional: stairs at the forward door, a ground power cart, one cart train.
  add('stairs', sx + half + 1.9, nz - c.door.aft, Math.PI / 2);
  add('gpu', sx - 3.2, nz + 2.4, 0.4);
  add('tug', sx - half - 8, nz - 9, 0.05);
  add('cart', sx - half - 8, nz - 13, 0.05);
  if (rand() > 0.4) add('cart', sx - half - 8, nz - 16.9, 0.05);
  if (rand() > 0.5) add('belt-loader', sx - half - 3.2, nz - 20, R + 0.4);
  add('cone', sx + 15.2, nz - 15, 0); add('cone', sx - 15.2, nz - 15, 0); add('cone', sx, nz - 28, 0);
  add('chock', sx, nz - 3.2, 0); add('chock', sx + 2.6, nz - 12.6, 0); add('chock', sx - 2.6, nz - 12.6, 0);
  return items;
}

// --- service-road loops ------------------------------------------------------------

/**
 * A closed loop (rounded rectangle) through the head-of-stand road, an end
 * connector, the tail-of-stand road and the other connector. `cw` sets the
 * travel direction. Returns { segs, length } where every seg is a line or an
 * arc with its cumulative start distance; sampleRoute() walks it.
 */
export function makeLoop(xMin, xMax, zNear, zFar, radius, cw) {
  // Corners in travel order for the "near lane heads +X" direction.
  const r = Math.min(radius, (xMax - xMin) / 2 - 1, (zNear - zFar) / 2 - 1);
  const pts = [
    [xMin, zNear], [xMax, zNear], [xMax, zFar], [xMin, zFar],
  ];
  if (!cw) pts.reverse();
  const segs = [];
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], c = pts[(i + 2) % n];
    const ux = Math.sign(b[0] - a[0]), uz = Math.sign(b[1] - a[1]);
    const vx = Math.sign(c[0] - b[0]), vz = Math.sign(c[1] - b[1]);
    // Straight from (a + r*u) to (b - r*u), then a quarter arc around the corner.
    const p0 = [a[0] + ux * r, a[1] + uz * r], p1 = [b[0] - ux * r, b[1] - uz * r];
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    segs.push({ kind: 'line', s0: s, len: L, p0, dir: [ux, uz] });
    s += L;
    // Arc centre is inside the corner: b - r*u + r*v.
    const cx = b[0] - ux * r + vx * r, cz = b[1] - uz * r + vz * r;
    const a0 = Math.atan2(p1[1] - cz, p1[0] - cx);
    const cross = ux * vz - uz * vx; // turn direction
    segs.push({ kind: 'arc', s0: s, len: (Math.PI / 2) * r, c: [cx, cz], r, a0, turn: Math.sign(cross) });
    s += (Math.PI / 2) * r;
  }
  return { segs, length: s };
}

/** Position and yaw at distance s along a loop (wraps). */
export function sampleRoute(route, s, out = {}) {
  const L = route.length;
  s = ((s % L) + L) % L;
  let lo = 0, hi = route.segs.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (route.segs[mid].s0 <= s) lo = mid; else hi = mid - 1; }
  const g = route.segs[lo];
  const t = s - g.s0;
  if (g.kind === 'line') {
    out.x = g.p0[0] + g.dir[0] * t; out.z = g.p0[1] + g.dir[1] * t;
    out.yaw = yawToward(g.dir[0], g.dir[1]);
  } else {
    const a = g.a0 + g.turn * (t / g.r);
    out.x = g.c[0] + Math.cos(a) * g.r; out.z = g.c[1] + Math.sin(a) * g.r;
    // Tangent of the arc in the travel direction.
    out.yaw = yawToward(-Math.sin(a) * g.turn, Math.cos(a) * g.turn);
  }
  return out;
}

// --- the plan --------------------------------------------------------------------

/**
 * @param site     resolveLoungeSite() result
 * @param layout   airportLayout(site)
 * @param options  { runway: the observed runway record (windsocks, signs),
 *                   landmark: AIRPORT_LANDMARKS spec (real tower), isPavement:
 *                   (sceneX, sceneZ) => bool (keeps buildings off runways) }
 */
export function planAirportSet(site, layout, { runway = null, landmark = null, isPavement = null } = {}) {
  if (!site || !layout) return null;
  if (layout.pier) return planPierSet(site, layout, { runway, landmark, isPavement });
  const C = cfg();
  const S = SET_SIZE[layout.size];
  const T = layout.terminal;
  const lanes = layout.lanes;
  const facadeZ = T.z0;
  const seed = setHash(`${site.airportId}|airport-set-v1`);
  const rand = setRandom(seed);
  const gateY = layout.size === 'small' ? 0 : C.gateFloorM;
  const free = (x, z, pad = 0) => {
    if (!isPavement) return true;
    for (const [dx, dz] of [[0, 0], [pad, 0], [-pad, 0], [0, pad], [0, -pad]]) {
      const w = siteToWorld(site, x + dx, z + dz);
      if (isPavement(w.x, w.z)) return false;
    }
    return true;
  };

  // Lounge pavilion base: from the pier roof up to the room's slab, under the
  // room footprint and never inside LOUNGE_ROOM.envelope (y is apron-relative).
  const env = LOUNGE_ROOM.envelope;
  const podium = {
    x0: env.minX + 0.8, x1: env.maxX - 0.8,
    z0: facadeZ + 0.2, z1: env.maxZ - 0.8,
    y0: T.roofY, y1: site.floorM + env.minY - 0.02,
  };

  // Stands, bridges, turnaround sets.
  const stands = layout.stands.map((s, i) => {
    const r = setRandom(setHash(s.id));
    const bridges = S.bridges ? planBridges(s, gateY, lanes.road.z0) : [];
    const servicing = planTurnaround(s, r, bridges.length > 0);
    return { ...s, index: i, bridges, servicing, number: s.number ?? i + 1 };
  });

  // Staging equipment between neighbouring stands, outside both ERLs.
  const staging = [];
  for (let i = 0; i + 1 < stands.length; i++) {
    const a = stands[i], b = stands[i + 1];
    const r = setRandom(setHash(`${a.id}|${b.id}|stage`));
    const bx = (a.x + STAND_CLASS[a.cls].span / 2 + b.x - STAND_CLASS[b.cls].span / 2) / 2;
    const z = lanes.noseZ - 2;
    const kinds = ['cart', 'cart', 'dolly', 'gpu', 'tug', 'cart', 'belt-loader', 'stairs'];
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const type = kinds[Math.floor(r() * kinds.length)];
      staging.push({ type, x: bx + (k - (n - 1) / 2) * 3.4, z: z - k * 0.6 - r() * 2, yaw: (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.2, servicing: false });
    }
  }
  // A staging lot beside the left pier end (rows of carts, a bus, vans).
  const lotX = T.x0 - 9;
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < (layout.size === 'small' ? 3 : 7); k++) {
      staging.push({ type: row === 0 ? 'cart' : (k % 3 === 0 ? 'tug' : 'dolly'), x: lotX + row * 4.2, z: facadeZ + 6 + k * 3.9, yaw: Math.PI / 2, servicing: false });
    }
  }
  if (layout.size !== 'small') {
    staging.push({ type: 'bus', x: lotX - 2, z: facadeZ + 40, yaw: Math.PI, servicing: false });
    staging.push({ type: 'van', x: lotX + 6, z: facadeZ + 42, yaw: Math.PI, servicing: false });
  }

  // Service-road loops: outer lanes clockwise, inner lanes counter-clockwise
  // (right-hand traffic: the lane nearer the pier heads +X).
  const E = T.x1 + 20;
  const headZ = (lanes.road.z0 + lanes.road.z1) / 2;
  const tailZ = lanes.tailRoad ? (lanes.tailRoad.z0 + lanes.tailRoad.z1) / 2 : layout.apron.z0 + 7;
  const loops = [
    makeLoop(-E - 2.4, E + 2.4, headZ + 2.4, tailZ - 2.4, 11, true),
    makeLoop(-E + 2.4, E - 2.4, headZ - 2.4, tailZ + 2.4, 8.5, false),
  ];
  const moverKinds = {
    big: ['train3', 'van', 'train4', 'bowser', 'train3', 'catering', 'belt-loader', 'bus', 'van', 'train2'],
    mid: ['train3', 'van', 'bowser', 'train2', 'catering', 'van', 'train3'],
    small: ['train2', 'van', 'tug', 'van'],
  }[layout.size];
  const movers = moverKinds.map((kind, i) => {
    const loop = i % 2;
    const share = moverKinds.length / 2;
    const L = loops[loop].length;
    return { kind, loop, s0: (Math.floor(i / 2) / share) * L + rand() * 18, speed: C.gse.speedMps[loop] };
  });

  // Apron flood masts: at every other stand boundary just beyond the road,
  // none within mastClearOfLoungeM of the lounge, plus the apron's far corners.
  const masts = [];
  const mastH = C.mastHeightM[layout.size];
  for (let i = 0; i + 1 < stands.length; i++) {
    if (i % 2 === 1 && stands.length > 4) continue;
    const a = stands[i], b = stands[i + 1];
    const x = (a.x + STAND_CLASS[a.cls].span / 2 + b.x - STAND_CLASS[b.cls].span / 2) / 2;
    if (Math.abs(x) < C.mastClearOfLoungeM) continue;
    masts.push({ x, z: lanes.road.z0 - 3.2, h: mastH, yaw: 0 });
  }
  for (const x of [layout.apron.x0 + 10, layout.apron.x1 - 10]) masts.push({ x, z: layout.apron.z0 + 8, h: mastH, yaw: Math.PI });

  // Eave floodlights: a luminaire pair on the airside fascia over each stand,
  // aimed at the stand (the stands under the lounge are lit from the roof
  // edge, so no mast stands in the view). Lamps that would sit in front of
  // the lounge podium move out to its corners.
  const roofFloods = [];
  if (layout.size !== 'small') {
    const fz = facadeZ - C.eaveM - 0.22, fy = T.roofY - 0.7; // the lens, under the fascia lip
    const clear = (x) => (x > podium.x0 - 1.5 && x < podium.x1 + 1.5 ? (x < (podium.x0 + podium.x1) / 2 ? podium.x0 - 1.5 : podium.x1 + 1.5) : x);
    for (const s of stands) {
      const lamps = [];
      for (const dx of [-6, 6]) {
        const x = clear(s.x + dx);
        if (x > T.x0 + 1 && x < T.x1 - 1 && !lamps.some((l) => Math.abs(l - x) < 3)) lamps.push(x);
      }
      roofFloods.push({ stand: s.index, x: s.x, lamps, y: fy, z: fz });
    }
  }

  // Control tower: the real one at flagships, else beside the left pier end.
  let tower = null;
  if (landmark?.tower) {
    const p = projectAirportPoint(landmark.tower[0], landmark.tower[1]);
    const l = worldToSite(site, p.x, p.z);
    tower = { x: l.x, z: l.z, h: landmark.towerHeight, real: true, nudgeM: 0 };
    // The procedural pier can overlap the real tower's foot (LOWI): step the
    // tower out of the pier, the shortest way, by no more than it overlaps.
    const r = Math.hypot(Math.max(14, tower.h * 0.32), Math.max(9, tower.h * 0.18)) / 2 + 3;
    const bx0 = T.x0 - r, bx1 = T.x1 + r, bz0 = facadeZ - C.eaveM - r, bz1 = T.z1 + r;
    if (tower.x > bx0 && tower.x < bx1 && tower.z > bz0 && tower.z < bz1) {
      const moves = [[bz1 - tower.z, 0, 1], [tower.z - bz0, 0, -1], [tower.x - bx0, -1, 0], [bx1 - tower.x, 1, 0]].sort((a, b) => a[0] - b[0]);
      const [d, mx, mz] = moves[0];
      tower.x += mx * d; tower.z += mz * d; tower.nudgeM = d;
    }
  } else {
    const h = C.tower.genericHeightM[layout.size];
    for (const dz of [24, 60, -40]) {
      const x = T.x0 - C.tower.genericOffsetM[layout.size], z = facadeZ + dz;
      if (free(x, z, 14)) { tower = { x, z, h, real: false }; break; }
    }
  }

  // Hangars beyond the right pier end, doors toward the airfield.
  const hangars = [];
  const [hw, hd, hh] = C.hangars[layout.size];
  const count = layout.size === 'small' ? 1 : 2;
  for (let i = 0; i < count; i++) {
    const cx = T.x1 + 55 + hw / 2 + i * (hw + 22);
    const front = facadeZ - 18;
    const h = { x: cx, z: front + hd / 2, w: hw, d: hd, h: hh, number: i + 1, front };
    if (free(cx, h.z, Math.max(hw, hd) / 2)) hangars.push(h);
  }

  // Windsocks and hold-position signs need the observed runway's geometry.
  const windsocks = [], signs = [];
  if (runway?.a && runway?.b) {
    const f = airportFrame(runway);
    const side = Math.sign(site.cross) || 1;
    const local = (along, cross) => {
      const p = airportPoint(runway, along, cross);
      return worldToSite(site, p.x, p.z);
    };
    const W = C.windsock;
    for (const along of [(runway.thresholdA || 0) + W.alongFromThresholdM, f.length - (runway.thresholdB || 0) - W.alongFromThresholdM]) {
      if (along <= 0 || along >= f.length) continue;
      const p = local(along, side * (runway.width / 2 + W.crossM));
      windsocks.push({ x: p.x, z: p.z });
    }
    const label = `${runway.runway}-${runway.reciprocal}`;
    const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const r2 = setRandom(seed ^ 0x51a7);
    C.signs.alongM.forEach((d, i) => {
      const along = site.along + d;
      if (along < 120 || along > f.length - 120) return;
      const p = local(along, side * (runway.width / 2 + C.signs.holdCrossM));
      const twy = letters[Math.floor(r2() * letters.length)];
      signs.push({ x: p.x, z: p.z, runway: label, taxiway: `${twy}${1 + (i % 5)}`, direction: i % 2 ? `${twy} →` : `← ${twy}` });
    });
  }

  // OSM buildings inside these room-local rectangles are retired while
  // observing (lib/fly/operations-scenery.js). Generous margins: a real
  // terminal clipped half inside the pier reads worse than a missing one.
  const footprint = [
    { x0: T.x0 - 8, x1: T.x1 + 8, z0: facadeZ - C.eaveM - 2, z1: T.z1 + 8, kind: 'terminal' },
    { x0: layout.apron.x0, x1: layout.apron.x1, z0: layout.apron.z0, z1: facadeZ, kind: 'apron' },
    { x0: T.x0 - 20, x1: T.x0 - 2, z0: facadeZ, z1: T.z1, kind: 'staging' },
  ];
  for (const h of hangars) footprint.push({ x0: h.x - h.w / 2 - 10, x1: h.x + h.w / 2 + 10, z0: h.front - 30, z1: h.front + h.d + 10, kind: 'hangar' });
  if (tower) footprint.push({ x0: tower.x - 22, x1: tower.x + 22, z0: tower.z - 22, z1: tower.z + 22, kind: 'tower' });

  return {
    version: 1,
    seed,
    size: layout.size,
    floorM: site.floorM,
    gateY,
    terminal: { ...T, eave: C.eaveM },
    podium,
    lanes,
    apron: layout.apron,
    stands,
    staging,
    loops,
    movers,
    masts,
    roofFloods,
    tower,
    hangars,
    windsocks,
    signs,
    footprint,
    gateLetter: 'ABCDEFG'[seed % 4],
  };
}

/** Scene-space polygons of the plan footprint (for scenery exclusion). */
export function footprintWorld(site, plan) {
  return plan.footprint.map((r) => [
    siteToWorld(site, r.x0, r.z0), siteToWorld(site, r.x1, r.z0),
    siteToWorld(site, r.x1, r.z1), siteToWorld(site, r.x0, r.z1),
  ].map((p) => ({ x: p.x, z: p.z })));
}

/** Reuse canonical front planning and rotate the rear side 180 degrees.
 * Gameplay receives room coordinates; geometry retains canonical plans. */
function planPierSet(site, layout, options) {
  const frontLayout = { ...layout, pier: false, stands: layout.sides[0].stands };
  const front = planAirportSet(site, frontLayout, options);
  const offset = front.stands.length, zc = layout.zc;
  const rearLayout = { ...frontLayout, stands: layout.sides[1].stands.map((s) => ({ ...s, ...s.canon })) };
  const rear = planAirportSet(site, rearLayout, {});
  rear.skipTerminal = true;
  rear.tower = null; rear.hangars = []; rear.windsocks = []; rear.signs = [];
  rear.staging = rear.staging.filter((s) => s.z < layout.terminal.z0);
  rear.movers = rear.movers.slice(0, PIER_SET.backMovers[layout.size]);
  rear.stands.forEach((s, i) => { s.index = offset + i; s.number = offset + i + 1; });
  const point = (p) => ({ ...p, x: -p.x, z: 2 * zc - p.z });
  const item = (p) => ({ ...point(p), ...(Number.isFinite(p.yaw) ? { yaw: p.yaw + Math.PI } : {}) });
  const pose = (p) => ({ ...p, rot: point(p.rot), cab: point(p.cab), yaw: p.yaw + Math.PI, cabYaw: p.cabYaw + Math.PI });
  const rearStands = rear.stands.map((s) => ({ ...item(s), side: 'back', noseZ: 2 * zc - s.noseZ,
    bridges: s.bridges.map((b) => ({ ...b, door: point(b.door), docked: pose(b.docked), retracted: pose(b.retracted) })), servicing: s.servicing.map(item) }));
  const loops = rear.loops.map((r) => ({ ...r, segs: r.segs.map((g) => g.kind === 'line' ? { ...g, p0: [-g.p0[0], 2 * zc - g.p0[1]], dir: [-g.dir[0], -g.dir[1]] } : { ...g, c: [-g.c[0], 2 * zc - g.c[1]], a0: g.a0 + Math.PI }) }));
  const rect = (r) => ({ ...r, x0: -r.x1, x1: -r.x0, z0: 2 * zc - r.z1, z1: 2 * zc - r.z0 });
  return { ...front, pier: true, zc,
    geometrySides: [{ plan: front, rot180: false }, { plan: rear, rot180: true, zc }],
    stands: [...front.stands, ...rearStands], staging: [...front.staging, ...rear.staging.map(item)],
    loops: [...front.loops, ...loops], movers: [...front.movers, ...rear.movers.map((m) => ({ ...m, loop: m.loop + front.loops.length }))],
    masts: [...front.masts, ...rear.masts.map(item)],
    roofFloods: [...front.roofFloods, ...rear.roofFloods.map((f) => ({ ...item(f), stand: f.stand + offset, lamps: f.lamps.map((x) => -x), side: 'back' }))],
    footprint: [...front.footprint, { ...layout.aprons[1], kind: 'apron' }, ...rear.footprint.filter((r) => r.kind === 'staging').map(rect)],
    aprons: layout.aprons,
  };
}

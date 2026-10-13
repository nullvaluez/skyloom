// Parked aircraft on the observation lounge's stands: static scenery, never a
// live contact (not in the traffic engine, the board, the snapshot or the
// picking), so the apron under the lounge is a working gate area even when no
// tracked aircraft sits on it.
//
// Docking contract with the airport set (lib/fly/airport-set, AIRFIELD
// STRUCTURES): each stand's jet bridge cab docks at the stand class's left
// forward door (STAND_CLASS[cls].door: `aft` metres behind the stop line,
// `half` off the stand centreline, `sill` above the apron). Every parked
// airframe is therefore placed by its OWN painted L1 door
// (fleet-layout.boardingDoor, the same numbers the paint uses): scaled within
// a few percent so its sill meets the cab floor, moved along the stand so the
// door station meets the cab, and across so the skin meets the cab mouth. A
// stand left empty (FLEET_VIEW.parked.emptyShare) or hidden because a real
// grounded contact is on it is reported to the set (setOccupied(i, false)) so
// its bridge retracts and its servicing vehicles leave.
//
// Frame: room-local metres (lib/fly/lounge-site.js): +X right of the seated
// observer, -Z toward the runway, +Y up from the apron. The group carries the
// site transform exactly like the airport set (rotation.y = heading, scale
// (k, 1, k)) at ABSOLUTE scene coordinates; its parent (worldRoot) rebases.
//
// Draws: one instanced hero mesh per family present (typically 3-6), casting
// and receiving cinema shadows (a depth material that honours plugs and
// variant masks).
import { Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Object3D } from 'three';
import { STAND_CLASS } from './airport-layout';
import { FLEET_FAMILIES, airframeSpec, familyForCode } from './fleet-types';
import { airframeLayout, boardingDoor } from './fleet-layout';
import { buildLiveAirframe } from './live-aircraft-geometry';
import { createFleetDepthMaterial, createFleetMaterial, createFleetShared, paletteRow } from './fleet-material';
import { FLEET_VIEW } from './observation-config';

/** Which designators park on which stand class (weights). L1 sills sit near the class's cab. */
export const PARK_TYPES = Object.freeze({
  regional: [['E75L', 3], ['CRJ7', 2], ['E170', 1]],
  narrow: [['A320', 3], ['A321', 3], ['A20N', 2], ['A319', 1], ['B752', 1]],
  wide: [['B77W', 3], ['A359', 2], ['B789', 2], ['A333', 2], ['B763', 1]],
});
// Largest stretch (either way) used to meet the cab floor: invisible on a
// whole airframe, and it closes the gap between published sills.
const SCALE_TOLERANCE = 0.08;
// Radius (x the class factor) in which a real grounded contact claims a stand.
const CLASS_RADIUS = { regional: 0.8, narrow: 1, wide: 1.6 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}
function pick(table, u) {
  let total = 0;
  for (const [, w] of table) total += w;
  let r = u * total;
  for (const [v, w] of table) if ((r -= w) <= 0) return v;
  return table[0][0];
}

/**
 * Deterministic plan for a lounge site: per stand, the parked airframe (or
 * empty), its room-local placement and the docking error left after scaling.
 * Pure: no three.js objects (scripts/verify-fleet-airframes.mjs checks it).
 */
export function planParkedFleet(site, layout) {
  if (!site || !layout?.stands?.length) return [];
  const id = String(site.airportId ?? site.ident ?? 'site');
  // A few neutral "fleets" based at this terminal (paint seeds, never liveries).
  const fleets = [0, 1, 2].map((k) => hash(`${id}:fleet${k}`) & 255);
  return layout.stands.map((stand, index) => {
    const h = hash(`${id}:${stand.id}`);
    const cls = STAND_CLASS[stand.cls] ?? STAND_CLASS.narrow;
    const empty = ((h >>> 8) % 1000) / 1000 < FLEET_VIEW.parked.emptyShare;
    const code = pick(PARK_TYPES[stand.cls] ?? PARK_TYPES.narrow, (h % 10007) / 10007);
    const family = familyForCode(code);
    const f = FLEET_FAMILIES[family];
    const spec = airframeSpec(family, { t: code }, `park:${id}:${index}`);
    const L = airframeLayout(f);
    const door = boardingDoor(f);
    const share = (h >>> 4) % 10;
    const paint = fleets[share < 6 ? 0 : share < 9 ? 1 : 2];
    // Meet the cab: sill by a small stretch, door station along the stand,
    // the skin at the cab mouth across it. Doors ahead of the forward plug
    // travel with the nose, so their station from the nose never changes.
    const scale = spec.scale * clamp(cls.door.sill / door.sillAboveGround, 1 - SCALE_TOLERANCE, 1 + SCALE_TOLERANCE);
    const station = door.station + (L.seg(door.station) === -1 ? 0 : spec.plugF);
    const doorZ = stand.noseZ - cls.door.aft;
    const noseZ = doorZ + station * scale;
    // The model's origin is the BASE fuselage midpoint; the nose is len/2 +
    // plugF ahead of it. Nose-in: the aircraft faces +Z (the pier); its left
    // side, where the boarding door is, is +X.
    const z = noseZ - (L.len / 2 + spec.plugF) * scale;
    const x = stand.x + cls.door.half - door.half * scale;
    return {
      index, stand, code, family, spec, scale, x, z, empty, paint,
      mainZ: z - (L.mainContacts[0]?.z ?? 0) * scale, // room-local z of the main gear (ground sample)
      groundOffset: L.groundOffset * scale,
      dock: { sill: door.sillAboveGround * scale - cls.door.sill, along: 0, across: 0, noseOverStop: noseZ - stand.noseZ },
    };
  });
}

const _pose = new Object3D();
const _m = new Matrix4();
const _white = new Color(1, 1, 1);

/**
 * The parked fleet for one lounge site. Geometry builds progressively (one
 * family per prepare()) so mounting never hitches a frame.
 */
export class ParkedFleetSet {
  constructor(site, layout) {
    this.site = site;
    this.plan = planParkedFleet(site, layout);
    this.group = new Group();
    this.group.name = 'parked-fleet';
    this.group.visible = false;
    this.shared = createFleetShared(null);
    this.meshes = new Map(); // family -> InstancedMesh
    this.queue = [...new Set(this.plan.filter((p) => !p.empty).map((p) => p.family))];
    this.state = this.plan.map(() => ({ hidden: false, realUntil: -1, ground: 0 }));
    this.occupancyFor = null; // the airport set the occupancy was last pushed to
    this.nextCheck = 0;
    this.nextGround = 0;
    this.dirty = true;
    this.stats = { stands: this.plan.length, parked: 0, empty: this.plan.filter((p) => p.empty).length, hidden: 0, draws: 0, triangles: 0, families: this.queue.length };
  }

  get ready() {
    return this.queue.length === 0;
  }

  /** Build the next family's mesh. True once every family exists. */
  prepare() {
    const family = this.queue.shift();
    if (family != null) {
      const f = FLEET_FAMILIES[family];
      const built = buildLiveAirframe(f, 'hero');
      const material = createFleetMaterial(f, built.parts, this.shared);
      const count = this.plan.filter((p) => p.family === family && !p.empty).length;
      const mesh = new InstancedMesh(built.hull, material, count);
      mesh.name = `parked:${f.id}`;
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      const a = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
      const b = new InstancedBufferAttribute(new Float32Array(count * 4), 4);
      built.hull.setAttribute('aFleetA', a);
      built.hull.setAttribute('aFleetB', b);
      for (let i = 0; i < count; i++) mesh.setColorAt(i, _white);
      mesh.customDepthMaterial = createFleetDepthMaterial(material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      this.meshes.set(family, mesh);
      this.group.add(mesh);
      this.dirty = true;
    }
    return this.ready;
  }

  /**
   * Per frame. runtime: the fly runtime (airportWatch, airportSet, traffic,
   * cinemaEnvironment). now: seconds.
   */
  update(runtime, now) {
    const w = runtime.airportWatch, site = this.site;
    const enabled = FLEET_VIEW.parkedScenery !== false;
    if (!this.ready) this.prepare();
    const set = runtime.airportSet?.site === site ? runtime.airportSet : null;
    this.group.visible = enabled && !!w?.active && !!w.validated;
    const apronY = set ? set.apronY() : w?.validated ? w.floorY - site.floorM : site.groundY;
    this.group.position.set(site.x, apronY, site.z);
    this.group.rotation.set(0, site.heading, 0);
    this.group.scale.set(site.k, 1, site.k);

    // Real grounded contacts claim their stand (and keep it a while after).
    if (now >= this.nextCheck) {
      this.nextCheck = now + 0.5;
      const items = runtime.traffic?.items ?? [];
      for (const p of this.plan) {
        if (p.empty) continue;
        const st = this.state[p.index];
        const r = FLEET_VIEW.parked.occupiedRadiusM * (CLASS_RADIUS[p.stand.cls] ?? 1);
        for (const t of items) {
          if (!(t.flags & 1)) continue;
          if (Math.hypot(t.rx - p.stand.wx, t.rz - p.stand.wz) / site.k < r) { st.realUntil = now + 20; break; }
        }
        const hidden = now < st.realUntil;
        if (hidden !== st.hidden) { st.hidden = hidden; this.dirty = true; }
      }
    }
    // Sit on the ground the airport set uses (refined as its field samples).
    if (set && now >= this.nextGround) {
      this.nextGround = now + 1;
      for (const p of this.plan) {
        const g = set.groundAt(p.x, p.mainZ);
        const y = Number.isFinite(g) ? g : 0;
        if (Math.abs(y - this.state[p.index].ground) > 0.01) { this.state[p.index].ground = y; this.dirty = true; }
      }
    }
    if (set && set !== this.occupancyFor) {
      this.occupancyFor = set;
      this.dirty = true;
    }
    if (this.dirty) this._rebuild(set, enabled);

    // Night: cabins and logo lights like the live fleet's (the same shared
    // program), plus the stand's floodlights on the airframes.
    const night = runtime.cinemaEnvironment?.night ?? 0;
    this.shared.uFleetNight.value.set(night * 2.4, night * 1.6, 0.4 + night * 3, 0);
    const flood = FLEET_VIEW.parked.flood, k = night * flood[3];
    for (const mesh of this.meshes.values()) mesh.material.userData.fleet.uFleetFlood.value.set(flood[0] * k, flood[1] * k, flood[2] * k, 0);
  }

  _rebuild(set, enabled) {
    this.dirty = false;
    const used = new Map();
    let parked = 0, hidden = 0, triangles = 0;
    for (const p of this.plan) {
      const st = this.state[p.index];
      const show = enabled && !p.empty && !st.hidden;
      if (set) set.setOccupied(p.index, show);
      if (!p.empty && st.hidden) hidden++;
      const mesh = this.meshes.get(p.family);
      if (!show || !mesh) continue;
      const slot = used.get(mesh) ?? 0;
      used.set(mesh, slot + 1);
      _pose.position.set(p.x, st.ground + p.groundOffset, p.z);
      _pose.rotation.set(0, Math.PI, 0);
      _pose.scale.setScalar(p.scale);
      _pose.updateMatrix();
      mesh.setMatrixAt(slot, _pose.matrix);
      const f = FLEET_FAMILIES[p.family];
      // Gear down, clean wing, wing at rest on the ground; no registration.
      mesh.geometry.attributes.aFleetA.setXYZW(slot, 1, 0, 0, 0.12);
      mesh.geometry.attributes.aFleetB.setXYZW(slot, paletteRow(f.palette, p.paint) + 256 * (p.spec.variant & 255), (p.paint * 37 + p.index * 11) % 1024, p.spec.plugF, p.spec.plugA);
      parked++;
    }
    let draws = 0;
    for (const mesh of this.meshes.values()) {
      const n = used.get(mesh) ?? 0;
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.attributes.aFleetA.needsUpdate = true;
      mesh.geometry.attributes.aFleetB.needsUpdate = true;
      if (n) {
        mesh.computeBoundingSphere();
        draws++;
        triangles += (n * mesh.geometry.index.count) / 3;
      }
    }
    Object.assign(this.stats, { parked, hidden, draws, triangles });
  }

  dispose() {
    for (const mesh of this.meshes.values()) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.customDepthMaterial?.dispose();
      mesh.dispose();
    }
    this.meshes.clear();
    this.group.removeFromParent();
  }
}

/** Matrix of a planned airframe in room-local metres (tests, captures). */
export function parkedMatrix(p, ground = 0, out = _m) {
  _pose.position.set(p.x, ground + p.groundOffset, p.z);
  _pose.rotation.set(0, Math.PI, 0);
  _pose.scale.setScalar(p.scale);
  _pose.updateMatrix();
  return out.copy(_pose.matrix);
}

// Live traffic as first-party 3D airframes (satellite style).
//
// Draws, per frame, every resolved contact inside the model range as one of
// three levels of detail:
//   hero  per family, a handful of instances: the selection / binocular
//         target and whatever is big on screen (or, while observing from the
//         lounge, the nearest few within ~3 km);
//   mid   per family, contacts a few dozen pixels long;
//   far   one silhouette per FAR_CLASS (fleet-types.js), stretched per
//         instance to the family's span/length/height, and held at a minimum
//         on-screen size while observing so no contact aliases away.
// LOD is chosen from the PROJECTED size with the live camera, so the
// binoculars raise detail by themselves. Gear, flaps, spoilers, props, wing
// bend and fuselage plugs are instance attributes on one draw per mesh
// (fleet-material.js); nothing allocates per aircraft per frame.
//
// Budget (BUDGET below): at most 30 draws and 900k triangles for the whole
// fleet. Far silhouettes always fit (<= 7 draws, ~1k triangles each); the
// remaining draws and triangles go to the contacts largest on screen first,
// so a rare family seen far away draws as its silhouette rather than open
// one more mesh. Typical: 10-20 draws, 250-350k triangles at a busy hub.
import { Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Object3D, Vector3 } from 'three';
import { LIVE_AIRCRAFT, liveModelLod, resolveLiveType } from './live-aircraft';
import { FAR_CLASS, FAR_REP_INDEX, FLEET_FAMILIES } from './fleet-types';
import { airframeLayout } from './fleet-layout';
import { buildLiveAirframe } from './live-aircraft-geometry';
import { createFleetMaterial, createFleetShared, paletteRow, RegistrationAtlas } from './fleet-material';
import { projectModelMatrix } from './render-scale';
import { livingProfile } from './living-earth';
import { horizonFade } from './toy-world/world-bend';
import { TRAFFIC, TRAFFIC_HORIZON } from './fly-constants';
import { PHASE, phaseConfig, trackPhase } from './flight-phase';
import { TrafficShadows } from './traffic-shadows';
import { shipPassOn } from './ship-light';

// SHIP PASS LIGHT (TRAFFIC_SHADOWS, FLY_SHIP_PASS.md LT-3): constructed only
// with the flag on; off, the fleet is exactly today's.
const TRAFFIC_SHADOWS_ON = shipPassOn('TRAFFIC_SHADOWS');

const HERO_CAP = 8;
const MID_CAP = 64;
const FAR_CAP = 512;
// Families whose hero mesh is built up front (the rest build on first use).
const PREBUILT_HEROES = ['a320', 'b737', 'ejet', 'crj', 'b787', 'b777', 'b757', 'a220', 'business', 'b767'];
// Flight mode keeps today's behaviour: hero detail near the player, no
// minimum-size floor (the far glints take over past the model range).
const FLIGHT = { heroPx: 260, midPx: 26, minPx: 0, heroMax: 4 };
const OBSERVE = { heroPx: 150, midPx: 22, minPx: 2.6, heroMax: HERO_CAP, heroM: 3000, selectedM: 60000 };
const BUDGET = { draws: 30, triangles: 900000 };

const pose = new Object3D();
const _m = new Matrix4();
const _tint = new Color();
const _v = new Vector3();
const _cfg = {};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const approach = (v, target, rate, dt) => (v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt));

function instanced(geometry, material, capacity, name) {
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  const a = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
  const b = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
  geometry.setAttribute('aFleetA', a);
  geometry.setAttribute('aFleetB', b);
  // instanceColor exists from birth so the program never changes mid-flight.
  mesh.setColorAt(0, _tint.setRGB(1, 1, 1));
  mesh.instanceColor.setUsage(DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.userData.fleetA = a;
  mesh.userData.fleetB = b;
  mesh.userData.used = 0;
  return mesh;
}
const bytesOf = (g) => Object.values(g.attributes).reduce((n, a) => n + (a.isInstancedBufferAttribute ? 0 : a.array.byteLength), 0) + (g.index?.array.byteLength ?? 0);

export class DetailedTraffic {
  constructor() {
    this.group = new Group();
    this.group.name = 'live-aircraft-detail';
    this.atlas = new RegistrationAtlas();
    this.shared = createFleetShared(this.atlas);
    this.families = FLEET_FAMILIES.map((f) => ({ f, material: null, parts: null, mid: null, hero: null, heroQueued: false }));
    this.far = FAR_REP_INDEX.map((index) => ({ rep: FLEET_FAMILIES[index], mesh: null, material: null }));
    this.queue = [
      ...this.far.map((_, i) => ({ kind: 'far', i })),
      ...this.families.map((_, i) => ({ kind: 'mid', i })),
      ...PREBUILT_HEROES.map((id) => ({ kind: 'hero', i: FLEET_FAMILIES.findIndex((f) => f.id === id) })),
    ];
    this.readyAfter = this.queue.length;
    this.built = 0;
    this.scratch = [];
    this.stats = { families: 0, displayed: 0, near: 0, mid: 0, far: 0, grounded: 0, fallback: 0, ready: false, triangles: 0, geometryBytes: 0, draws: 0, heroFamilies: 0 };
    this.disposed = false;
    this.shadows = TRAFFIC_SHADOWS_ON ? new TrafficShadows(this.group) : null;
  }

  /** Build the next queued geometry. True once every up-front mesh exists. */
  prepare() {
    const job = this.queue.shift();
    if (job) {
      if (job.kind === 'far') this._buildFar(job.i);
      else if (job.kind === 'mid') this._buildFamily(job.i, 'mid');
      else this._buildFamily(job.i, 'hero');
      this.built++;
    }
    this.stats.families = this.families.filter((s) => s.mid).length;
    return this.built >= this.readyAfter;
  }

  _material(s) {
    if (!s.material) {
      const built = buildLiveAirframe(s.f, 'mid');
      s.parts = built.parts;
      s.material = createFleetMaterial(s.f, s.parts, this.shared);
      s.pending = built;
    }
    return s.material;
  }

  _buildFamily(i, lod) {
    const s = this.families[i];
    if (!s || s[lod]) return;
    const material = this._material(s);
    let built = lod === 'mid' && s.pending ? s.pending : buildLiveAirframe(s.f, lod);
    if (lod === 'mid') s.pending = null;
    const mesh = instanced(built.hull, material, lod === 'hero' ? HERO_CAP : MID_CAP, `live-${lod}:${s.f.id}`);
    s[lod] = mesh;
    s.groundOffset = built.groundOffset;
    this.group.add(mesh);
    this.stats.geometryBytes += bytesOf(built.hull);
    built = null;
  }

  _buildFar(k) {
    const slot = this.far[k];
    if (slot.mesh) return;
    const built = buildLiveAirframe(slot.rep, 'far');
    slot.material = createFleetMaterial(slot.rep, built.parts, this.shared, { far: true });
    slot.mesh = instanced(built.hull, slot.material, FAR_CAP, `live-far:${slot.rep.id}`);
    slot.groundOffset = built.groundOffset;
    // The silhouette shows one tip/engine option: the rep's own default.
    slot.variant = slot.rep.variants.base || 0;
    this.group.add(slot.mesh);
    this.stats.geometryBytes += bytesOf(built.hull);
  }

  _hero(i) {
    const s = this.families[i];
    if (s.hero) return s.hero;
    if (!s.heroQueued) {
      s.heroQueued = true;
      this.queue.push({ kind: 'hero', i });
    }
    return null;
  }

  /**
   * items: TrafficEngine items. selected: hex (or null) for the flight-mode
   * rule. ctx (optional): { camera, heightPx, observing, selectedSet,
   * modelRangeM, groundAt(x, z), airportY, dt, now, night, lights, smoke,
   * reserve: { draws, triangles } held by other fleet scenery }.
   */
  update(items, flight, origin, tier, selected, satellite, time, ctx = null) {
    for (const it of items) it.livingDetailed = false;
    const st = this.stats;
    this.group.visible = satellite;
    st.displayed = st.near = st.mid = st.far = st.grounded = st.triangles = st.draws = st.heroFamilies = 0;
    if (!satellite) return;
    this.shared.uFleetTime.value = time;
    this.atlas.begin();
    for (const s of this.families) {
      if (s.mid) s.mid.userData.used = 0;
      if (s.hero) s.hero.userData.used = 0;
    }
    for (const slot of this.far) if (slot.mesh) slot.mesh.userData.used = 0;
    if (!this.far.every((f) => f.mesh)) return;
    this.shadows?.begin({ tier });

    const observing = !!ctx?.observing;
    const rules = observing ? OBSERVE : FLIGHT;
    const profile = livingProfile(tier);
    const range = ctx?.modelRangeM ?? TRAFFIC.modelLodDistanceM;
    const camera = ctx?.camera;
    const focal = camera ? camera.projectionMatrix.elements[5] * (ctx.heightPx ?? 1080) * 0.5 : 0;
    const dt = Math.min(0.25, Math.max(0, ctx?.dt ?? 1 / 60));
    const now = ctx?.now ?? time;
    const selectedSet = ctx?.selectedSet;

    // 1. Candidates with their projected size.
    const cands = this.scratch;
    cands.length = 0;
    for (const it of items) {
      if (!(it.opacity > 0.03) || !(it.distM < range) || !it.fix1) continue;
      const spec = resolveLiveType(it);
      if (!spec) continue;
      const dW = Math.hypot(it.rx - flight.pos.x, it.rz - flight.pos.z);
      const horizon = horizonFade(dW, it.ryd, TRAFFIC_HORIZON);
      if (horizon <= 0.02) continue;
      const isSel = it.hex === selected || !!selectedSet?.has(it.hex);
      const px = focal > 0 ? (spec.length * focal) / Math.max(1, it.distM) : 0;
      it.fleetPx = px;
      it.fleetHorizon = horizon;
      it.fleetSelected = isSel;
      cands.push(it);
    }
    cands.sort((a, b) => (b.fleetSelected - a.fleetSelected) || b.fleetPx - a.fleetPx || a.distM - b.distM);

    // 2. Level of detail, then the instance. Hero and mid meshes open draws
    // while the budget lasts; the far silhouettes keep their reserve.
    let heroes = 0, tris = 0;
    const open = this._open ??= new Set();
    open.clear();
    // Parked scenery (ctx.reserve: its draws/triangles) shares the budget.
    const reserve = ctx?.reserve;
    const detailDraws = BUDGET.draws - this.far.length - (reserve?.draws ?? 0);
    // Every contact may end up a far silhouette: reserve those triangles.
    let farTris = 0;
    for (const slot of this.far) farTris = Math.max(farTris, slot.mesh.geometry.index.count / 3);
    const detailTris = BUDGET.triangles - farTris * cands.length - (reserve?.triangles ?? 0);
    const fits = (mesh, cap) => !!mesh && mesh.userData.used < cap && tris + mesh.geometry.index.count / 3 <= detailTris && (open.has(mesh) || open.size < detailDraws);
    for (const it of cands) {
      const spec = it.fleetType.spec;
      const fam = this.families[spec.family];
      const f = fam.f;
      const state = (it.fleet ??= { lod: 'far', gear: it.flags & 1 ? 1 : 0, flaps: 0, spoiler: 0, load: it.flags & 1 ? 0.15 : 1, pitch: 0, groundY: null, groundAt: -1e9, grounded: !!(it.flags & 1), landedAt: -1e9, liftoffAt: -1e9, speed: 0, speedRate: 0, regSlot: -1 });
      const wasHero = state.lod === 'hero', wasMid = state.lod !== 'far';
      let lod = 'far';
      let wantHero;
      if (camera) {
        wantHero = (it.fleetSelected && it.distM < (observing ? rules.selectedM : 8000)) || it.fleetPx > rules.heroPx * (wasHero ? 0.8 : 1) || (observing && it.distM < rules.heroM * (wasHero ? 1.15 : 1));
      } else {
        wantHero = liveModelLod(it.distM, it.fleetSelected, wasHero, profile.detailM);
      }
      if (wantHero && heroes < rules.heroMax) {
        const hero = this._hero(spec.family) ?? (camera ? null : (this._buildFamily(spec.family, 'hero'), fam.hero));
        if (fits(hero, HERO_CAP)) lod = 'hero';
        else if (fits(fam.mid, MID_CAP)) lod = 'mid';
      }
      if (lod === 'far' && fits(fam.mid, MID_CAP)) {
        const midWanted = camera ? it.fleetPx > rules.midPx * (wasMid ? 0.75 : 1) : true;
        if (midWanted) lod = 'mid';
      }
      if (lod !== 'far') {
        const mesh = lod === 'hero' ? fam.hero : fam.mid;
        open.add(mesh);
        tris += mesh.geometry.index.count / 3;
      }
      if (lod === 'hero') heroes++;
      state.lod = lod;
      it.livingNear = lod === 'hero';

      this._advance(it, state, spec, f, dt, now, ctx);

      // Pose. Grounded tracks are pinned 2 m over the sampled terrain by the
      // traffic engine: stand the aircraft on its gear instead.
      const farSlot = lod === 'far' ? this.far[f.far] : null;
      const lay = airframeLayout(farSlot ? farSlot.rep : f);
      const sx = farSlot ? f.span / farSlot.rep.span : 1;
      const sz = farSlot ? spec.length / spec.scale / farSlot.rep.length : 1;
      const sy = farSlot ? f.height / farSlot.rep.height : 1;
      let scale = spec.scale * it.scaleK;
      if (farSlot && rules.minPx > 0 && it.fleetPx > 0 && it.fleetPx < rules.minPx) scale *= rules.minPx / it.fleetPx;
      const groundOffset = lay.groundOffset * (farSlot ? sy : 1) * scale;
      const grounded = !!(it.flags & 1);
      const fix = it.fix1;
      const speed = Math.hypot(fix.vE, fix.vN);
      const path = !grounded && speed > 20 ? Math.atan2(fix.vUp, speed) : 0;
      pose.position.set(it.rx - origin.anchor.x, it.ryd, it.rz - origin.anchor.z);
      pose.rotation.order = 'YXZ';
      pose.rotation.set(path + state.pitch, -it.yaw, grounded ? 0 : -it.bank);
      pose.scale.set(scale * sx, scale * sy, scale * sz);
      pose.updateMatrix();
      if (grounded) {
        // Stand on the gear and pivot rotation / derotation about the main
        // wheels, so a rotating jet never sweeps its tail through the runway.
        // The ground is the surface drawn under it (ctx.groundAt: the airport
        // set's apron inside its footprint, else the refined terrain), else
        // the engine's one-off pin (2 m over the terrain sampled at first fix).
        const contact = _v.set(0, lay.groundY, lay.mainContacts[0]?.z ?? 0).applyMatrix4(pose.matrix);
        pose.position.y += (state.groundY ?? it.ryd - 2) - contact.y;
        pose.updateMatrix();
      } else if (state.groundY != null) {
        // Altitude reports are coarse near the field: never sink a low
        // airborne contact below its own wheels on the sampled ground.
        const floor = state.groundY + groundOffset;
        if (pose.position.y < floor) { pose.position.y = floor; pose.updateMatrix(); }
      }
      projectModelMatrix(pose.matrix, 1 / Math.cos(fix.latRad));

      const mesh = lod === 'hero' ? fam.hero : lod === 'mid' ? fam.mid : farSlot.mesh;
      const slot = mesh.userData.used++;
      mesh.setMatrixAt(slot, pose.matrix);
      if (this.shadows) {
        const k = 1 / Math.cos(fix.latRad), size = spec.scale * it.scaleK;
        this.shadows.note(mesh, slot, lod, it.distM, pose.matrix, Math.max(f.span, f.length) * size * 0.6 * k);
        this.shadows.blob({ x: pose.position.x, y: pose.position.y, z: pose.position.z, yaw: it.yaw, groundY: state.groundY, span: f.span, length: f.length, scale: size, eff: it.opacity * it.fleetHorizon }, k);
      }
      const eff = it.opacity * it.fleetHorizon;
      mesh.setColorAt(slot, _tint.setRGB(eff, eff, eff));
      mesh.userData.fleetA.setXYZW(slot, state.gear, state.flaps, state.spoiler, state.load);
      const variant = farSlot ? farSlot.variant : spec.variant;
      const reg = lod === 'hero' && it.meta?.r ? this.atlas.slot(String(it.meta.r)) : -1;
      const row = paletteRow(f.palette, spec.seed);
      mesh.userData.fleetB.setXYZW(slot, row + 256 * (variant & 255) + 65536 * (reg + 1), (spec.seed * 37 + (it.hex?.charCodeAt?.(0) ?? 0)) % 1024, farSlot ? 0 : spec.plugF, farSlot ? 0 : spec.plugA);

      ctx?.lights?.addAircraft(pose.matrix, lay, farSlot ? null : spec, state, it, eff);
      if (ctx?.smoke?.isEmitting(it.hex)) ctx.smoke.emitFrom(it, pose.matrix, lay, origin, now, ctx.wind);
      if (grounded) st.grounded++;
      if (lod === 'hero') st.near++;
      else if (lod === 'mid') st.mid++;
      else st.far++;
      it.livingDetailed = true;
      st.displayed++;
    }

    // 3. Upload.
    const flush = (mesh) => {
      if (!mesh) return;
      const n = mesh.userData.used;
      mesh.count = n;
      if (!n) return;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, n * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.clearUpdateRanges();
      mesh.instanceColor.addUpdateRange(0, n * 3);
      mesh.instanceColor.needsUpdate = true;
      for (const a of [mesh.userData.fleetA, mesh.userData.fleetB]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * 4);
        a.needsUpdate = true;
      }
      st.triangles += (n * mesh.geometry.index.count) / 3;
      st.draws++;
    };
    for (const s of this.families) {
      flush(s.mid);
      if (s.hero) {
        flush(s.hero);
        if (s.hero.count) st.heroFamilies++;
      }
    }
    for (const slot of this.far) flush(slot.mesh);
    if (this.shadows) {
      this.shadows.end();
      st.shadows = this.shadows.stats;
      if (this.shadows.blobs.count) st.draws++;
    }
    st.fallback = 0;
    for (const it of items) if (!it.livingDetailed && it.distM < range && it.opacity > 0.03) st.fallback++;
  }

  /** Per-track configuration: phase targets, animated toward at real rates. */
  _advance(it, s, spec, f, dt, now, ctx) {
    const grounded = !!(it.flags & 1);
    const fix = it.fix1;
    const speed = Math.hypot(fix.vE, fix.vN);
    // Ground under the track: sampled every few seconds (cheap DEM lookup;
    // twice a second on the ground, where it carries the airframe), the
    // airport elevation while observing, else the grounded pin.
    if (ctx?.groundAt && now - s.groundAt > (grounded ? 0.5 : 2.5)) {
      s.groundAt = now;
      const g = ctx.groundAt(it.rx, it.rz);
      if (g != null) s.groundY = g;
    }
    if (s.groundY == null && it.groundElev != null) s.groundY = it.groundElev;
    const groundY = s.groundY ?? ctx?.airportY ?? 0;
    // Events: touchdown and liftoff edges.
    if (grounded && !s.grounded) {
      s.landedAt = now;
      if (speed > 40) ctx?.smoke?.touchdown(it, spec, f, now);
    } else if (!grounded && s.grounded) s.liftoffAt = now;
    s.grounded = grounded;
    s.speedRate = s.speedRate * 0.9 + ((speed - s.speed) / Math.max(dt, 1e-3)) * 0.1;
    s.speed = speed;
    const phase = trackPhase(it, groundY);
    s.phase = phase;
    const light = f.palette === 'ga' || f.helicopter;
    const cfg = phaseConfig(it, phase, groundY, s, now, { light }, _cfg);
    s.landing = cfg.landing;
    s.taxi = cfg.taxi;
    s.strobe = cfg.strobe;
    s.beacon = cfg.beacon;
    const fixedGear = f.helicopter || f.gear?.type === 'fixed';
    // ~7 s gear cycle, ~12 s full flap travel, ~1.5 s lift dumpers.
    s.gear = fixedGear ? 1 : approach(s.gear, cfg.gear, 0.15, dt);
    s.flaps = approach(s.flaps, cfg.flaps, 0.09, dt);
    s.spoiler = approach(s.spoiler, cfg.spoiler, 0.7, dt);
    s.load = approach(s.load, grounded ? 0.12 : 1, 0.6, dt);
    s.pitch += (cfg.pitch - s.pitch) * Math.min(1, dt * 1.5);
    if (phase === PHASE.PARKED || phase === PHASE.TAXI) s.pitch *= 0.5;
  }

  /** Release GPU resources (the group is unparented by the owner). */
  dispose() {
    this.disposed = true;
    this.shadows?.dispose();
    this.shadows = null;
    for (const s of this.families) {
      for (const mesh of [s.mid, s.hero]) if (mesh) { mesh.removeFromParent(); mesh.geometry.dispose(); mesh.dispose(); }
      s.material?.dispose();
      s.pending?.hull.dispose();
    }
    for (const slot of this.far) {
      if (slot.mesh) { slot.mesh.removeFromParent(); slot.mesh.geometry.dispose(); slot.mesh.dispose(); }
      slot.material?.dispose();
    }
    this.atlas.dispose();
    this.group.removeFromParent();
  }
}

export { LIVE_AIRCRAFT, FAR_CLASS };

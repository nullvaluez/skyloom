// The airport set, assembled. Two layers:
//
//   buildSetGeometry(plan, atlas)  pure geometry (node-testable): the static
//                                  terminal + masts, every unique batched part
//                                  (vehicle kit, bridge poses and their drive
//                                  columns, far fixtures), decals and pools.
//   createAirportSet(...)          the renderable: one Group of five draws —
//                                  static Mesh, BatchedMesh (bridges, vehicles,
//                                  tower, hangars, signs, windsocks), decals,
//                                  pools, and the GlowPoints light set — plus
//                                  update(), occupancy and ground hooks.
//
// Draw budget (AIRFIELD structures, High): 5 colour draws + the shadow
// cascades of the two casters. Vehicles move by instance matrix only.
//
// Ground: buildings keep the apron plane (with plinths running below it);
// everything that touches the ground — markings, pools, vehicles, bridge
// drive columns, far fixtures — follows the sampled ground (./ground.js).
import { BatchedMesh, Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import { MeshWriter } from './mesh-writer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildTerminal, buildGateSigns } from './terminal.js';
import { buildBridgeColumn, buildBridgePose, bridgeColumnSpot } from './bridges.js';
import { GSE_KIT, moverParts } from './gse.js';
import { buildHangar, buildMast, buildSignGroup, buildTower, buildWindsockMast } from './fixtures.js';
import { buildDecals, buildPools, drapeGeometry } from './decals.js';
import { atlasEntries, drawAtlas, planAtlas } from './atlas.js';
import { createDecalMaterial, createPoolMaterial, createSetMaterial, createSetUniforms, MAX_FLOODS } from './materials.js';
import { SetLights } from './lights.js';
import { sampleRoute, setHash, setRandom, yawToward } from './plan.js';
import { AIRFIELD } from '../observation-config.js';

function writerGeometry(build) {
  const w = new MeshWriter();
  build(w);
  return w.toGeometry();
}

/**
 * Pure geometry for a plan. Returns plain geometries + placement records; no
 * materials, no textures, no scene objects.
 */
export function buildSetGeometry(plan, atlas) {
  if (plan.geometrySides) {
    const builds = plan.geometrySides.map((side) => {
      const built = buildSetGeometry(side.plan, atlas);
      if (!side.rot180) return built;
      const matrix = new Matrix4().makeRotationY(Math.PI).setPosition(0, 0, 2 * side.zc);
      for (const key of ['staticGeo', 'decals', 'pools']) built[key].applyMatrix4(matrix);
      for (const bridge of built.bridges) for (const key of ['docked', 'retracted']) {
        bridge[key].applyMatrix4(matrix);
        const col = bridge[`${key}Column`]; col.x = -col.x; col.z = 2 * side.zc - col.z; col.yaw += Math.PI;
      }
      for (const p of built.parked) { p.x = -p.x; p.z = 2 * side.zc - p.z; p.yaw += Math.PI; }
      built.movers.forEach((m) => { m.loop += plan.geometrySides[0].plan.loops.length; });
      return built;
    });
    const [front, rear] = builds;
    const merge = (key) => { const parts = builds.map((b) => b[key]); const result = mergeGeometries(parts); parts.forEach((g) => g.dispose()); return result; };
    const kits = new Map(front.kits);
    for (const [key, geo] of rear.kits) { if (kits.has(key)) geo.dispose(); else kits.set(key, geo); }
    return { staticGeo: merge('staticGeo'), decals: merge('decals'), pools: merge('pools'), kits,
      bridges: builds.flatMap((b) => b.bridges), parked: builds.flatMap((b) => b.parked), movers: builds.flatMap((b) => b.movers),
      fixtures: front.fixtures, socks: front.socks,
    };
  }
  const staticGeo = writerGeometry((w) => {
    if (plan.skipTerminal) buildGateSigns(w, plan, atlas); else buildTerminal(w, plan, atlas);
    for (const m of plan.masts) buildMast(w, m);
  });

  const kits = new Map();
  const kit = (type) => {
    if (!GSE_KIT[type]) return null;
    if (!kits.has(type)) kits.set(type, writerGeometry((w) => GSE_KIT[type].build(w)));
    return kits.get(type);
  };

  // Bridges: one geometry per pose (room-local metres) plus its drive column
  // (built at its own origin, placed on the ground by instance matrix).
  const bridges = [];
  for (const s of plan.stands) {
    s.bridges.forEach((b, gi) => {
      const label = gi === 0 ? atlas?.rect(`${plan.gateLetter}${s.number}`) : null;
      const entry = { stand: s.index, gate: gi };
      for (const key of ['docked', 'retracted']) {
        const pose = b[key];
        entry[key] = writerGeometry((w) => buildBridgePose(w, pose, { stand: s, facadeZ: plan.terminal.z0, gateY: plan.gateY, sill: b.sill, docked: key === 'docked', label }));
        entry[`${key}Column`] = { geo: writerGeometry((w) => buildBridgeColumn(w, pose)), ...bridgeColumnSpot(pose) };
      }
      bridges.push(entry);
    });
  }

  // Parked equipment (per stand, shown when occupied) and staging (always).
  const parked = [];
  for (const s of plan.stands) for (const it of s.servicing) if (kit(it.type)) parked.push({ ...it, standIndex: s.index });
  for (const it of plan.staging) if (kit(it.type)) parked.push({ ...it, standIndex: -1 });

  // Movers: trains expand into a tug and carts; each part keeps its spacing.
  const movers = plan.movers.map((m, mi) => {
    const parts = moverParts(m.kind, setHash(`${plan.seed}|${mi}`)).map((p) => ({ ...p }));
    let off = 0;
    parts.forEach((p, k) => {
      if (k > 0) off += (GSE_KIT[parts[k - 1].type].length + GSE_KIT[p.type].length) / 2 + 0.55;
      p.offset = off;
      kit(p.type);
    });
    return { ...m, parts };
  });

  // Far fixtures: built at a local origin, placed (and lifted onto their own
  // sampled ground) by instance matrix.
  const fixtures = [];
  if (plan.tower) {
    let info = null;
    const geo = writerGeometry((w) => { info = buildTower(w, { ...plan.tower, x: 0, z: 0 }); });
    fixtures.push({ kind: 'tower', x: plan.tower.x, z: plan.tower.z, yaw: 0, geo, info });
  }
  for (const h of plan.hangars) fixtures.push({ kind: 'hangar', x: h.x, z: h.front, yaw: 0, geo: writerGeometry((w) => buildHangar(w, { ...h, x: 0, front: 0 }, atlas)) });
  for (const sg of plan.signs) fixtures.push({ kind: 'sign', x: sg.x, z: sg.z, yaw: 0, geo: writerGeometry((w) => buildSignGroup(w, { ...sg, x: 0, z: 0 }, atlas)) });
  const socks = [];
  for (const ws of plan.windsocks) {
    let pivot = null;
    const geo = writerGeometry((w) => { pivot = buildWindsockMast(w, { x: 0, z: 0 }); });
    socks.push({ x: ws.x, z: ws.z, y: pivot.y, fixture: fixtures.length });
    fixtures.push({ kind: 'windsock', x: ws.x, z: ws.z, yaw: 0, geo });
  }
  if (socks.length) kit('windsock');

  const lift = AIRFIELD.structures.decalLiftM;
  const decals = buildDecals(plan, atlas, lift);
  const pools = buildPools(plan, lift + 0.02);
  return { staticGeo, kits, bridges, parked, movers, fixtures, socks, decals, pools };
}

const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Triangle census of a built set (all instances; one pose per bridge). */
export function setGeometryStats(built) {
  let batched = 0;
  for (const b of built.bridges) batched += tri(b.docked) + tri(b.dockedColumn.geo);
  for (const p of built.parked) batched += tri(built.kits.get(p.type));
  for (const m of built.movers) for (const p of m.parts) batched += tri(built.kits.get(p.type));
  for (const f of built.fixtures) batched += tri(f.geo);
  for (let i = 0; i < built.socks.length; i++) batched += tri(built.kits.get('windsock'));
  return {
    static: tri(built.staticGeo),
    batched,
    decals: tri(built.decals),
    pools: tri(built.pools),
    total: tri(built.staticGeo) + batched + tri(built.decals) + tri(built.pools),
  };
}

const _m = new Matrix4(), _q = new Quaternion(), _p = new Vector3(), _s = new Vector3(1, 1, 1), _up = new Vector3(0, 1, 0);
const _qx = new Quaternion(), _ax = new Vector3(1, 0, 0);
function place(x, y, z, yaw, pitch = 0) {
  _q.setFromAxisAngle(_up, yaw);
  if (pitch) _q.multiply(_qx.setFromAxisAngle(_ax, pitch));
  return _m.compose(_p.set(x, y, z), _q, _s);
}

/** A flat field until the ground has been sampled. */
const FLAT = { at: () => 0, version: 0 };

/**
 * Build the renderable set.
 * @param plan   planAirportSet() result
 * @param frame  { k, heading } (the set group's scale and yaw)
 */
export function createAirportSet(plan, frame) {
  const atlasLayout = planAtlas(atlasEntries(plan));
  const built = buildSetGeometry(plan, atlasLayout);
  const uniforms = createSetUniforms();
  uniforms.uSetAtlas.value = drawAtlas(atlasLayout);
  uniforms.uSetConcourse.value.set(plan.gateY + 0.35, plan.terminal.roofY);
  const N = AIRFIELD.structures.night;
  uniforms.uSetGains.value.set(N.interior, N.signs, N.floodLight, N.floodPool);
  uniforms.uSetPoolFill.value = N.floodFill;
  const setMaterial = createSetMaterial(uniforms);
  const decalMaterial = createDecalMaterial(uniforms);
  const poolMaterial = createPoolMaterial(uniforms, 'light');
  const poolFillMaterial = createPoolMaterial(uniforms, 'fill');

  const group = new Group();
  group.name = 'airport-set';

  const staticMesh = new Mesh(built.staticGeo, setMaterial);
  staticMesh.name = 'airport-set:static';
  staticMesh.castShadow = true;
  staticMesh.receiveShadow = true;
  staticMesh.frustumCulled = false; // spans the whole set; the camera is inside it
  group.add(staticMesh);

  // --- batched parts -------------------------------------------------------------
  const unique = new Set();
  const keep = (g) => { unique.add(g); return g; };
  for (const b of built.bridges) { keep(b.docked); keep(b.retracted); keep(b.dockedColumn.geo); keep(b.retractedColumn.geo); }
  for (const p of built.parked) keep(built.kits.get(p.type));
  for (const m of built.movers) for (const p of m.parts) keep(built.kits.get(p.type));
  for (const f of built.fixtures) keep(f.geo);
  if (built.socks.length) keep(built.kits.get('windsock'));
  let maxV = 0, maxI = 0;
  for (const g of unique) { maxV += g.attributes.position.count; maxI += g.index.count; }
  const instanceCount = built.bridges.length * 4 + built.parked.length + built.movers.reduce((n, m) => n + m.parts.length, 0) + built.fixtures.length + built.socks.length;
  const batched = new BatchedMesh(Math.max(1, instanceCount), Math.max(3, maxV), Math.max(3, maxI), setMaterial);
  batched.name = 'airport-set:batched';
  batched.sortObjects = false;
  batched.perObjectFrustumCulled = true;
  batched.castShadow = true;
  batched.receiveShadow = true;
  const ids = new Map();
  for (const g of unique) ids.set(g, batched.addGeometry(g));
  const inst = (g, matrix, visible = true) => {
    const id = batched.addInstance(ids.get(g));
    batched.setMatrixAt(id, matrix);
    batched.setVisibleAt(id, visible);
    return id;
  };
  const identity = new Matrix4();
  // Grounded instances: re-placed whenever the ground field moves.
  const grounded = []; // { id, x, z, yaw, dy }
  const ground = (g, x, z, yaw, visible = true) => { const id = inst(g, place(x, 0, z, yaw), visible); grounded.push({ id, x, z, yaw }); return id; };
  const bridgeIds = built.bridges.map((b) => ({
    stand: b.stand,
    docked: [inst(b.docked, identity, true), ground(b.dockedColumn.geo, b.dockedColumn.x, b.dockedColumn.z, b.dockedColumn.yaw, true)],
    retracted: [inst(b.retracted, identity, false), ground(b.retractedColumn.geo, b.retractedColumn.x, b.retractedColumn.z, b.retractedColumn.yaw, false)],
  }));
  const parkedIds = built.parked.map((p) => ({ stand: p.standIndex, id: ground(built.kits.get(p.type), p.x, p.z, p.yaw) }));
  const fixtureIds = built.fixtures.map((f) => ({ ...f, id: inst(f.geo, place(f.x, 0, f.z, f.yaw)), dy: 0 }));
  const sockGeo = built.kits.get('windsock');
  const sockIds = built.socks.map((s) => ({ ...s, id: inst(sockGeo, place(s.x, s.y, s.z, 0)) }));
  const parts = [];
  for (const m of built.movers) for (const p of m.parts) {
    const part = { ...p, mover: m, x: 0, z: 0, yaw: 0 };
    part.id = inst(built.kits.get(p.type), place(0, -50, 0, 0));
    parts.push(part);
  }
  group.add(batched);

  // --- decals and pools --------------------------------------------------------------
  const decals = new Mesh(built.decals, decalMaterial);
  decals.name = 'airport-set:decals';
  decals.receiveShadow = true;
  // Negative: drawn after the transparent imagery (r185 reverse-Z order, materials.js).
  decals.renderOrder = -5;
  decals.frustumCulled = false;
  group.add(decals);
  // Floodlight pools: the multiplying 'light' pass, then the faint fill,
  // both after the markings and every ground overlay.
  const pools = new Mesh(built.pools, poolMaterial);
  pools.name = 'airport-set:pools';
  pools.renderOrder = -6;
  pools.frustumCulled = false;
  pools.visible = false;
  group.add(pools);
  const poolFill = new Mesh(built.pools, poolFillMaterial);
  poolFill.name = 'airport-set:pool-fill';
  poolFill.renderOrder = -7;
  poolFill.frustumCulled = false;
  poolFill.visible = false;
  group.add(poolFill);

  // --- floodlight uniform and the light set ------------------------------------------
  // Masts and eave floodlights share MAX_FLOODS slots, nearest the lounge first.
  const floodLight = AIRFIELD.structures.night.floodLight;
  const candidates = [
    ...plan.masts.map((m) => ({ x: m.x, y: m.h - 0.6, z: m.z, w: (Math.cos(m.yaw || 0) >= 0 ? 1 : -1) * floodLight * 2.4 })),
    ...(plan.roofFloods || []).map((f) => ({ x: f.x, y: f.y, z: f.z, w: (f.side === 'back' ? -1 : 1) * floodLight * 1.5 })),
  ].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  const floods = uniforms.uSetFlood.value;
  let nf = 0;
  for (const f of candidates) {
    if (nf >= MAX_FLOODS) break;
    floods[nf++].set(f.x, f.y, f.z, f.w);
  }
  uniforms.uSetFloodCount.value = nf;

  const tower = built.fixtures.find((f) => f.kind === 'tower');
  const lights = new SetLights(plan, frame, { tower: tower?.info });
  // Parked engines-running beacons: pushback tugs and loaders at work.
  const rnd = setRandom(plan.seed ^ 0xbeac);
  for (const p of built.parked) {
    const L = GSE_KIT[p.type]?.lights?.beacon;
    if (!L || p.standIndex < 0 || rnd() < 0.4) continue;
    const [lx, ly, lz] = L[0], c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    p.beacon = lights.addParkedBeacon(p.x + lx * c + lz * s, ly, p.z - lx * s + lz * c, rnd());
  }
  parts.forEach((part, i) => lights.addMover(part, i + 1));
  lights.commit();
  group.add(lights.glow.mesh);

  const state = { occupancy: new Map(), ground: FLAT, groundVersion: -1 };
  const lift = AIRFIELD.structures.decalLiftM;

  const api = {
    group,
    plan,
    uniforms,
    lights,
    meshes: { staticMesh, batched, decals, pools, poolFill },
    atlasBytes: uniforms.uSetAtlas.value ? (uniforms.uSetAtlas.value.image.data.byteLength * 4) / 3 : 0,
    triangles: setGeometryStats(built),
    fixtures: fixtureIds,

    /** Stand occupancy. Unoccupied stands retract their bridges and clear servicing gear. */
    setOccupied(index, occupied) {
      if (state.occupancy.get(index) === occupied) return;
      state.occupancy.set(index, occupied);
      for (const b of bridgeIds) if (b.stand === index) {
        for (const id of b.docked) batched.setVisibleAt(id, occupied);
        for (const id of b.retracted) batched.setVisibleAt(id, !occupied);
      }
      for (const p of parkedIds) if (p.stand === index) batched.setVisibleAt(p.id, occupied);
      for (const p of built.parked) if (p.standIndex === index && p.beacon >= 0) lights.glow.dim(p.beacon, occupied ? 1.1 : 0);
    },

    /** Adopt a ground field (./ground.js): re-drape markings and grounded parts. */
    setGround(field) {
      state.ground = field || FLAT;
      state.groundVersion = -1;
    },

    /** Lift a far fixture (and its windsock) onto its own sampled ground (metres relative to the apron). */
    setFixtureGround(index, dy) {
      const f = fixtureIds[index];
      if (!f || Math.abs(f.dy - dy) < 0.05) return;
      f.dy = dy;
      batched.setMatrixAt(f.id, place(f.x, dy, f.z, f.yaw));
      lights.shiftFixture(f.x, f.z, dy);
    },

    /**
     * Per frame. `t` seconds (shared clock), `night` 0..1, `wind` room-local
     * metres/second [x, z], `cam` room-local camera position.
     */
    update({ t, night, wind, cam, camera, heightPx }) {
      uniforms.uSetTime.value = t;
      uniforms.uSetNight.value = night;
      if (cam) uniforms.uSetCam.value.copy(cam);
      pools.visible = poolFill.visible = night > 0.02;
      const g = state.ground;
      if (g.version !== state.groundVersion) {
        state.groundVersion = g.version;
        drapeGeometry(built.decals, g, lift);
        drapeGeometry(built.pools, g, lift + 0.02);
        for (const r of grounded) batched.setMatrixAt(r.id, place(r.x, g.at(r.x, r.z), r.z, r.yaw));
        lights.drape(g);
      }
      // Movers along their loops, on the ground.
      for (const part of parts) {
        const m = part.mover;
        const at = sampleRoute(plan.loops[m.loop], m.s0 + m.speed * t - part.offset);
        part.x = at.x; part.z = at.z; part.yaw = at.yaw; part.y = g.at(at.x, at.z);
        batched.setMatrixAt(part.id, place(at.x, part.y, at.z, at.yaw));
      }
      // Windsocks: stream downwind, droop in light air, a little flutter.
      const speed = Math.hypot(wind[0], wind[1]);
      const fill = Math.min(1, speed / 7.7);
      const yaw = speed > 0.2 ? yawToward(wind[0], wind[1]) : 0;
      sockIds.forEach((s, i) => {
        const dy = fixtureIds[s.fixture]?.dy ?? 0;
        const flutter = 0.05 * (1 - fill * 0.6) * Math.sin(t * (2.6 + i) + i * 1.7);
        batched.setMatrixAt(s.id, place(s.x, s.y + dy, s.z, yaw + flutter, -(1 - fill) * 1.25 + 0.04 * Math.sin(t * 3.1 + i)));
      });
      lights.update(camera, heightPx, t, night);
    },

    dispose() {
      built.staticGeo.dispose();
      for (const geo of unique) geo.dispose();
      built.decals.dispose();
      built.pools.dispose();
      batched.dispose();
      setMaterial.dispose();
      decalMaterial.dispose();
      poolMaterial.dispose();
      poolFillMaterial.dispose();
      uniforms.uSetAtlas.value?.dispose();
      lights.dispose();
    },
  };
  return api;
}

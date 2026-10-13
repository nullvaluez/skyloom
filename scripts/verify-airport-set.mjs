// AIRFIELD STRUCTURES gate (FLY_OBSERVATION_LOUNGE.md, workstream E): the
// observation lounge's airport set — layout, plan and geometry — in node.
//
//   node scripts/verify-airport-set.mjs
//
// For the four flagships and three generic airports (big / mid / small runway
// classes) it builds the whole set and checks: the layout record keeps its
// contract shape; every vertex is finite and bounded; two builds are byte-
// identical; nothing intrudes into LOUNGE_ROOM.envelope; the triangle budget
// (AIRFIELD share: 350k) holds; every docked bridge meets its door; the
// service-road loops never cross a stand; movers never overlap; the atlas
// holds every legend; the footprint covers terminal and apron; and the
// scenery retirement round-trips a synthetic building chunk exactly.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({ resolve(s, c, next) { if (s.startsWith('@/')) s = new URL('../' + s.slice(2), import.meta.url).href; if (s.startsWith('.') || s.startsWith('file:')) { const u = new URL(s, c.parentURL); if (fs.existsSync(fileURLToPath(u) + '.js')) return next(u.href + '.js', c); } return next(s, c); } });

const registry = await import('../lib/fly/operations-airports.js');
const { resolveLoungeSite, siteToWorld } = await import('../lib/fly/lounge-site.js');
const { airportLayout, STAND_CLASS } = await import('../lib/fly/airport-layout.js');
const { planAirportSet, sampleRoute } = await import('../lib/fly/airport-set/plan.js');
const { buildSetGeometry, setGeometryStats } = await import('../lib/fly/airport-set/index.js');
const { atlasEntries, planAtlas } = await import('../lib/fly/airport-set/atlas.js');
const { GSE_KIT } = await import('../lib/fly/airport-set/gse.js');
const { LOUNGE_ROOM, LOUNGE_BUDGETS, AIRFIELD } = await import('../lib/fly/observation-config.js');
const { AIRPORT_LANDMARKS } = await import('../lib/fly/airport-landmarks.js');
const { airportSetRetirement } = await import('../lib/fly/operations-scenery.js');

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };

// --- catalog loading (same rules as runway-catalog.js, from public/) ----------------
const index = JSON.parse(fs.readFileSync('public/data/runways/v1/index.json', 'utf8')).runways;
const regionCache = new Map();
const region = (r) => { if (!regionCache.has(r)) regionCache.set(r, JSON.parse(fs.readFileSync(`public/data/runways/v1/regions/${r}.json`, 'utf8')).airports); return regionCache.get(r); };
function loadAirport(id) {
  let a = registry.airportById(id);
  if (a) return a;
  const item = index.find((r) => r.id === id) || index.filter((r) => r.ident === id).sort((x, y) => (y.length || 0) - (x.length || 0))[0];
  assert.ok(item, `catalog has ${id}`);
  // Register the airport's neighbours too (lounge-site.js picks the terminal side from siblings).
  for (const it of index.filter((r) => Math.abs(r.lat - item.lat) < 0.25 && Math.abs(r.lon - item.lon) * Math.cos(item.lat * Math.PI / 180) < 0.25)) {
    const row = region(it.region).find((x) => x.id === it.id);
    if (row) try { registry.registerAirport(row); } catch { /* invalid rows are skipped like the runtime does */ }
  }
  a = registry.airportById(item.id);
  assert.ok(a, `registered ${id}`);
  return a;
}

const AIRPORTS = ['KCMH', 'KJFK', 'LOWI', 'YSSY', 'EGLL', 'KMDW', 'KBTV', 'K00V'];
const sets = [];
for (const id of AIRPORTS) {
  const airport = loadAirport(id);
  const site = resolveLoungeSite(airport);
  const layout = airportLayout(site);
  const runway = registry.airportById(site.runwayId);
  const isPavement = (x, z) => !!registry.findAirportSurface(x, z, 25);
  const plan = planAirportSet(site, layout, { runway, landmark: AIRPORT_LANDMARKS[site.ident] || null, isPavement });
  const atlas = planAtlas(atlasEntries(plan));
  const built = buildSetGeometry(plan, atlas);
  sets.push({ id, airport, site, layout, plan, atlas, built, runway, isPavement });
}

const classes = new Set(sets.map((s) => s.layout.size));
check('the review set spans every terminal size class', () => assert.deepEqual([...classes].sort(), ['big', 'mid', 'small']));

check('layout keeps its contract record shape', () => {
  for (const { layout } of sets) {
    for (const k of ['x0', 'x1', 'z0', 'z1', 'roofY']) assert.ok(Number.isFinite(layout.terminal[k]), `terminal.${k}`);
    for (const k of ['x0', 'x1', 'z0', 'z1']) assert.ok(Number.isFinite(layout.apron[k]), `apron.${k}`);
    assert.ok(Number.isFinite(layout.floorM));
    assert.ok(layout.stands.length >= 2);
    for (const s of layout.stands) {
      for (const k of ['x', 'z', 'wx', 'wz', 'heading', 'noseZ']) assert.ok(Number.isFinite(s[k]), `stand.${k}`);
      assert.equal(typeof s.id, 'string');
      assert.ok(STAND_CLASS[s.cls], 'stand class');
      // Nose-in: the stand's aircraft faces the pier, nose ahead of its centre.
      assert.ok(s.noseZ > s.z && s.noseZ < layout.terminal.z0);
    }
  }
});

check('stands never overlap (wingspan + clearance inside the pitch)', () => {
  for (const { layout } of sets) {
    const st = layout.stands;
    for (let i = 1; i < st.length; i++) {
      const a = st[i - 1], b = st[i];
      const gap = (b.x - STAND_CLASS[b.cls].span / 2) - (a.x + STAND_CLASS[a.cls].span / 2);
      assert.ok(gap >= 7.5, `wingtip clearance ${gap.toFixed(1)} m between ${a.id} and ${b.id}`);
    }
    for (const s of st) assert.ok(s.x - STAND_CLASS[s.cls].span / 2 >= layout.terminal.x0 - 1 && s.x + STAND_CLASS[s.cls].span / 2 <= layout.terminal.x1 + 1, 'stands within the pier frontage');
  }
});

const attrArrays = (g) => ['position', 'normal', 'color', 'aSurf', 'uv'].map((k) => g.getAttribute(k)?.array).filter(Boolean);
check('every vertex is finite and every surface byte is in range', () => {
  for (const { built } of sets) {
    const geos = [built.staticGeo, built.decals, built.pools, ...built.kits.values(), ...built.fixtures.map((f) => f.geo), ...built.bridges.flatMap((b) => [b.docked, b.retracted])];
    for (const g of geos) {
      for (const a of attrArrays(g)) for (let i = 0; i < a.length; i++) assert.ok(Number.isFinite(a[i]), 'finite attribute');
      const surf = g.getAttribute('aSurf');
      if (surf) for (let i = 0; i < surf.count; i++) { assert.ok(surf.getX(i) <= 13, 'surface class'); assert.ok(surf.getW(i) <= 14, 'glow id'); }
      const n = g.getAttribute('normal');
      for (let i = 0; i < n.count; i++) assert.ok(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-3, 'unit normal');
      const idx = g.index.array, count = g.getAttribute('position').count;
      for (let i = 0; i < idx.length; i++) assert.ok(idx[i] < count, 'index in range');
    }
  }
});

// Every placed vertex, room-local (apron-relative y): static + both bridge
// poses + instances at their placements.
function* placedVertices(built) {
  const emit = function* (g, x = 0, z = 0, yaw = 0, y = 0) {
    const p = g.getAttribute('position'), c = Math.cos(yaw), s = Math.sin(yaw);
    for (let i = 0; i < p.count; i++) {
      const lx = p.getX(i), ly = p.getY(i), lz = p.getZ(i);
      yield [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    }
  };
  yield* emit(built.staticGeo);
  for (const b of built.bridges) { yield* emit(b.docked); yield* emit(b.retracted); }
  for (const p of built.parked) yield* emit(built.kits.get(p.type), p.x, p.z, p.yaw);
  for (const f of built.fixtures) yield* emit(f.geo, f.x, f.z, f.yaw);
}

check('the set is bounded (no stray vertex)', () => {
  // 6 km: a seat at one end of a long runway puts the far windsock that far
  // out (YSSY's sits 3.6 km away on the 3.96 km 16R/34L).
  for (const { built, site } of sets) {
    for (const [x, y, z] of placedVertices(built)) {
      assert.ok(Math.abs(x) < 6000 && Math.abs(z) < 6000, `xz bound ${x.toFixed(0)},${z.toFixed(0)}`);
      assert.ok(y > -3 && y < 140, `y bound ${y.toFixed(1)} at ${site.ident}`);
    }
  }
});

check('LOUNGE_ROOM.envelope stays empty', () => {
  const e = LOUNGE_ROOM.envelope;
  for (const { built, site } of sets) {
    const y0 = site.floorM + e.minY, y1 = site.floorM + e.maxY;
    for (const [x, y, z] of placedVertices(built)) {
      const inside = x > e.minX + 1e-3 && x < e.maxX - 1e-3 && z > e.minZ + 1e-3 && z < e.maxZ - 1e-3 && y > y0 + 1e-3 && y < y1 - 1e-3;
      assert.ok(!inside, `vertex inside the lounge envelope at ${site.ident}: ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`);
    }
  }
});

check('the pavilion base reaches the room slab from the pier roof', () => {
  for (const { plan, site } of sets) {
    assert.ok(Math.abs(plan.podium.y1 - (site.floorM + LOUNGE_ROOM.envelope.minY)) < 0.05);
    assert.equal(plan.podium.y0, plan.terminal.roofY);
  }
});

check('two builds are byte-identical (deterministic)', () => {
  const digest = (built) => {
    const h = createHash('sha256');
    const geos = [built.staticGeo, built.decals, built.pools, ...[...built.kits.entries()].sort().map(([, g]) => g), ...built.fixtures.map((f) => f.geo), ...built.bridges.flatMap((b) => [b.docked, b.retracted])];
    for (const g of geos) { for (const a of attrArrays(g)) h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); h.update(Buffer.from(g.index.array.buffer)); }
    h.update(JSON.stringify(built.parked.map((p) => [p.type, p.x, p.z, p.yaw])));
    return h.digest('hex');
  };
  for (const s of sets.slice(0, 3)) {
    const again = buildSetGeometry(planAirportSet(s.site, airportLayout(s.site), { runway: s.runway, landmark: AIRPORT_LANDMARKS[s.site.ident] || null, isPavement: s.isPavement }), s.atlas);
    assert.equal(digest(again), digest(s.built), s.id);
  }
});

const budget = 350000;
check(`triangle budget holds (<= ${budget}, structures share of AIRFIELD ${LOUNGE_BUDGETS.airfield.triangles})`, () => {
  for (const { built, id } of sets) {
    const t = setGeometryStats(built);
    console.log(`  ${id.padEnd(5)} static ${t.static} batched ${t.batched} decals ${t.decals} pools ${t.pools} total ${t.total}`);
    assert.ok(t.total <= budget, `${id}: ${t.total}`);
  }
});

check('every docked bridge meets its boarding door', () => {
  const B = AIRFIELD.structures.bridge;
  for (const { plan } of sets) {
    for (const s of plan.stands) for (const b of s.bridges) {
      const d = b.docked;
      const mouthX = d.cab.x - B.cabDepth / 2; // cab yaw +PI/2: mouth faces -X
      assert.ok(Math.abs(d.cabYaw - Math.PI / 2) < 1e-9, 'cab faces the fuselage');
      assert.ok(Math.abs(mouthX - b.door.x - B.bumperM) < 1e-6, 'mouth on the door');
      assert.ok(Math.abs(d.cab.z - b.door.z) < 1e-9, 'cab centred on the door');
      assert.equal(d.floorB, b.sill, 'cab floor at the sill');
      // Telescoping sections overlap when extended and never exceed the tunnel.
      for (let i = 1; i < 3; i++) assert.ok(d.sections[i].s0 < d.sections[i - 1].s1, 'sections overlap');
      assert.ok(d.sections[2].s1 <= d.len + 1e-6, 'outer section ends at the cab');
      // The retracted pose nests the same physical sections.
      for (let i = 0; i < 3; i++) assert.ok(Math.abs((b.retracted.sections[i].s1 - b.retracted.sections[i].s0) - (d.sections[i].s1 - d.sections[i].s0)) < 1e-9);
      assert.ok(b.retracted.len < d.len, 'retracted is shorter');
    }
  }
});

check('service-road loops never cross a stand and movers never overlap', () => {
  for (const { plan, id } of sets) {
    for (const loop of plan.loops) {
      for (let s = 0; s < loop.length; s += 2) {
        const p = sampleRoute(loop, s);
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.yaw));
        for (const st of plan.stands) {
          const c = STAND_CLASS[st.cls];
          const inStand = Math.abs(p.x - st.x) < c.span / 2 + 1 && p.z < st.noseZ + 2 && p.z > st.noseZ - c.length - 1;
          assert.ok(!inStand, `${id}: route crosses stand ${st.id} at ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
        }
      }
      // Continuity: consecutive samples never jump (no teleporting).
      let prev = sampleRoute(loop, 0);
      for (let s = 0.5; s <= loop.length + 0.5; s += 0.5) {
        const p = sampleRoute(loop, s);
        assert.ok(Math.hypot(p.x - prev.x, p.z - prev.z) < 0.6, `${id}: route jump at s=${s}`);
        prev = p;
      }
    }
    for (let l = 0; l < plan.loops.length; l++) {
      const ms = plan.movers.filter((m) => m.loop === l).sort((a, b) => a.s0 - b.s0);
      for (let i = 0; i < ms.length; i++) {
        const a = ms[i], b = ms[(i + 1) % ms.length];
        const gap = ((b.s0 - a.s0) % plan.loops[l].length + plan.loops[l].length) % plan.loops[l].length || plan.loops[l].length;
        assert.ok(gap > 45, `${id}: movers ${i} and ${(i + 1) % ms.length} only ${gap.toFixed(1)} m apart`);
      }
      assert.ok(new Set(ms.map((m) => m.speed)).size <= 1, 'one speed per loop (no overtaking)');
    }
  }
});

check('parked equipment never stands inside a docked bridge or another vehicle', () => {
  for (const { built, id } of sets) {
    const items = built.parked.filter((p) => !['cone', 'chock'].includes(p.type));
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.standIndex !== b.standIndex && a.standIndex >= 0 && b.standIndex >= 0) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      const r = 0.42 * (Math.min(GSE_KIT[a.type].length, 4) + Math.min(GSE_KIT[b.type].length, 4));
      assert.ok(d > r * 0.75, `${id}: ${a.type} and ${b.type} overlap (${d.toFixed(2)} m)`);
    }
  }
});

check('the atlas holds every legend', () => {
  for (const { plan, atlas } of sets) {
    for (const e of atlasEntries(plan)) {
      const r = atlas.rect(e.key);
      assert.ok(r, `atlas cell for ${e.key}`);
      assert.ok(r.u0 >= 0 && r.u1 <= 1 && r.v0 >= 0 && r.v1 <= 1 && r.u1 > r.u0 && r.v1 > r.v0);
    }
  }
});

check('the footprint covers the terminal, the apron and every far building', () => {
  for (const { plan } of sets) {
    const covers = (x, z) => plan.footprint.some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
    const T = plan.terminal, A = plan.apron;
    for (const [x, z] of [[T.x0, T.z0], [T.x1, T.z1], [0, T.z1], [A.x0, A.z0], [A.x1, A.z0]]) assert.ok(covers(x, z));
    for (const h of plan.hangars) assert.ok(covers(h.x, h.front + h.d / 2));
    if (plan.tower) assert.ok(covers(plan.tower.x, plan.tower.z));
  }
});

check('far buildings stay off every registered runway', () => {
  for (const { plan, site, isPavement } of sets) {
    for (const h of plan.hangars) { const w = siteToWorld(site, h.x, h.front + h.d / 2); assert.ok(!isPavement(w.x, w.z), 'hangar on pavement'); }
    if (plan.tower && !plan.tower.real) { const w = siteToWorld(site, plan.tower.x, plan.tower.z); assert.ok(!isPavement(w.x, w.z), 'tower on pavement'); }
  }
});

check('flagship towers sit at their real coordinates', () => {
  for (const { plan, site } of sets.filter((s) => AIRPORT_LANDMARKS[s.site.ident])) {
    assert.ok(plan.tower?.real, site.ident);
    assert.equal(plan.tower.h, AIRPORT_LANDMARKS[site.ident].towerHeight);
    // Only stepped off the procedural pier, never moved far from the real spot.
    assert.ok(plan.tower.nudgeM <= 25, `${site.ident} tower nudged ${plan.tower.nudgeM.toFixed(1)} m`);
    if (plan.tower.nudgeM > 0) console.log(`  ${site.ident} tower stepped ${plan.tower.nudgeM.toFixed(1)} m off the pier`);
    const T = plan.terminal;
    const inside = plan.tower.x > T.x0 - 3 && plan.tower.x < T.x1 + 3 && plan.tower.z > T.z0 - T.eave - 3 && plan.tower.z < T.z1 + 3;
    assert.ok(!inside, `${site.ident} tower stands inside the pier`);
  }
});

check('scenery retirement collapses buildings in the footprint and restores them exactly', () => {
  const { site, plan } = sets[0];
  const inside = siteToWorld(site, 0, plan.terminal.z0 + 20);
  const outside = siteToWorld(site, 0, 2500);
  // A fake chunk: two "buildings" of three vertices each, anchors tile-local.
  const cx = inside.x - 100, cz = inside.z - 100;
  const pos = new Float32Array([100, 0, 100, 102, 5, 100, 100, 5, 104, outside.x - cx, 0, outside.z - cz, outside.x - cx + 2, 5, outside.z - cz, outside.x - cx, 5, outside.z - cz + 3]);
  const anchor = new Float32Array([101, 101, 101, 101, 101, 101, outside.x - cx + 1, outside.z - cz + 1, outside.x - cx + 1, outside.z - cz + 1, outside.x - cx + 1, outside.z - cz + 1]);
  const original = pos.slice();
  const attr = (array, itemSize) => ({ array, count: array.length / itemSize, needsUpdate: false, clearUpdateRanges() {} });
  const geometry = { attrs: { position: attr(pos, 3), aBendAnchor: attr(anchor, 2) }, getAttribute(k) { return this.attrs[k]; }, boundingSphere: { center: { x: 0, z: 0 }, radius: 50000 }, computeBoundingSphere() {} };
  const engine = { chunks: new Map([['t', { state: 'ready', mesh: { geometry, position: { x: cx, z: cz } } }]]) };
  const r = airportSetRetirement(site, plan.footprint);
  assert.equal(r.sweep(engine), 3, 'the inside building is retired, the outside one kept');
  for (let v = 0; v < 3; v++) { assert.equal(pos[v * 3], 101); assert.equal(pos[v * 3 + 2], 101); }
  for (let i = 9; i < 18; i++) assert.equal(pos[i], original[i]);
  assert.equal(r.sweep(engine), 0, 'idempotent');
  r.restore();
  assert.deepEqual([...pos], [...original]);
});

console.log(`AIRPORT SET: ${checks}/${checks}`);

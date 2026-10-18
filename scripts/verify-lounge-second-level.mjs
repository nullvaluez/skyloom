// Lounge second-level pass — the cross-lane contract gate (node; no GPU).
//
// FLY_LOUNGE_SECOND_LEVEL.md "W0 contracts": three lanes (FURNISH geometry,
// LIGHT shading, LIFE behaviour) share positions through
// lib/fly/lounge/upper-dressing.mjs and land in any order. This gate holds
// them to it against the REAL built rooms:
//   1. the contract is well formed (ids, rects inside their floors, chart
//      prints clear of the handrail, cups on their surfaces);
//   2. the pass's budgets: pier room + instruments triangles within the plan
//      (PLAN_TRIANGLES.total, under the sanctioned 160k ceiling), 14 draws,
//      practicals <= MAX_LIGHTS, shadow boxes <= MAX_SHADOWS;
//   3. the classic room is untouched (12 draws, 120198 triangles, 28
//      practicals, no dressing, one steam source);
//   4. the surface codes and glow aliases keep their contract values, every
//      new code has a documented fallback, and the defines reach the PIER
//      program only;
//   5. nothing built intrudes on KEEP_CLEAR;
//   6. every rug the footsteps rely on is really there;
//   7. every built cup steams at its contract point and every extra steam
//      source belongs to a built cup;
//   8. every built inspectable has geometry inside its bounds, every built
//      chart print carries SURF.CHART on its face;
//   9. the reserved upstairs station, when LIFE adds it, sits where reserved.
// Lanes extend this gate with their own checks (same file, their own section).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(s, c, next) {
    if (s.startsWith('@/')) s = new URL('../' + s.slice(2), import.meta.url).href;
    if (s.startsWith('.') || s.startsWith('file:')) {
      const u = new URL(s, c.parentURL);
      if (!fs.existsSync(fileURLToPath(u)) && fs.existsSync(fileURLToPath(u) + '.js')) return next(u.href + '.js', c);
    }
    return next(s, c);
  },
});
const { ShaderLib } = await import('three');
const { createAirportLounge } = await import('../lib/fly/airport-lounge.js');
const { createObservatoryInstruments } = await import('../lib/fly/lounge/observatory-instruments.js');
const { observatoryStations } = await import('../lib/fly/lounge/observatory-stations.mjs');
const { SURF, GLOW, roomDressing } = await import('../lib/fly/lounge/room-build.js');
const { MAX_LIGHTS, MAX_SHADOWS, SURF_FALLBACK } = await import('../lib/fly/lounge/room-shading.js');
const { roomVariant } = await import('../lib/fly/lounge/room-plan.js');
const { blockerDistance } = await import('../lib/fly/lounge/room-walk.mjs');
const { LOUNGE_BUDGETS } = await import('../lib/fly/observation-config.js');
const D = await import('../lib/fly/lounge/upper-dressing.mjs');
const { buildTriBvh } = await import('./_tri-bvh.mjs');

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
const triangles = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
const plan = roomVariant('pier'), U = plan.upper;
const pier = createAirportLounge({ variant: 'pier', document: null });
const classic = createAirportLounge({ variant: 'classic', document: null });
const instruments = createObservatoryInstruments('pier', null);
const room = pier.room;
const built = room.dressing;
const ids = new Set(Object.values(D.DRESSING));
const inRect = (x, z, r, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;

// --- 1. the contract itself -----------------------------------------------------------
check('the dressing contract is well formed (ids, rects, cups, inspectables, chart prints)', () => {
  assert.equal(ids.size, Object.values(D.DRESSING).length, 'DRESSING ids are unique');
  const plate = U.plate;
  for (const r of D.KEEP_CLEAR) {
    assert.ok(r.x0 < r.x1 && r.z0 < r.z1, `${r.id} is a rectangle`);
    if (r.floorId === 'upper') assert.ok(inRect(r.x0, r.z0, plate, 1e-9) && inRect(r.x1, r.z1, plate, 1e-9), `${r.id} lies on the upper plate`);
  }
  for (const [floorId, layer] of Object.entries(D.FOOTSTEP_SURFACES)) {
    assert.ok(['stone', 'oak', 'tread'].includes(layer.surface), `${floorId} surface`);
    for (const r of layer.rects) {
      assert.ok(r.x0 < r.x1 && r.z0 < r.z1 && ['rug'].includes(r.surface), `${floorId} rect`);
      if (r.dressingId) assert.ok(ids.has(r.dressingId), `${floorId} rect names a DRESSING id`);
    }
  }
  assert.equal(D.surfaceAt('upper', 0, 10.95), 'rug');
  assert.equal(D.surfaceAt('upper', -6.5, 9.4), 'oak', 'the nook rug counts only once built');
  assert.equal(D.surfaceAt('upper', -6.5, 9.4, [D.DRESSING.NOOK_RUG]), 'rug');
  assert.equal(D.surfaceAt('stairs', -10, 7), 'tread');
  assert.equal(D.surfaceAt('lower', 0, 2), 'stone');
  for (const cup of D.CUPS) {
    assert.ok(ids.has(cup.id) && (cup.on === null || ids.has(cup.on)), `${cup.id} ids`);
    const p = D.steamPoint(cup);
    assert.ok(Math.abs(p[1] - cup.base[1] - 0.0825) < 1e-9, `${cup.id} steam point`);
  }
  const c = D.CREDENZA;
  for (const cup of D.CUPS.filter((k) => k.on === D.DRESSING.COFFEE_STATION)) {
    assert.ok(Math.abs(cup.base[0] - c.x) < c.halfX - 0.1 && Math.abs(cup.base[2] - c.z) < c.halfZ - 0.1 && cup.base[1] === c.top, `${cup.id} stands on the credenza`);
  }
  for (const it of D.INSPECTABLES) {
    assert.ok(ids.has(it.dressingId), `${it.id} names a DRESSING id`);
    assert.ok(['upper', 'stairs', 'lower'].includes(it.floorId) && it.text.length > 20 && it.text.length < 260, `${it.id} floor and text`);
    for (let i = 0; i < 3; i++) assert.ok(it.bounds.min[i] < it.bounds.max[i], `${it.id} bounds`);
  }
  // Chart prints: level frames (<= 60 mm) clear the west handrail top
  // (rake + guard + half its 55 mm section) by >= 0.25 m across their width.
  const rail = (z) => D.stairRampY(z) + U.guardM + 0.0275;
  for (const p of D.CHART_PANELS) {
    const bottom = p.yc - p.h / 2 - 0.06;
    for (let z = p.zc - p.w / 2 - 0.06; z <= p.zc + p.w / 2 + 0.06 + 1e-9; z += 0.02) assert.ok(bottom - rail(z) >= 0.25, `${p.id} clears the handrail at z ${z.toFixed(2)}`);
    assert.ok(p.zc - p.w / 2 - 0.06 > 4.4 && p.zc + p.w / 2 + 0.06 < U.stair.z1, `${p.id} hangs over the flight, past the glazing's end post`);
    assert.ok(p.x - -11.2 >= 0.02 && p.x - -11.185 >= 0.02, `${p.id} face is >= 20 mm proud of the wall and the dado trim`);
    assert.ok(p.yc + p.h / 2 + 0.06 < U.roofY - 0.3, `${p.id} under the stairwell roof`);
  }
});

// --- 2. budgets -----------------------------------------------------------------------
let pierTris = instruments.stats.triangles;
check('budgets: pier room + instruments within the pass plan, 14 draws, fixtures within the shader tables', () => {
  const meshes = pier.group.children.filter((o) => o.isMesh);
  pierTris += meshes.reduce((s, m) => s + triangles(m.geometry), 0);
  assert.equal(meshes.length + instruments.stats.draws, LOUNGE_BUDGETS.room.draws, 'draws');
  assert.ok(D.PLAN_TRIANGLES.total <= LOUNGE_BUDGETS.room.triangles, 'the plan sits under the sanctioned ceiling');
  assert.equal(D.PLAN_TRIANGLES.baseline + D.PLAN_TRIANGLES.furnish + D.PLAN_TRIANGLES.light + D.PLAN_TRIANGLES.life <= D.PLAN_TRIANGLES.total, true, 'lane shares fit the plan');
  assert.ok(pierTris <= D.PLAN_TRIANGLES.total, `pier room + instruments ${pierTris} <= plan ${D.PLAN_TRIANGLES.total}`);
  assert.ok(room.practicals.length <= MAX_LIGHTS, `practicals ${room.practicals.length} <= ${MAX_LIGHTS}`);
  assert.ok(room.shadows.length <= MAX_SHADOWS, `shadow boxes ${room.shadows.length} <= ${MAX_SHADOWS}`);
});

// --- 3. classic untouched -----------------------------------------------------------------
check('the classic room is untouched (12 draws, 120198 triangles, 28 practicals, no dressing, one steam source)', () => {
  const meshes = classic.group.children.filter((o) => o.isMesh);
  assert.equal(meshes.length, 12);
  assert.equal(meshes.reduce((s, m) => s + triangles(m.geometry), 0), 120198);
  assert.equal(classic.room.practicals.length, 28);
  assert.deepEqual([...classic.room.dressing], []);
  assert.deepEqual([...roomDressing('classic')], []);
  assert.equal(classic.room.steamSources.length, 1);
  assert.equal(classic.room.steamSources[0], classic.room.practicals.steam);
});

// --- 4. codes and fallbacks ---------------------------------------------------------------------
check('surface codes and glow aliases keep their contract values; fallbacks documented; defines pier-only', () => {
  assert.equal(SURF.UPPER_FLOOR, 17); assert.equal(SURF.CHART, 18); assert.equal(SURF.SPINES, 19); assert.equal(SURF.EXTERIOR, 20);
  for (const code of [SURF.UPPER_FLOOR, SURF.CHART, SURF.SPINES, SURF.EXTERIOR]) assert.ok(typeof SURF_FALLBACK[code] === 'string' && SURF_FALLBACK[code].length > 5, `fallback for ${code}`);
  // Aliases until LIGHT gives them channels: a re-point must stay a valid channel.
  for (const name of ['READING', 'DISPLAY']) assert.ok(Number.isInteger(GLOW[name]) && GLOW[name] >= 0, `GLOW.${name}`);
  const source = (lounge, name) => {
    const m = lounge.materials[name];
    const shader = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader, uniforms: {} };
    m.onBeforeCompile(shader, {});
    return shader.fragmentShader;
  };
  assert.ok(source(pier, 'stone').includes(`#define SURF_CHART ${SURF.CHART}`), 'pier program defines the new codes');
  assert.ok(!source(classic, 'stone').includes('SURF_CHART'), 'classic program source is untouched');
});

// --- 5. keep-clear --------------------------------------------------------------------------------
check('no built blocker intrudes on KEEP_CLEAR', () => {
  const layerOf = (b) => b.floorId ?? 'lower';
  for (const r of D.KEEP_CLEAR) {
    const floorY = r.floorId === 'upper' ? U.floorY : 0;
    const relevant = room.blockers.filter((b) => layerOf(b) === r.floorId && !(r.maxTopM != null && b.y1 != null && b.y1 - floorY <= r.maxTopM));
    for (let x = r.x0; x <= r.x1 + 1e-9; x += 0.05) {
      for (let z = r.z0; z <= r.z1 + 1e-9; z += 0.05) {
        for (const b of relevant) assert.ok(blockerDistance(b, x, z) > 0, `${b.kind}${b.seatId ? ' ' + b.seatId : ''} at (${b.c}) intrudes on ${r.id} at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
  }
});

// --- 6. rugs --------------------------------------------------------------------------------------------
const fabric = buildTriBvh({ fabric: room.buckets.fabric });
check('every rug the footsteps rely on is built where declared', () => {
  for (const [floorId, layer] of Object.entries(D.FOOTSTEP_SURFACES)) {
    const floorY = floorId === 'upper' ? U.floorY : 0;
    for (const r of layer.rects) {
      if (r.dressingId && !built.includes(r.dressingId)) continue;
      const pts = [[(r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2], [r.x0 + 0.1, r.z0 + 0.1], [r.x1 - 0.1, r.z0 + 0.1], [r.x0 + 0.1, r.z1 - 0.1], [r.x1 - 0.1, r.z1 - 0.1]];
      for (const [x, z] of pts) {
        const t = fabric.cast(x, floorY + 0.3, z, 0, -1, 0, 0.5);
        const top = floorY + 0.3 - t;
        assert.ok(Number.isFinite(t) && top > floorY + 0.005 && top < floorY + 0.03, `${floorId} rug at (${x.toFixed(2)}, ${z.toFixed(2)}): top ${top}`);
      }
    }
  }
});

// --- 7. steam ----------------------------------------------------------------------------------------------
check('every built cup steams at its contract point; every extra steam source is a built cup', () => {
  assert.equal(room.steamSources[0], room.practicals.steam, 'the hero cup leads');
  const extra = room.steamSources.slice(1);
  for (const cup of D.CUPS) {
    const sources = extra.filter((s) => Math.hypot(s.at[0] - cup.base[0], s.at[2] - cup.base[2]) < 0.05);
    if (!built.includes(cup.id)) { assert.equal(sources.length, 0, `${cup.id} not built but steaming`); continue; }
    assert.equal(sources.length, 1, `${cup.id} steams once`);
    const p = D.steamPoint(cup), s = sources[0];
    assert.ok(Math.hypot(s.at[0] - p[0], s.at[1] - p[1], s.at[2] - p[2]) < 0.002 && Math.abs((s.r ?? D.STEAM_R) - D.STEAM_R) < 1e-9, `${cup.id} steam point`);
  }
  for (const s of extra) assert.ok(D.CUPS.some((cup) => built.includes(cup.id) && Math.hypot(s.at[0] - cup.base[0], s.at[2] - cup.base[2]) < 0.05), `steam at (${s.at}) has no built cup`);
  for (const id of built) assert.ok(ids.has(id), `built dressing id ${id} is in the contract`);
});

// --- 8. inspectables and chart prints -------------------------------------------------------------------
check('every built inspectable has geometry inside its bounds; every built chart print carries SURF.CHART', () => {
  const inside = (min, max) => {
    let n = 0;
    for (const g of Object.values(room.buckets)) {
      const p = g.attributes.position.array;
      for (let i = 0; i < p.length; i += 3) if (p[i] >= min[0] && p[i] <= max[0] && p[i + 1] >= min[1] && p[i + 1] <= max[1] && p[i + 2] >= min[2] && p[i + 2] <= max[2]) n++;
    }
    return n;
  };
  for (const it of D.INSPECTABLES) if (built.includes(it.dressingId)) assert.ok(inside(it.bounds.min, it.bounds.max) >= 24, `${it.id}: geometry inside its bounds`);
  if (built.includes(D.DRESSING.CHART_WALL)) {
    for (const panel of D.CHART_PANELS) {
      let n = 0;
      for (const g of Object.values(room.buckets)) {
        const p = g.attributes.position.array, s = g.attributes.aSurf.array;
        for (let i = 0, v = 0; i < p.length; i += 3, v++) {
          if (Math.round(s[v * 4 + 3]) !== SURF.CHART) continue;
          if (Math.abs(p[i] - panel.x) < 0.004 && Math.abs(p[i + 2] - panel.zc) <= panel.w / 2 + 0.002 && Math.abs(p[i + 1] - panel.yc) <= panel.h / 2 + 0.002) n++;
        }
      }
      assert.ok(n >= 4, `${panel.id}: SURF.CHART face on its contract rect (${n} vertices)`);
    }
  }
});

// --- 9. reserved station ------------------------------------------------------------------------------------
check('the reserved upstairs station, if added, sits where it was reserved', () => {
  const stations = observatoryStations('pier');
  for (const r of D.RESERVED_STATIONS) {
    const s = stations.find((x) => x.id === r.id);
    if (!s) continue;
    assert.equal(s.kind, r.kind);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(s.position[i] - r.position[i]) < 1e-6, `${r.id} position`);
  }
});

pier.dispose(); classic.dispose(); instruments.dispose();
console.log(`PASS lounge second level: ${checks} checks · pier room + instruments ${pierTris} / plan ${D.PLAN_TRIANGLES.total} triangles · ${room.practicals.length}/${MAX_LIGHTS} practicals · ${room.shadows.length}/${MAX_SHADOWS} shadow boxes · dressing built [${built.join(', ')}]`);

// FLEET & SKY gate (FLY_OBSERVATION_LOUNGE.md, workstream C): the first-party
// procedural airframes that draw live traffic, their per-airframe options,
// the phase-driven configuration (gear, flaps, lift dumpers) and the fleet's
// draw/triangle budget while observing. Node only, no GPU, no network.
//
//   node scripts/verify-fleet-airframes.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(s, c, next) {
    if (s.startsWith('@/')) s = new URL('../' + s.slice(2), import.meta.url).href;
    if (s.startsWith('.') || s.startsWith('file:')) {
      const u = new URL(s, c.parentURL);
      if (fs.existsSync(fileURLToPath(u) + '.js')) return next(u.href + '.js', c);
    }
    return next(s, c);
  },
});

const { PerspectiveCamera } = await import('three');
const T = await import('../lib/fly/fleet-types.js');
const { airframeLayout, tipFor, engineStyle } = await import('../lib/fly/fleet-layout.js');
const { buildLiveAirframe, ZONE, PART, DRIVER, PART_SLOTS } = await import('../lib/fly/live-aircraft-geometry.js');
const { LIVE_AIRCRAFT, resolveLiveAircraft, resolveLiveType } = await import('../lib/fly/live-aircraft.js');
const { PHASE, trackPhase, phaseConfig } = await import('../lib/fly/flight-phase.js');
const { buildPaletteData, PALETTE, paletteRow } = await import('../lib/fly/fleet-material.js');
const { DetailedTraffic } = await import('../lib/fly/detailed-traffic.js');
const { trailPersistence } = await import('../lib/fly/fleet-trails.js');
const { SKY_VIEW } = await import('../lib/fly/observation-config.js');

let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log(`PASS ${name}`);
}

const BUDGET = { hero: 40000, mid: 9500, far: 1500 };
const ORDER = ['a320', 'b737', 'a330', 'a350', 'b777', 'b787', 'b747', 'a380', 'crj', 'ejet', 'atr', 'dash8', 'business', 'piston', 'twin', 'helicopter', 'lowwing-piston', 'single-turboprop', 'twin-utility', 'b757', 'b767', 'a300', 'erj', 'md80', 'a220', 'c130', 'k35r', 'c17', 'md11'];
const GEAR_PARTS = [PART.NOSE, PART.MAIN_L, PART.MAIN_R, PART.BODY_L, PART.BODY_R, PART.CENTER];
const VARIANT_BITS = Object.values(T.VARIANT).reduce((m, b) => m | b, 0);

// Build every family at every level once.
const built = new Map();
for (const f of LIVE_AIRCRAFT) for (const lod of ['hero', 'mid', 'far']) built.set(`${f.id}:${lod}`, buildLiveAirframe(f, lod));
const get = (f, lod) => built.get(`${f.id}:${lod}`);

check('family contract: 29 families in a stable order, one family per type code, valid far classes', () => {
  assert.deepEqual(T.FLEET_FAMILIES.map((f) => f.id), ORDER);
  assert.equal(LIVE_AIRCRAFT, T.FLEET_FAMILIES);
  const claimed = new Map();
  for (const f of T.FLEET_FAMILIES) {
    assert.equal(T.FAMILY_INDEX[f.id], f.index);
    assert.ok(f.codes.length > 0, f.id);
    for (const code of f.codes) {
      assert.ok(!claimed.has(code), `${code} claimed by ${claimed.get(code)} and ${f.id}`);
      claimed.set(code, f.id);
      assert.equal(T.familyForCode(code), f.index);
    }
    assert.ok(f.far >= 0 && f.far < T.FAR_REP.length, f.id);
  }
  for (const i of T.FAR_REP_INDEX) assert.ok(i >= 0 && i < ORDER.length);
});

check('real designators draw as their own type family', () => {
  const want = {
    A321: 'a320', A20N: 'a320', B38M: 'b737', B739: 'b737', B752: 'b757', B753: 'b757', B762: 'b767', B763: 'b767', B764: 'b767',
    A306: 'a300', A310: 'a300', E135: 'erj', E145: 'erj', E45X: 'erj', MD88: 'md80', B712: 'md80', BCS1: 'a220', BCS3: 'a220',
    C130: 'c130', C30J: 'c130', K35R: 'k35r', C17: 'c17', MD11: 'md11', B744: 'b747', B748: 'b747', A388: 'a380', CRJ9: 'crj',
    E175: 'ejet', E75L: 'ejet', AT76: 'atr', DH8D: 'dash8', GLF6: 'business', C172: 'piston', PA28: 'lowwing-piston', P28A: 'lowwing-piston',
    BE58: 'twin', PC12: 'single-turboprop', DHC6: 'twin-utility', EC45: 'helicopter', A359: 'a350', B77W: 'b777', B789: 'b787', A333: 'a330',
  };
  for (const [code, id] of Object.entries(want)) assert.equal(T.FLEET_FAMILIES[resolveLiveAircraft({ t: code }, 0)].id, id, code);
  // Unknown types fall back by size class, never to a widebody.
  assert.equal(T.FLEET_FAMILIES[resolveLiveAircraft({ t: 'ZZZZ' }, 0)].id, 'a320');
  assert.equal(resolveLiveAircraft({ t: 'ZZZZ' }, 8), null);
  assert.equal(T.FLEET_FAMILIES[resolveLiveAircraft({}, 3)].id, 'helicopter');
});

check('per-airframe options are deterministic, bounded, and carry no airline identity beyond a paint seed', () => {
  for (const f of T.FLEET_FAMILIES) {
    for (const code of f.codes) {
      for (const meta of [{ t: code, flight: 'DAL123' }, { t: code, flight: 'FDX1346' }, { t: code }]) {
        const a = T.airframeSpec(f.index, meta, 'a1b2c3'), b = T.airframeSpec(f.index, meta, 'a1b2c3');
        assert.deepEqual(a, b);
        assert.deepEqual(Object.keys(a).sort(), ['family', 'length', 'operator', 'plugA', 'plugF', 'scale', 'seed', 'variant']);
        assert.ok(Number.isFinite(a.plugF) && Number.isFinite(a.plugA) && Math.abs(a.plugF) + Math.abs(a.plugA) <= f.length * 0.4, `${code} plugs`);
        assert.ok(a.scale > 0.45 && a.scale < 1.7, `${code} scale ${a.scale}`);
        assert.ok(a.seed >= 0 && a.seed < 256);
        assert.equal(a.variant & ~VARIANT_BITS, 0, `${code} variant bits`);
        assert.equal(!!(a.variant & T.VARIANT.FREIGHTER), !!(f.win && T.FREIGHTER_OPERATORS.has(a.operator)), code);
      }
    }
  }
  // One operator, one neutral scheme: the seed follows the call-sign prefix.
  const s1 = T.airframeSpec(0, { t: 'A320', flight: 'JBU1' }, 'aaaaaa'), s2 = T.airframeSpec(0, { t: 'A321', flight: 'JBU77' }, 'bbbbbb');
  assert.equal(s1.seed, s2.seed);
  assert.ok(T.airframeSpec(T.FAMILY_INDEX.b767, { t: 'B763', flight: 'FDX1346' }, 'a2b991').variant & T.VARIANT.FREIGHTER);
});

check('paint is neutral: civil bodies are near-white or grey, palette rows stay inside their class', () => {
  const data = buildPaletteData();
  for (let row = PALETTE.civil[0]; row < PALETTE.civil[1]; row++) {
    const o = row * 8 * 4, [r, g, b] = [data[o], data[o + 1], data[o + 2]];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    assert.ok(max > 170 && (max - min) / max < 0.12, `row ${row} body ${r},${g},${b}`);
  }
  for (const [cls, [a, b]] of Object.entries(PALETTE)) for (let seed = 0; seed < 256; seed++) { const row = paletteRow(cls, seed); assert.ok(row >= a && row < b); }
});

check('every family builds finite geometry at three detail levels inside its budget', () => {
  for (const f of LIVE_AIRCRAFT) {
    let prev = Infinity;
    for (const lod of ['hero', 'mid', 'far']) {
      const m = get(f, lod), g = m.hull, n = g.attributes.position.count;
      assert.ok(m.triangles > 0 && m.triangles <= BUDGET[lod], `${f.id} ${lod} ${m.triangles}`);
      assert.ok(m.triangles <= prev, `${f.id} ${lod} is not cheaper`);
      prev = m.triangles;
      for (const name of ['position', 'normal', 'aFleetUv', 'aFleetPart', 'aFleetFlex']) {
        const a = g.attributes[name];
        assert.ok(a && a.count === n, `${f.id} ${lod} ${name}`);
        for (const v of a.array) assert.ok(Number.isFinite(v), `${f.id} ${lod} ${name}`);
      }
      for (const i of g.index.array) assert.ok(i < n);
      const nr = g.attributes.normal.array;
      for (let i = 0; i < nr.length; i += 3) { const l = Math.hypot(nr[i], nr[i + 1], nr[i + 2]); assert.ok(l > 0.97 && l < 1.03, `${f.id} ${lod} normal ${l}`); }
      // No more than 1% zero-area triangles.
      const p = g.attributes.position.array, idx = g.index.array;
      let flat = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-9) flat++;
      }
      assert.ok(flat <= idx.length / 3 * 0.01, `${f.id} ${lod} degenerate ${flat}`);
    }
    const g = get(f, 'hero').hull;
    g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!f.helicopter) assert.ok(Math.abs(bb.max.x - bb.min.x - f.span) < f.span * 0.12, `${f.id} span`);
    assert.ok(Math.abs(bb.max.z - bb.min.z - f.length) < f.length * 0.1, `${f.id} length`);
  }
});

check('moving parts: every part a vertex names is driven, gear retracts where it should, flaps and props exist', () => {
  for (const f of LIVE_AIRCRAFT) {
    const m = get(f, 'hero'), part = m.hull.attributes.aFleetPart.array, { A, B, C } = m.parts;
    const used = new Set();
    for (let i = 0; i < part.length; i += 4) used.add(part[i + 1]);
    for (const id of used) {
      if (id === 0) continue;
      assert.ok(id > 0 && id < PART_SLOTS, `${f.id} part ${id}`);
      const drv = A[id * 4 + 3];
      assert.ok([DRIVER.GEAR, DRIVER.FLAPS, DRIVER.SPOILER, DRIVER.SPIN, DRIVER.SLAT].includes(drv), `${f.id} part ${id} driver ${drv}`);
      const axis = Math.hypot(B[id * 4], B[id * 4 + 1], B[id * 4 + 2]);
      assert.ok(Math.abs(axis - 1) < 1e-4 || (B[id * 4 + 3] === 0 && drv !== DRIVER.SPIN), `${f.id} part ${id} axis`);
      for (const v of [...A.slice(id * 4, id * 4 + 4), ...B.slice(id * 4, id * 4 + 4), ...C.slice(id * 4, id * 4 + 4)]) assert.ok(Number.isFinite(v));
      if (drv === DRIVER.SPIN) assert.ok(C[id * 4 + 3] > 0, `${f.id} spins`);
    }
    const retracts = !f.helicopter && f.gear?.type !== 'fixed';
    const gear = GEAR_PARTS.filter((id) => used.has(id));
    if (retracts) {
      assert.ok(gear.includes(PART.NOSE) || f.gear?.type === 'tandem' || f.gear?.type === 'sponson' || gear.length >= 2, `${f.id} gear parts`);
      for (const id of gear) assert.equal(A[id * 4 + 3], DRIVER.GEAR, `${f.id} gear part ${id}`);
    } else {
      for (const id of gear) assert.notEqual(A[id * 4 + 3], DRIVER.GEAR, `${f.id} fixed gear must not retract`);
    }
    const flaps = [PART.FLAP_LI, PART.FLAP_LO, PART.FLAP_RI, PART.FLAP_RO].filter((id) => used.has(id));
    if (!f.helicopter && f.palette !== 'ga') assert.ok(flaps.length >= 2, `${f.id} flaps`);
    if (f.prop || f.helicopter) assert.ok([...used].some((id) => A[id * 4 + 3] === DRIVER.SPIN), `${f.id} props/rotor`);
    // Both navigation lenses are part of the airframe (lights ride on them).
    const zones = new Set();
    for (let i = 0; i < part.length; i += 4) zones.add(part[i]);
    assert.ok(zones.has(ZONE.LENS_R) && zones.has(ZONE.LENS_G), `${f.id} lenses`);
  }
});

check('variant masks and fuselage plugs are well formed', () => {
  for (const f of LIVE_AIRCRAFT) {
    for (const lod of ['hero', 'mid', 'far']) {
      const part = get(f, lod).hull.attributes.aFleetPart.array;
      for (let i = 0; i < part.length; i += 4) {
        assert.equal(part[i + 2] & ~VARIANT_BITS, 0, `${f.id} ${lod} mask`);
        assert.ok(part[i + 3] === -1 || part[i + 3] === 0 || part[i + 3] === 1, `${f.id} ${lod} plug section`);
      }
    }
    // The family's own default option draws a complete aircraft: the
    // wingtip and engine it selects exist in the geometry (a 'none' tip is
    // the plain structural tip), and so does one of any tail options.
    const base = f.variants.base ?? 0, part = get(f, 'hero').hull.attributes.aFleetPart.array;
    let present = 0;
    for (let i = 0; i < part.length; i += 4) present |= part[i + 2];
    const tip = tipFor(f, base), eng = engineStyle(f, base), V = T.VARIANT;
    if (tip.type !== 'none' && tip.bit) assert.ok(present & tip.bit, `${f.id} default wingtip has no geometry`);
    if (eng?.bit) assert.ok(present & eng.bit, `${f.id} default engine has no geometry`);
    if (present & (V.TAIL_A | V.TAIL_B)) assert.ok(base & present & (V.TAIL_A | V.TAIL_B), `${f.id} default tail has no geometry`);
  }
});

check('the airframe stands on its wheels: only gear reaches below the wheel line, nacelles and tips clear the ground', () => {
  for (const f of LIVE_AIRCRAFT) {
    const m = get(f, 'hero'), lay = airframeLayout(f);
    const p = m.hull.attributes.position.array, part = m.hull.attributes.aFleetPart.array;
    let lowest = Infinity, lowestZone = -1;
    for (let v = 0; v < p.length / 3; v++) {
      const zone = part[v * 4], pid = part[v * 4 + 1];
      if (GEAR_PARTS.includes(pid) || zone === ZONE.GEAR || zone === ZONE.TIRE || zone === ZONE.HUB) continue;
      if (pid === PART.SPOIL_L || pid === PART.SPOIL_R) continue;
      if (part[v * 4 + 2] && !(part[v * 4 + 2] & (f.variants.base ?? 0))) continue;
      // Wheel pants and gear doors belong to the leg they fair.
      if (lay.legs.some((leg) => Math.hypot(p[v * 3] - leg.x, p[v * 3 + 2] - leg.z) < leg.wheelD * 1.7)) continue;
      if (p[v * 3 + 1] < lowest) { lowest = p[v * 3 + 1]; lowestZone = zone; }
    }
    assert.ok(lowest >= lay.groundY + 0.12, `${f.id}: zone ${lowestZone} reaches ${(lowest - lay.groundY).toFixed(2)} m above the wheel line`);
    assert.ok(m.groundOffset > 0, f.id);
  }
});

check('phase configuration: PHASE values are stable and every phase drives a plausible configuration', () => {
  assert.deepEqual(Object.values(PHASE), ['parked', 'taxi', 'runway', 'final', 'climb-out', 'approach', 'departure', 'climb', 'descent', 'cruise', 'level']);
  const track = (ry, vE, vUp, flags = 0) => ({ ry, flags, fix1: { vE, vN: 0, vUp } });
  const cfg = (t, memory = {}, now = 1000) => phaseConfig(t, trackPhase(t, 0), 0, memory, now);
  let c = cfg(track(300, 75, -3.5));
  assert.equal(trackPhase(track(300, 75, -3.5), 0), PHASE.FINAL);
  assert.ok(c.gear === 1 && c.flaps === 1 && c.landing && c.strobe);
  c = cfg(track(11000, 240, 0));
  assert.equal(trackPhase(track(11000, 240, 0), 0), PHASE.CRUISE);
  assert.ok(c.gear === 0 && c.flaps === 0 && !c.landing && c.strobe);
  c = cfg(track(2, 60, 0, 1), { landedAt: 990 });
  assert.equal(trackPhase(track(2, 60, 0, 1), 0), PHASE.RUNWAY);
  assert.ok(c.gear === 1 && c.flaps === 1 && c.spoiler === 1, 'landing roll: landing flap and lift dumpers');
  c = cfg(track(2, 60, 0, 1), {});
  assert.ok(c.flaps > 0.2 && c.spoiler === 0, 'takeoff roll: takeoff flap');
  c = cfg(track(2, 8, 0, 1), { landedAt: 900 });
  assert.ok(c.gear === 1 && c.flaps === 0 && c.taxi, 'taxi-in clean');
  c = cfg(track(2, 0, 0, 1), { landedAt: -1e9 });
  assert.ok(c.gear === 1 && !c.beacon && !c.strobe, 'parked: dark');
  c = cfg(track(600, 75, 0));
  assert.ok(c.flaps > 0.3, 'a slow level segment low down is configured for the approach');
  for (const vUp of [-12, -3, 0, 3, 12]) for (const ry of [5, 200, 900, 2500, 6000, 12000]) for (const v of [0, 40, 80, 140, 250]) {
    const o = cfg(track(ry, v, vUp));
    for (const k of ['gear', 'flaps', 'spoiler']) assert.ok(o[k] >= 0 && o[k] <= 1);
    assert.ok(Number.isFinite(o.pitch) && Math.abs(o.pitch) < 0.3);
  }
});

check('contrail persistence stays within two to five minutes and is stable per flight-level band and hour', () => {
  const [lo, hi] = SKY_VIEW.lifeSec;
  assert.ok(lo >= 120 && hi <= 300);
  const seen = new Set();
  for (let alt = 7000; alt < 13000; alt += 150) for (const hour of [0, 1, 2]) {
    const life = trailPersistence(alt, hour);
    assert.ok(life >= lo && life <= hi);
    assert.equal(life, trailPersistence(alt, hour));
    seen.add(life);
  }
  assert.ok(seen.size > 5, 'bands differ');
  assert.ok(SKY_VIEW.points * SKY_VIEW.pointSec >= hi, 'the ring holds the longest trail');
});

check('a busy, diverse sky stays inside 30 draws and 900k triangles, binoculars included', () => {
  const renderer = new DetailedTraffic();
  while (!renderer.prepare()) { /* build the up-front meshes */ }
  const camera = new PerspectiveCamera(58, 16 / 9, 1, 500000);
  camera.updateProjectionMatrix();
  const items = [];
  let n = 0;
  for (const f of LIVE_AIRCRAFT) {
    for (let k = 0; k < 8; k++, n++) {
      const d = [250, 600, 1500, 3000, 6000, 12000, 25000, 50000][k];
      const a = n * 2.399;
      items.push({ hex: `f${n.toString(16).padStart(5, '0')}`, meta: { t: f.codes[0], flight: `TST${n}`, r: `N${n}FS` }, archetype: 0, opacity: 1,
        distM: d, flags: k < 3 ? 1 : 0, rx: Math.cos(a) * d, rz: Math.sin(a) * d, ryd: k < 3 ? 4 : 300 + d * 0.2, scaleK: 1, yaw: a, bank: 0,
        fix1: { vE: 70, vN: 10, vUp: k < 3 ? 0 : -3, latRad: 0.7 } });
    }
  }
  const flight = { pos: { x: 0, y: 30, z: 0 } }, origin = { anchor: { x: 0, z: 0 } };
  const ctx = (fov, selected) => {
    camera.fov = fov;
    camera.updateProjectionMatrix();
    return { camera, heightPx: 1080, observing: true, selectedSet: new Set(selected ? [selected] : []), modelRangeM: 60000, airportY: 4, dt: 1 / 60, now: 10 };
  };
  for (const [fov, sel] of [[58, null], [58, items[5].hex], [58 / 20, items[40].hex], [58 / 8, null]]) {
    for (let pass = 0; pass < 3; pass++) {
      renderer.update(items, flight, origin, 'high', null, true, pass, ctx(fov, sel));
      while (renderer.queue.length) renderer.prepare(); // heroes requested this frame
    }
    renderer.update(items, flight, origin, 'high', null, true, 4, ctx(fov, sel));
    const st = renderer.stats;
    console.log(`     fov ${fov.toFixed(1)}: ${st.draws} draws, ${Math.round(st.triangles / 1000)}k triangles, hero ${st.near} / mid ${st.mid} / far ${st.far}`);
    assert.ok(st.draws <= 30, `fov ${fov}: ${st.draws} draws`);
    assert.ok(st.triangles <= 900000, `fov ${fov}: ${st.triangles} triangles`);
    assert.equal(st.displayed, items.length, 'every contact in range is drawn (detail is what the budget trades)');
    assert.ok(st.near <= 8);
    if (sel) assert.equal(items.find((i) => i.hex === sel).fleet.lod, 'hero', 'the selection is a hero');
  }
  renderer.dispose();
});

for (const m of built.values()) m.hull.dispose();
console.log(`FLEET AIRFRAMES: ${checks}/${checks}`);

// Lounge seat choice (lib/fly/lounge-seat.js) and the seat order in
// lib/fly/lounge-site.js, on a synthetic airfield (no network, deterministic).
//
//   node scripts/verify-lounge-seat.mjs
//
// The field: one 3 km runway 09/27 at 40 N. North of it, behind a parallel
// taxiway, a real apron with thirteen gates and a terminal building behind
// them; south of it a taxiway and grass. A good seat stands its pier on the
// terminal and its stands on the apron, north; never on the runway or a
// taxiway. An airfield blanketed in taxiways has no acceptable seat (the
// generic one stands). The generated hub table is checked for shape.
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

const registry = await import('../lib/fly/operations-airports.js');
const { chooseLoungeSeat, airfieldRaster, genericFloor } = await import('../lib/fly/lounge-seat.js');
const { resolveLoungeSite, storedSeat } = await import('../lib/fly/lounge-site.js');
const { LOUNGE_SEATS } = await import('../lib/fly/lounge-seats.js');
const { LOUNGE_SITE, SEAT } = await import('../lib/fly/observation-config.js');

let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log(`PASS ${name}`);
}

const runway = registry.registerAirport({
  id: 'ZZSE:09-27', name: 'Seat test field', width: 45,
  a: { lat: 40, lon: -80, elevation: 200 }, b: { lat: 40, lon: -79.96487, elevation: 200 },
});
const L = registry.airportFrame(runway).length;
const P = (along, cross) => registry.airportPoint(runway, along, cross);
const ring = (pts) => pts.flatMap(([a, c]) => { const p = P(a, c); return [p.x, p.z]; });
const line = (a0, a1, c) => ({ id: `t${a0}-${c}`, ref: '', pts: ring([[a0, c], [a1, c]]) });
const corners = (a0, a1, c0, c1) => [[a0, c0], [a1, c0], [a1, c1], [a0, c1], [a0, c0]];

// +cross is south of an eastbound runway (right of 09); north is negative.
const k = registry.airportFrame(runway).k;
const p0 = P(-2600, -2600), p1 = P(L + 2600, 2600);
const bounds = { minX: Math.min(p0.x, p1.x), minZ: Math.min(p0.z, p1.z), maxX: Math.max(p0.x, p1.x), maxZ: Math.max(p0.z, p1.z) };
const gates = [];
for (let a = 900; a <= 2100; a += 100) { const g = P(a, -690); gates.push({ id: `g${a}`, ref: String(a), x: g.x, z: g.z }); }
const field = {
  ident: 'ZZSE', k, bounds,
  runwayLines: [], gates, labels: [], roads: [], cover: [], aerodromes: [],
  taxiwayLines: [line(0, L, -190), line(0, L, 190), line(650, 650, -190)],
  pavements: [{ id: 1, cls: 'apron', ref: '', rings: [ring(corners(700, 2300, -320, -720))] }],
  buildings: [{ id: 2, height: 22, minHeight: 0, colour: '', hide3d: false, pieces: [[ring(corners(650, 2350, -735, -830))]], area: 1, cx: 0, cz: 0 }],
};

check('the seat stands at the terminal: north, stands on the apron, pier on the terminal, gates in reach', () => {
  const seat = chooseLoungeSeat([runway], field);
  assert.ok(seat, 'a seat is chosen');
  assert.equal(seat.runwayId, runway.id);
  assert.ok(seat.cross < 0, `north of the runway (cross ${seat.cross})`);
  const f = seat.detail.footprint;
  assert.equal(f.stands.runway + f.pier.runway + f.apron.runway, 0, 'nothing on the runway');
  assert.equal(f.stands.taxiway, 0, 'no taxiway under the stands');
  assert.ok(f.stands.apron / f.stands.n >= 0.9, `stands on the apron (${f.stands.apron}/${f.stands.n})`);
  assert.ok(f.gates >= 6, `real gates at the stands (${f.gates})`);
  assert.ok(seat.along >= 900 && seat.along <= 2100, `along the apron (${seat.along})`);
  assert.equal(seat.floorM, genericFloor(runway));
  // The field discriminates: the generic rule (one runway: the right side)
  // would put this lounge south, on grass behind a taxiway.
  assert.ok(resolveLoungeSite(runway).cross > 0, 'the generic seat is south');
});

check('the choice is deterministic', () => {
  const a = chooseLoungeSeat([runway], field), b = chooseLoungeSeat([runway], field);
  assert.deepEqual({ ...a, detail: null }, { ...b, detail: null });
});

check('every candidate on a taxiway or runway is refused: a field blanketed in taxiways has no seat', () => {
  const lines = [];
  for (let c = -2400; c <= 2400; c += 60) lines.push(line(-2400, L + 2400, c));
  assert.equal(chooseLoungeSeat([runway], { ...field, taxiwayLines: lines, pavements: [], gates: [] }), null);
});

check('the raster rejects an airfield too large to score (the generic seat stands)', () => {
  const huge = { ...field, bounds: { ...bounds, maxX: bounds.minX + 1e6, maxZ: bounds.minZ + 1e6 } };
  assert.equal(airfieldRaster(huge, [runway]), null);
  assert.equal(chooseLoungeSeat([runway], huge), null);
});

check('seat order: flagship, hub table, chosen, generic', () => {
  const seat = chooseLoungeSeat([runway], field);
  const chosen = resolveLoungeSite(runway, { seat });
  assert.equal(chosen.source, 'chosen');
  assert.equal(chosen.along, seat.along);
  assert.equal(chosen.cross, seat.cross);
  assert.equal(chosen.floorM, seat.floorM);
  const generic = resolveLoungeSite(runway);
  assert.equal(generic.source, 'generic');
  // A seat for another airport is ignored.
  assert.equal(resolveLoungeSite(runway, { seat: { ...seat, ident: 'ZZXX' } }).source, 'generic');
  // A flagship ignores a passed seat (stub lookup: the authored runway is the flagship's own).
  // That is the classic room's order; the pier room (the default since LOUNGE_PIER went on,
  // 2026-10-18) takes its scored pier-table row first and ignores a passed seat just the same.
  const kcmh = registry.airportById('KCMH');
  if (kcmh) {
    assert.equal(resolveLoungeSite(kcmh, { seat: { ...seat, ident: 'KCMH' }, variant: 'classic' }).source, 'flagship');
    assert.equal(resolveLoungeSite(kcmh, { seat: { ...seat, ident: 'KCMH' }, variant: 'pier' }).source, 'table');
  }
  assert.equal(storedSeat(runway), null);
});

check('the hub table is well formed and never shadows a flagship', () => {
  for (const [ident, s] of Object.entries(LOUNGE_SEATS)) {
    assert.ok(!LOUNGE_SITE.flagship[ident], `${ident} is a flagship`);
    assert.ok(s.runway.startsWith(`${ident}:`), `${ident} runway ${s.runway}`);
    assert.ok(Number.isFinite(s.along) && s.along >= 0, `${ident} along`);
    assert.ok(Number.isFinite(s.cross) && Math.abs(s.cross) >= 60, `${ident} cross`);
    assert.ok([SEAT.midFloorM, ...LOUNGE_SITE.generic.map((c) => c.floorM)].includes(s.floorM), `${ident} floor ${s.floorM}`);
  }
});

console.log(`LOUNGE SEAT: ${checks}/${checks} (${Object.keys(LOUNGE_SEATS).length} hub seats in the table)`);

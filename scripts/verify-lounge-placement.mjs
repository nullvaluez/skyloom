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
const { assessPierRoomFootprint, rearSetEligible } = await import('../lib/fly/lounge-seat.js');
const { airportLayout } = await import('../lib/fly/airport-layout.js');
const { planAirportSet, sampleRoute } = await import('../lib/fly/airport-set/plan.js');
const { LOUNGE_SEATS_PIER } = await import('../lib/fly/lounge-seats-pier.js');
const { airportPoint, airportFrame, registerAirport } = await import('../lib/fly/operations-airports.js');
let count = 0;
const check = (name, fn) => { fn(); count++; console.log('PASS ' + name); };
const ring = (x0, x1, z0, z1) => [x0, z0, x1, z0, x1, z1, x0, z1];
const frame = { x: 0, z: 0, k: 1, heading: 0 };
const field = { aerodromes: [{ rings: [ring(-100, 100, -100, 100)] }], roads: [] };
check('room envelope and margin need complete aerodrome evidence', () => {
  assert.equal(assessPierRoomFootprint(field, frame).safe, true);
  assert.equal(assessPierRoomFootprint({ ...field, aerodromes: [] }, frame).safe, false);
  const coastal = { ...field, aerodromes: [{ rings: [ring(-100, 100, -100, 3)] }] };
  assert.equal(assessPierRoomFootprint(coastal, frame).reason, 'outside-aerodrome');
  const hole = { ...field, aerodromes: [{ rings: [ring(-100, 100, -100, 100), ring(-3, 3, 5, 11)] }] };
  assert.equal(assessPierRoomFootprint(hole, frame).safe, false);
});
check('roads crossing between footprint samples still reject placement', () => {
  const road = { cls: 'service', pts: [-90, 1.1, 90, 1.1] };
  assert.equal(assessPierRoomFootprint({ ...field, roads: [road] }, frame).reason, 'room-road-clearance');
  assert.equal(assessPierRoomFootprint({ ...field, roads: [{ ...road, pts: [-90, 21, 90, 21] }] }, frame).safe, false);
  assert.equal(assessPierRoomFootprint({ ...field, roads: [{ ...road, pts: [-90, 30, 90, 30] }] }, frame).safe, true);
  assert.equal(assessPierRoomFootprint({ ...field, roads: [{ ...road, brunnel: 'tunnel' }] }, frame).safe, true);
});
check('room samples cannot occupy flight pavement even inside airport bounds', () => {
  const raster = { minX: -100, minZ: -100, cell: 10, W: 20, H: 20, cls: new Uint8Array(400).fill(2) };
  assert.equal(assessPierRoomFootprint(field, frame, raster).reason, 'room-on-flight-pavement');
});
const zone = { n: 100, out: 0, runway: 0, taxiway: 0, building: 0, apron: 100 };
check('rear scenery needs positive apron evidence and clear stand footprints', () => {
  assert.equal(rearSetEligible({ backStands: zone, backApron: zone }), true);
  for (const bad of [{ apron: 0 }, { apron: 94 }, { runway: 1 }, { building: 1 }, { taxiway: 1 }, { out: 1 }]) {
    assert.equal(rearSetEligible({ backStands: { ...zone, ...bad }, backApron: zone }), false);
  }
  assert.equal(rearSetEligible({ backStands: zone, backApron: { ...zone, apron: 0 } }), false);
  assert.equal(rearSetEligible({}), false);
});
check('unknown or ineligible rear set creates no rear stands, bridges, vehicles or footprint', () => {
  const site = { ...frame, airportId: 'TEST', ident: 'TEST', variant: 'pier', floorM: 24, groundY: 0 };
  for (const rearSet of [undefined, false, true]) {
    const layout = airportLayout({ ...site, rearSet }), plan = planAirportSet({ ...site, rearSet }, layout);
    assert.ok(layout.terminal.z1 < 15, 'pier room terminal shape remains');
    assert.equal(layout.aprons.length, rearSet ? 2 : 1);
    assert.equal(layout.stands.some(s => s.side === 'back'), rearSet === true);
    assert.equal(plan.geometrySides?.some(s => s.rot180) ?? false, rearSet === true);
    assert.equal(plan.footprint.some(r => r.kind === 'apron' && r.z0 > layout.terminal.z1 - 1), rearSet === true);
    if (!rearSet) {
      for (const stand of plan.stands) {
        assert.ok(stand.z < layout.terminal.z0);
        for (const bridge of stand.bridges) {
          assert.ok(bridge.docked.cab.z < layout.terminal.z0);
          assert.ok(bridge.retracted.cab.z < layout.terminal.z0);
        }
        assert.ok(stand.servicing.every(vehicle => vehicle.z < layout.terminal.z0));
      }
      assert.ok(plan.staging.every(vehicle => vehicle.z < layout.terminal.z0));
      for (const mover of plan.movers) {
        const route = plan.loops[mover.loop];
        assert.ok(route, 'no rear loop reference');
        for (let i = 0; i <= 100; i++) assert.ok(sampleRoute(route, route.length * i / 100).z < layout.terminal.z0);
      }
    }
  }
  const classic = { ...site, variant: 'classic' };
  assert.deepEqual(airportLayout(classic), airportLayout({ ...classic, rearSet: true }));
});
check('cached YSSY evidence rejects the coastal room and accepts the contained replacement', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/lounge-placement-yssy.json', import.meta.url)));
  const at = s => {
    const runway = registerAirport(s.runway);
    const p = airportPoint(runway, s.along, s.cross), a = airportPoint(runway, s.along, 0);
    return { x: p.x, z: p.z, k: airportFrame(runway).k, heading: Math.atan2(-(a.x - p.x), -(a.z - p.z)) };
  };
  const oldFrame = at(fixture.previous), newFrame = at(fixture.current);
  assert.equal(assessPierRoomFootprint(fixture.features, oldFrame).reason, 'outside-aerodrome');
  assert.equal(assessPierRoomFootprint(fixture.features, newFrame).safe, true);
  const oldRoads = { ...fixture.features, aerodromes: [{ rings: [ring(oldFrame.x - 500, oldFrame.x + 500, oldFrame.z - 500, oldFrame.z + 500)] }] };
  assert.equal(assessPierRoomFootprint(oldRoads, oldFrame).reason, 'room-road-clearance');
  assert.equal(fixture.current.runway.id, LOUNGE_SEATS_PIER.YSSY.runway);
  assert.equal(fixture.current.along, LOUNGE_SEATS_PIER.YSSY.along);
  assert.equal(fixture.current.cross, LOUNGE_SEATS_PIER.YSSY.cross);
  assert.equal(LOUNGE_SEATS_PIER.YSSY.rearSet, false);
});
check('generated table and complete 115-airport audit agree on safety and rear eligibility', () => {
  const audit = JSON.parse(fs.readFileSync(new URL('./lounge-pier-audit.json', import.meta.url)));
  assert.equal(audit.safetyRevision, 2);
  assert.equal(audit.airports, 115);
  assert.equal(audit.rows.length, 115);
  assert.equal(new Set(audit.rows.map(r => r.ident)).size, 115);
  const selected = audit.rows.filter(r => r.selected);
  assert.equal(selected.length, Object.keys(LOUNGE_SEATS_PIER).length);
  assert.equal(audit.selected, selected.length);
  assert.equal(audit.fallback, audit.rows.length - selected.length);
  for (const r of selected) {
    const table = LOUNGE_SEATS_PIER[r.ident];
    assert.ok(table, r.ident);
    assert.equal(r.seat.detail.roomSafety.safe, true, r.ident);
    assert.equal(table.rearSet, r.seat.rearSet);
    assert.equal(table.rearSet, rearSetEligible(r.seat.detail.footprint));
    assert.equal(table.along, r.seat.along);
    assert.equal(table.cross, r.seat.cross);
  }
});
console.log(`PASS lounge placement: ${count} checks`);

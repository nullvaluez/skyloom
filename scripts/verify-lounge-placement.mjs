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
const { assessPierRoomFootprint, assessPierRearOpening, airfieldRaster, rearSetEligible } = await import('../lib/fly/lounge-seat.js');
const { assessPierRearSet } = await import('../lib/fly/lounge-rear-safety.js');
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
check('final rear gate covers narrow edge obstacles and preserves unoccupied service-road crossings', () => {
  const site = { ...frame, airportId: 'REAR-GATE', ident: 'REAR-GATE', variant: 'pier', rearSet: true, floorM: 16, groundY: 0 };
  const layout = airportLayout(site), apron = layout.aprons[1];
  const clean = { occluderRevision: 1, occluders: [], aerodromes: [{rings:[ring(-500,500,-500,500)]}], pavements:[{cls:'apron',rings:[ring(-250,250,-50,200)]}], roads:[] };
  assert.equal(assessPierRearSet({...clean,occluders:undefined},site,layout).safe,false,'missing occluder data cannot certify a rear set');
  const valid = assessPierRearSet(clean,site,layout);
  assert.equal(valid.safe,true); assert.ok(valid.samples>50000); assert.equal(valid.sampleM,1);
  assert.equal(assessPierRearSet({...clean,occluders:[{id:17,top:12,rings:[ring(apron.x1-.1,apron.x1+.1,100.2,100.4)]}]},site,layout).reason,'rear-apron-building');
  for(const key of ['aerodromes','pavements']) {
    const source = clean[key].map(p=>({...p,rings:[...p.rings,ring(10.2,10.4,50.2,50.4)]}));
    assert.equal(assessPierRearSet({...clean,[key]:source},site,layout).safe,false,key+' sub-grid hole caught at source edges');
  }
  assert.equal(assessPierRearSet({...clean,pavements:[...clean.pavements,{cls:'taxiway',id:18,rings:[ring(209.9,210.1,100.2,100.4)]}]},site,layout).reason,'rear-apron-flight-pavement');
  assert.equal(assessPierRearSet({...clean,taxiwayLines:[{id:19,pts:[-400,140,400,140]}]},site,layout).reason,'rear-apron-flight-centreline');
  const stand=layout.stands.find(s=>s.side==='back');
  assert.equal(assessPierRearSet({...clean,roads:[{id:20,cls:'service',pts:[stand.x,-500,stand.x,500]}]},site,layout).reason,'rear-structure-road-clearance','long crossing segment is checked even when endpoints lie outside the apron');
  assert.equal(assessPierRearSet({...clean,roads:[{id:21,cls:'service',pts:[-500,110,500,110]}]},site,layout).safe,true,'a road crossing unoccupied apron is not an invented structure collision');
});
check('cached KLAX and CYYZ edge failures disable rear scenery without relocating either room', () => {
  const saved=JSON.parse(fs.readFileSync(new URL('./fixtures/lounge-rear-safety.json',import.meta.url)));
  assert.deepEqual(saved.fixtures.map(f=>f.ident),['KLAX','CYYZ']);
  for(const f of saved.fixtures) {
    assert.equal(rearSetEligible(f.coarse),true,'old coarse evidence alone looked eligible');
    const result=assessPierRearSet(f.features,f.site,airportLayout(f.site));
    assert.equal(result.safe,false); assert.equal(result.reason,'rear-apron-building'); assert.equal(result.featureId,f.expected.featureId);
    const row=LOUNGE_SEATS_PIER[f.ident]; assert.equal(row.rearSet,false); assert.equal(row.runway,f.originalSite.runwayId); assert.equal(row.along,f.originalSite.along); assert.equal(row.cross,f.originalSite.cross); assert.equal(row.floorM,f.site.floorM);
  }
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
check('cached YSSY evidence rejects coastal and obstructed rooms and accepts the contained open replacement', () => {
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
  const raster = airfieldRaster(fixture.features, fixture.runways.map(registerAirport), 8, { occluders: true });
  const failed = assessPierRearOpening(raster, newFrame, fixture.current.floorM);
  assert.equal(failed.safe, false, 'contained room is still unusable behind rendered buildings');
  assert.ok(failed.samples.every(s => s.clearDeg === 0), 'both floor apertures are obstructed');
  const clipped = assessPierRearOpening(raster, at(fixture.rejectedApertureCandidate), fixture.rejectedApertureCandidate.floorM);
  assert.equal(clipped.safe, false, 'candidate that sees open sky only beyond the physical route aperture is rejected');
  assert.ok(clipped.samples[3].clearDeg < 40);
  const accepted = fixture.occlusionReplacement;
  assert.equal(assessPierRoomFootprint(fixture.features, at(accepted), raster).safe, true);
  const opening = assessPierRearOpening(raster, at(accepted), accepted.floorM);
  assert.equal(opening.safe, true); assert.ok(opening.samples.every(s => s.clearDeg >= 40));
  assert.equal(accepted.runway.id, LOUNGE_SEATS_PIER.YSSY.runway);
  assert.equal(accepted.along, LOUNGE_SEATS_PIER.YSSY.along);
  assert.equal(accepted.cross, LOUNGE_SEATS_PIER.YSSY.cross);
  assert.equal(LOUNGE_SEATS_PIER.YSSY.rearSet, false);
});
check('generated table and complete 115-airport audit agree on safety and rear eligibility', () => {
  const audit = JSON.parse(fs.readFileSync(new URL('./lounge-pier-audit.json', import.meta.url)));
  assert.equal(audit.safetyRevision, 3);
  assert.equal(audit.occlusionRevision, 1);
  assert.equal(audit.rearSetSafetyRevision, 1);
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
    assert.equal(r.seat.detail.back.opening.safe, true, r.ident);
    assert.equal(r.seat.detail.back.opening.samples.length, 7);
    assert.ok(r.seat.detail.back.opening.samples.every(s => s.clearDeg >= 40), r.ident);
    assert.equal(table.rearSet, r.seat.rearSet);
    assert.equal(table.rearSet, rearSetEligible(r.seat.detail.footprint) && r.seat.detail.rearSafety?.safe === true);
    if(rearSetEligible(r.seat.detail.footprint)) assert.equal(r.seat.detail.rearSafety.revision,1);
    assert.equal(table.along, r.seat.along);
    assert.equal(table.cross, r.seat.cross);
  }
});
console.log(`PASS lounge placement: ${count} checks`);

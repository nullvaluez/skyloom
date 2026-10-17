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


const { createAirportLounge } = await import('../lib/fly/airport-lounge.js');
const { roomVariant } = await import('../lib/fly/lounge/room-plan.js');
const W = await import('../lib/fly/lounge/room-walk.mjs');
const { airportLayout, STAND_CLASS } = await import('../lib/fly/airport-layout.js');
const { planAirportSet, sampleRoute } = await import('../lib/fly/airport-set/plan.js');
const { buildSetGeometry, setGeometryStats, createAirportSet } = await import('../lib/fly/airport-set/index.js');
const { planAtlas, atlasEntries } = await import('../lib/fly/airport-set/atlas.js');
const { planParkedFleet, parkedMatrix, ParkedFleetSet } = await import('../lib/fly/fleet-parked.js');
const { FLEET_FAMILIES } = await import('../lib/fly/fleet-types.js');
const { airframeLayout, boardingDoor } = await import('../lib/fly/fleet-layout.js');
const { ShaderLib, Vector3, Group, PerspectiveCamera } = await import('three');
const { updateRoomShading } = await import('../lib/fly/lounge/room-shading.js');
const { geometrySignature, decodeBake } = await import('../lib/fly/lounge/room-ao.js');
const room = createAirportLounge({ variant: 'pier', document: null });
const space = W.buildWalkSpace(room.room.blockers, { variant: 'pier' }), seats = roomVariant('pier').vantage;
check('all six physical chairs and every accessible floor component connect through the staircase', () => {
  for (const seat of seats) {
    assert.ok(room.room.blockers.some((b) => b.seatId === seat.id), `physical ${seat.id}`);
    const target = { x: seat.approach[0], z: seat.approach[1], floorId: seat.floorId ?? 'lower' };
    const grid = space.layers[target.floorId];
    assert.ok(W.isFree(grid, target.x, target.z), `free approach ${seat.id}`);
    assert.ok(W.findPath(space, { x: 0, z: 3, floorId: 'lower' }, target), `reachable ${seat.id}`);
  }
  // The 10 cm navigation grid is conservative (body radius + half diagonal).
  // Verify every component, including cells separated only by that raster
  // margin: each must join the aisle through exact 1 cm collision-safe steps.
  for (const [floorId, grid] of Object.entries(space.layers)) {
  const visited = new Set(), total = grid.cells.reduce((a, b) => a + b, 0);
  const flood = (start, seen) => {
    const component = [], stack = [start]; seen.add(start);
    while (stack.length) {
      const k = stack.pop(), i = k % grid.nx, j = Math.floor(k / grid.nx);
      component.push(k);
      for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const x=i+di,z=j+dj,n=z*grid.nx+x;
        if (x>=0&&x<grid.nx&&z>=0&&z<grid.nz&&grid.cells[n]&&!seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    return component;
  };
  const centre = (k) => ({ x: grid.x0 + (k % grid.nx + .5) * grid.cellM, z: grid.z0 + (Math.floor(k / grid.nx) + .5) * grid.cellM });
  const anchor = { lower: { x: 0, z: 3 }, stairs: space.links[0], upper: { x: -7.5, z: 11.9 } }[floorId];
  const aisle = Math.floor((anchor.z-grid.z0)/grid.cellM)*grid.nx+Math.floor((anchor.x-grid.x0)/grid.cellM);
  assert.ok(grid.cells[aisle], 'central aisle has a safe grid cell');
  flood(aisle, visited);
  const coarseCount = visited.size, escapes = [];
  for (let first=0;first<grid.cells.length;first++) {
    if (!grid.cells[first] || visited.has(first)) continue;
    const component = flood(first, new Set()), start = centre(first), step = .01;
    const queue = [{ i:0,j:0,parent:-1 }], seen = new Set(['0,0']);
    let end = -1;
    for (let q=0;q<queue.length&&q<100000;q++) {
      const item=queue[q], p={x:start.x+item.i*step,z:start.z+item.j*step};
      const ci=Math.floor((p.x-grid.x0)/grid.cellM), cj=Math.floor((p.z-grid.z0)/grid.cellM);
      if (visited.has(cj*grid.nx+ci)) { end=q; break; }
      for (const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const i=item.i+di,j=item.j+dj,key=`${i},${j}`;
        if (seen.has(key)||Math.abs(i)>150||Math.abs(j)>150) continue;
        const target={x:start.x+i*step,z:start.z+j*step};
        if (!W.isFree(grid,target.x,target.z)) continue;
        const moved=W.moveWithCollision(grid,p,di*step,dj*step);
        if (Math.hypot(moved.x-target.x,moved.z-target.z)>1e-8) continue;
        seen.add(key); queue.push({i,j,parent:q});
      }
    }
    assert.ok(end>=0, `disconnected floor component ${component.length} cells at ${start.x},${start.z} has no exact walking escape`);
    let minClearance=Infinity, steps=0;
    for(let q=end;q>=0;q=queue[q].parent) {
      const p=queue[q]; minClearance=Math.min(minClearance,W.clearance(grid.blockers,start.x+p.i*step,start.z+p.j*step)); steps++;
    }
    escapes.push({cells:component.length,from:start,steps:steps-1,minClearance:+minClearance.toFixed(6)});
    for(const cell of component) visited.add(cell);
  }
  assert.equal(visited.size,total,'every accessible grid component connects to the central aisle');
  console.log(`  ${floorId} circulation: ${total} cells connected (${coarseCount} coarse + collision-verified escapes ${JSON.stringify(escapes)})`);
  }
});
check('pier furniture and rear fins have collision footprints at body height', () => {
  for (const [name, geometry] of Object.entries(room.room.buckets)) {
    const p = geometry.attributes.position;
    for (let i=0;i<p.count;i++) {
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
      if(y>.03&&y<2&&W.onFloorPlate(x,z)) assert.ok(W.clearance(room.room.blockers,x,z)<.006, `${name} ${x},${y},${z} missing collision`);
    }
  }
});
check('rear aperture is open in geometry and shaders; its AO cannot be confused with classic', () => {
  assert.equal(room.glass.mesh.geometry.attributes.position.count, 48);
  const baked = fs.readFileSync(new URL('../public/models/lounge-ao-pier-v1.bin', import.meta.url));
  assert.equal(decodeBake(baked.buffer.slice(baked.byteOffset,baked.byteOffset+baked.byteLength)).signature, geometrySignature(room.room.buckets));
  for (const material of room.litMaterials()) {
    const shader = { ...ShaderLib.physical, uniforms: {} };
    material.onBeforeCompile(shader, {});
    assert.ok(shader.fragmentShader.includes('#define LG_BACK_GLAZED'));
    assert.ok(material.customProgramCacheKey().endsWith('-pier-upper-v1'));
  }
});
check('Night Watch dims decoration coherently while retaining circulation lighting and exterior state', () => {
  const group = new Group(), camera = new PerspectiveCamera(); camera.updateMatrixWorld();
  const state = { group, camera, sun: { sinEl: -.3 }, keyScene: new Vector3(0,1,0) };
  updateRoomShading(room.uniforms, state);
  const bright = [...room.uniforms.uLoungeGlow.value], bounce = room.uniforms.uLoungeBounce.value.length();
  const sun = JSON.stringify(state.sun);
  updateRoomShading(room.uniforms, { ...state, nightWatch: 1 });
  const dim = room.uniforms.uLoungeGlow.value;
  assert.equal(dim[0], bright[0]); assert.ok(dim[4] < bright[4]*.2);
  assert.ok(dim[5] >= bright[5]*.6); assert.ok(dim[6] >= bright[6]*.4);
  assert.ok(room.uniforms.uLoungeBounce.value.length() < bounce);
  assert.equal(JSON.stringify(state.sun), sun);
});
const openField = { ...field, aerodromes: [{ rings: [ring(corners(-2500, L+2500, -2500, 2500))] }], buildings: [], taxiwayLines: [], pavements: [{ cls: 'apron', rings: [ring(corners(300, 2700, -250, -1100))] }] };
let chosen;
check('pier site scoring checks both apron footprints and four rear seated/standing sightlines', () => {
  chosen = chooseLoungeSeat([runway], openField, { variant: 'pier' });
  assert.ok(chosen, 'a safe open apron admits a pier');
  assert.equal(chosen.variant, 'pier');
  assert.equal(chosen.detail.back.samples, 4);
  assert.equal(chosen.detail.footprint.backStands.runway, 0);
  assert.equal(resolveLoungeSite(runway, { variant: 'pier', seat: chosen }).variant, 'pier');
});
check('unknown, runway-covered and obstructed pier candidates retain classic fallback', () => {
  assert.equal(resolveLoungeSite(runway, { variant: 'pier' }).variant, 'classic');
  const unsafe = { ...openField, pavements: [{ cls: 'runway', rings: [ring(corners(-2500, L+2500, -2500, 2500))] }] };
  assert.equal(chooseLoungeSeat([runway], unsafe, { variant: 'pier' }), null);
  const blocked = { ...openField, buildings: [{ height: 150, pieces: [[ring(corners(-2500, L+2500, -2500, 2500))]] }] };
  assert.equal(chooseLoungeSeat([runway], blocked, { variant: 'pier' }), null);
});
check('missing scored runway and mismatched chosen airport never produce a generic pier', () => {
  const cmh = registry.airportById('KCMH');
  assert.ok(storedSeat(cmh, { variant: 'pier' }), 'fixture has a scored pier table row');
  const missingStored = resolveLoungeSite(cmh, { variant: 'pier', lookup: () => null });
  const classic = resolveLoungeSite(cmh, { variant: 'classic', lookup: () => null });
  assert.deepEqual(missingStored, classic, 'unresolvable stored placement preserves classic fallback exactly');
  const missingChosen = resolveLoungeSite(runway, { variant: 'pier', seat: chosen, lookup: () => null });
  assert.deepEqual(missingChosen, resolveLoungeSite(runway, { variant: 'classic', lookup: () => null }));
  assert.equal(resolveLoungeSite(runway, { variant: 'pier', seat: { ...chosen, ident: 'OTHER' } }).variant, 'classic');
});
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

check('explicitly eligible rear sets retain mirrored bridges, routes and bounded geometry in all size classes', () => {
  for (const floorM of [24, 16, 10]) {
    const site = { airportId: 'REAR-FIXTURE', ident: 'REAR-FIXTURE', variant: 'pier', rearSet: true, floorM, k: 1, heading: 0, x: 0, z: 0, groundY: 0 };
    const layout = airportLayout(site), plan = planAirportSet(site, layout), half = layout.stands.length / 2;
    assert.ok(layout.pier && plan.pier && half > 0);
    for (let i = 0; i < half; i++) {
      const f = layout.stands[i], b = layout.stands[i + half];
      assert.ok(Math.abs(f.x + b.x) < 1e-8);
      assert.ok(Math.abs(f.z + b.z - 2 * layout.zc) < 1e-8);
      for (let j = 0; j < plan.stands[i].bridges.length; j++) {
        const fb = plan.stands[i].bridges[j], bb = plan.stands[i + half].bridges[j];
        assert.ok(Math.abs(fb.docked.cab.x + bb.docked.cab.x) < 1e-8);
        assert.ok(Math.abs(fb.docked.cab.z + bb.docked.cab.z - 2 * layout.zc) < 1e-8);
      }
    }
    for (let i = 0; i < 2; i++) for (const distance of [0, 11, 127]) {
      const f = sampleRoute(plan.loops[i], distance), b = sampleRoute(plan.loops[i + 2], distance);
      assert.ok(Math.abs(f.x + b.x) < 1e-7);
      assert.ok(Math.abs(f.z + b.z - 2 * layout.zc) < 1e-7);
    }
    const built = buildSetGeometry(plan, planAtlas(atlasEntries(plan)));
    assert.ok(setGeometryStats(built).total < 350000);
    const geos = [built.staticGeo, built.decals, built.pools, ...built.kits.values(), ...built.bridges.flatMap(b => [b.docked, b.retracted, b.dockedColumn.geo, b.retractedColumn.geo]), ...built.fixtures.map(f => f.geo)];
    for (const geo of geos) {
      for (const attribute of Object.values(geo.attributes)) assert.ok(attribute.array.every(Number.isFinite));
      geo.dispose();
    }
  }
});

check('review airports render only their eligible scenery sides with valid geometry and routes', () => {
  for (const ident of ['KCMH','KJFK','LOWI','EGLL','YSSY']) {
    const airport = loadAirport(ident);
    assert.ok(airport, ident);
    // Force geometry review only; production placements require the scorer above.
    const site = resolveLoungeSite(airport, { variant: 'pier' });
    assert.equal(site.variant, 'pier', ident+' has a scored table placement');
    const layout = airportLayout(site), plan = planAirportSet(site, layout);
    assert.equal(layout.aprons.length, site.rearSet ? 2 : 1);
    assert.equal(layout.stands.some((s) => s.side === 'back'), site.rearSet);
    if (!site.rearSet) assert.ok(!plan.geometrySides?.some((s) => s.rot180), ident+' no unsupported rear geometry');
    assert.ok(layout.terminal.z1 < 15);
    assert.equal(plan.stands.length, layout.stands.length);
    const built = buildSetGeometry(plan, planAtlas(atlasEntries(plan)));
    assert.ok(setGeometryStats(built).total < 350000, ident+' set budget');
    for (const g of [built.staticGeo,built.decals,built.pools,...built.bridges.map((b)=>b.docked)]) for (const a of Object.values(g.attributes)) assert.ok(a.array.every(Number.isFinite), ident+' finite');
    const half=site.rearSet ? layout.stands.length/2 : layout.stands.length;
    for (let i=0;site.rearSet && i<half;i++) {
      const f=layout.stands[i],b=layout.stands[i+half];
      assert.ok(Math.abs(f.x+b.x)<1e-8); assert.ok(Math.abs(f.z+b.z-2*layout.zc)<1e-8);
      const fb=plan.stands[i].bridges,bb=plan.stands[i+half].bridges;
      for(let j=0;j<fb.length;j++) { assert.ok(Math.abs(fb[j].docked.cab.x+bb[j].docked.cab.x)<1e-8); assert.ok(Math.abs(fb[j].docked.cab.z+bb[j].docked.cab.z-2*layout.zc)<1e-8); }
    }
    for (let i=0;site.rearSet && i<2;i++) for(const t of [0,11,127]) {
      const f=sampleRoute(plan.loops[i],t),b=sampleRoute(plan.loops[i+2],t);
      assert.ok(Math.abs(f.x+b.x)<1e-7); assert.ok(Math.abs(f.z+b.z-2*layout.zc)<1e-7);
    }
    const fleet=planParkedFleet(site,layout);
    assert.ok(fleet.some((p)=>p.lod==='mid'));
    for(const p of fleet.filter((p)=>p.stand.side==='back')) {
      assert.ok(p.z>layout.terminal.z1, ident+' aircraft behind pier');
      const forward=new Vector3(0,0,-1).transformDirection(parkedMatrix(p)); assert.ok(forward.z<-.99);
      const family=FLEET_FAMILIES[p.family], shape=airframeLayout(family), door=boardingDoor(family), cls=STAND_CLASS[p.stand.cls];
      const zm=-shape.len/2-p.spec.plugF+door.station+(shape.seg(door.station)===-1?0:p.spec.plugF);
      const at=new Vector3(-door.half,door.sill,zm).applyMatrix4(parkedMatrix(p));
      assert.ok(Math.abs(at.x-(p.stand.x-cls.door.half))<.05,ident+' rear door across');
      assert.ok(Math.abs(at.z-(p.stand.noseZ+cls.door.aft))<.05,ident+' rear door along');
    }
    const rendered=createAirportSet(plan,{k:site.k,heading:site.heading});
    assert.ok(rendered.lights.n<=rendered.lights.glow.capacity,ident+' light capacity');
    const camera=new PerspectiveCamera(); camera.updateMatrixWorld();
    rendered.update({t:1,night:1,wind:[2,0],camera,heightPx:900,cam:new Vector3(0,25,13)});
    rendered.setOccupied(site.rearSet ? half : 0,false); rendered.setOccupied(site.rearSet ? half : 0,true); rendered.dispose();
    const parked=new ParkedFleetSet(site,layout); while(!parked.ready) parked.prepare();
    parked.update({airportWatch:{active:true,validated:true,floorY:site.groundY+site.floorM},traffic:{items:[]}},1);
    assert.ok(parked.stats.parked>0); assert.ok(parked.stats.triangles>0); parked.dispose();
    for(const g of [built.staticGeo,built.decals,built.pools,...built.kits.values(),...built.bridges.flatMap((b)=>[b.docked,b.retracted,b.dockedColumn.geo,b.retractedColumn.geo]),...built.fixtures.map((f)=>f.geo)]) g.dispose();
  }
});
room.dispose();
console.log(`LOUNGE PIER: ${checks} checks`);

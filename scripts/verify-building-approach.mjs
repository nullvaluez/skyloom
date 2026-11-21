import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { ShaderLib } from 'three';

register('./_node-resolve.mjs', import.meta.url);
const { installUrlFlags, pinned } = await import('../lib/fly/fly-pins.js');
globalThis.window = { location: { search: '' }, __flyWorldPassTierOverride: true };
installUrlFlags();
const { BUILDING_APPROACH, CANOPY_VIEW_LOD } = await import('../lib/fly/fly-constants.js');
const { worldPassRequest } = await import('../lib/fly/world-pass.js');
const { createTileCtx } = await import('../lib/fly/toy-world/worker/tile-ctx.js');
const { buildSatSkyline } = await import('../lib/fly/toy-world/worker/sat-skyline.js');
const { admitFootprints } = await import('../lib/fly/toy-world/worker/sat-buildings/admission.js');
const { heightOf } = await import('../lib/fly/toy-world/worker/sat-buildings/height.js');
const { classifyRingsSat } = await import('../lib/fly/toy-world/worker/geom.js');
const { createStandInPreparation, advanceStandInPreparation } = await import('../lib/fly/toy-world/sat-stand-in-prep.js');
const { mergeStandInParts, createStandInGeometry } = await import('../lib/fly/toy-world/sat-stand-ins.js');
const { createStandInMaterial, createStandInUniforms } = await import('../lib/fly/sat-stand-in-material.js');
const { SatSkylineEngine } = await import('../lib/fly/toy-world/sat-skyline-engine.js');
const { inParcelRing, placeParcelRings, residentParcelSignature } = await import('../lib/fly/parcel-gap.js');
const { createCinematicHomeMaterial, createCinematicHomeDepthMaterial } = await import('../lib/fly/cinematic-ground.js');
const { buildRoadsideInfill } = await import('../lib/fly/settlement-infill.js');
const { buildSatVeg } = await import('../lib/fly/toy-world/worker/sat-veg.js');

const request = worldPassRequest();
assert.equal(BUILDING_APPROACH.enabled, true);
assert.equal(CANOPY_VIEW_LOD.enabled, true);
const rollback = { location: { search: '?flags=-BUILDING_APPROACH,-CANOPY_VIEW_LOD' } };
installUrlFlags(rollback);
const defaultWindow = globalThis.window;
globalThis.window = rollback;
assert.equal(pinned(BUILDING_APPROACH, '__flyBuildingApproachOverride').enabled, false);
assert.equal(pinned(CANOPY_VIEW_LOD, '__flyCanopyViewLodOverride').enabled, false);
globalThis.window = defaultWindow;
assert.equal(request.reach.worker.maxNeighborhoodPerTile, BUILDING_APPROACH.maxNeighborhoodPerTile);
assert.equal(request.reach.worker.cityContinuity, undefined);
const old = structuredClone(request);
delete old.reach.worker.maxNeighborhoodPerTile;
delete old.reach.worker.cityContinuity;
old.reach.worker.footprintK = 0.5;
const extent = 4096, span = 2 * Math.PI * 6378137 / 2 ** 14;
function context(vt, wp, x = 8192, y = 8192, compact = false, compactOptions = {}) {
  const cx = (x + 0.5 - 8192) * span, cz = (y + 0.5 - 8192) * span;
  const cityHorizon = { maxTriangles: 768, maxBodies: 96, compact,
    footprintK: BUILDING_APPROACH.footprintK, maxNeighborhoodPerTile: BUILDING_APPROACH.maxNeighborhoodPerTile,
    ...compactOptions };
  return createTileCtx(vt, { tileSpan: span, cx, cz, mercX0: cx-span/2, mercYTop: -cz+span/2,
    k: Math.cosh(cz/6378137), t0: performance.now(), trueAreas: true, visuals: true, cityHorizon },
  { z: 14, x, y, v: 1, detail: 'sat-skyline', options: { worldPass: wp } });
}
function feature(id, x, y, top = 5, base = 0) {
  // 16 x 12 metres at the equator; the OMT synthetic 5 has no height tag.
  const points = [[x,y],[x+27,y],[x+27,y+20],[x,y+20],[x,y]].map(([x,y]) => ({x,y}));
  return { type: 3, id, properties: { render_height: top, render_min_height: base },
    loadGeometry: () => [points] };
}
const streets = Array.from({ length: 49 }, (_,i) => feature(i, 400+(i%7)*46, 400+Math.floor(i/7)*40));
const farms = Array.from({ length: 25 }, (_,i) => feature(100+i, 40+(i%5)*800, 40+Math.floor(i/5)*800));
const overpass = feature(300, 2000, 2700, 28, 9);
const tile = features => ({ layers: { building: { extent, length: features.length, feature: i => features[i] } } });
const neighborhood = tile([...streets, overpass]);
const oldBundle = buildSatSkyline(context(neighborhood,old)).satStandIns;
const detailed = context(neighborhood,request);
const near = admitFootprints(detailed,classifyRingsSat);
const heights = near.map(it => heightOf(it,detailed,'near').h).sort((a,b)=>a-b);
const proxies = buildSatSkyline(context(neighborhood,request)).satStandIns;
assert.equal(oldBundle.n, 1);
assert.equal(proxies.n, near.length);
assert.equal(buildSatSkyline(context(tile(farms),request)).empty, true);
const proxyHeights = Array.from({ length: proxies.n }, (_,i) => proxies.dim[4*i+2]).sort((a,b)=>a-b);
assert.ok(proxyHeights.every((h,i) => Math.abs(h-heights[i]) < 0.001));
assert.deepEqual([...proxies.bottom].filter(Boolean), [9*32]);
const reordered = buildSatSkyline(context(tile([overpass,...streets].reverse()),request)).satStandIns;
assert.deepEqual(proxies.pos, reordered.pos);
assert.deepEqual(proxies.dim, reordered.dim);
const budget = structuredClone(request);
budget.reach.worker.maxNeighborhoodPerTile = 10;
const capped = buildSatSkyline(context(neighborhood,budget)).satStandIns;
assert.equal(capped.n, 11);
assert.deepEqual([...capped.bottom].filter(Boolean), [9*32]);
const compact = buildSatSkyline(context(neighborhood,null,8192,8192,true)).satStandIns;
assert.equal(compact.n, 50);
assert.ok(compact.n*6 <= 768);

// This mapped suburb is distributed across an entire tile and never meets
// the dense local cluster test. CITY_CONTINUITY already admits its houses.
const spread = tile(Array.from({length:256}, (_,i) =>
  feature(i, 10 + (i%16)*235, 10 + Math.floor(i/16)*235)));
const continuity = structuredClone(old);
continuity.reach.worker.cityContinuity = true;
const both = structuredClone(request);
both.reach.worker.cityContinuity = true;
const alone = buildSatSkyline(context(spread,continuity)).satStandIns;
const together = buildSatSkyline(context(spread,both)).satStandIns;
assert.ok(alone.n > 0);
function anchors(bundle) {
  return new Set(Array.from({length:bundle.n}, (_,i) => bundle.pos.slice(i*2,i*2+2).join(',')));
}
const combined = anchors(together);
assert.ok([...anchors(alone)].every(key => combined.has(key)));
const compactOld = buildSatSkyline(context(spread,null,8192,8192,true,
  { footprintK:0.5, maxNeighborhoodPerTile:0 })).satStandIns;
const compactBoth = buildSatSkyline(context(spread,null,8192,8192,true)).satStandIns;
assert.ok(compactOld.n && compactBoth.n >= compactOld.n && compactBoth.n*6<=768);
assert.ok(buildSatSkyline(context(spread,null,8192,8192,true,{cityContinuity:false})).empty);

const parts = [{si: proxies, dx: 0, dz: 0}, {si: oldBundle, dx: span, dz: 0}];
const merged = mergeStandInParts(parts);
const job = createStandInPreparation(parts, Float32Array.of(12,12,12,12),1,2*span);
while (!advanceStandInPreparation(job,performance.now()+2)) { /* service bounded batches */ }
assert.deepEqual(merged.bottom, job.result.m.bottom);
const geo = createStandInGeometry(job.result.m, job.result.baseY,2*span,job.result);
assert.deepEqual(geo.getAttribute('aStandInBottom').array, merged.bottom);
assert.ok(job.result.baseY.every(h => h === 12));
const mat = createStandInMaterial({ uniforms: createStandInUniforms(), footprintK: BUILDING_APPROACH.footprintK });
const shader = { ...ShaderLib.standard, uniforms: {} };
mat.onBeforeCompile(shader);
assert.ok(shader.vertexShader.includes('aStandInBottom / 32.0'));
assert.ok(shader.fragmentShader.includes('uArchitectureNearFade * vArchitectureCovered'));
assert.deepEqual(mat.defaultAttributeValues.aStandInBottom, [0]);
geo.dispose();
mat.dispose();

const engine = new SatSkylineEngine({groundAt: () => ({ tileZ: 8, elev: 43 })});
const pending = { group: { z: 14, gx: 2048, gy: 2048 }, gi: 0 };
engine.pendingFinalize.push(pending);
for(let i=0;i<100 && !pending.gridZoom?.every(z=>z===8);i++) engine._drapePending(-300);
assert.ok(pending.gridZoom.every(z=>z===8));
assert.ok(pending.grid.every(h=>h===43));
engine.dispose();
const clock = {value: 1};
for (const [material,program] of [[createCinematicHomeMaterial(()=>{},clock),'standard'],
    [createCinematicHomeDepthMaterial(()=>{},clock),'depth']]) {
  const shader = {...ShaderLib[program], uniforms:{}};
  material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uHomeTime,clock);
  assert.ok(shader.vertexShader.includes('transformed *= smoothstep(0.0, 1.2, uHomeTime - aHomeBorn)'));
  material.emissiveMap?.dispose();
  material.dispose();
}

const tiles = Array.from({ length:25 }, (_,i) => ({
  key:'14/'+i+'/100', state:'ready', tile:{x:i,y:100}, cx:(i%5-2)*1000, cz:(Math.floor(i/5)-2)*1000,
  span:1000, parcel:[0,0], parcelKind:Uint8Array.of(1),
}));
const nearTiles = tiles.slice(0,9);
const ringSource = {chunks: new Map(tiles.map(c=>[c.key,c])), supportRevision:1};
const readySignature = residentParcelSignature(ringSource);
const late = {...tiles[0],key:'14/50/100'};
ringSource.chunks.set(late.key,{...late,state:'sampling'});
assert.equal(residentParcelSignature(ringSource),readySignature);
ringSource.chunks.set(late.key,late);
assert.notEqual(residentParcelSignature(ringSource),readySignature);
ringSource.chunks.delete(tiles[0].key);
assert.equal(ringSource.chunks.size,tiles.length);
assert.notEqual(residentParcelSignature(ringSource),readySignature);
ringSource.chunks.delete(late.key);
ringSource.chunks.set(tiles[0].key,tiles[0]);
const beforeHeal = residentParcelSignature(ringSource);
ringSource.supportRevision++;
assert.notEqual(residentParcelSignature(ringSource),beforeHeal);

function roadsidePool(resident, perNear) {
  let placed = 0;
  const primary = new Map(), outer = new Map();
  placeParcelRings(nearTiles, resident, 5000, Math.floor(5000/9), (c,cap,far) => {
    const count = Math.min(cap-placed,far ? 384 : perNear);
    (far ? outer : primary).set(c.key,count);
    placed += count;
    return placed;
  },0,0,4000);
  assert.ok(placed<=5000);
  return {primary,outer,placed};
}
for (const perNear of [140,399,555]) {
  const base = roadsidePool(null,perNear), forward = roadsidePool(tiles,perNear);
  assert.deepEqual(forward.primary,base.primary);
  assert.equal(forward.placed,5000);
  assert.deepEqual(roadsidePool(tiles.toReversed(),perNear).outer,forward.outer);
  const counts = tiles.map(c=>forward.outer.get(c.key)??0);
  assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
}
for (const dist of [1000,2400,2401,3500,4000]) for (const street of [true,false]) {
  const near = inParcelRing(false,street,true,dist**2,2400**2,4000**2);
  const far = inParcelRing(true,street,true,dist**2,2400**2,4000**2);
  assert.equal(near && far,false);
  assert.equal(near || far,dist<=2400 || (street && dist<4000));
}
assert.equal(inParcelRing(true,true,false,2000**2,2400**2,4000**2),true);
console.log('PASS 49 neighborhood homes precede detail, 25 scattered farm footprints stay flat, near/far heights and the 9 m underpass agree, city previews compose, compact budgets and z8 ground support hold. Near housing retains its allocation across 25 competing tiles, stationary arrivals invalidate placement, visible and shadow geometry share the birth ramp.');

const line = {type:2, properties:{class:'minor'}, loadGeometry:()=>[[{x:0,y:128},{x:256,y:128}]]};
const oneFeature = f => ({extent:256, length:1, feature:()=>f});
const streetTile = {layers:{transportation:oneFeature(line)}};
function lawn(code=30) {
  const cover=new Uint8Array(256*256).fill(code);
  for(const x of [100,160]) for(let y=123;y<=124;y++) cover.fill(50,y*256+x,y*256+x+2);
  return cover;
}
const mixed = (vt, cover, on=true, max=384) => buildRoadsideInfill(vt,cover,2048,max,null,on);
const lawns=lawn(), homes=mixed(streetTile,lawns);
assert.equal(mixed(streetTile,lawns,false).length,0);
assert.equal(homes.length,2);
assert.deepEqual(mixed(streetTile,lawns),homes);
assert.deepEqual(mixed(streetTile,lawns,true,1),homes.slice(0,1));
for(const p of homes) {
  assert.equal(lawns[Math.floor(p.y*256)*256+Math.floor(p.x*256)],50);
  assert.ok(Math.abs(128-p.y*256)*8>=20 && Math.abs(128-p.y*256)*8<=40);
}
const roadOnly=new Uint8Array(256**2).fill(30);
roadOnly.fill(50,126*256,131*256);
assert.equal(mixed(streetTile,roadOnly).length,0);
roadOnly.fill(50,124*256,125*256); // isolated one-pixel line off the mapped centerline
assert.equal(mixed(streetTile,roadOnly).length,0);
const parallelPavement=new Uint8Array(256**2).fill(30);
for(let y=123;y<125;y++) parallelPavement.fill(50,y*256+20,y*256+230);
assert.equal(mixed(streetTile,parallelPavement).length,0);
for(const hazard of [0,10,20,40,60,80,90,95]) assert.equal(mixed(streetTile,lawn(hazard)).length,0);
for(const [layer,cls] of [['landuse','industrial'],['landuse','kindergarten'],['aeroway','aerodrome'],['building','building'],['water','lake']]) {
  const block={type:3,properties:{class:cls},loadGeometry:()=>[[{x:50,y:90},{x:220,y:90},{x:220,y:150},{x:50,y:150}]]};
  assert.equal(mixed({layers:{...streetTile.layers,[layer]:oneFeature(block)}},lawns).length,0);
}
// The 7 m mapped shed fits between all surface-mask sample centers, within
// one house width of the western anchor. Use the worker's real footprint veto.
const shed={type:3,properties:{},loadGeometry:()=>[[
  {x:1629,y:1993},{x:1643,y:1993},{x:1643,y:2007},{x:1629,y:2007},{x:1629,y:1993},
]]};
function workerLots(building) {
  const layers={...streetTile.layers};
  if(building) layers.building={...oneFeature(shed),extent:4096};
  const frame={tileSpan:2048,k:1,cx:0,cz:0,mercX0:-1024,mercYTop:1024,t0:0,worldCover:lawns};
  return buildSatVeg(createTileCtx({layers},frame,{z:14,x:8192,y:8192,v:27,detail:'sat-veg',
    options:{mixedRoadsideLots:true,worldPass:request}})).satParcel;
}
const noShed=workerLots(false),withShed=workerLots(true);
assert.equal(noShed.length,4);
assert.equal(withShed.length,2);
assert.ok(withShed[0]>0 && Array.from(noShed).includes(withShed[0]));
assert.equal(mixed(streetTile,null).length,0);
for(const cls of ['tertiary','track','service']) {
  assert.equal(mixed({layers:{transportation:oneFeature({...line,properties:{class:cls}})}},lawns).length,0);
}
const withOld=lawns.slice();
for(let y=110;y<140;y++) withOld.fill(50,y*256+25,y*256+70);
const prior=mixed(streetTile,withOld,false);
assert.ok(prior.length>0);
assert.deepEqual(mixed(streetTile,withOld).slice(0,prior.length),prior);
console.log('PASS mixed-lawn lots require an off-street built patch, retain prior placements and veto protected classes, road-only pixels, airfields and nonresidential land.');

// Replays first consult the local recordings. A clean checkout can fetch
// the same dated vector tiles when a replay is explicitly requested.
const vectorRoot = 'https://tiles.openfreemap.org/planet/20261115_080022_pt/14';
async function recordedSource(file, url) {
  try { return await readFile(file); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const response = await fetch(url, {signal: AbortSignal.timeout(20000)});
  if (!response.ok) throw Error(url + ' HTTP ' + response.status);
  return Buffer.from(await response.arrayBuffer());
}
if (process.argv.includes('--quail')) {
  const { decodeWorldCover, worldCoverURL } = await import('../lib/fly/world-cover.js');
  const { default: sharp } = await import('sharp');
  const x=4411,y=6192,cz=(y+.5-8192)*span,cx=(x+.5-8192)*span,k=Math.cosh(cz/6378137);
  const [pbf,png]=await Promise.all([
    recordedSource('.graphics-review/building-approach/quail-worker/ofm.pbf',vectorRoot+'/'+x+'/'+y+'.pbf'),
    recordedSource('.graphics-review/building-approach/quail-worker/cover.png',worldCoverURL(14,x,y)),
  ]);
  const vt=new VectorTile(new PbfReader(pbf)), cover=decodeWorldCover(await sharp(png).ensureAlpha().raw().toBuffer());
  const frame={cx,cz,k,tileSpan:span,mercX0:cx-span/2,mercYTop:-cz+span/2,t0:0,worldCover:cover};
  const east=6378137*(-83.0747)*Math.PI/180,north=-6378137*Math.asinh(Math.tan(40.1734*Math.PI/180));
  const build=options=>buildSatVeg(createTileCtx(vt,frame,{z:14,x,y,v:27,detail:'sat-veg',options:{...options,worldPass:request}}));
  const before=build({}), off=build({mixedRoadsideLots:false}), after=build({mixedRoadsideLots:true});
  for(const key of ['satParcel','satParcelKind','satParcelYaw']) assert.deepEqual(before[key],off[key]);
  assert.equal(before.satParcelKind?.includes(1)??false,false);
  const distances=[];
  for(let i=0;i<after.satParcelKind.length;i++) if(after.satParcelKind[i]===1) {
    distances.push(Math.round(Math.hypot(cx+after.satParcel[2*i]-east,cz+after.satParcel[2*i+1]-north)/k));
  }
  distances.sort((a,b)=>a-b);
  assert.equal(distances.length,12);
  assert.deepEqual(distances.filter(d=>d<=250),[88,163,164,207]);
  assert.equal(distances.filter(d=>d<=500).length,10);
  console.log('Quail Crossing, November 15 vector tile, ESA 2021. Worker roadside homes 0 → 12; within 250 m 0 → 4; within 500 m 0 → 10. Distances (m)',distances);
}

// Optional replay against the locally recorded Powell approach. The core
// gate above uses no network, build directory or downloaded fixture.
if (process.argv.includes('--powell')) {
  const rows = [];
  for (let x=4407;x<=4409;x++) for (let y=6189;y<=6191;y++) {
    const bytes = await recordedSource(`.graphics-review/powell-color/benchmark/${x}-${y}.pbf`,vectorRoot+'/'+x+'/'+y+'.pbf');
    const build = wp => buildSatSkyline(context(new VectorTile(new PbfReader(bytes)),wp,x,y)).satStandIns;
    const count = (s,range,footprintK) => {
      let n=0;
      for(let i=0;i<(s?.n??0);i++) {
        const k = Math.cosh((y+.5-8192)*span/6378137);
        const footprint = 2*Math.sqrt(s.dim[i*4]*s.dim[i*4+1])/k;
        const physicalPx = 779*Math.max(s.dim[4*i+2],footprintK*footprint)/range;
        if(physicalPx>=1.2 && 779*s.size[i]/range>=1.2)n++;
      }
      return n;
    };
    const before = build(old), after = build(request);
    rows.push({ x,y,old:before?.n??0,preview:after?.n??0,old6km:count(before,6000,0.5),
      preview6km:count(after,6000,BUILDING_APPROACH.footprintK),old9km:count(before,9000,0.5),preview9km:count(after,9000,BUILDING_APPROACH.footprintK) });
  }
  assert.equal(rows.reduce((total,tile)=>total+tile.old,0),1);
  assert.equal(rows.reduce((total,tile)=>total+tile.preview,0),557);
  assert.equal(rows.filter(tile=>tile.preview===0).length,5);
  console.table(rows);
}

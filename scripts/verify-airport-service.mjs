// GATE TO GATE — verify-airport-service (node; no browser, no GL, no server).
//
// The airport service's shared contracts (FLY_GATE_TO_GATE_PLAN.md, W0). One
// section per contract; later waves append sections (pose equivalence,
// snapshot round trip, …) below the existing ones.
//
//   suppression  multi-area airfield suppression (lib/fly/airfield/
//                airfield-suppression.js) and its consumers: the SatRoadEngine
//                runway-light exclusion, the LivingAirports cut uniforms and
//                tile hiding, and the single-disc identity with the pre-G2G code.
//   catalog      runway-catalog eviction with four big protected idents plus
//                twenty discoveries terminates and keeps every protected row.
//
// One pass/fail summary at the end; exit 1 on any failure.
// Run: node scripts/verify-airport-service.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
register(pathToFileURL(path.join(HERE, '_node-resolve.mjs')).href);
register(pathToFileURL(path.join(HERE, '_alias-loader.mjs')).href);

// The runway catalog reads its JSON from public/ through fetch.
globalThis.localStorage = { setItem() {}, getItem() { return null; } };
globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', url), 'utf8')) });

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const S = await imp('lib/fly/airfield/airfield-suppression.js');
const { SatRoadEngine } = await imp('lib/fly/toy-world/sat-road-engine.js');
const { LivingAirports } = await imp('lib/fly/living-airports.js');
const catalog = await imp('lib/fly/runway-catalog.js');
const registry = await imp('lib/fly/operations-airports.js');
const { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, ShaderLib } = await import('three');

let pass = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name} — ${String(error?.message || error).split('\n')[0]}`);
  }
}
const clearAll = () => {
  for (const d of S.airfieldSuppressions()) S.setAirfieldSuppressionArea(d.key, null);
};

// ---- section: suppression ---------------------------------------------------
console.log('\n[suppression]');

// A road chunk mesh: `verts` = [[localX, localZ, cls], …] at a scene position.
function roadMesh(x, z, verts) {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(Float32Array.from(verts.flatMap(([lx, lz]) => [lx, 0, lz])), 3));
  geo.setAttribute('aRoadCls', new BufferAttribute(Uint8Array.from(verts.map((v) => v[2])), 1));
  const mesh = new Mesh(geo, new MeshBasicMaterial());
  mesh.position.set(x, 0, z);
  return mesh;
}
const classes = (mesh) => [...mesh.geometry.getAttribute('aRoadCls').array];
const engineWith = (meshes) => {
  const engine = new SatRoadEngine({ groundAt: () => null });
  meshes.forEach((mesh, i) => engine.chunks.set(`14/${i}/0`, { mesh }));
  return engine;
};
const DISC_A = { ident: 'AAAA', x: 1000, z: 0, radius: 100, runwayIds: ['AAAA:09-27'] };
const DISC_B = { ident: 'BBBB', x: 50010, z: 10, radius: 50, runwayIds: ['BBBB:01-19', 'XXXX:05-23'], covers: 'runways' };

await check('two discs zero the class-7 runway lights inside either, nothing else, and clearing restores them', () => {
  clearAll();
  const a = roadMesh(1000, 0, [[0, 0, 7], [40, 30, 7], [500, 0, 7], [0, 0, 3], [10, 10, 5]]);
  const b = roadMesh(50000, 0, [[10, 10, 7], [10, 200, 7], [12, 8, 1]]);
  const engine = engineWith([a, b]);
  S.setAirfieldSuppressionArea('lounge', DISC_A);
  S.setAirfieldSuppressionArea('area:b', DISC_B);
  engine.setRunwayLightExclusion(S.airfieldSuppressions());
  assert.deepEqual(classes(a), [0, 0, 7, 3, 5]);
  assert.deepEqual(classes(b), [0, 7, 1]);
  // A chunk born while the discs are live is cut at birth (the finalize path).
  const late = roadMesh(1000, 0, [[5, 5, 7]]);
  engine._applyLightCut(late);
  assert.deepEqual(classes(late), [0]);
  clearAll();
  engine.setRunwayLightExclusion(S.airfieldSuppressions());
  assert.deepEqual(classes(a), [7, 7, 7, 3, 5]);
  assert.deepEqual(classes(b), [7, 7, 1]);
  engine.setRunwayLightExclusion(null);
  assert.deepEqual(classes(a), [7, 7, 7, 3, 5]);
});

// The pre-G2G single-disc cut, verbatim arithmetic (sat-road-engine.js before W0).
function legacyCut(mesh, cut) {
  const attr = mesh.geometry.getAttribute('aRoadCls'), pos = mesh.geometry.getAttribute('position');
  const r2 = cut ? cut.radius * cut.radius : 0;
  for (let i = 0; i < attr.count; i++) {
    if (mesh.userData.legacy7?.[i] === undefined) (mesh.userData.legacy7 ??= [])[i] = attr.array[i] === 7;
    if (!mesh.userData.legacy7[i]) continue;
    const inside = !!cut && (mesh.position.x + pos.array[i * 3] - cut.x) ** 2 + (mesh.position.z + pos.array[i * 3 + 2] - cut.z) ** 2 <= r2;
    attr.array[i] = inside ? 0 : 7;
  }
}
await check('one disc: the exclusion output is byte-identical to the single-disc code, single-disc form accepted', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let trial = 0; trial < 40; trial++) {
    const x = 1000 + (rand() - 0.5) * 400, z = (rand() - 0.5) * 400;
    const verts = Array.from({ length: 400 }, () => [(rand() - 0.5) * 600, (rand() - 0.5) * 600, rand() < 0.6 ? 7 : 3]);
    const cut = { x: 1000 + (rand() - 0.5) * 50, z: (rand() - 0.5) * 50, radius: 50 + rand() * 250 };
    const ours = roadMesh(x, z, verts), theirs = roadMesh(x, z, verts);
    const engine = engineWith([ours]);
    if (trial % 2) engine.setRunwayLightExclusion([{ ...cut, ident: 'T', runwayIds: [] }]);
    else engine.setRunwayLightExclusion(cut); // the single-disc form
    legacyCut(theirs, cut);
    assert.deepEqual(classes(ours), classes(theirs), `trial ${trial}`);
    engine.setRunwayLightExclusion(null);
    legacyCut(theirs, null);
    assert.deepEqual(classes(ours), classes(theirs), `trial ${trial} restore`);
  }
});

await check('airfieldSuppressesAirport matches either disc by ident or by drawn runway id', () => {
  clearAll();
  S.setAirfieldSuppressionArea('lounge', DISC_A);
  S.setAirfieldSuppressionArea('area:b', DISC_B);
  assert.equal(S.airfieldSuppressesAirport({ id: 'AAAA:04-22', ident: 'AAAA' }), true);
  assert.equal(S.airfieldSuppressesAirport({ id: 'BBBB:01-19' }), true);
  assert.equal(S.airfieldSuppressesAirport({ id: 'XXXX:05-23', ident: 'XXXX' }), true);
  assert.equal(S.airfieldSuppressesAirport({ id: 'CCCC:10-28', ident: 'CCCC' }), false);
  assert.equal(S.airfieldSuppressesAirport({ id: 'KCMH' }), false);
  assert.equal(S.airfieldSuppressesAirport(null), false);
  // An explicit list (the AirportOperationsLayer snapshot) and the single-disc form.
  assert.equal(S.airfieldSuppressesAirport({ id: 'BBBB:01-19' }, [S.airfieldSuppressions()[0]]), false);
  assert.equal(S.airfieldSuppressesAirport({ id: 'BBBB:01-19' }, S.airfieldSuppressions()[1]), true);
  assert.equal(S.insideAirfieldSuppression(1050, 0), true);
  assert.equal(S.insideAirfieldSuppression(50010, 50), true);
  assert.equal(S.insideAirfieldSuppression(3000, 0), false);
  assert.equal(S.insideAirfieldSuppression(1050, 0, S.airfieldSuppressions()[1]), false);
  clearAll();
});

await check("a disc with covers 'runways' is reported with its covers; the default is 'all'", () => {
  clearAll();
  S.setAirfieldSuppressionArea('lounge', DISC_A);
  S.setAirfieldSuppressionArea('area:b', DISC_B);
  const list = S.airfieldSuppressions();
  assert.deepEqual(list.map((d) => [d.key, d.covers]), [['lounge', 'all'], ['area:b', 'runways']]);
  assert.equal(S.airfieldSuppressionOf({ id: 'BBBB:01-19' })?.covers, 'runways');
  assert.equal(S.airfieldSuppressionOf({ id: 'AAAA:09-27' })?.covers, 'all');
  assert.ok(Object.isFrozen(list) && list.every((d) => Object.isFrozen(d) && Object.isFrozen(d.runwayIds)));
  clearAll();
});

await check('airfieldSuppressions() keeps its identity until a change; listeners hear only changes', () => {
  clearAll();
  const heard = [];
  const off = S.subscribeAirfieldSuppression((list) => heard.push(list));
  const empty = S.airfieldSuppressions();
  assert.equal(empty.length, 0);
  assert.equal(S.airfieldSuppressions(), empty);
  S.setAirfieldSuppressionArea('nowhere', null); // clearing an unknown key is no change
  assert.equal(heard.length, 0);
  S.setAirfieldSuppressionArea('lounge', DISC_A);
  const one = S.airfieldSuppressions();
  assert.notEqual(one, empty);
  assert.equal(heard.length, 1);
  assert.equal(heard[0], one);
  S.setAirfieldSuppressionArea('lounge', { ...DISC_A, runwayIds: [...DISC_A.runwayIds] }); // equal values
  assert.equal(S.airfieldSuppressions(), one);
  assert.equal(heard.length, 1);
  S.setAirfieldSuppressionArea('lounge', { ...DISC_A, radius: 120 });
  assert.notEqual(S.airfieldSuppressions(), one);
  assert.equal(heard.length, 2);
  // Compat: the single-disc API is the 'lounge' area and the first disc.
  S.setAirfieldSuppressionArea('area:b', DISC_B);
  S.setAirfieldSuppression(null);
  assert.deepEqual(S.airfieldSuppressions().map((d) => d.key), ['area:b']);
  assert.equal(S.airfieldSuppression()?.key, 'area:b');
  S.setAirfieldSuppression(DISC_A);
  assert.equal(S.airfieldSuppressions().at(-1).key, 'lounge');
  off();
  clearAll();
  assert.equal(heard.length, 5);
  assert.equal(S.airfieldSuppression(), null);
});

// LivingAirports: one cached pavement tile (the verify-cloud-road-paths fixture,
// a 250 m strip at the scene origin) on flat ground.
const STRIP = {
  pos: new Float32Array([0, 0, 5, 250, 0, -5, 0, 0, -5, 0, 0, 5, 250, 0, 5, 250, 0, -5]),
  uv: new Float32Array([5, 0, -5, 250, -5, 0, 5, 0, 5, 250, -5, 250]),
  style: new Float32Array([2, 10, 2, 10, 2, 10, 2, 10, 2, 10, 2, 10]),
  evidence: { roadSegments: 1, mappedPolygons: 0, inferredWidths: 0 },
};
const SPAN = 40075016.68557849 / 16384;
const SURFACE = { bands: [null, null, { span: SPAN, slots: [{ key: '14/8192/8192', state: 'ready', mask: { airport: STRIP } }] }], stats: { commits: 1 } };
const RT = { flight: { latDeg: 0, pos: { x: 0, y: 110, z: 0 }, groundElev: 100 }, origin: { anchor: { x: 10, y: 0, z: -20 } }, engine: { getGroundAt: () => ({ elev: 100, tileZ: 18 }) } };

await check('LivingAirports: one disc packs the old uniform; several discs cut, only covers "all", at most three', () => {
  clearAll();
  const layer = new LivingAirports();
  layer.update(SURFACE, RT);
  assert.equal(layer.cutN.value, 0);
  S.setAirfieldSuppressionArea('lounge', { ident: 'AAAA', x: 125, z: 0, radius: 200, runwayIds: [] });
  layer.update(SURFACE, RT);
  // The pre-G2G encoding: (x - anchor.x, z - anchor.z, radius², on).
  assert.equal(layer.cutN.value, 1);
  assert.deepEqual(layer.cuts.value[0].toArray(), [125 - 10, 0 + 20, 200 * 200, 1]);
  S.setAirfieldSuppressionArea('area:r', { ident: 'RRRR', x: 9000, z: 0, radius: 300, covers: 'runways' });
  S.setAirfieldSuppressionArea('area:1', { ident: 'BBBB', x: 5000, z: 0, radius: 300 });
  S.setAirfieldSuppressionArea('area:2', { ident: 'CCCC', x: 7000, z: 0, radius: 300 });
  S.setAirfieldSuppressionArea('area:3', { ident: 'DDDD', x: 8000, z: 0, radius: 300 });
  layer.update(SURFACE, RT);
  assert.equal(layer.cutN.value, 3);
  assert.deepEqual(layer.cuts.value.map((v) => v.x), [115, 4990, 6990]);
  assert.equal(layer.material.customProgramCacheKey().endsWith('-living-airfield-v3'), true);
  // The injected shader text landed (every replace anchor matched).
  const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
  layer.material.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /uniform vec4 uAirfieldCuts\[3\];\s*uniform int uAirfieldCutN;/);
  assert.match(shader.fragmentShader, /for\(int i=0;i<3;i\+\+\)\{if\(i>=uAirfieldCutN\)break;/);
  assert.doesNotMatch(shader.fragmentShader, /uAirfieldCut\b/);
  assert.equal(shader.uniforms.uAirfieldCuts, layer.cuts);
  assert.equal(shader.uniforms.uAirfieldCutN, layer.cutN);
  // Without a floating origin nothing is cut (as before).
  layer.update(SURFACE, { ...RT, origin: null });
  assert.equal(layer.cutN.value, 0);
  layer.dispose();
  clearAll();
});

await check('LivingAirports: a tile wholly inside one disc is hidden (no draw); partly inside or cleared, it draws', () => {
  clearAll();
  const layer = new LivingAirports();
  for (let i = 0; i < 20; i++) layer.update(SURFACE, RT);
  const tile = [...layer.tiles.values()][0];
  assert.ok(tile.indices > 0 && tile.mesh.visible && layer.stats.draws === 1);
  S.setAirfieldSuppressionArea('lounge', { ident: 'AAAA', x: 125, z: 0, radius: 200, runwayIds: [] });
  layer.update(SURFACE, RT);
  assert.equal(tile.mesh.visible, false);
  assert.equal(layer.stats.draws, 0);
  S.setAirfieldSuppressionArea('lounge', { ident: 'AAAA', x: 0, z: 0, radius: 60, runwayIds: [] });
  layer.update(SURFACE, RT);
  assert.equal(tile.mesh.visible, true);
  S.setAirfieldSuppressionArea('lounge', { ident: 'AAAA', x: 125, z: 0, radius: 200, runwayIds: [], covers: 'runways' });
  layer.update(SURFACE, RT);
  assert.equal(tile.mesh.visible, true, "a 'runways' disc keeps the pavement sheet");
  assert.equal(layer.cutN.value, 0);
  S.setAirfieldSuppressionArea('lounge', { ident: 'AAAA', x: 125, z: 0, radius: 200, runwayIds: [] });
  layer.update(SURFACE, RT);
  assert.equal(tile.mesh.visible, false);
  clearAll();
  layer.update(SURFACE, RT);
  assert.equal(tile.mesh.visible, true);
  assert.equal(layer.stats.draws, 1);
  layer.dispose();
});

// ---- section: catalog -------------------------------------------------------
console.log('\n[catalog]');

await check('four big protected idents plus twenty discoveries: eviction terminates and keeps every protected row', async () => {
  const index = await catalog.runwayIndex();
  const discovered = () => registry.OPERATIONS_AIRPORTS.filter((a) => a.authored === false);
  const rowsOf = (ident) => index.filter((r) => r.ident === ident);
  const register = async (rows) => {
    for (const r of rows) assert.equal((await catalog.ensureAirport(r.id))?.id, r.id);
  };
  const big = ['KORD', 'KDFW', 'KDEN', 'KBOS'];
  big.forEach((ident, i) => catalog.protectRunwayIdent(['lounge', 'departure', 'destination', 'nearby'][i], ident));
  const protectedRows = big.flatMap(rowsOf);
  assert.ok(protectedRows.length >= 24, `${protectedRows.length} protected rows`);
  // Fill the registry first so every later activation has to evict.
  await register(index.filter((r) => !big.includes(r.ident)).slice(0, catalog.RUNWAY_ACTIVE_LIMIT));
  await register(protectedRows);
  const discoveries = index.filter((r) => !big.includes(r.ident)).slice(500, 520);
  await register(discoveries);
  for (const r of [...protectedRows, ...discoveries]) assert.ok(registry.airportById(r.id), r.id);
  assert.equal(discovered().length, catalog.RUNWAY_ACTIVE_LIMIT);
  // Protected rows beyond the bound: activation still terminates and keeps them.
  const more = ['KNRQ', 'EHAM', 'KDTW', 'LTFM'];
  more.forEach((ident, i) => catalog.protectRunwayIdent(`extra-${i}`, ident));
  const all = [...protectedRows, ...more.flatMap(rowsOf)];
  assert.ok(all.length > catalog.RUNWAY_ACTIVE_LIMIT);
  await register(more.flatMap(rowsOf));
  await register(index.filter((r) => ![...big, ...more].includes(r.ident)).slice(600, 610));
  for (const r of all) assert.ok(registry.airportById(r.id), r.id);
  assert.equal(discovered().length, all.length + 1);
  for (const role of ['lounge', 'departure', 'destination', 'nearby', ...more.map((_, i) => `extra-${i}`)]) catalog.protectRunwayIdent(role, null);
  assert.equal(catalog.protectedRunwayIdents().size, 0);
});

// ---- summary ----------------------------------------------------------------
const total = pass + failures.length;
console.log(`\nAIRPORT SERVICE: ${pass}/${total}${failures.length ? ` — FAILED: ${failures.join(' | ')}` : ''}`);
process.exit(failures.length ? 1 : 0);

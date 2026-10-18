// Lounge second-level pass — the LIGHT lane's gate (node; no GPU).
//
// FLY_LOUNGE_SECOND_LEVEL.md, LIGHT brief. Every LIGHT change lives in the
// PIER program (or behind the pier variant); this gate holds the lane to it on
// three's real shader sources and the real built rooms:
//   1. the classic program carries none of the pier-only code, and keeps its
//      eight-channel glow table; the pier program carries every guard and
//      feature (NaN guards, exterior, boards, charts, specular fixes);
//   2. the pier room adds <= 24 fragment uniform vectors (the lane budget);
//   3. glow channels: GLOW.READING / GLOW.DISPLAY have channels of their own
//      inside the pier table; Night Watch dims them with the decorative
//      fixtures and keeps the pier's circulation channel; the classic
//      table's dimming is unchanged;
//   4. the exterior predicate, executed from the emitted GLSL on points in
//      and around the room;
//   5. the chart prints the shader draws are exactly CHART_PANELS;
//   6. the interior probe shades each face from its own camera and restores
//      the live uniforms afterwards (pier), and leaves them alone (classic);
//   7. steam: seven cards (14 triangles) per source, a per-cup phase in the
//      pier, the classic plume's attributes and shader untouched by it.
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
const { ShaderLib, Group, Matrix3, Matrix4, PerspectiveCamera, Scene, Vector3 } = await import('three');
const { createAirportLounge } = await import('../lib/fly/airport-lounge.js');
const { GLOW } = await import('../lib/fly/lounge/room-build.js');
const { GLOW_CHANNELS, createRoomUniforms, updateRoomShading } = await import('../lib/fly/lounge/room-shading.js');
const { createLoungeSteam } = await import('../lib/fly/lounge/lounge-steam.js');
const { InteriorProbe } = await import('../lib/fly/lounge/lounge-probe.js');
const { CHART_PANELS, CUPS, steamPoint, STEAM_R } = await import('../lib/fly/lounge/upper-dressing.mjs');

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log('PASS ' + name); };
const pier = createAirportLounge({ variant: 'pier', document: null });
const classic = createAirportLounge({ variant: 'classic', document: null });
const source = (material) => {
  const lib = material.isMeshBasicMaterial ? ShaderLib.basic : material.isMeshPhysicalMaterial ? ShaderLib.physical : ShaderLib.standard;
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader, {});
  return shader.fragmentShader;
};
const lit = (lounge) => lounge.litMaterials();

// Identifiers only the pier program may contain (the LIGHT lane's code).
const PIER_ONLY = ['lgBn * inversesqrt( lgBl )', 'lgAO = clamp( lgAO, 0.0, 1.0 )', 'lgFace', 'bool lgExt', 'lgExtKey', 'lgBoards', 'lgSectional', 'lgApproachPlate', 'lgSpine', 'lgSpecK', 'lgSm.roughness', 'lgRoughAdd', 'LG_CHARTS'];

check('the classic program carries none of the pier-only code and keeps eight glow channels', () => {
  for (const m of lit(classic)) {
    const fs = source(m);
    for (const id of PIER_ONLY) assert.ok(!fs.includes(id), `${m.name}: classic program contains ${id}`);
    assert.ok(fs.includes('uniform float uLoungeGlow[ 8 ];'), `${m.name}: classic glow table`);
    assert.ok(!m.customProgramCacheKey().includes('light-v1'), `${m.name}: classic program key`);
  }
  const em = source(classic.materials.emissive);
  assert.ok(em.includes('uLoungeGlow[ 8 ]') && em.includes('pow( ( vLoungePos.y - 1.5 ) / 1.1, 2.0 )'), 'classic emissive text');
  assert.equal(classic.materials.emissive.customProgramCacheKey(), 'lounge-emissive-v2');
  assert.equal(classic.uniforms.uLoungeGlow.value.length, GLOW_CHANNELS.classic);
});

check('the pier program carries the NaN guards, the exterior, the surface detail and the specular fixes', () => {
  for (const m of lit(pier)) {
    const fs = source(m);
    for (const id of PIER_ONLY) assert.ok(fs.includes(id), `${m.name}: pier program lacks ${id}`);
    assert.ok(!fs.includes('return normalize( abs( det ) * surfNorm - grad );'), `${m.name}: unguarded bump normalize`);
    assert.ok(!fs.includes('pow( ph * 2.0 - 1.0, 2.0 )'), `${m.name}: pow of a negative base`);
    assert.ok(fs.includes(`uniform float uLoungeGlow[ ${GLOW_CHANNELS.pier} ];`), `${m.name}: pier glow table`);
    assert.ok(m.customProgramCacheKey().includes('-floor-split-v1-light-v1'), `${m.name}: pier program key bumped`);
  }
  const em = source(pier.materials.emissive);
  assert.ok(em.includes(`uLoungeGlow[ ${GLOW_CHANNELS.pier} ]`) && !em.includes('pow( ( vLoungePos.y'), 'pier emissive text');
  assert.equal(pier.materials.emissive.customProgramCacheKey(), 'lounge-emissive-v2-pier-v1');
  assert.equal(pier.uniforms.uLoungeGlow.value.length, GLOW_CHANNELS.pier);
});

let slots = 0;
check('the pier room adds <= 24 fragment uniform vectors (LIGHT budget)', () => {
  const SLOTS = { float: 1, vec2: 1, vec3: 1, vec4: 1, mat3: 3, mat4: 4, sampler2D: 0, samplerCube: 0 };
  for (const m of lit(pier)) {
    let n = 0;
    for (const u of source(m).matchAll(/uniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(\w+)\s+(uLounge\w+)\s*(?:\[\s*(\d+)\s*\])?\s*;/g)) n += SLOTS[u[1]] * (u[3] ? Number(u[3]) : 1);
    assert.ok(n > 8 && n <= 24, `${m.name}: ${n} uniform vectors`);
    slots = Math.max(slots, n);
  }
});

check('READING and DISPLAY have channels of their own; Night Watch dims them and keeps the pier circulation', () => {
  assert.equal(GLOW.READING, 8); assert.equal(GLOW.DISPLAY, 9);
  assert.ok(GLOW.DISPLAY < GLOW_CHANNELS.pier && GLOW_CHANNELS.classic === 8);
  const state = { group: new Group(), camera: new PerspectiveCamera(), sun: { sinEl: -0.3 }, keyScene: new Vector3(0, 1, 0) };
  state.camera.updateMatrixWorld();
  for (const [lounge, entranceKeep] of [[pier, 0.8], [classic, 0.65]]) {
    updateRoomShading(lounge.uniforms, state);
    const bright = [...lounge.uniforms.uLoungeGlow.value];
    updateRoomShading(lounge.uniforms, { ...state, nightWatch: 1 });
    const dim = [...lounge.uniforms.uLoungeGlow.value];
    assert.ok(bright.every(Number.isFinite) && dim.every(Number.isFinite));
    assert.ok(Math.abs(dim[GLOW.ENTRANCE] / bright[GLOW.ENTRANCE] - entranceKeep) < 1e-6, `${lounge.room.variant} circulation kept ${dim[GLOW.ENTRANCE] / bright[GLOW.ENTRANCE]}`);
    if (lounge === pier) {
      assert.ok(bright[GLOW.READING] > 1 && bright[GLOW.DISPLAY] > 1, 'warm pools after dark');
      for (const ch of [GLOW.READING, GLOW.DISPLAY]) assert.ok(dim[ch] <= bright[ch] * 0.13, `channel ${ch} dims with the decoration`);
    }
  }
  // by day the reading lamps are barely on, the display lights stay on
  updateRoomShading(pier.uniforms, { ...state, sun: { sinEl: 0.8 } });
  const day = pier.uniforms.uLoungeGlow.value;
  assert.ok(day[GLOW.READING] < 0.2 && day[GLOW.DISPLAY] > 0.5);
});

check('the exterior predicate (executed from the emitted GLSL) holds outdoors only', () => {
  const fs = source(pier.materials.plaster);
  const consts = Object.fromEntries([...fs.matchAll(/#define (LG_\w+|SURF_\w+) ([\d.-]+)/g)].map(([, k, v]) => [k, Number(v)]));
  const expr = fs.match(/bool lgExt = ([^;]+);/)[1].replace(/lgP\.(\w)/g, 'p.$1');
  const ext = new Function('p', 'lgFlag', ...Object.keys(consts), `return ${expr};`);
  const at = (x, y, z, flag = 0) => ext({ x, y, z }, flag, ...Object.values(consts));
  assert.equal(at(0, 4.66, 5), true, 'the lower roof (deck top)');
  assert.equal(at(-9.5, 4.66, 2.9), true, 'the deck in front of the stairwell');
  assert.equal(at(-8.75, 6.2, 6), true, 'the stairwell enclosure\'s outer east skin');
  assert.equal(at(-8.85, 6.2, 6), false, 'its inner face');
  assert.equal(at(0, 4.6, 10), false, 'the upper floor');
  assert.equal(at(0, 6, 9), false, 'the upper room');
  assert.equal(at(0, 2, 5), false, 'the lower room');
  assert.equal(at(0, 4.598, 5), false, 'the lower ceiling deck\'s underside');
  assert.equal(at(-10, 5.2, 9), false, 'the stair');
  assert.equal(at(0, 1, 0, consts.SURF_EXTERIOR), true, 'SURF_EXTERIOR anywhere');
});

check('the chart prints the shader draws are exactly CHART_PANELS', () => {
  const fs = source(pier.materials.small);
  const row = fs.match(/const vec4 LG_CHARTS\[ (\d+) \] = vec4\[ \d+ \]\( (.+) \);/);
  assert.equal(Number(row[1]), CHART_PANELS.length);
  const vecs = [...row[2].matchAll(/vec4\( ([^)]+) \)/g)].map((m) => m[1].split(',').map(Number));
  CHART_PANELS.forEach((c, i) => assert.deepEqual(vecs[i], [c.zc, c.yc, c.kind === 'approach' ? 1 : 0, c.seed], c.id));
  assert.ok(fs.includes(`#define LG_CHART_W ${CHART_PANELS[0].w}`) && fs.includes(`#define LG_CHART_H ${CHART_PANELS[0].h}`));
  assert.ok(CHART_PANELS.every((c) => c.w === CHART_PANELS[0].w && c.h === CHART_PANELS[0].h), 'one print size');
});

check('the interior probe shades each face from its own camera and restores the live uniforms (pier only)', () => {
  const group = new Group();
  group.position.set(3, 18, -2);
  group.rotation.y = 0.7;
  group.updateMatrixWorld(true);
  const stub = () => {
    const seen = [];
    let target = null;
    return {
      seen,
      capabilities: { reversedDepthBuffer: false }, xr: { enabled: false }, shadowMap: { autoUpdate: true, needsUpdate: false },
      autoClear: true, info: { render: { calls: 0 } },
      getRenderTarget: () => target, setRenderTarget: (t) => { target = t; },
      getClearColor: (c) => c.set(0, 0, 0), setClearColor() {}, getClearAlpha: () => 1,
      render(scene, cam) { seen.push({ cam, uniforms: null }); },
    };
  };
  for (const [lounge, shaded] of [[pier, true], [classic, false]]) {
    const u = createRoomUniforms(lounge.room.variant);
    const live = new Matrix3().set(1, 2, 3, 4, 5, 6, 7, 8, 10);
    u.uLoungeViewToRoom.value.copy(live);
    u.uLoungeEye.value.set(9, 9, 9);
    const r = stub();
    r.render = (scene, cam) => r.seen.push({ cam, m: u.uLoungeViewToRoom.value.clone(), eye: u.uLoungeEye.value.clone() });
    const probe = new InteriorProbe(16);
    const pe = [0, 6.1, 10.7];
    const eye = new Vector3(...pe).applyMatrix4(group.matrixWorld);
    probe.capture(r, new Scene(), group, [], eye, pe, shaded ? u : null);
    assert.equal(r.seen.length, 6);
    for (const { cam, m, eye: e } of r.seen) {
      if (!shaded) { assert.ok(m.equals(live) && e.equals(new Vector3(9, 9, 9))); continue; }
      const want = new Matrix3().setFromMatrix4(new Matrix4().multiplyMatrices(cam.matrixWorldInverse, group.matrixWorld)).invert();
      m.elements.forEach((v, i) => assert.ok(Math.abs(v - want.elements[i]) < 1e-9, 'face view-to-room'));
      assert.ok(e.distanceTo(new Vector3(...pe)) < 1e-9, 'probe eye');
    }
    assert.ok(u.uLoungeViewToRoom.value.equals(live) && u.uLoungeEye.value.equals(new Vector3(9, 9, 9)), 'live uniforms restored');
    probe.dispose();
  }
});

check('steam: 14 triangles per cup, a per-cup phase in the pier, the classic plume untouched', () => {
  const sources = [pier.room.practicals.steam, ...CUPS.map((c) => ({ at: steamPoint(c), r: STEAM_R }))];
  const steam = createLoungeSteam(sources, { variant: 'pier' });
  const g = steam.mesh.geometry;
  assert.equal(g.attributes.position.count / 3, 14 * sources.length);
  const seeds = new Set(g.attributes.aSeed.array);
  assert.equal(seeds.size, sources.length, 'each cup its own phase');
  assert.ok(steam.mesh.material.vertexShader.includes('attribute float aSeed;') && !steam.mesh.material.fragmentShader.includes('pow( p.x'));
  steam.dispose();
  // the rooms as built: one plume per steam source
  assert.equal(pier.steam.mesh.geometry.attributes.position.count / 3, 14 * pier.room.steamSources.length);
  const cs = classic.steam.mesh;
  assert.equal(cs.geometry.attributes.position.count, 42);
  assert.ok(!cs.geometry.attributes.aSeed && !cs.material.vertexShader.includes('aSeed') && cs.material.fragmentShader.includes('pow( p.x / width, 2.0 )'));
  assert.deepEqual([...cs.geometry.attributes.position.array.slice(0, 3)], classic.room.practicals.steam.at.map(Math.fround));
});

pier.dispose(); classic.dispose();
console.log(`PASS lounge light: ${checks} checks · pier room ${slots} uniform vectors (<= 24) · glow ${GLOW_CHANNELS.pier} pier / ${GLOW_CHANNELS.classic} classic channels`);

/**
 * SHIP PASS LIGHT (FLY_SHIP_PASS.md 5.4) — the LIGHT stream's node gate.
 *
 *   node scripts/verify-ship-light.mjs [--base=<ref>]
 *
 * Prints PASS / FAIL rows and "N passed, M failed"; exit 1 on any failure.
 *
 * FLAG-OFF IDENTITY is proven against the tree the stream branched from, not
 * against a copy of today's code: the base's lib/ and stores/ are extracted
 * with `git archive` into a temporary directory (nothing is checked out) and
 * the SAME probe builds the live terrain material chain there and here. With
 * every LIGHT flag off, the shader text and program key must be byte-identical
 * (sha256). The base is the merge-base with --base, by default the Ship Pass
 * W0 commit (scripts/_ship-pass-base.mjs), so the comparison still means
 * "unchanged since W0" on main after the streams are merged.
 *
 * FLAG ARMS run as child processes (`--probe=<json>`), because the Ship Pass
 * flags resolve once at module load: each arm sets its pins on a stub window
 * BEFORE importing anything.
 *
 * Browser-only facts (GLSL compiling under ANGLE, texture-unit headroom,
 * pixels) belong to scripts/review-ship-light.cjs and verify-photo-hires.mjs;
 * fps and motion belong to the owner's RTX 5080 and iPhone (FLY_SHIP_PASS.md 9).
 *
 * RE-PREMISED (merge to main, 2026-10-30): the owner ships every Ship Pass
 * flag ON, LIGHT's six included (TERRAIN_SHADOW, TRAFFIC_SHADOWS,
 * AIRFRAME_SHADOW, SHADOW_REACH, PHOTO_HIRES, HANGAR_EXPOSURE). This gate was
 * written while they shipped off, when an unpinned probe WAS the off arm. Now
 * the off / identity arm is the W0 frame PINNED: every Ship Pass flag (the
 * ship-pass.js table) and PLAYER_SURFACE set `{ enabled:false }` before
 * anything is imported (the `?flags=-NAME` page load), and the arm proves it
 * resolved them off (0e). Every flag-on arm is that W0 frame plus its own
 * flag(s), as it was when the base shipped off, so "the flag-off key plus one
 * token" and "the patch is purely additive" still compare one feature against
 * W0. The shipped (now on) state has its own rows, (S1)-(S7), probed with no
 * flag pins at all (only the device-class pin, which is not a flag).
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { shipPassBase } from './_ship-pass-base.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const sha = (s) => createHash('sha256').update(String(s).replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
const probeArg = process.argv.find((a) => a.startsWith('--probe='));

// ===========================================================================
// PROBE (child process): build artifacts under one set of pins, print JSON.
// ===========================================================================
if (probeArg) {
  const { root, pins = {}, light = true } = JSON.parse(probeArg.slice(8));
  const { register } = await import('node:module');
  register(pathToFileURL(path.join(root, 'scripts/_node-resolve.mjs')).href, import.meta.url);
  globalThis.window = { location: { search: '' }, matchMedia: () => ({ matches: false }), navigator: {}, ...pins };
  const mod = (rel) => import(pathToFileURL(path.join(root, rel)).href);
  const THREE = await import(pathToFileURL(path.join(ROOT, 'node_modules/three/build/three.module.js')).href);
  const { useFlyStore } = await mod('stores/fly-store.js');
  useFlyStore.setState({ mapStyle: 'satellite', visuals: 'enhanced', qualityTier: 'high', qualityPreset: 'high' });
  const out = {};
  const compile = (m) => {
    const lib = m.isShaderMaterial ? { vertexShader: m.vertexShader, fragmentShader: m.fragmentShader, uniforms: m.uniforms } : THREE.ShaderLib.standard;
    const sh = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: THREE.UniformsUtils.clone(lib.uniforms) };
    m.onBeforeCompile(sh, { capabilities: { isWebGL2: true, maxTextures: 16 } });
    return { key: m.customProgramCacheKey(), frag: sh.fragmentShader, vert: sh.vertexShader, uniforms: Object.keys(sh.uniforms) };
  };
  // The live terrain chain (FlyScene's onTileMaterial, prewarm's twin).
  const { buildR25TerrainTwin } = await mod('lib/fly/r25-ground.js');
  const earth = compile(buildR25TerrainTwin());
  out.earth = { key: earth.key, frag: sha(earth.frag), vert: sha(earth.vert), text: earth.frag, uniforms: earth.uniforms };
  if (light) {
    const ts = await mod('lib/fly/terrain-shadow.js');
    out.mode = ts.terrainShadowMode();
    const depth = compile(ts.createTerrainShadowDepthMaterial());
    out.depth = { key: depth.key, vert: depth.vert, frag: depth.frag };
    // What this process resolved (ship-pass.js reads the pins once, at load).
    out.flags = (await mod('lib/fly/ship-pass.js')).shipPassFlags();
    out.flags.PLAYER_SURFACE = (await mod('lib/fly/player-surface.js')).PLAYER_SURFACE_ACTIVE.enabled === true;
    out.photoActive = (await mod('lib/fly/photo-hires.js')).photoHiresActive({ tier: 'high' });
    // HangarScene's own gate line ((7d) holds the source to it), through the
    // stream's reader: the exposure block or null, and what StageBay builds.
    {
      const sl = await mod('lib/fly/ship-light.js');
      const hs = await mod('components/fly/hud/hangar-stage.js');
      const EXPOSURE = sl.shipPassOn('HANGAR_EXPOSURE') ? sl.lightBlock('HANGAR_EXPOSURE') : null;
      out.hangar = { exposure: EXPOSURE !== null, reflector: { medium: hs.hangarReflectorResolution('medium', EXPOSURE), high: hs.hangarReflectorResolution('high', EXPOSURE) }, white: EXPOSURE ? hs.hangarExposureScale(0.85, EXPOSURE) : 1 };
    }
    const cs = await mod('lib/fly/cinema-shadows.js');
    const st = useFlyStore.getState();
    out.airframeOn = { high: cs.airframeShadowOn(st), medium: cs.airframeShadowOn({ ...st, qualityTier: 'medium', qualityPreset: 'medium' }) };
    out.reach = { high: cs.shadowReachConfig(st), medium: cs.shadowReachConfig({ ...st, qualityTier: 'medium', qualityPreset: 'medium' }) };
    // LT-3: the fleet, the path table and one simulated frame of each path.
    const tsh = await mod('lib/fly/traffic-shadows.js');
    const { DetailedTraffic } = await mod('lib/fly/detailed-traffic.js');
    const dt = new DetailedTraffic();
    out.traffic = { shadows: !!dt.shadows, groupChildren: dt.group.children.length };
    out.traffic.paths = Object.fromEntries(['dgpu', 'igpu', 'phone', 'tablet', 'software'].flatMap((cls) => ['low', 'medium', 'high'].map((tier) => [`${cls}/${tier}`, tsh.trafficShadowPath({ tier, cls })])));
    if (dt.shadows) {
      const { CINEMA_UNIFORMS } = await mod('lib/fly/cinema-frame.js');
      CINEMA_UNIFORMS.uCinema.value = 1;
      CINEMA_UNIFORMS.uCinemaKey.value.set(0.5, 0.3, 0.8).normalize();
      const sh = dt.shadows;
      const mk = (name) => {
        const m = new THREE.MeshPhysicalMaterial();
        m.userData.fleet = {};
        m.userData.fleetShared = {};
        const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(30, 10, 40), m, 8);
        mesh.name = name;
        mesh.count = 3;
        return mesh;
      };
      const [A, B, C, D] = ['A', 'B', 'C', 'D'].map(mk);
      const at = (z) => new THREE.Matrix4().makeTranslation(0, 5, -z);
      sh.begin({ tier: 'high' });
      sh.note(A, 0, 'hero', 500, at(500), 25);
      sh.note(A, 1, 'hero', 900, at(900), 25);
      sh.note(B, 0, 'mid', 1500, at(1500), 25);
      sh.note(C, 0, 'mid', 3000, at(3000), 25);
      sh.note(D, 0, 'far', 100, at(100), 25);
      sh.note(D, 1, 'mid', 9000, at(9000), 25);
      sh.end();
      const big = new THREE.OrthographicCamera(-20000, 20000, 20000, -20000, 1, 40000);
      big.position.set(0, 10000, 0);
      big.lookAt(0, 0, 0);
      big.updateMatrixWorld();
      const big2 = big.clone();
      big2.updateMatrixWorld();
      const none = new THREE.OrthographicCamera(-10, 10, 10, -10, 1, 20);
      none.position.set(50000, 10000, 50000);
      none.lookAt(50000, 0, 50000);
      none.updateMatrixWorld();
      const shot = (mesh, cam) => {
        mesh.onBeforeShadow(null, mesh, null, cam);
        const drawn = mesh.count;
        mesh.onAfterShadow(null, mesh);
        return { drawn, restored: mesh.count };
      };
      out.traffic.caster = {
        casting: [A, B, C, D].map((m) => m.castShadow),
        depth: A.customDepthMaterial?.customProgramCacheKey?.() ?? null,
        sharedDepth: A.customDepthMaterial === A.material.userData.shipShadowDepth,
        a1: shot(A, big),
        aNone: shot(A, none),
        b1: shot(B, big),
        a2: shot(A, big2),
        a1Again: shot(A, big),
        stats: { ...sh.stats },
      };
      // Next frame: one draw from last frame's pairs is reported, and a far
      // contact never makes a mesh cast.
      sh.begin({ tier: 'high' });
      sh.note(D, 0, 'mid', 9000, at(9000), 25);
      sh.end();
      out.traffic.caster.next = { stats: { ...sh.stats }, casting: [A, B, C, D].map((m) => m.castShadow) };
      // The blob path on Medium.
      useFlyStore.setState({ qualityTier: 'medium', qualityPreset: 'medium' });
      sh.begin({ tier: 'medium' });
      sh.blob({ x: 0, y: 4, z: 0, yaw: 0.3, groundY: 0, span: 35, length: 38, scale: 1, eff: 1 }, 1.3);
      sh.blob({ x: 0, y: 200, z: 0, yaw: 0, groundY: 0, span: 35, length: 38, scale: 1, eff: 1 }, 1.3);
      sh.end();
      out.traffic.blob = { stats: { ...sh.stats }, count: sh.blobs.count, alpha: sh.alpha.getX(0), key: sh.blobs.material.customProgramCacheKey(), casting: [A, B].map((m) => m.castShadow) };
      useFlyStore.setState({ qualityTier: 'high', qualityPreset: 'high' });
      // dispose() hands the meshes back (their own hooks, no depth material,
      // not armed), and a new instance arms the same meshes afresh.
      const proto = THREE.Object3D.prototype.onBeforeShadow;
      sh.dispose();
      const handedBack = [A, B].every((m) => m.onBeforeShadow === proto && m.customDepthMaterial === undefined && !m.userData.shipShadowArmed && m.material.userData.shipShadowDepth === undefined);
      const sh2 = new tsh.TrafficShadows(new THREE.Group());
      sh2.begin({ tier: 'high' });
      sh2.note(A, 0, 'hero', 500, at(500), 25);
      sh2.end();
      out.traffic.rearm = { handedBack, armed: A.onBeforeShadow !== proto && !!A.customDepthMaterial, drawn: shot(A, big).drawn };
      sh2.dispose();
    }
    const reg = await mod('lib/fly/prewarm-registry.js');
    out.prewarm = reg.prewarmEntries().filter((e) => e.stream === 'LIGHT').map((e) => {
      let keys = [];
      try {
        const built = e.build(null, null);
        const objects = Array.isArray(built) ? built : [built];
        for (const o of objects) o?.traverse?.((x) => {
          for (const m of [x.material, x.customDepthMaterial].flat()) if (m?.customProgramCacheKey) keys.push(compile(m).key);
        });
      } catch (error) {
        keys = [`THROW ${error.message}`];
      }
      return { key: e.key, when: e.when, keys };
    });
  }
  process.stdout.write(`\n@@PROBE${JSON.stringify(out)}`);
  process.exit(0);
}

// ===========================================================================
// MAIN
// ===========================================================================
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function probe(root, pins = {}, light = true) {
  const r = spawnSync(process.execPath, [import.meta.filename, `--probe=${JSON.stringify({ root, pins, light })}`], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 << 20,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  const at = (r.stdout || '').lastIndexOf('@@PROBE');
  if (r.status !== 0 || at < 0) throw new Error(`probe failed (${root}, ${JSON.stringify(pins)}): ${(r.stderr || '').split('\n').slice(-8).join(' | ')}`);
  return JSON.parse(r.stdout.slice(at + 7));
}
const count = (s, sub) => s.split(sub).length - 1;
const pinName = (name) => `__fly${name.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}Override`;
const ON = (name) => ({ [pinName(name)]: { enabled: true } });
const LIGHT = ['TERRAIN_SHADOW', 'TRAFFIC_SHADOWS', 'AIRFRAME_SHADOW', 'SHADOW_REACH', 'PHOTO_HIRES', 'HANGAR_EXPOSURE'];

// --- base snapshot ----------------------------------------------------------
const baseArg = process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? null;
let baseRef = null;
try {
  baseRef = baseArg ? execFileSync('git', ['-C', ROOT, 'merge-base', 'HEAD', baseArg], { encoding: 'utf8' }).trim() : shipPassBase(ROOT);
  if (!baseRef) throw new Error('no base');
} catch {
  try {
    baseRef = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    baseRef = null;
  }
}
const SNAP = mkdtempSync(path.join(tmpdir(), 'ship-light-base-'));
try {
  if (baseRef) {
    mkdirSync(path.join(SNAP, 'scripts'), { recursive: true });
    const tar = execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', baseRef, 'lib', 'stores', 'scripts/_node-resolve.mjs'], { maxBuffer: 256 << 20 });
    execFileSync('tar', ['-x', '-C', SNAP], { input: tar });
    symlinkSync(path.join(ROOT, 'node_modules'), path.join(SNAP, 'node_modules'), 'dir');
  }

  const { register } = await import('node:module');
  register(pathToFileURL(path.join(ROOT, 'scripts/_node-resolve.mjs')).href, import.meta.url);

  // The W0 frame: every Ship Pass flag (ship-pass.js's own table, read here
  // with no window, so its values are the SHIPPED states) and PLAYER_SURFACE
  // pinned off, `?flags=-NAME` for each. Every off arm below is W0 and every
  // flag-on arm is W0 plus its own flag(s).
  const SHIPPED = (await import('../lib/fly/ship-pass.js')).shipPassFlags();
  SHIPPED.PLAYER_SURFACE = (await import('../lib/fly/player-surface.js')).PLAYER_SURFACE_ACTIVE.enabled === true;
  const W0 = Object.fromEntries(Object.keys(SHIPPED).map((name) => [pinName(name), { enabled: false }]));
  const W0_ON = (...names) => Object.assign({ ...W0 }, ...names.map(ON));

  // =========================================================================
  // (0) FLAG-OFF IDENTITY — the earth surface (the one patched material).
  // =========================================================================
  const cur = probe(ROOT, W0);
  check('(0e) the W0 arm is pinned: it resolves every Ship Pass flag and PLAYER_SURFACE off, the six LIGHT flags among them',
    Object.keys(SHIPPED).length >= 21 && [...LIGHT, 'PLAYER_SURFACE'].every((f) => f in cur.flags) && Object.values(cur.flags).every((v) => v === false), JSON.stringify(cur.flags));
  if (baseRef && existsSync(path.join(SNAP, 'lib/fly/r25-ground.js'))) {
    const base = probe(SNAP, W0, false);
    check('(0a) flags off: the terrain program key equals the base tree', cur.earth.key === base.earth.key, `${baseRef.slice(0, 7)} ${base.earth.key.slice(-40)}`);
    check('(0b) flags off: terrain fragment + vertex text sha256 equal the base tree', cur.earth.frag === base.earth.frag && cur.earth.vert === base.earth.vert, `frag ${cur.earth.frag} vs ${base.earth.frag}`);
  } else check('(0a) base snapshot available', false, `no base for ${baseArg}`);
  check('(0c) flags off: no terrain-shadow mode, no ts token, no ts uniforms', cur.mode === null && !cur.earth.key.includes('|ts-') && !cur.earth.uniforms.some((u) => u.startsWith('uTs')));
  check('(0d) flags off: airframe receive and Medium reach are inert', cur.airframeOn.high === false && cur.airframeOn.medium === false && cur.reach.high === null && cur.reach.medium === null);

  // =========================================================================
  // (1) LT-2 TERRAIN_SHADOW — the anchored patch, both paths.
  // =========================================================================
  const map = probe(ROOT, { ...W0_ON('TERRAIN_SHADOW'), __flyLightDeviceClass: 'dgpu' });
  const hor = probe(ROOT, { ...W0_ON('TERRAIN_SHADOW'), __flyLightDeviceClass: 'phone' });
  const soft = probe(ROOT, { ...W0_ON('TERRAIN_SHADOW'), __flyLightDeviceClass: 'software' });
  check('(1a) desktop path is the depth map, touch is the horizon map, software is refused', map.mode === 'map' && hor.mode === 'horizon' && soft.mode === null, `${map.mode}/${hor.mode}/${soft.mode}`);
  check('(1b) flag on: the key is the flag-off key plus one path token', map.earth.key.replace('|ts-map-v1', '') === cur.earth.key && hor.earth.key.replace('|ts-horizon-v1', '') === cur.earth.key
    && count(map.earth.key, '|ts-map-v1') === 1 && count(hor.earth.key, '|ts-horizon-v1') === 1, map.earth.key.slice(-60));
  for (const [name, arm] of [['map', map], ['horizon', hor]]) {
    const t = arm.earth.text;
    check(`(1c) ${name}: receiver declared once, applied once to direct light only`,
      count(t, 'float terrainShadowLit(') === 1 && count(t, 'earthTerrainLit=terrainShadowLit(') === 1
        && count(t, 'reflectedLight.directDiffuse*=earthTerrainLit;') === 1 && count(t, 'reflectedLight.directSpecular*=earthTerrainLit;') === 1
        && !/indirect\w*\*=earthTerrainLit/.test(t));
    check(`(1d) ${name}: the light term follows lights_fragment_end and the water term precedes coastWeight`,
      t.indexOf('earthTerrainLit=terrainShadowLit(') > t.indexOf('#include <lights_fragment_end>') && t.indexOf('water*=mix(1.,mix(.62,1.,earthTerrainLit),day);') < t.indexOf('float coastWeight='));
    check(`(1e) ${name}: shared receiver uniforms bound`, ['uTsMap', 'uTsMatrix', 'uTsParams', 'uTsLight'].every((u) => arm.earth.uniforms.includes(u)));
  }
  // The flag-on text minus the patch is the flag-off text: nothing else moved.
  {
    const t = await import('../lib/fly/terrain-shadow.js');
    const strip = (text, mode) => text.replace(t.terrainShadowGLSL(mode), '').replace(t.TS_LIGHT_TERM, '').replace(t.TS_WATER_TERM, '');
    const offText = cur.earth.text;
    const a = strip(map.earth.text, 'map'), b = strip(hor.earth.text, 'horizon');
    check('(1f) the patch is purely additive: stripped flag-on text equals flag-off text (both paths)', sha(a) === sha(offText) && sha(b) === sha(offText), `${sha(a)} ${sha(b)} vs ${sha(offText)}`);
  }
  {
    const d = map.depth;
    check('(1g) depth material: world-bend bent, packed linear light depth, own key', d.key.includes('world-bend') && d.key.endsWith('|terrain-shadow-depth-v1')
      && d.vert.includes('wPos.y -= bendD * bendD * uBendK;') && d.vert.includes('vTsDepth = -mvPosition.z;') && d.frag.includes('fract(v * vec3(1., 255., 65025.))'));
  }

  // Pure geometry and the receiver math, in process (flags are irrelevant here).
  const THREE = await import('three');
  const ts = await import('../lib/fly/terrain-shadow.js');
  {
    // anchors throw on a miss and on a repeat (the city-facades idiom)
    let miss = false, repeat = false;
    try { ts.once('abc', 'x', 'y', 't'); } catch { miss = true; }
    try { ts.once('aa', 'a', 'y', 't'); } catch { repeat = true; }
    let patchMiss = false;
    try { ts.applyTerrainShadowPatch({ fragmentShader: 'void main(){}', vertexShader: '', uniforms: {} }, 'map'); } catch { patchMiss = true; }
    check('(1h) anchors throw on a missing or repeated anchor (and the patch on foreign text)', miss && repeat && patchMiss);
  }
  {
    // packing round trip at 24 bits
    let worst = 0;
    for (let i = 0; i <= 2000; i++) {
      const v = (i / 2000) * 0.999999;
      worst = Math.max(worst, Math.abs(ts.unpackDepth(ts.packDepth(v)) - v));
    }
    check('(1i) RGB depth packing round-trips within 2^-23 over [0,1)', worst < 1.2e-7, `worst ${worst.toExponential(2)}`);
  }
  {
    // texel snap: static terrain keeps its texel as the centre moves
    const L = new THREE.Vector3(0.6, 0.087, 0.79).normalize();
    const basis = ts.lightBasis(L);
    const ortho = Math.abs(basis.R.dot(basis.F)) < 1e-9 && Math.abs(basis.U.dot(basis.F)) < 1e-9 && Math.abs(basis.R.dot(basis.U)) < 1e-9 && Math.abs(basis.R.y) < 1e-12;
    const size = 2048, rangeS = 40000, span = 3000;
    const tx = (2 * rangeS) / size, ty = (2 * (Math.abs(basis.F.y) * rangeS + Math.hypot(basis.F.x, basis.F.z) * span)) / size;
    const point = new THREE.Vector3(5321.7, 812.3, -2210.4);
    let stable = true;
    let texel0 = null;
    for (let i = 0; i < 40; i++) {
      const P = new THREE.Vector3(100 + i * 7.3, 600, -40 + i * 3.1);
      const S = ts.snapToTexels(P, basis, tx, ty);
      const frame = ts.mapFrame(S, basis, rangeS, span, 12000);
      const M = ts.mapMatrix(frame, basis);
      const c = point.clone().applyMatrix4(M);
      const tex = [Math.floor(c.x * size), Math.floor(c.y * size)];
      const frac = [c.x * size - tex[0], c.y * size - tex[1]];
      if (texel0 === null) texel0 = { frac };
      else if (Math.abs(frac[0] - texel0.frac[0]) > 1e-6 || Math.abs(frac[1] - texel0.frac[1]) > 1e-6) stable = false;
    }
    check('(1j) light basis is orthonormal with a horizontal R; snapping keeps a static point on the same sub-texel phase', ortho && stable);
  }
  {
    // the map matrix: centre -> (0.5, 0.5); edges -> 0/1; depth linear in F
    const L = new THREE.Vector3(-0.3, 0.5, 0.4).normalize();
    const basis = ts.lightBasis(L);
    const P = new THREE.Vector3(10, 200, 20);
    const frame = ts.mapFrame(P, basis, 1000, 500, 300);
    const M = ts.mapMatrix(frame, basis);
    const at = (v) => v.clone().applyMatrix4(M);
    const c = at(P), e = at(P.clone().addScaledVector(basis.R, 1000));
    const z1 = at(P.clone().addScaledVector(basis.F, 100)).z - c.z;
    check('(1k) map matrix: centre at uv 0.5, reach at the edge, depth grows along the light', Math.abs(c.x - 0.5) < 1e-9 && Math.abs(c.y - 0.5) < 1e-9 && Math.abs(e.x - 1) < 1e-9 && Math.abs(z1 - 100 / (frame.far - frame.near)) < 1e-9 && c.z > 0 && c.z < 1);
    // every ground point of the reach lies inside the light box
    let inside = true;
    for (let a = 0; a < 64; a++) for (const h of [-500, 0, 500]) {
      const q = at(P.clone().add(new THREE.Vector3(Math.cos(a / 10) * 999, h, Math.sin(a / 10) * 999)));
      if (q.x < 0 || q.x > 1 || q.y < 0 || q.y > 1 || q.z < 0 || q.z > 1) inside = false;
    }
    check('(1l) the light box holds the whole reach at +/- the height span', inside);
  }
  {
    // the horizon march: flat is lit; a ridge toward the light shadows the lee
    const n = 32, flat = new Float32Array(n * n).fill(100);
    const lit0 = ts.marchLit(flat, n, 16, 16, 1, 0, 50, Math.tan((5 * Math.PI) / 180), 30, 100);
    const ridge = flat.slice();
    for (let j = 0; j < n; j++) ridge[j * n + 20] = 600; // a 500 m wall 4 cells toward +x
    const tan5 = Math.tan((5 * Math.PI) / 180);
    const behind = ts.marchLit(ridge, n, 16, 16, 1, 0, 50, tan5, 30, 600);
    const away = ts.marchLit(ridge, n, 16, 16, -1, 0, 50, tan5, 30, 600);
    const high = ts.marchLit(ridge, n, 16, 16, 1, 0, 50, Math.tan((80 * Math.PI) / 180), 30, 600);
    const unknown = new Float32Array(n * n).fill(NaN);
    check('(1m) horizon march: flat lit, ridge toward a 5 deg sun shadows, away or high sun lit, unknown never occludes',
      lit0 === 1 && behind === 0 && away === 1 && high === 1 && ts.marchLit(unknown, n, 3, 3, 1, 0, 50, tan5, 30, 0) === 1,
      `${lit0} ${behind} ${away} ${high}`);
  }

  {
    // The horizon map end to end (a stub sampler over a ridge): it fills,
    // marches, lights the sun side and shadows the lee; a small move keeps the
    // grid (hysteresis) and the lit texture stays where it was marched.
    const hm = new ts.HorizonShadowMap(32);
    const ridgeAt = (x) => (Math.abs(x - 2000) < 400 ? 900 : 0); // a N-S wall at x = 2 km
    const sampler = { sample: (lon) => ({ elev: ridgeAt(lon) }) };
    const engine = { worldToGeo: (p) => ({ x: p.x, y: p.z }) };
    const L = new THREE.Vector3(1, Math.tan((6 * Math.PI) / 180), 0).normalize(); // sun low in +x
    const ctx = (now, x = 0) => ({ engine, sampler, player: { x, y: 500, z: 0 }, anchor: { x: 0, z: 0 }, L, k: 1, rangeM: 8000, hz: 1, now, epoch: 1, block: { horizonBudgetMs: 1000, horizonSoftM: 30, horizonResampleSec: 8 } });
    for (let i = 0; i < 6 && !hm.valid; i++) hm.update(ctx(i));
    const n = 32, cell = hm.litCell, ox = hm.litOrigin.x;
    const litAt = (x) => hm.lit[16 * n + Math.floor((x - ox) / cell)] / 255;
    const lee = litAt(500), sunSide = litAt(3500), behindFar = litAt(-7000);
    const origin0 = hm.origin.x;
    hm.update(ctx(1.2, 600)); // a few cells: inside the hysteresis band
    check('(1n) horizon map: fills from the sampler, the lee of a 900 m wall under a 6 deg sun is dark, the sun side lit',
      hm.valid && hm.stats.sampled === n * n && lee === 0 && sunSide === 1 && behindFar === 1 && hm.origin.x === origin0, `lee ${lee} sun ${sunSide} far ${behindFar}`);
    const u = { uTsMatrix: { value: new THREE.Matrix4() }, uTsMap: { value: null }, uTsParams: { value: new THREE.Vector4() }, uTsLight: { value: new THREE.Vector3() } };
    hm.bind(u, { x: 0, z: 0 }, 1);
    const c = new THREE.Vector3(ox + cell * 0.5, 0, hm.litOrigin.y + cell * 0.5).applyMatrix4(u.uTsMatrix.value);
    check('(1o) horizon bind: the first cell centre maps to uv (0.5/n, 0.5/n), the texture is the lit grid', Math.abs(c.x - 0.5 / n) < 1e-9 && Math.abs(c.y - 0.5 / n) < 1e-9 && u.uTsMap.value === hm.texture && u.uTsParams.value.x === 1);
  }

  // The 16-unit fragment sampler ceiling. ANGLE on D3D11 (Chrome on Windows,
  // the owner's RTX 5080) and iPhone WebGL2 both expose 16 fragment texture
  // units, and SwiftShader may expose more, so a venue link proves nothing
  // here. The upper bound: every custom sampler the patched earth fragment
  // REFERENCES (a declared-only one is compiled out), plus three's map and
  // envMap (satellite imagery, the Enhanced environment) and one shadow map
  // per cascade at the class's largest profile (desktop Ultra, phone).
  // TERRAIN_SHADOW adds one (uTsMap); another stream adding a sampler to the
  // earth chain on the merged tree turns this row (and the shipped (S3)) red.
  const { CINEMA_PROFILES } = await import('../lib/fly/cinema-profile.js');
  const desktopCascades = Math.max(...['ultra', 'high', 'medium'].map((p) => CINEMA_PROFILES[p].cascades));
  const census = (text, cascades) => {
    const names = [...text.matchAll(/^\s*uniform\s+(?:(?:lowp|mediump|highp)\s+)?sampler\w*\s+(\w+)/gm)].map((m) => m[1]);
    // three's own optional maps sit in #ifdef blocks the live tile never
    // defines (specularColorMap, sheenColorMap, ...), so only custom names count.
    const custom = [...new Set(names)].filter((n) => /^u[A-Z]/.test(n) && count(text, n) > 1);
    return { custom, total: custom.length + 2 + cascades };
  };
  {
    const off = census(cur.earth.text, desktopCascades), on = census(map.earth.text, desktopCascades), ph = census(hor.earth.text, CINEMA_PROFILES.phone.cascades);
    check('(1p) earth fragment samplers stay within 16 units with the flag on (desktop Ultra cascades, phone)',
      on.total <= 16 && ph.total <= 16 && on.total === off.total + 1 && on.custom.includes('uTsMap'),
      `desktop off ${off.total} -> on ${on.total} (${on.custom.length} custom + map + envMap + ${desktopCascades} cascades), phone on ${ph.total}`);
  }

  // =========================================================================
  // (4) LT-4 AIRFRAME_SHADOW and (5) LT-5 SHADOW_REACH.
  // =========================================================================
  const cs = await import('../lib/fly/cinema-shadows.js');
  {
    const breaks = cs.airframeSplits(3, 0.5, 3000, 45);
    const ok = breaks.length === 3 && Math.abs(breaks[0] - 45 / 3000) < 1e-12 && breaks[2] === 1 && breaks[1] > breaks[0] && breaks[1] < 1;
    const single = cs.airframeSplits(1, 0.5, 3000, 45);
    check('(4a) airframe split pins cascade 0 at the fit and splits the rest practically; one cascade is untouched', ok && single.length === 1 && single[0] === 1, JSON.stringify(breaks.map((b) => +b.toFixed(4))));
    const cfg = { fitPad: 1.6, minFitM: 40, maxFitFrac: 0.35 };
    const b = cs.airframeShadowBreak({ distM: 30, lengthM: 15, rangeM: 3000, cameraMode: 'chase', cascades: 3 }, cfg);
    const big = cs.airframeShadowBreak({ distM: 120, lengthM: 70, rangeM: 3000, cameraMode: 'photo', cascades: 3 }, cfg);
    const off = [
      cs.airframeShadowBreak({ distM: 30, lengthM: 15, rangeM: 3000, cameraMode: 'cinema', cascades: 3 }, cfg),
      cs.airframeShadowBreak({ distM: 30, lengthM: 15, rangeM: 3000, cameraMode: 'chase', cascades: 1 }, cfg),
      cs.airframeShadowBreak({ distM: NaN, lengthM: 15, rangeM: 3000, cameraMode: 'chase', cascades: 3 }, cfg),
    ];
    check('(4b) fit = camera distance + pad x half-length, clamped; other views / one cascade / no pose: none', b === 42 && Math.abs(big - 176) < 1e-9 && off.every((x) => x === null), `${b} ${big}`);
    const bias = [cs.airframeNormalBias(0.03), cs.airframeNormalBias(10), cs.airframeNormalBias(0.0001), cs.airframeNormalBias(0)];
    check('(4c) cascade-0 normal bias follows its texels, clamped [0.02, 0.65]', Math.abs(bias[0] - 0.045) < 1e-12 && bias[1] === 0.65 && bias[2] === 0.02 && bias[3] === 0.65);
    check('(4d) refit hysteresis', cs.airframeRefit(null, 50) && cs.airframeRefit(50, null) && !cs.airframeRefit(null, null) && !cs.airframeRefit(50, 54) && cs.airframeRefit(50, 60));
  }
  {
    const on = probe(ROOT, { ...W0_ON('AIRFRAME_SHADOW', 'SHADOW_REACH'), __flyLightDeviceClass: 'dgpu' });
    const phone = probe(ROOT, { ...W0_ON('AIRFRAME_SHADOW', 'SHADOW_REACH'), __flyLightDeviceClass: 'phone' });
    check('(4e) airframe receive: High/Ultra desktop only (not Medium, not phones)', on.airframeOn.high === true && on.airframeOn.medium === false && phone.airframeOn.high === false);
    check('(5a) reach: Medium desktop only (not High, not touch)', on.reach.high === null && on.reach.medium?.shadowMaxRangeM === 1200 && phone.reach.medium === null);
    check('(4f) program keys never move with the airframe/reach flags (uniform-only features)', on.earth.key === cur.earth.key && on.earth.frag === cur.earth.frag);
  }
  {
    const me = await import('../lib/fly/mobile-enhanced.js');
    const cfg = { shadowMaxRangeM: 1200, shadowAglScale: 1.6, shadowPaddingM: 180 };
    check('(5b) Medium at 900 m AGL shadows to the 1.2 km ceiling; ground level keeps the 600 m profile', me.mobileShadowRange(600, 900, cfg) === 1200 && me.mobileShadowRange(600, 0, cfg) === 600 && me.mobileShadowRange(600, 300, cfg) === 660);
  }
  // =========================================================================
  // (3) LT-3 TRAFFIC_SHADOWS.
  // =========================================================================
  let trafficOn = null, prewarmOn = null; // the pinned-on arms, for the shipped rows
  {
    check('(3a) flags off: the live fleet builds no shadow system (today\'s meshes and draws)', cur.traffic.shadows === false && cur.traffic.groupChildren === 0);
    const on = probe(ROOT, { ...W0_ON('TRAFFIC_SHADOWS'), __flyLightDeviceClass: 'dgpu' });
    trafficOn = on;
    const p = on.traffic.paths;
    check('(3b) paths: desktop High casts, desktop Medium/Low and touch get blobs, software none',
      p['dgpu/high'] === 'caster' && p['igpu/high'] === 'caster' && p['dgpu/medium'] === 'blob' && p['phone/high'] === 'blob' && p['tablet/medium'] === 'blob' && p['software/high'] === null && cur.traffic.paths['dgpu/high'] === null,
      JSON.stringify(p));
    const c = on.traffic.caster;
    check('(3c) casters: the two nearest in-range meshes cast; out-of-range and far-LOD never', c.casting.join() === 'true,true,false,false', c.casting.join());
    check('(3d) casters use the fleet depth material, one per family material', c.depth === 'fleet-airframe-v2|depth' && c.sharedDepth === true);
    check('(3e) each caster draws only its in-range instance prefix, and its count is restored after the shadow draw', c.a1.drawn === 2 && c.a1.restored === 3 && c.b1.drawn === 1 && c.b1.restored === 3);
    check('(3f) a cascade the casters do not touch draws nothing; the per-frame pair budget (2) is never exceeded', c.aNone.drawn === 0 && c.a2.drawn === 0 && c.a1Again.drawn === 2 && c.stats.castInstances === 3);
    check('(3g) next frame: last frame\'s shadow draws are reported (2 <= budget) and a far contact stops all casting', c.next.stats.shadowDraws === 2 && c.next.casting.join() === 'false,false,false,false');
    const b = on.traffic.blob;
    check('(3j) dispose hands the meshes back (prototype hooks, no depth material) and a new instance re-arms them',
      on.traffic.rearm?.handedBack === true && on.traffic.rearm?.armed === true && on.traffic.rearm?.drawn === 1, JSON.stringify(on.traffic.rearm));
    check('(3h) blobs: one instanced draw, below the AGL ceiling only, casters released on the blob path', b.count === 1 && b.stats.blobs === 1 && b.casting.join() === 'false,false' && b.key.endsWith('|traffic-blob-v1') && b.key.includes('world-bend'));
    const tsh = await import('../lib/fly/traffic-shadows.js');
    const cfg = { opacity: 0.5, spanPad: 1, lengthPad: 1, sunStretchMax: 2.5, liftM: 0.3 };
    const sun = new THREE.Vector3(1, Math.tan((10 * Math.PI) / 180), 0).normalize();
    const touch = tsh.blobPose({ x: 0, y: 0, z: 0, yaw: 0, groundY: 0, span: 30, length: 40 }, sun, 60, cfg);
    const mid = tsh.blobPose({ x: 0, y: 10, z: 0, yaw: 0, groundY: 0, span: 30, length: 40 }, sun, 60, cfg);
    const low = tsh.blobPose({ x: 0, y: 50, z: 0, yaw: 0, groundY: 0, span: 30, length: 40 }, new THREE.Vector3(1, 0.01, 0).normalize(), 60, cfg);
    check('(3i) blob math: full at the wheels, falls away from the light by agl/tan(el), capped at sunStretchMax lengths, gone at the ceiling',
      touch.alpha === 0.5 && touch.x === 0 && Math.abs(mid.x + 10 / Math.tan((10 * Math.PI) / 180)) < 1e-6 && Math.abs(mid.alpha - 0.5 * (50 / 60) ** 2) < 1e-12
        && Math.abs(low.x + 100) < 1e-9 && tsh.blobPose({ x: 0, y: 61, z: 0, groundY: 0, span: 1, length: 1 }, sun, 60, cfg) === null && tsh.blobPose({ x: 0, y: 1, z: 0, groundY: NaN, span: 1, length: 1 }, sun, 60, cfg) === null,
      `${mid.x.toFixed(2)} ${low.x}`);
  }

  // =========================================================================
  // (6) LT-6 PHOTO_HIRES.
  // =========================================================================
  {
    const ph = await import('../lib/fly/photo-hires.js');
    const block = { scale: 3, minLongPx: 2560, maxTiles: 16 };
    const desk = ph.photoExportPlan({ bufW: 1920, bufH: 1080, request: 'auto', budget: { maxScale: 3, maxLongPx: 4096 }, block, limits: { maxTexture: 16384, maxRenderbuffer: 16384, maxViewport: [16384, 16384] } });
    const tblock = { ...block, touchScale: 2 };
    const phone2 = ph.photoExportPlan({ bufW: 585, bufH: 1266, request: 'auto', budget: { maxScale: 2, maxLongPx: 4096 }, block: tblock, touch: true });
    const phone3 = ph.photoExportPlan({ bufW: 585, bufH: 1266, request: 'auto', budget: { maxScale: 3, maxLongPx: 4096 }, block: tblock, touch: true });
    const desk3 = ph.photoExportPlan({ bufW: 585, bufH: 1266, request: 'auto', budget: { maxScale: 3, maxLongPx: 4096 }, block: tblock });
    const odd = [977, 1170, 1279, 1333, 1266].map((L) => ph.photoExportPlan({ bufW: Math.round(L * 0.46), bufH: L, request: 'auto', budget: { maxScale: 3, maxLongPx: 4096 }, block: tblock, touch: true }).outH - Math.max(2560, 2 * L));
    const one = [ph.photoExportPlan({ bufW: 800, bufH: 600, request: undefined, budget: { maxScale: 3 }, block }), ph.photoExportPlan({ bufW: 800, bufH: 600, request: 1, budget: { maxScale: 3 }, block })];
    const tiled = ph.photoExportPlan({ bufW: 2000, bufH: 1000, request: 2, budget: { maxScale: 3, maxLongPx: 4096 }, block, limits: { maxTexture: 2048, maxRenderbuffer: 2048, maxViewport: [2048, 2048] } });
    const bounded = ph.photoExportPlan({ bufW: 2000, bufH: 1000, request: 2, budget: { maxScale: 3, maxLongPx: 4096 }, block: { ...block, maxTiles: 1 }, limits: { maxTexture: 2048 } });
    check('(6a) desktop: 2-3x up to the 4,096 px long side, one offscreen render', desk.outW === 4096 && desk.outH === 2304 && desk.tiles === 1 && Math.abs(desk.scale - 4096 / 1920) < 1e-12, JSON.stringify(desk));
    check('(6b) phone: touch aims at touchScale 2, raised to exactly 2,560 px only where the policy allows (maxScale 2 -> 2,532; maxScale 3 -> 2,560; non-touch 3x -> 3,798; never under 2,560 to a float floor)',
      phone2.outH === 2532 && phone3.outH === 2560 && desk3.outH === 3798 && odd.every((d) => d === 0), `${phone2.outH} ${phone3.outH} ${desk3.outH} ${odd.join(',')}`);
    check('(6c) no request or scale 1: the drawing buffer exactly (verify-photo\'s contract)', one.every((o) => o.scale === 1 && o.outW === 800 && o.outH === 600 && o.tiles === 1));
    check('(6d) past MAX_TEXTURE_SIZE the export is tiled; the tile bound shrinks it rather than exceed', tiled.tiles === 2 && tiled.outW === 4000 && tiled.tileW <= 2048 && bounded.tiles === 1 && bounded.outW <= 2048, `${JSON.stringify(tiled)} ${JSON.stringify(bounded)}`);
    {
      // tiles: the tile's corners of the full frame land on the viewport's
      // corners (top-left tile first, as the 2D canvas is drawn)
      const P = new THREE.Matrix4().makePerspective(-1, 1, 0.6, -0.6, 1, 1000);
      const ndc = (M, v) => v.clone().applyMatrix4(M);
      const T = ph.photoTileMatrix(2, 0, 0, new THREE.Matrix4());
      const M = new THREE.Matrix4().multiplyMatrices(T, P);
      const topLeft = new THREE.Vector3(-1, 0.6, -1), centre = new THREE.Vector3(0, 0, -1);
      const a = ndc(M, topLeft), b = ndc(M, centre);
      const T2 = ph.photoTileMatrix(2, 1, 1, new THREE.Matrix4());
      const c = ndc(new THREE.Matrix4().multiplyMatrices(T2, P), centre);
      check('(6h) tile matrix: the top-left tile maps the frame corner to (-1, 1) and the centre to (1, -1); the bottom-right tile the centre to (-1, 1)',
        Math.abs(a.x + 1) < 1e-9 && Math.abs(a.y - 1) < 1e-9 && Math.abs(b.x - 1) < 1e-9 && Math.abs(b.y + 1) < 1e-9 && Math.abs(c.x + 1) < 1e-9 && Math.abs(c.y - 1) < 1e-9);
    }
    let rejected = false;
    try { await ph.capturePhoto({ scale: 2 }); } catch { rejected = true; }
    check('(6e) capturePhoto({scale}) -> Promise<Blob> rejects cleanly with no camera registered', rejected && ph.capturePhoto.length <= 1);
    const src = (await import('node:fs')).readFileSync(path.join(ROOT, 'components/fly/PhotoCapture.jsx'), 'utf8').replace(/\r\n/g, '\n');
    check('(6f) capture holds the governor (frame-api), emits track(\'photo_taken\'), keeps the watermark, restores pixel ratio + composer',
      src.includes("holdGovernor('photo-hires')") && src.includes("track('photo_taken')") && src.includes('drawWatermark(ctx, w, h, mapStyle)') && /finally \{[\s\S]*gl\.setPixelRatio\(pr\);[\s\S]*composer\.setSize\(css\.x, css\.y\);[\s\S]*composer\.render\(0\)/.test(src));
    const off = probe(ROOT, W0);
    check('(6g) flags off: no hi-res path (the action ignores scale)', off.photoActive === false);
  }

  // =========================================================================
  // (7) LT-7 HANGAR_EXPOSURE.
  // =========================================================================
  {
    const hs = await import('../components/fly/hud/hangar-stage.js');
    const cfg = { targetLuma: 0.42, minScale: 0.55, maxScale: 1, reflectorScale: 0.5 };
    check('(7a) exposure: a white livery dims (clamped 0.55), mid grey keeps today, a dark one never brightens',
      hs.hangarExposureScale(0.85, cfg) === 0.55 && hs.hangarExposureScale(0.42, cfg) === 1 && hs.hangarExposureScale(0.1, cfg) === 1 && Math.abs(hs.hangarExposureScale(0.6, cfg) - 0.7) < 1e-12);
    check('(7b) reflector: flag off 1024/512 (today); on, Medium halves (256), High keeps 1024', hs.hangarReflectorResolution('high', null) === 1024 && hs.hangarReflectorResolution('medium', null) === 512 && hs.hangarReflectorResolution('medium', cfg) === 256 && hs.hangarReflectorResolution('high', cfg) === 1024);
    const root = new THREE.Group();
    const white = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    const vc = new THREE.BoxGeometry(1, 1, 1);
    vc.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vc.attributes.position.count * 3).fill(0.2), 3));
    const tinted = new THREE.Mesh(vc, new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true }));
    root.add(white, tinted);
    const l = hs.liveryLuminance(root);
    const painted = new THREE.Group();
    painted.userData.fleetPaint = { uniforms: { uFleetPaintOn: { value: 1 }, uFleetHull: { value: new THREE.Color(1, 1, 1) }, uFleetTrim: { value: new THREE.Color(0, 0, 0) }, uFleetAccent: { value: new THREE.Color(0, 0, 0) } } };
    check('(7c) livery luminance: area-weighted material x vertex colour; a paint preset reads its hull', Math.abs(l - 0.6) < 1e-6 && Math.abs(hs.liveryLuminance(painted) - 0.75) < 1e-12 && hs.liveryLuminance(new THREE.Group()) === 0.5, l.toFixed(4));
    const hsrc = (await import('node:fs')).readFileSync(path.join(ROOT, 'components/fly/hud/HangarScene.jsx'), 'utf8');
    check('(7d) hangar: flag off = no exposure state read (EXPOSURE null) and today\'s reflector size', hsrc.includes("const EXPOSURE = shipPassOn('HANGAR_EXPOSURE') ? lightBlock('HANGAR_EXPOSURE') : null;") && hsrc.includes('const exposure=EXPOSURE&&liveryLuma!==null?hangarExposureScale(liveryLuma,EXPOSURE):1;'));
    check('(7e) flags off (W0, pinned): the gate line yields no exposure block, today\'s 512 / 1024 reflector, a white livery at today\'s light',
      cur.hangar.exposure === false && cur.hangar.reflector.medium === 512 && cur.hangar.reflector.high === 1024 && cur.hangar.white === 1, JSON.stringify(cur.hangar));
  }

  // =========================================================================
  // (8) Prewarm: every new LIGHT program variant is registered.
  // =========================================================================
  {
    const all = probe(ROOT, { ...W0_ON('TERRAIN_SHADOW', 'TRAFFIC_SHADOWS'), __flyLightDeviceClass: 'dgpu' });
    prewarmOn = all;
    const by = Object.fromEntries(all.prewarm.map((e) => [e.key, e]));
    const keys = all.prewarm.flatMap((e) => e.keys);
    check('(8a) four LIGHT entries, each gated on its flag', ['LIGHT:terrain-shadowed-earth', 'LIGHT:terrain-shadow-depth', 'LIGHT:traffic-caster', 'LIGHT:traffic-blob'].every((k) => by[k]) && all.prewarm.every((e) => e.when.flags?.length === 1), Object.keys(by).join(','));
    check('(8b) the builds carry the live keys: patched earth, terrain depth, fleet + fleet depth, blob',
      keys.some((k) => k.includes('|ts-map-v1')) && keys.some((k) => k.endsWith('|terrain-shadow-depth-v1')) && keys.includes('fleet-airframe-v2|depth') && keys.some((k) => k.includes('fleet-airframe-v2')) && keys.some((k) => k.endsWith('|traffic-blob-v1')) && !keys.some((k) => k.startsWith('THROW')), keys.filter((k) => k.startsWith('THROW')).join(' '));
    check('(8c) the live earth key equals the prewarm earth key (same chain, same session decision)', keys.includes(map.earth.key));
  }

  // =========================================================================
  // (9) Provides: requestShadowCasters() (FLY_SHIP_PASS.md 5.4).
  // =========================================================================
  {
    const cs = await import('../lib/fly/cinema-shadows.js');
    const parent = new THREE.Object3D();
    const objs = [0, 1, 2].map(() => { const o = new THREE.Object3D(); parent.add(o); return o; });
    objs[1].castShadow = true; // an object that already casts keeps its own value on release
    const orphan = new THREE.Object3D();
    const release = cs.requestShadowCasters('gate', [...objs, orphan], { max: 2 });
    const on = cs.applyShadowCasterRequests(true);
    const armed = objs.map((o) => o.castShadow);
    const offN = cs.applyShadowCasterRequests(false);
    const parked = objs.map((o) => o.castShadow);
    cs.applyShadowCasterRequests(true);
    release();
    const restored = objs.map((o) => o.castShadow);
    const empty = cs.applyShadowCasterRequests(true);
    check('(9a) requestShadowCasters: bounded casters while the cascades exist, parked without them, scene-only',
      on === 2 && armed.join() === 'true,true,false' && orphan.castShadow === false && offN === 0 && parked.join() === 'false,true,false', `${on} ${armed} ${parked}`);
    check('(9b) release restores each object\'s own castShadow; no request = nothing touched', restored.join() === 'false,true,false' && empty === 0 && objs.every((o) => o.userData.shipCastPrev === undefined));
  }

  // =========================================================================
  // (S) SHIPPED DEFAULT — no flag pins at all (the device class is pinned,
  // which is not a flag): what a player gets since the merge to main.
  // =========================================================================
  {
    const desk = probe(ROOT, { __flyLightDeviceClass: 'dgpu' });
    const phone = probe(ROOT, { __flyLightDeviceClass: 'phone' });
    check('(S1) shipped default: TERRAIN_SHADOW, TRAFFIC_SHADOWS, AIRFRAME_SHADOW, SHADOW_REACH, PHOTO_HIRES and HANGAR_EXPOSURE ship on (owner, merge to main 2026-10-30)',
      LIGHT.every((f) => SHIPPED[f] === true && desk.flags[f] === true && phone.flags[f] === true), LIGHT.map((f) => `${f}=${SHIPPED[f]}`).join(' '));
    check('(S2) shipped default earth: desktop the depth map, touch the horizon map, each exactly the pinned TERRAIN_SHADOW arm (key, fragment, vertex), so the W0 key plus one token and the W0 text plus the patch',
      desk.mode === 'map' && phone.mode === 'horizon'
        && desk.earth.key === map.earth.key && desk.earth.frag === map.earth.frag && desk.earth.vert === map.earth.vert
        && phone.earth.key === hor.earth.key && phone.earth.frag === hor.earth.frag && phone.earth.vert === hor.earth.vert,
      `${desk.mode}/${phone.mode} ${desk.earth.frag} vs ${map.earth.frag}, ${phone.earth.frag} vs ${hor.earth.frag}`);
    const sd = census(desk.earth.text, desktopCascades), sp = census(phone.earth.text, CINEMA_PROFILES.phone.cascades);
    check('(S3) shipped default: earth fragment samplers stay within 16 units (desktop Ultra cascades, phone)', sd.total <= 16 && sp.total <= 16 && sd.custom.includes('uTsMap') && sp.custom.includes('uTsMap'),
      `desktop ${sd.total}, phone ${sp.total}`);
    check('(S4) shipped default: airframe receive on High/Ultra desktop only, the Medium-desktop reach to 1.2 km, neither on touch',
      desk.airframeOn.high === true && desk.airframeOn.medium === false && phone.airframeOn.high === false && desk.reach.high === null && desk.reach.medium?.shadowMaxRangeM === 1200 && phone.reach.medium === null);
    check('(S5) shipped default: the live fleet builds the shadow system, with the pinned-on arm\'s path table and simulated caster / blob / re-arm frames',
      desk.traffic.shadows === true && desk.traffic.groupChildren === trafficOn?.traffic.groupChildren && desk.traffic.paths['dgpu/high'] === 'caster'
        && JSON.stringify(desk.traffic.paths) === JSON.stringify(trafficOn?.traffic.paths) && JSON.stringify(desk.traffic.caster) === JSON.stringify(trafficOn?.traffic.caster)
        && JSON.stringify(desk.traffic.blob) === JSON.stringify(trafficOn?.traffic.blob) && JSON.stringify(desk.traffic.rearm) === JSON.stringify(trafficOn?.traffic.rearm),
      `shadows ${desk.traffic.shadows} children ${desk.traffic.groupChildren}`);
    check('(S6) shipped default: the hi-res photo path is live; the hangar reads its exposure block (a white livery dims to 0.55, Medium reflector 256, High 1024)',
      desk.photoActive === true && desk.hangar.exposure === true && desk.hangar.white === 0.55 && desk.hangar.reflector.medium === 256 && desk.hangar.reflector.high === 1024, JSON.stringify(desk.hangar));
    const keys = desk.prewarm.flatMap((e) => e.keys);
    check('(S7) shipped default: the LIGHT prewarm builds carry the shipped live earth key and the pinned arm\'s keys, none throws',
      keys.includes(desk.earth.key) && JSON.stringify(desk.prewarm) === JSON.stringify(prewarmOn?.prewarm) && !keys.some((k) => k.startsWith('THROW')));
  }
} finally {
  rmSync(SNAP, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

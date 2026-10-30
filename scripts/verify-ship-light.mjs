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
 * (sha256). The base is the merge-base with --base (default main); on a tree
 * that IS main (after the lead's merge) the comparison is to itself and still
 * holds the flag-on rows to their anchors.
 *
 * FLAG ARMS run as child processes (`--probe=<json>`), because the Ship Pass
 * flags resolve once at module load: each arm sets its pins on a stub window
 * BEFORE importing anything.
 *
 * Browser-only facts (GLSL compiling under ANGLE, texture-unit headroom,
 * pixels) belong to scripts/review-ship-light.cjs and verify-photo-hires.mjs;
 * fps and motion belong to the owner's RTX 5080 and iPhone (FLY_SHIP_PASS.md 9).
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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
    const cs = await mod('lib/fly/cinema-shadows.js');
    const st = useFlyStore.getState();
    out.airframeOn = { high: cs.airframeShadowOn(st), medium: cs.airframeShadowOn({ ...st, qualityTier: 'medium', qualityPreset: 'medium' }) };
    out.reach = { high: cs.shadowReachConfig(st), medium: cs.shadowReachConfig({ ...st, qualityTier: 'medium', qualityPreset: 'medium' }) };
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
const ON = (name) => ({ [`__fly${name.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}Override`]: { enabled: true } });

// --- base snapshot ----------------------------------------------------------
const baseArg = process.argv.find((a) => a.startsWith('--base='))?.slice(7) ?? 'main';
let baseRef = null;
try {
  baseRef = execFileSync('git', ['-C', ROOT, 'merge-base', 'HEAD', baseArg], { encoding: 'utf8' }).trim();
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

  // =========================================================================
  // (0) FLAG-OFF IDENTITY — the earth surface (the one patched material).
  // =========================================================================
  const cur = probe(ROOT, {});
  if (baseRef && existsSync(path.join(SNAP, 'lib/fly/r25-ground.js'))) {
    const base = probe(SNAP, {}, false);
    check('(0a) flags off: the terrain program key equals the base tree', cur.earth.key === base.earth.key, `${baseRef.slice(0, 7)} ${base.earth.key.slice(-40)}`);
    check('(0b) flags off: terrain fragment + vertex text sha256 equal the base tree', cur.earth.frag === base.earth.frag && cur.earth.vert === base.earth.vert, `frag ${cur.earth.frag} vs ${base.earth.frag}`);
  } else check('(0a) base snapshot available', false, `no base for ${baseArg}`);
  check('(0c) flags off: no terrain-shadow mode, no ts token, no ts uniforms', cur.mode === null && !cur.earth.key.includes('|ts-') && !cur.earth.uniforms.some((u) => u.startsWith('uTs')));
  check('(0d) flags off: airframe receive and Medium reach are inert', cur.airframeOn.high === false && cur.airframeOn.medium === false && cur.reach.high === null && cur.reach.medium === null);

  // =========================================================================
  // (1) LT-2 TERRAIN_SHADOW — the anchored patch, both paths.
  // =========================================================================
  const map = probe(ROOT, { ...ON('TERRAIN_SHADOW'), __flyLightDeviceClass: 'dgpu' });
  const hor = probe(ROOT, { ...ON('TERRAIN_SHADOW'), __flyLightDeviceClass: 'phone' });
  const soft = probe(ROOT, { ...ON('TERRAIN_SHADOW'), __flyLightDeviceClass: 'software' });
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
    const on = probe(ROOT, { ...ON('AIRFRAME_SHADOW'), ...ON('SHADOW_REACH'), __flyLightDeviceClass: 'dgpu' });
    const phone = probe(ROOT, { ...ON('AIRFRAME_SHADOW'), ...ON('SHADOW_REACH'), __flyLightDeviceClass: 'phone' });
    check('(4e) airframe receive: High/Ultra desktop only (not Medium, not phones)', on.airframeOn.high === true && on.airframeOn.medium === false && phone.airframeOn.high === false);
    check('(5a) reach: Medium desktop only (not High, not touch)', on.reach.high === null && on.reach.medium?.shadowMaxRangeM === 1200 && phone.reach.medium === null);
    check('(4f) program keys never move with the airframe/reach flags (uniform-only features)', on.earth.key === cur.earth.key && on.earth.frag === cur.earth.frag);
  }
  {
    const me = await import('../lib/fly/mobile-enhanced.js');
    const cfg = { shadowMaxRangeM: 1200, shadowAglScale: 1.6, shadowPaddingM: 180 };
    check('(5b) Medium at 900 m AGL shadows to the 1.2 km ceiling; ground level keeps the 600 m profile', me.mobileShadowRange(600, 900, cfg) === 1200 && me.mobileShadowRange(600, 0, cfg) === 600 && me.mobileShadowRange(600, 300, cfg) === 660);
  }
} finally {
  rmSync(SNAP, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

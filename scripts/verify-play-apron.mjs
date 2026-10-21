// Node gate for Play Pass APRON (FLY_PLAY_PASS.md, flag APRON_DETAIL;
// lib/fly/airfield/airfield-apron.js). Synthetic inputs only — no network, no
// GPU, no DOM:
//
//   1. FLAG OFF IS THE PREVIOUS LOOK: the four airfield materials built with
//      the flag off produce exactly the shader text and program keys of main
//      before the pass (a08407c, three r185), raw and through the production
//      chain (patchAirfieldMaterial), and the uniform cells are the old set;
//   2. flag on: every anchored substitution resolves (a missing anchor
//      throws), the keys carry the apron suffix, every uniform the new text
//      declares exists, and a missing anchor really throws;
//   3. the tunables block and the one-reader rule (play-pass.js);
//   4. the detail field on a fixture airfield: the centreline distance is
//      exact where it matters, the signed pavement-edge distance has the right
//      sign and size, stand stains sit under the stands, the apron weight is 1
//      on the apron, the build is deterministic and arrives in slices;
//   5. the stand and set-taxi-line transforms from the room frame.
//
//   node scripts/verify-play-apron.mjs            check
//   node scripts/verify-play-apron.mjs --print    print the flag-off fingerprints (to re-pin after a three upgrade)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';

register('./_node-resolve.mjs', import.meta.url);
process.removeAllListeners('warning');

const ROOT = path.resolve(import.meta.dirname, '..');
const { ShaderLib, REVISION } = await import('three');
const M = await import('../lib/fly/airfield/airfield-materials.js');
const A = await import('../lib/fly/airfield/airfield-apron.js');
const { SURF } = await import('../lib/fly/airfield/airfield-geometry.js');
const { APRON_DETAIL } = await import('../lib/fly/fly-constants.js');
const { playPassOn, playPassBlock } = await import('../lib/fly/play-pass.js');
const { AIRFIELD } = await import('../lib/fly/observation-config.js');
const { siteToWorld } = await import('../lib/fly/lounge-site.js');
const { STAND_CLASS } = await import('../lib/fly/airport-layout.js');
const { standLeadIn } = await import('../lib/fly/airport-set/decals.js');

let checks = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    checks++;
    console.log('PASS ' + name);
  } catch (e) {
    failures.push(name);
    console.log('FAIL ' + name + '\n     ' + String(e.message || e).split('\n')[0]);
  }
}

// --- 1. flag off -----------------------------------------------------------------

// Recorded on main at a08407c (before this pass) with three r185: sha256 of
// vertex + fragment + program key after onBeforeCompile on ShaderLib.standard.
const PINS = {
  raw: { grass: 'f6b63b63d2cdcb8b', pavement: 'ac8fb809be09fd09', runway: 'c19cb078bff0e3f0', paint: '0ae7e54b191f3bb1' },
  chain: { grass: '5ba857d573e6c853', pavement: '8e81172d2825cfd0', runway: '030367aa806724c5', paint: '7bdfa1de16d8c26d' },
};
const PIN_REVISION = '185';
const LAYERS = [['grass', M.createGrassMaterial], ['pavement', M.createPavementMaterial], ['runway', M.createRunwayMaterial], ['paint', M.createPaintMaterial]];

function compiled(material) {
  const sh = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader, uniforms: {} };
  material.onBeforeCompile(sh, null);
  return { ...sh, key: material.customProgramCacheKey() };
}
const fingerprint = (c) => crypto.createHash('sha256').update(c.vertexShader + '\n//--\n' + c.fragmentShader + '\n//--\n' + c.key).digest('hex').slice(0, 16);

function build(apron) {
  const u = M.createAirfieldUniforms({ apron });
  const out = {};
  for (const [layer, f] of LAYERS) {
    out[layer] = {
      raw: compiled(f(u, AIRFIELD.ground.lift[layer], { apron })),
      chain: compiled(M.patchAirfieldMaterial(f(u, AIRFIELD.ground.lift[layer], { apron }), layer)),
    };
  }
  return { u, out };
}

const off = build(false);
if (process.argv.includes('--print')) {
  for (const k of ['raw', 'chain']) console.log(k, JSON.stringify(Object.fromEntries(LAYERS.map(([l]) => [l, fingerprint(off.out[l][k])]))));
  process.exit(0);
}

check(`(1a) flag off: raw shader text and keys are main's (three r${REVISION}, pinned on r${PIN_REVISION})`, () => {
  for (const [l] of LAYERS) assert.equal(fingerprint(off.out[l].raw), PINS.raw[l], `${l} raw text changed`);
});
check('(1b) flag off: the production chain (bend, daylight, layer key) is main\'s', () => {
  for (const [l] of LAYERS) assert.equal(fingerprint(off.out[l].chain), PINS.chain[l], `${l} chained text changed`);
});
check('(1c) flag off: program keys carry no apron suffix', () => {
  for (const [l] of LAYERS) {
    assert.equal(off.out[l].raw.key, `airfield-ground-${l}-v2`);
    assert.ok(off.out[l].chain.key.endsWith(`|airfield-${l}-v2`));
  }
});
check('(1d) flag off: the uniform cells are the previous eighteen', () => {
  assert.deepEqual(Object.keys(off.u), ['uAfHeight', 'uAfGrid', 'uAfSize', 'uAfTime', 'uAfNight', 'uAfSlab', 'uAfMow', 'uAfRwyA', 'uAfRwyB', 'uAfRwyC', 'uAfRwyD', 'uAfGlyphs', 'uAfPhoto', 'uAfPhotoBounds', 'uAfPhotoOn', 'uAfGrassTone', 'uAfPave', 'uAfPaveOn']);
  assert.ok(!Object.keys(off.u).some((k) => k.startsWith('uAfApron') || k.startsWith('uAfDetail')));
});

// --- 2. flag on ----------------------------------------------------------------------

const on = build(true);
check('(2a) flag on: every anchor resolves and the keys carry the apron suffix', () => {
  for (const [l] of LAYERS) {
    assert.equal(on.out[l].raw.key, `airfield-ground-${l}-v2-${A.APRON_KEY}`);
    assert.ok(on.out[l].chain.key.endsWith(`|airfield-${l}-v2-${A.APRON_KEY}`));
    assert.notEqual(fingerprint(on.out[l].chain), PINS.chain[l]);
  }
});
check('(2b) flag on: every uniform the patched text declares is a uniform cell', () => {
  for (const [l] of LAYERS) {
    const frag = on.out[l].chain.fragmentShader;
    const declared = [...frag.matchAll(/uniform\s+\w+\s+(uAf\w+)/g)].map((m) => m[1]);
    for (const name of declared) assert.ok(name in on.u, `${l}: ${name} declared, no cell`);
    for (const name of ['uAfApron']) assert.ok(declared.includes(name), `${l}: ${name} not declared`);
  }
});
check('(2c) flag on: the previous look stays the level-0 branch (old expressions kept)', () => {
  const pave = on.out.pavement.raw.fragmentShader;
  assert.ok(pave.includes('mix( afAsphalt( afP, afFoot, 0.085 ), afConcrete( afP, afFoot, 0.8 ), concreteW )'));
  assert.ok(pave.includes('uAfApron.x > 0.5'));
  const paint = on.out.paint.raw.fragmentShader;
  assert.ok(paint.includes('col = mix( vec3( 0.025, 0.024, 0.024 ), yellow, line );'));
});
check('(2c2) flag on: each layer carries its additions (none silently skipped)', () => {
  const frag = (l) => on.out[l].raw.fragmentShader;
  assert.ok(frag('pavement').includes('afApronWear( pave, afP, afFoot, concreteW )'));
  assert.ok(frag('pavement').includes('totalEmissiveRadiance += diffuseColor.rgb * uAfApronN.rgb'), 'night floodlight');
  assert.ok(frag('pavement').includes('roughnessFactor - afSheen'));
  assert.ok(frag('grass').includes('afGrassApron( grass, afP, afFoot )') && frag('grass').includes('mowK = uAfApronG.x'));
  assert.ok(frag('runway').includes('rubber = max( rubber, roll * uAfApronG.w )') && frag('runway').includes('uAfApronC.z'));
  assert.ok(frag('paint').includes('afBorder') && (frag('paint').match(/uAfApron\.x > 0\.5/g) || []).length >= 4);
  assert.ok(!off.out.pavement.raw.fragmentShader.includes('totalEmissiveRadiance += diffuseColor'), 'flag off: no floodlight');
});
check('(2d) a missing or repeated anchor throws', () => {
  assert.throws(() => A.swap('abc', 'x', 'y', 'test'), /missing/);
  assert.throws(() => A.swap('xx', 'x', 'y', 'test'), /not unique/);
  assert.equal(A.swap('axb', 'x', 'y', 'test'), 'ayb');
  assert.throws(() => A.apronPavement({ decl: '', color: 'nothing here', roughness: '' }), /anchor missing/);
});
check('(2e) flag on: the patched text has no per-frame console and no new network', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/fly/airfield/airfield-apron.js'), 'utf8');
  assert.ok(!/console\./.test(src));
  assert.ok(!/fetch\(|XMLHttpRequest|https?:\/\//.test(src));
});

// --- 3. tunables and the one reader --------------------------------------------------

check('(3a) APRON_DETAIL ships on, with sane tunables', () => {
  const B = APRON_DETAIL;
  assert.equal(B.enabled, true);
  assert.equal(playPassOn('APRON_DETAIL'), true);
  assert.equal(playPassBlock('APRON_DETAIL').field.sizePx, B.field.sizePx);
  assert.ok([512, 1024, 2048, 4096].includes(B.field.sizePx));
  assert.ok(B.field.halfM >= AIRFIELD.ground.paint.maxDistM, 'the field covers the painted area');
  assert.ok(B.field.halfM * 2 / B.field.sizePx <= 4, 'texel <= 4 m');
  assert.ok(B.field.budgetMs > 0 && B.field.budgetMs <= 4, 'a few ms a frame');
  assert.ok(B.tiers.length && B.tiers.every((t) => ['high', 'medium'].includes(t)), "'low' never draws the detail");
  assert.ok(B.slab.lengthM > 3 && B.slab.lengthM < 10 && B.slab.laneM > 3 && B.slab.laneM < 10);
  assert.ok(B.concrete.albedo > 0.2 && B.concrete.albedo < 0.45);
  assert.ok(B.concrete.levelCap >= 1 && B.concrete.levelCap <= 1.35 && B.runway.levelCap >= 1 && B.runway.levelCap <= 1.4);
  for (const v of Object.values(B.wear)) assert.ok(v >= 0 && v <= 2);
  assert.equal(B.shoulderM.length, 3);
  assert.ok(B.shoulderM.every((v, i) => v >= 0 && v <= 12 && (i === 0 || v <= B.shoulderM[i - 1])));
  for (const v of Object.values(B.grass)) assert.ok(v >= 0 && v <= 2);
  assert.ok(B.night.flood >= 0 && B.night.flood <= 1.5);
  assert.equal(B.night.floodColor.length, 3);
  assert.ok(B.night.floodColor.every((v) => v >= 0 && v <= 1.5));
});
check('(3b) the flag is read only through lib/fly/play-pass.js', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue; }
      if (!/\.(js|jsx|mjs)$/.test(e.name)) continue;
      const rel = path.relative(ROOT, p).replace(/\\/g, '/');
      if (rel === 'lib/fly/play-pass.js' || rel === 'lib/fly/fly-constants.js' || rel === 'lib/fly/device-report.js') continue;
      const s = fs.readFileSync(p, 'utf8');
      if (/import\s*\{[^}]*\bAPRON_DETAIL\b[^}]*\}\s*from\s*['"][^'"]*fly-constants/.test(s)) offenders.push(rel);
    }
  };
  walk(path.join(ROOT, 'lib'));
  walk(path.join(ROOT, 'components'));
  assert.deepEqual(offenders, []);
});
check('(3c) touch devices never build the field; the level follows the tier list', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib/fly/airfield/airfield-ground.js'), 'utf8');
  assert.ok(/isMobileGraphicsClass\(\)\)\s*\{[\s\S]{0,80}touch/.test(src));
  assert.ok(/APRON\.tiers\.includes\(tier\)/.test(src));
  assert.ok(/if \(APRON_ON\) this\._startApron/.test(src));
});

// --- 4. the detail field --------------------------------------------------------------

// A fixture airfield in local metres: an E-W taxiway along z = 0 (x -600..600)
// with a N-S branch at x = 200, a 300 x 200 m apron north of it, a runway
// rectangle to the south, one stand on the apron.
function rect(x0, z0, x1, z1, surf) {
  const position = new Float32Array([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1]);
  const index = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const s = new Float32Array([surf, 1, 0, surf, 1, 0, surf, 1, 0, surf, 1, 0]);
  return { position, index, surf: s };
}
function merge(...gs) {
  const pos = [], idx = [], surf = [];
  for (const g of gs) {
    const base = pos.length / 3;
    pos.push(...g.position);
    idx.push(...Array.from(g.index, (i) => i + base));
    if (g.surf) surf.push(...g.surf);
  }
  return { position: new Float32Array(pos), index: new Uint32Array(idx), surf: new Float32Array(surf) };
}
const halfW = 11.5;
const model = { taxiways: [{ pts: [-600, 0, 600, 0], halfW }, { pts: [200, 0, 200, -400], halfW }], aClass: 0 };
const pave = merge(rect(-600, -halfW, 600, halfW, SURF.taxiway), rect(200 - halfW, -400, 200 + halfW, 0, SURF.taxiway), rect(-300, -250, 0, -50, SURF.apron));
const rwy = rect(-800, 300, 800, 361, 0);
const TC = 208.5 * 3.125 - 800; // a texel centre of the 512 px, 1600 m field
const blobs = [{ x: TC, z: TC, sigma: 2, w: 1 }];
const opts = { sizePx: 512, halfM: 800, blobs };

let slices = 0;
const job = A.apronFieldJob(model, pave, rwy, opts);
let field;
for (;;) {
  const r = job.next();
  if (r.done) { field = r.value; break; }
  slices++;
}
const at = (x, z) => A.fieldAt(field, x, z);
const step = field.step; // 3.125 m

check('(4a) the field arrives in slices and is deterministic', () => {
  assert.ok(slices >= 20, `only ${slices} slices`);
  const again = A.buildApronField(model, pave, rwy, opts);
  assert.equal(Buffer.compare(Buffer.from(again.data), Buffer.from(field.data)), 0);
  assert.equal(field.size, 512);
  assert.equal(field.data.length, 512 * 512 * 4);
});
check('(4b) R: distance to the taxiway centreline, exact to the quantum away from the line', () => {
  const q = A.FIELD_RANGE / 255;
  for (const z of [4.7, 7.8, 10.9, 14.0, 20.3]) {
    const tz = (Math.floor((z + 800) / step) + 0.5) * step - 800; // texel centre
    const got = at(-300, tz).dc;
    assert.ok(Math.abs(got - Math.abs(tz)) <= q, `z ${tz.toFixed(2)}: ${got.toFixed(3)}`);
  }
  assert.ok(at(-300, 200).dc >= A.FIELD_RANGE - q, 'far from any taxiway: clamped');
  assert.ok(at(200, -200).dc < 2.5, 'on the branch');
});
check('(4c) G: signed distance to the pavement edge (inside < 0, outside > 0, metres)', () => {
  const inside = at(-300, 0).sd; // taxiway centre: 11.5 m from both edges
  assert.ok(inside < -9 && inside > -14, `inside ${inside}`);
  const out = at(-300, 30).sd; // 18.5 m south of the taxiway edge
  assert.ok(out > 15 && out < 22, `outside ${out}`);
  const apron = at(-150, -150).sd;
  assert.ok(apron < -A.FIELD_RANGE + 1, `deep in the apron ${apron}`);
  assert.ok(at(-300, 330).sd < 0, 'the runway is pavement');
});
check('(4d) B: stand stains sit under the stand; A: the apron weight is 1 on the apron, 0 on the taxiway', () => {
  assert.ok(at(TC, TC).stain > 0.98, `centre ${at(TC, TC).stain}`);
  assert.ok(at(TC + 3.125, TC).stain < at(TC, TC).stain);
  assert.ok(at(TC, TC - 20).stain < 0.02);
  assert.ok(at(-150, -150).apron > 0.99);
  assert.ok(at(-300, 0).apron < 0.01);
  assert.ok(at(100, -150).apron < 0.01);
});

// --- 5. room frame -> local ---------------------------------------------------------------

const site = { x: 1000, z: -2000, k: 1.3, heading: 0.7 };
const toLocal = (lx, lz) => { const w = siteToWorld(site, lx, lz); return [(w.x - site.x) / site.k, (w.z - site.z) / site.k]; };
check('(5a) stand blobs: nose stop, gear and engines in the stand frame, mapped like siteToWorld', () => {
  const stand = { x: 40, z: -60, noseZ: -40, cls: 'narrow', side: 'front' };
  const blobsOut = A.standBlobs(site, { stands: [stand] }, STAND_CLASS);
  assert.ok(blobsOut.length > 7);
  const nose = blobsOut[0];
  const [nx, nz] = toLocal(40, -40 - 0.12 * STAND_CLASS.narrow.length);
  assert.ok(Math.hypot(nose.x - nx, nose.z - nz) < 1e-6);
  const back = A.standBlobs(site, { stands: [{ ...stand, side: 'back', noseZ: 40 }] }, STAND_CLASS)[0];
  const [bx, bz] = toLocal(40, 40 + 0.12 * STAND_CLASS.narrow.length);
  assert.ok(Math.hypot(back.x - bx, back.z - bz) < 1e-6, 'a back stand faces -z');
});
check('(5b) set taxi lines: the taxilane and both lead-in turns per stand, rear side turned about zc', () => {
  const lanes = { taxilaneZ: -120, noseZ: -40, road: { z0: -30, z1: -20 } };
  const stand = { x: 40, z: -60, noseZ: -40, cls: 'narrow', canon: { x: 40, z: -60, noseZ: -40 } };
  const layout = { lanes, apron: { x0: -200, x1: 200, z0: -170, z1: -10 }, zc: 30, sides: [{ side: 'front', stands: [stand], lanes, xform: { rot180: false, zc: 30 } }, { side: 'back', stands: [{ ...stand, x: -40, noseZ: 100 }], lanes, xform: { rot180: true, zc: 30 } }] };
  const lines = A.setTaxiLines(site, layout, standLeadIn);
  assert.equal(lines.length, 2 * (1 + 3));
  const [tx, tz] = toLocal(-196, -120);
  assert.ok(Math.hypot(lines[0].pts[0] - tx, lines[0].pts[1] - tz) < 1e-6, 'front taxilane start');
  const [rx, rz] = toLocal(196, 2 * 30 + 120);
  assert.ok(Math.hypot(lines[4].pts[0] - rx, lines[4].pts[1] - rz) < 1e-6, 'rear taxilane start, turned 180 degrees');
  for (const l of lines) for (const v of l.pts) assert.ok(Number.isFinite(v));
});

console.log(`\n${checks} passed, ${failures.length} failed${failures.length ? ': ' + failures.join(' | ') : ''}`);
process.exitCode = failures.length ? 1 : 0;

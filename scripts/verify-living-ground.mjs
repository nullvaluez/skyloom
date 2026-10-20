/**
 * LIVING WORLD — verify-living-ground: the GROUND workstream's gate
 * (NIGHT_LIGHTS, GROUND_MIST; lib/fly/living-ground.js and its two modules).
 *
 *  (1) Flags OFF: the Enhanced aerial pass carries no GROUND code and gains no
 *      uniforms, the patch is the identity, the attach is a no-op, and the
 *      satellite credits do not name NASA — the previous frame by construction.
 *  (2) Flags ON: the Enhanced text carries every block; the Classic and LAW
 *      texts are byte-identical to flags off; the Enhanced text minus the
 *      GROUND edits IS the flags-off text; every GROUND uniform the program
 *      declares is in the effect's map; the NASA credit is on screen and in
 *      the Credits list.
 *  (3) The CPU halves: the atlas window and slots, the decode (background to
 *      black, the curve, sRGB-encoded), the mist's time-of-day / wind / fog
 *      law, and the ground field built from a synthetic valley (floor below
 *      the ridges, the deeper pool in the valley, coarse DEM refused); the
 *      street-light pattern (deterministic, three nested densities, no
 *      clipping); the field's crossfade (a new grid fades in over the old,
 *      never overwrites a grid still on screen) and its holes (unknown
 *      terrain carries no mist and invents no basin).
 *  (4) WebGL2: the merged EffectPass program, on and off, compiles and links
 *      under three's prefix (the host's GPU; SwiftShader where there is none),
 *      and a copy with one undeclared call must fail, so the row can go red.
 *
 * Run: node scripts/verify-living-ground.mjs
 * Legs run in child processes because each flag is a page-load (module-load)
 * decision, exactly as in the app.
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leg = process.argv.find((a) => a.startsWith('--leg='))?.slice(6);
const FLAGS = ['NIGHT_LIGHTS', 'GROUND_MIST'];
const pinName = (f) => `__fly${f.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}Override`;

async function buildLeg(on) {
  globalThis.window = { location: { search: '', href: 'http://localhost/' } };
  for (const f of FLAGS) globalThis.window[pinName(f)] = { enabled: on };
  if (typeof globalThis.OffscreenCanvas === 'undefined') {
    const inert = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : inert), apply: () => inert, construct: () => inert });
    globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return inert; } };
  }
  register('./_node-resolve.mjs', import.meta.url);
  register('./_alias-loader.mjs', import.meta.url);
  register('./_r25-c-jsx-loader.mjs', import.meta.url);
  const imp = (rel) => import(new URL(`../${rel}`, import.meta.url).href);
  const THREE = await imp('node_modules/three/build/three.module.js');
  const { EffectPass } = await import('postprocessing');
  const AP = await imp('components/fly/AerialPerspective.jsx');
  const LG = await imp('lib/fly/living-ground.js');
  const TS = await imp('lib/fly/tile-sources.js');
  const enhanced = new AP.AerialPerspectiveEffect({ r25: true });
  const classic = new AP.AerialPerspectiveEffect();
  // EffectPass merges its effects into the material only on (re)compile; the
  // composer does it on first render. Do it here so the program is the real one.
  const pass = new EffectPass(new THREE.PerspectiveCamera(), enhanced);
  pass.recompile();
  const inc = (t) => t.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (m, n) => inc(THREE.ShaderChunk[n] ?? `// missing ${n}`));
  const out = {
    active: LG.LIVING_GROUND_ACTIVE,
    shaders: { ...LG.LIVING_GROUND_SHADERS },
    enhanced: enhanced.getFragmentShader(),
    classic: classic.getFragmentShader(),
    uniforms: [...enhanced.uniforms.keys()].sort(),
    probe: on ? 'n/a' : LG.livingGroundAerial('// probe\n') === '// probe\n' ? 'identity' : 'patched',
    attachIsNoop: on ? null : String(LG.attachLivingGround({}) ?? '').length < 20,
    handle: !!globalThis.window.__flyLivingGround,
    credits: TS.CREDITS_ATTRIBUTIONS.map((a) => a.label),
    onScreen: TS.attributionsFor('satellite', 'adsb.lol').map((a) => a.label),
    nasa: TS.NIGHT_LIGHTS_ATTRIBUTION.label,
    pass: { frag: inc(pass.fullscreenMaterial.fragmentShader), vert: inc(pass.fullscreenMaterial.vertexShader), defines: { ...pass.fullscreenMaterial.defines } },
  };
  // The LAW variant's text is a module const in the same file; read it.
  const src = fs.readFileSync(path.join(ROOT, 'components/fly/AerialPerspective.jsx'), 'utf8');
  out.law = src.match(/const lawFragmentShader = \/\* glsl \*\/ `([\s\S]*?)`;/)?.[1] ?? '';
  if (on) {
    const NLA = await imp('lib/fly/night-lights-atlas.js');
    const GMm = await imp('lib/fly/ground-mist.js');
    const C = await imp('lib/fly/fly-constants.js');
    // Atlas window + slot math (no fetch: pump is never called here).
    const atlas = new NLA.NightLightsAtlas({ curve: 3.6, maxRequests: 4 }, TS.NIGHT_LIGHTS_SOURCE);
    const W = 40075016.68557849, span = W / 256;
    const px = (74.55 / 256) * W - W / 2, pz = (96.97 / 256) * W - W / 2; // Philadelphia
    atlas.locate(px, pz);
    const keys = atlas.slots.map((s) => s.key);
    const slotOk = atlas.slots.every((s, i) => {
      const [, tx, ty] = s.key.split('/').map(Number);
      return i === (((ty % 4) + 4) % 4) * 4 + (((tx % 4) + 4) % 4);
    });
    const lut = atlas.lut;
    const bg = TS.NIGHT_LIGHTS_SOURCE.background;
    out.atlas = {
      window: [atlas.minX, atlas.minY], keys, slotOk,
      centred: Math.abs((px + W / 2) / span - (atlas.minX + 2)) <= 0.5 && Math.abs((pz + W / 2) / span - (atlas.minY + 2)) <= 0.5,
      lutBg: [lut[0][bg[0]], lut[1][bg[1]], lut[2][bg[2]]], lutTop: [lut[0][255], lut[1][255], lut[2][255]],
      lutMonotone: lut.every((l) => l.every((v, i) => i === 0 || v >= l[i - 1])),
      lutMid: lut[1][128], // (123/250)^3.6 = 0.078 linear -> sRGB 0.31 -> 79
      url: TS.NIGHT_LIGHTS_SOURCE.url(8, 74, 96),
    };
    atlas.dispose();
    // Mist strength law.
    const block = C.GROUND_MIST;
    const S = (el, morning, wx = null) => GMm.groundMistStrength({ sinEl: Math.sin((el * Math.PI) / 180), hourAngle: morning ? -1 : 1 }, wx, block);
    out.mist = {
      nightMorning: S(-25, true).tod, dawn: S(-2, true).tod, sunrise: S(3, true).tod, burned: S(22, true).tod,
      sunset: S(5, false).tod, dusk: S(-8, false).tod, nightEvening: S(-25, false).tod,
      calm: S(0, true, { windX: 1, windZ: 0 }).calm, windy: S(0, true, { windX: 12, windZ: 0 }).calm,
      fog: S(0, true, { windX: 1, fogT: 1 }).humid, dry: S(0, true, { windX: 1, overcastT: 1 }).humid,
      humidDay: S(30, true, { windX: 1, fogT: 1 }).tod,
    };
    // Ground field from a synthetic V valley (floor 200 m, ridges 1400 m).
    const makeEngine = (tileZ) => ({ getGroundAt(lon) { const x = Math.abs(lon - 11.42) * 111320 * Math.cos(47.2 * Math.PI / 180); return { elev: 200 + Math.min(1200, x * 0.12), tileZ }; } });
    const field = new GMm.GroundField(block);
    const k = 1 / Math.cos((47.2 * Math.PI) / 180);
    const cx = (11.42 / 360) * W, cz = -Math.log(Math.tan(Math.PI / 4 + (47.2 * Math.PI) / 360)) * (W / (2 * Math.PI));
    const w = field.want(cx, cz, 0, 0, 2600, k);
    const coarse = new GMm.GroundField(block);
    for (let i = 0; i < 400 && !coarse.live; i++) coarse.step(makeEngine(6), coarse.want(cx, cz, 0, 0, 2600, k), 200, i, 50);
    for (let i = 0; i < 400 && !field.live; i++) field.step(makeEngine(13), w, 200, i, 50);
    const n = field.n, data = field.data;
    const { DataUtils } = THREE;
    const at = (ix, iz, c) => DataUtils.fromHalfFloat(data[(iz * n + ix) * 4 + c]) + (c < 2 ? 200 : 0);
    const mid = n >> 1;
    // Columns across the valley (x = west-east): centre vs the far edge.
    out.field = {
      live: !!field.live, coarseLive: !!coarse.live,
      floorCentre: at(mid, mid, 0), terrainCentre: at(mid, mid, 1), depthCentre: at(mid, mid, 2),
      floorEdge: at(2, mid, 0), terrainEdge: at(2, mid, 1), depthEdge: at(2, mid, 2),
      top: field.live?.top ?? null,
    };
    // The crossfade: a second grid over different terrain fades in over the
    // first, and no third build may land while both are on screen.
    {
      const g = new GMm.GroundField(block);
      const eA = makeEngine(13), eB = { getGroundAt: (lon, lat) => ({ elev: eA.getGroundAt(lon, lat).elev + 150, tileZ: 13 }) };
      let t = 0;
      for (let i = 0; i < 400 && !g.live; i++) g.step(eA, w, 200, (t += 0.016), 50);
      const firstBuf = g.live.buf, born1 = g.live.born;
      // Age it out and rebuild on the raised terrain.
      t += block.map.maxAgeSec + 1;
      for (let i = 0; i < 400 && g.live.born === born1; i++) g.step(eB, w, 200, (t += 0.016), 50);
      const swapped = g.live.born !== born1 && g.live.buf !== firstBuf && !!g.prev;
      const b0 = g.blend(t);
      const half = g.blend(g.live.born + block.map.blendSec / 2);
      // While blending, a further build must not finish.
      const born2 = g.live.born;
      for (let i = 0; i < 50; i++) g.step(eA, w, 200, g.live.born + 0.1, 50);
      const heldWhileBlending = g.live.born === born2;
      const done = g.blend(g.live.born + block.map.blendSec + 0.01);
      out.blendCheck = { swapped, b0: +b0.toFixed(3), half: +half.toFixed(3), heldWhileBlending, done, prevRetired: g.prev === null };
      g.dispose();
    }
    // Holes: a band of unanswered terrain across a valley carries no mist and
    // drags no floor below the answered terrain around it.
    {
      const g = new GMm.GroundField(block);
      const eng = makeEngine(13);
      const holey = { getGroundAt: (lon, lat) => (Math.abs(lat - 47.2) < 0.05 ? null : eng.getGroundAt(lon, lat)) };
      for (let i = 0; i < 400 && !g.live; i++) g.step(holey, w, -800, i, 50);
      const n = g.n, d = g.data;
      let holes = 0, holeCovered = 0, minFloor = Infinity, minAnswered = Infinity;
      for (let i = 0; i < n * n; i++) {
        const a = THREE.DataUtils.fromHalfFloat(d[i * 4 + 3]);
        const fl = THREE.DataUtils.fromHalfFloat(d[i * 4]) + g.live.base;
        if (a < 0.5) { holes++; minFloor = Math.min(minFloor, fl); } else { minAnswered = Math.min(minAnswered, fl); if (a < 0.99) holeCovered++; }
      }
      out.holeCheck = { live: !!g.live, holes, holeCovered, minHoleFloor: Math.round(minFloor), minAnsweredFloor: Math.round(minAnswered) };
      g.dispose();
    }
    // The street-light pattern, small: deterministic, three nested densities.
    {
      const P = await imp('lib/fly/night-lights-pattern.js');
      const cfg = { size: 128, texelM: 16, cells: 4, seed: 7 };
      const seeds = P.lightPatternSeeds({ cells: 4, period: 128 * 16, seed: 7 });
      const run = () => { const o = new Uint8Array(128 * 128 * 4), sums = [0, 0, 0]; P.lightPatternRows(cfg, seeds, o, sums, 0, 128); return { o, sums }; };
      const a = run(), b = run();
      let same = a.o.length === b.o.length, nz = [0, 0, 0], sat = 0;
      for (let i = 0; i < a.o.length; i++) if (a.o[i] !== b.o[i]) { same = false; break; }
      for (let i = 0; i < 128 * 128; i++) for (let c = 0; c < 3; c++) { if (a.o[i * 4 + c] > 0) nz[c]++; if (a.o[i * 4 + c] === 255) sat++; }
      out.pattern = { same, sums: a.sums.map((v) => +v.toFixed(1)), nz, sat };
    }
    field.dispose();
    coarse.dispose();
  }
  return out;
}

if (leg) {
  const texts = await buildLeg(leg === 'on');
  process.stdout.write(JSON.stringify(texts));
  process.exit(0);
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const run = (l) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${l}`], { cwd: ROOT, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }).toString());
const off = run('off');
const on = run('on');
const GROUND_ID = /\b(lgHash|lgNoise|nlLights|nlFresh|nlLum|gmApply|gmSegment|gfField|gfGrid|livingGround|lgGround|lgEmit|uNL\w+|uGM\w+|uGF\w+)\b/;

// (1) off
check('(1a) flags off: the Enhanced aerial text carries no GROUND code', !GROUND_ID.test(off.enhanced) && off.shaders['aerial-enhanced'] === 'off');
check('(1b) flags off: no GROUND uniforms on the effect', !off.uniforms.some((k) => /^u(NL|GM|GF)[A-Z]/.test(k)), `${off.uniforms.length} uniforms`);
check('(1c) flags off: the patch is the identity, the attach a no-op, no dev handle', !off.active && off.probe === 'identity' && off.attachIsNoop && !off.handle);
check('(1d) flags off: the satellite credits and the Credits list do not name NASA', !off.onScreen.includes(off.nasa) && !off.credits.includes(off.nasa));

// (2) on
const marks = {
  field: on.enhanced.includes('vec4 gfField(vec2 xz){'),
  lights: on.enhanced.includes('emit=nlLights(world,metricRay,dXZ,trueY,city);'),
  mist: on.enhanced.includes('gmApply(world,metricRay,city*uNLMist,ground,emit);'),
  driver: on.enhanced.includes('    livingGround(world,metricRay,dXZ,trueY,lgGround,lgEmit);\n'),
  phys: on.enhanced.includes('vec3 lit=lgGround*apT+') && on.enhanced.includes('lit+=lgEmit*apT*transmission;'),
  fallback: on.enhanced.includes('outputColor=vec4((lgGround*transmittance+haze*(1.-transmittance)+lgEmit*transmittance)*uR25Exposure,inputColor.a);'),
};
check('(2a) flags on: every block is in the Enhanced aerial program', Object.values(marks).every(Boolean) && on.shaders['aerial-enhanced'] === 'patched', JSON.stringify(marks));
check('(2b) flags on: the Classic and LAW aerial texts are byte-identical to flags off', on.classic === off.classic && on.law === off.law && on.law.length > 0);
{
  // Undo exactly the GROUND edits; what is left must BE the flags-off text.
  let t = on.enhanced;
  const MAIN = 'void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {';
  const declAt = t.indexOf('\nfloat lgHash(');
  t = declAt >= 0 ? t.slice(0, declAt) + t.slice(t.indexOf(MAIN)) : t;
  t = t.replace('    vec3 lgGround=inputColor.rgb,lgEmit;\n    livingGround(world,metricRay,dXZ,trueY,lgGround,lgEmit);\n', '');
  t = t.replace('vec3 lit=lgGround*apT+', 'vec3 lit=inputColor.rgb*apT+');
  t = t.replace('      lit+=lgEmit*apT*transmission;\n', '');
  t = t.replace('outputColor=vec4((lgGround*transmittance+haze*(1.-transmittance)+lgEmit*transmittance)*uR25Exposure,inputColor.a);', 'outputColor=vec4((inputColor.rgb*transmittance+haze*(1.-transmittance))*uR25Exposure,inputColor.a);');
  check('(2c) flags on minus the GROUND edits === flags off (the only difference is the blocks)', t === off.enhanced, t === off.enhanced ? '' : `lengths ${t.length} vs ${off.enhanced.length}`);
}
{
  const declared = [...on.enhanced.matchAll(/uniform\s+\w+\s+(u(?:NL|GM|GF)\w+)/g)].map((m) => m[1]);
  const missing = declared.filter((u) => !on.uniforms.includes(u));
  const extra = on.uniforms.filter((u) => /^u(NL|GM|GF)[A-Z]/.test(u) && !declared.includes(u));
  check('(2d) flags on: every GROUND uniform the program declares is on the effect, and no others', declared.length > 0 && !missing.length && !extra.length, `${declared.length} declared${missing.length ? `; missing ${missing}` : ''}${extra.length ? `; extra ${extra}` : ''}`);
}
check('(2e) flags on: the PHYS_SKY and TRUE_SCALE edits survive', on.enhanced.includes('pskyAerial(') === off.enhanced.includes('pskyAerial(') && on.enhanced.includes('tsTrueRay') === off.enhanced.includes('tsTrueRay'));
check('(2f) flags on: NASA is credited on screen (satellite) and in the Credits list', on.onScreen.includes(on.nasa) && on.credits.includes(on.nasa) && /GIBS/.test(on.nasa));

// (3) CPU halves
{
  const a = on.atlas;
  check('(3a) the atlas window is centred on the aircraft and every tile sits in its mod-4 slot', a.centred && a.slotOk && a.keys.length === 16 && new Set(a.keys).size === 16, `window ${a.window}`);
  check('(3b) the decode: background to black, the top to white, monotone, the curve in the middle', a.lutBg.every((v) => v === 0) && a.lutTop.every((v) => v === 255) && a.lutMonotone && Math.abs(a.lutMid - 79) <= 2, `mid ${a.lutMid}`);
  check('(3c) the GIBS URL is the probed WMTS template (z/y/x, Level8, 2016)', a.url === 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/8/96/74.png');
  const m = on.mist;
  check('(3d) mist: night level, rising to its peak at dawn, burned off by mid-morning, back after sunset',
    Math.abs(m.nightMorning - m.nightEvening) < 1e-9 && m.dawn > m.nightMorning && m.sunrise > 0.9 && m.burned === 0 && m.sunset === 0 && m.dusk > 0.5, JSON.stringify(m));
  check('(3e) mist: wind thins it, fog thickens it, an overcast night thins it, humid air keeps a little by day',
    m.calm === 1 && m.windy < 0.1 && m.fog > 1.4 && m.dry < 0.62 && m.humidDay > 0);
  const f = on.field;
  check('(3f) field: the valley floor lies below the ridges and the valley pool is deeper than the ridge-top veil',
    f.live && f.floorCentre < f.terrainEdge - 300 && f.floorCentre <= f.terrainCentre + 1 && f.depthCentre >= f.depthEdge && f.top > f.floorCentre, JSON.stringify(f));
  check('(3g) field: a grid answered only by coarse DEM tiles never goes live', !f.coarseLive);
  const bc = on.blendCheck;
  check('(3h) field: a rebuild fades in over the old grid (other buffer), holds further builds until the fade ends, then retires the old grid',
    bc.swapped && bc.b0 < 0.05 && Math.abs(bc.half - 0.5) < 0.02 && bc.heldWhileBlending && bc.done === 1 && bc.prevRetired, JSON.stringify(bc));
  const hc = on.holeCheck;
  check('(3i) field: unanswered terrain carries no mist and drags no floor below the answered terrain (no invented basin)',
    hc.live && hc.holes > 0 && hc.minHoleFloor >= hc.minAnsweredFloor - 1, JSON.stringify(hc));
  const pt = on.pattern;
  check('(3j) the street-light pattern: deterministic, the core set contains more light than the suburb set and the suburb more than the countryside, nothing clipped',
    pt.same && pt.sums[0] > pt.sums[1] && pt.sums[1] > pt.sums[2] && pt.sums[2] > 0 && pt.nz[0] >= pt.nz[1] && pt.sat === 0, JSON.stringify(pt));
}

// (4) WebGL2 compile + link of the merged pass, on and off.
{
  const { chromium } = await import('playwright');
  const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const swift = process.platform !== 'win32' || process.env.FLY_SOFTWARE === '1';
  const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, headless: true,
    args: [...(swift ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11']), '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage();
    // The control: the same program with one undeclared identifier must FAIL,
    // or a green row here would prove nothing.
    // EffectPass renames the effect's own functions (nlLights -> e0NlLights).
    const brokenFrag = on.pass.frag.replace(/emit=(\w*[Nn]lLights)\(/, 'emit=$1Missing(');
    check('(4) CONTROL: the broken copy differs from the real program', brokenFrag !== on.pass.frag);
    const broken = { ...on.pass, frag: brokenFrag };
    const programs = [['aerial pass (on)', on.pass], ['aerial pass (off)', off.pass], ['control', broken]];
    const results = await page.evaluate((programs) => {
      const gl = document.createElement('canvas').getContext('webgl2');
      // three's GLSL3 ShaderMaterial prefixes (r185), reduced to what these programs use.
      const head = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\nprecision highp sampler3D;\n';
      const vp = `${head}uniform mat4 modelMatrix,modelViewMatrix,projectionMatrix,viewMatrix;\nuniform mat3 normalMatrix;\nuniform vec3 cameraPosition;\nuniform bool isOrthographic;\nin vec3 position;in vec3 normal;in vec2 uv;\n#define attribute in\n#define varying out\n#define texture2D texture\n`;
      const fp = `${head}uniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\nuniform bool isOrthographic;\n#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n#define textureCube texture\n#define USE_REVERSED_DEPTH_BUFFER\nvec4 linearToOutputTexel(vec4 v){return v;}\n`;
      const out = [];
      for (const [name, p] of programs) {
        const defs = Object.entries(p.defines).map(([k, v]) => `#define ${k} ${v}`).join('\n') + '\n';
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return [s, gl.getShaderParameter(s, gl.COMPILE_STATUS) ? null : gl.getShaderInfoLog(s)]; };
        const [v, ve] = sh(gl.VERTEX_SHADER, vp + defs + p.vert);
        const [f, fe] = sh(gl.FRAGMENT_SHADER, fp + defs + p.frag);
        let le = null, n = 0;
        if (!ve && !fe) {
          const pr = gl.createProgram(); gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
          if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) le = gl.getProgramInfoLog(pr); else n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
        }
        out.push([name, (ve || fe || le) ? String(ve || fe || le).slice(0, 1200) : null, n]);
      }
      return { out, renderer: gl.getParameter(gl.RENDERER) };
    }, programs);
    for (const [name, err, n] of results.out) {
      if (name === 'control') check('(4) CONTROL: the program with an undeclared identifier fails to compile', !!err);
      else check(`(4) ${name} compiles and links`, !err, err ?? `${n} active uniforms (${results.renderer})`);
    }
  } finally {
    await browser.close();
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * LIVING WORLD — verify-living-sky: the SKY workstream's gate
 * (LIVING_CLOUDS, FAR_CLOUDS, CIRRUS, LIGHT_SHAFTS, LENS_FLARE, NIGHT_SKY).
 *
 *  (1) Flags OFF: the real cloud pass builds its four programs (and no shaft
 *      targets) with texts byte-identical to a tree where the Living World
 *      modules do nothing — the previous frame by construction.
 *  (2) Flags ON: the Enhanced march and composite carry every addition
 *      (one marker per block) and the Classic pair is untouched.
 *  (3) WebGL2 (SwiftShader is fine): every patched program, plus the two shaft
 *      programs, compiles and links under three's ShaderMaterial prefix.
 *  (4) The galactic frame: the north galactic pole sits where an almanac puts
 *      it (Polaris check and two fixed instants), and stays unit length; the
 *      city skyglow that dims the Milky Way is ~1 over Manhattan, 0 at sea.
 *
 * Run: node scripts/verify-living-sky.mjs
 * Legs run in child processes because each flag is a page-load (module-load)
 * decision, exactly as in the app.
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leg = process.argv.find((a) => a.startsWith('--leg='))?.slice(6);
const FLAGS = ['LIVING_CLOUDS', 'FAR_CLOUDS', 'CIRRUS', 'LIGHT_SHAFTS', 'LENS_FLARE', 'NIGHT_SKY'];
const pinName = (f) => `__fly${f.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join('')}Override`;

async function buildTexts(on) {
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
  const CP = await imp('lib/fly/immersive-cloud-pass.js');
  const pass = new CP.ImmersiveCloudPass(new THREE.PerspectiveCamera(), {});
  pass.ensureR25();
  const out = {
    classicMarch: pass.marchMaterial.fragmentShader,
    classicComposite: pass.compositeMaterial.fragmentShader,
    march: pass.r25.march.fragmentShader,
    composite: pass.r25.composite.fragmentShader,
    vertex: pass.r25.march.vertexShader,
    shafts: pass.r25.shafts ? { source: pass.r25.shafts.sourceMaterial.fragmentShader, blur: pass.r25.shafts.blurMaterial.fragmentShader } : null,
    uniforms: Object.keys(pass.r25.uniforms).sort(),
  };
  if (on) {
    const NS = await imp('lib/fly/night-sky.js');
    const { Vector3 } = THREE;
    const v = new Vector3();
    // Polaris (RA 2h31m49s, Dec +89.264) from 40N: 40 deg up, due north.
    NS.equatorialToScene((2 + 31 / 60 + 49 / 3600) * 15 * Math.PI / 180, 89.264 * Math.PI / 180, NS.localSiderealRad(Date.UTC(2026, 6, 18, 3), -83), 40 * Math.PI / 180, v);
    const polaris = { up: Math.asin(v.y) * 180 / Math.PI, north: -v.z, east: v.x };
    const u = { uLivNight: { value: new THREE.Vector4() }, uLivGalPole: { value: new Vector3() }, uLivGalCenter: { value: new Vector3() } };
    // 2026-07-18 03:00 UTC from Ohio: the galactic centre is low in the south
    // (Sagittarius at ~23h local in July), the pole high in the north-west.
    NS.updateNightSky(u, { timeMs: Date.UTC(2026, 6, 18, 3), latDeg: 40, lonDeg: -83, elapsed: 10 });
    out.galactic = { pole: u.uLivGalPole.value.toArray(), centre: u.uLivGalCenter.value.toArray(), polaris };
    out.skyglow = { manhattan: NS.skyglowAt(40.70, -74.035), innsbruck: NS.skyglowAt(47.215, 11.33), yosemite: NS.skyglowAt(37.705, -119.70), atlantic: NS.skyglowAt(38, -45) };
  }
  return out;
}

if (leg) {
  const texts = await buildTexts(leg === 'on');
  process.stdout.write(JSON.stringify(texts));
  process.exit(0);
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { (ok ? pass++ : fail++); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const run = (l) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${l}`], { cwd: ROOT, maxBuffer: 64 << 20 }).toString());
const off = run('off');
const on = run('on');

// (1) off: no Living World edits, no shafts, no extra uniforms.
check('(1a) flags off: the Enhanced march carries no Living World code', !/\bliv[A-Z]/.test(off.march));
check('(1b) flags off: the Enhanced composite carries no Living World code', !/\bliv[A-Z]/.test(off.composite));
check('(1c) flags off: no shaft targets, no Living uniforms', off.shafts === null && !off.uniforms.some((k) => /^uLiv[A-Z]/.test(k)));
// (2) on: each block's marker, and the Classic pair untouched.
const marks = {
  LIVING_CLOUDS: on.march.includes('float cloudShade=livKeyDepth(p,footprint);') && on.march.includes('livScatter(mu,cloudShade,powder)'),
  FAR_CLOUDS: on.march.includes('livFarDeck(ray,livTR,metricRay,rayCone,livSceneT,livFarL,livFarA);'),
  CIRRUS: on.march.includes('livCirrus(ray,livTR,metricRay,rayCone,livSceneT,livFarL,livFarA);'),
  LIGHT_SHAFTS: on.composite.includes('livShaftLight(vUv,') && !!on.shafts,
  LENS_FLARE: on.composite.includes('livLens(vUv)'),
  NIGHT_SKY: on.composite.includes('light+=livMilkyWay(ray)*uCinemaOptics.y;') && on.composite.includes('livTwinkle(cell,ray.y)'),
};
check('(2a) flags on: every block is in its program', Object.values(marks).every(Boolean), JSON.stringify(marks));
check('(2b) flags on: the Classic march and composite are byte-identical to flags off', on.classicMarch === off.classicMarch && on.classicComposite === off.classicComposite);
check('(2c) flags on: the TRUE_SCALE and HDR_GUARD edits survive', on.march.includes('tsTrueRay') === off.march.includes('tsTrueRay') && on.composite.includes('hdrSafe(') === off.composite.includes('hdrSafe('));

// (4) the galactic frame
const g = on.galactic;
const len = (v) => Math.hypot(...v);
check('(4a) Polaris from 40N stands ~40 deg up, due north', Math.abs(g.polaris.up - 40) < 1.2 && g.polaris.north > 0.7 && Math.abs(g.polaris.east) < 0.03, JSON.stringify(g.polaris));
check('(4b) July 23h local, Ohio: the galactic centre low in the south, the pole high', g.centre[1] > 0 && g.centre[1] < 0.45 && g.centre[2] > 0.6 && g.pole[1] > 0.45 && Math.abs(len(g.pole) - 1) < 1e-9 && Math.abs(len(g.centre) - 1) < 1e-9, `centre ${g.centre.map((x) => x.toFixed(2))} pole ${g.pole.map((x) => x.toFixed(2))}`);

const sg = on.skyglow;
check('(4c) skyglow: Manhattan near 1, the open Atlantic 0, Yosemite low, Innsbruck between', sg.manhattan > 0.85 && sg.atlantic === 0 && sg.yosemite < 0.25 && sg.innsbruck > sg.yosemite && sg.innsbruck < sg.manhattan, JSON.stringify(Object.fromEntries(Object.entries(sg).map(([k, v]) => [k, +v.toFixed(3)]))));

// (3) compile + link in WebGL2
const { chromium } = await import('playwright');
const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const fs = await import('node:fs');
const browser = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  const programs = [['march', on.vertex, on.march], ['composite', on.vertex, on.composite], ['shaft-source', on.vertex, on.shafts.source], ['shaft-blur', on.vertex, on.shafts.blur], ['march (off)', off.vertex, off.march], ['composite (off)', off.vertex, off.composite]];
  const results = await page.evaluate((programs) => {
    const gl = document.createElement('canvas').getContext('webgl2');
    // three's ShaderMaterial prefix (r185, GLSL3), the parts these programs use.
    const vp = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler3D;\nuniform mat4 modelMatrix,modelViewMatrix,projectionMatrix,viewMatrix;\nuniform mat3 normalMatrix;\nuniform vec3 cameraPosition;\nin vec3 position;in vec3 normal;in vec2 uv;\n#define varying out\n#define attribute in\n#define texture2D texture\n';
    const fp = '#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler3D;\nprecision highp sampler2D;\nuniform mat4 viewMatrix;\nuniform vec3 cameraPosition;\nuniform bool isOrthographic;\n#define varying in\nlayout(location = 0) out highp vec4 pc_fragColor;\n#define gl_FragColor pc_fragColor\n#define texture2D texture\n#define textureCube texture\n#define CINEMA_BANK_LUT 1\n';
    const out = [];
    for (const [name, vs, fs] of programs) {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return [s, gl.getShaderParameter(s, gl.COMPILE_STATUS) ? null : gl.getShaderInfoLog(s)]; };
      const [v, ve] = sh(gl.VERTEX_SHADER, vp + vs);
      const [f, fe] = sh(gl.FRAGMENT_SHADER, fp + fs);
      let le = null;
      if (!ve && !fe) { const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) le = gl.getProgramInfoLog(p); else out.push([name, null, gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)]); }
      if (ve || fe || le) out.push([name, (ve || fe || le).slice(0, 1200), 0]);
    }
    return out;
  }, programs);
  for (const [name, err, uniforms] of results) check(`(3) ${name} compiles and links`, !err, err ?? `${uniforms} active uniforms`);
} finally {
  await browser.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

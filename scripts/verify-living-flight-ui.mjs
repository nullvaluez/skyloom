/**
 * LIVING WORLD — verify-living-flight-ui: the UI-FLIGHT workstream's gate
 * (FLIGHT_INSTRUMENTS, HANGAR_STAGE; FLY_LIVING_WORLD.md).
 *
 * NODE (always):
 *  (1) Flag off = today's HUD markup. FlyHUD is server-rendered (react-dom/
 *      server) with the flag pinned off and compared byte for byte with the
 *      FlyHUD of the commit this pass started from, in four store states
 *      (Enhanced, Enhanced + spotting, Classic, Neon).
 *  (2) Flag on: the instruments element is in the HUD, the stats strip carries
 *      data-instruments, and every data-testid of the off markup is still
 *      there.
 *  (3) The instruments' geometry: every tape, readout box and the heading
 *      scale sit inside the viewport on desktop (1600×900, 1280×720) and both
 *      phone orientations (390×844, 844×390); the desktop left tape clears the
 *      operations panel; the glass sits between the tapes.
 *  (4) The flight-path marker's projection: projectDirection() agrees with
 *      three's Vector3.project of a far point to well under a pixel, on a
 *      plain, a rolled and a view-offset camera, and refuses a direction
 *      behind the camera.
 *  (5) Flag off = today's hangar scene. The classic `Bay` is byte-identical
 *      (line endings normalised) to the starting commit's, HangarScene renders
 *      it unless HANGAR_STAGE is on, the shared `Aircraft` differs only by
 *      comments, and the stage's framing table is the Bay's own.
 *  (6) The stage's contracts, from source: the reflector exists only off the
 *      cheap path (phone or Low), reduced motion cuts the camera and stops the
 *      turntable and the dust, and the AIRFRAME integration point is marked.
 *  (7) CameraGlide: an eased move ends exactly on its goal, never cuts through
 *      the target (the radius is interpolated), and swings the short way.
 *
 * BROWSER (with --url=http://localhost:PORT, a running dev server):
 *  (8) For each arm (flags off via ?flags=-FLIGHT_INSTRUMENTS,-HANGAR_STAGE,
 *      and on): the hangar's testids exist; the hangar scene census (three
 *      devtools hook) is today's in the off arm (two directional lights and a
 *      hemisphere at today's intensities, no stage object, the classic floor)
 *      and carries the stage in the on arm (key, pool, two rims, door sun,
 *      haze, reflector floor), whose turntable turns after the idle delay.
 *  (9) In flight: the off arm has no instruments; the on arm has them, every
 *      HUD testid is present in both, and in held level flight the marker
 *      sits on the horizon rung (they share the frame's camera).
 * (10) Phones (390×844 and 844×390, touch): the instruments overlap no touch
 *      control and no HUD zone member; zero page errors in every run.
 *
 * Run:  node scripts/verify-living-flight-ui.mjs [--url=http://localhost:3144]
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = '5ed7486'; // the tree the Living World UI-FLIGHT pass started from
const leg = process.argv.find((a) => a.startsWith('--leg='))?.slice(6);
const urlArg = (process.argv.find((a) => a.startsWith('--url='))?.slice(6) || process.env.FLY_URL || '').replace(/\/$/, '');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const lf = (s) => s.replace(/\r\n/g, '\n');

/** Node hooks for the legs: JSX through the repo's TypeScript, CSS and R3F stubbed, `?lwbase` = the file at BASE. */
function registerHooks() {
  const tsUrl = pathToFileURL(path.join(ROOT, 'node_modules/typescript/lib/typescript.js')).href;
  const hooks = `
    import { readFileSync } from 'node:fs';
    import { execFileSync } from 'node:child_process';
    import { fileURLToPath } from 'node:url';
    import path from 'node:path';
    import tsMod from ${JSON.stringify(tsUrl)};
    const ts = tsMod.default ?? tsMod;
    const ROOT = ${JSON.stringify(ROOT)};
    const STUB = {
      'lwui-stub:css': 'export default {};',
      'lwui-stub:fiber': 'export const addAfterEffect = () => () => {}; export const useFrame = () => {}; export const useThree = () => ({});',
    };
    export async function resolve(spec, ctx, next) {
      if (spec.endsWith('.css')) return { url: 'lwui-stub:css', shortCircuit: true };
      if (spec === '@react-three/fiber') return { url: 'lwui-stub:fiber', shortCircuit: true };
      return next(spec, ctx);
    }
    export async function load(url, ctx, next) {
      if (STUB[url]) return { format: 'module', source: STUB[url], shortCircuit: true };
      if (!url.startsWith('file:')) return next(url, ctx);
      const u = new URL(url);
      const base = u.searchParams.get('lwbase');
      const file = fileURLToPath(u.href.split('?')[0]);
      if (!base && !file.endsWith('.jsx')) return next(url, ctx);
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      let source = base ? execFileSync('git', ['show', base + ':' + rel], { cwd: ROOT, encoding: 'utf8' }) : readFileSync(file, 'utf8');
      if (file.endsWith('.jsx')) {
        source = ts.transpileModule(source, { fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
      }
      return { format: 'module', source, shortCircuit: true };
    }`;
  register(pathToFileURL(path.join(ROOT, 'scripts/_node-resolve.mjs')).href);
  register(`data:text/javascript,${encodeURIComponent(hooks)}`);
}

const STATES = {
  enhanced: { mapStyle: 'satellite', visuals: 'enhanced', spotting: false },
  'enhanced-spotting': { mapStyle: 'satellite', visuals: 'enhanced', spotting: true },
  classic: { mapStyle: 'satellite', visuals: 'classic', spotting: false },
  neon: { mapStyle: 'toy', visuals: 'enhanced', spotting: false },
};

async function runLeg(on) {
  globalThis.window = { location: { search: '', href: 'http://localhost/' } };
  globalThis.window.__flyFlightInstrumentsOverride = { enabled: on };
  globalThis.window.__flyHangarStageOverride = { enabled: on };
  process.env.NODE_ENV = 'production';
  registerHooks();
  const imp = (rel, q = '') => import(pathToFileURL(path.join(ROOT, rel)).href + q);
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { useFlyStore } = await imp('stores/fly-store.js');
  const now = await imp('components/fly/hud/FlyHUD.jsx');
  const base = on ? null : await imp('components/fly/hud/FlyHUD.jsx', `?lwbase=${BASE}`);
  const runtime = { flight: null, geo: null };
  const render = (Mod, state) => {
    const arm = { ...state, qualityTier: 'high', qualityPreset: 'high', cameraMode: 'chase', lockState: 'idle' };
    Object.assign(useFlyStore.getInitialState(), arm);
    useFlyStore.setState(arm);
    return renderToStaticMarkup(React.createElement(Mod.FlyHUD, { runtime }));
  };
  const out = { markups: {}, base: {} };
  for (const [name, state] of Object.entries(STATES)) {
    out.markups[name] = render(now, state);
    if (base) out.base[name] = render(base, state);
  }
  if (on) {
    const FI = await imp('components/fly/hud/FlightInstruments.jsx');
    const THREE = await imp('node_modules/three/build/three.module.js');
    const { FLIGHT_INSTRUMENTS } = await imp('lib/fly/fly-constants.js');
    out.layouts = {};
    for (const [name, w, h, phone, landscape] of [
      ['desktop', 1600, 900, false, false],
      ['desktop-720', 1280, 720, false, false],
      ['portrait', 390, 844, true, false],
      ['landscape', 844, 390, true, true],
    ]) {
      const L = FI.instrumentLayout(w, h, { phone, landscape, cfg: FLIGHT_INSTRUMENTS });
      const font = L.font;
      const ro = L.kind === 'desktop' ? font + 6 : font + 3;
      const boxW = Math.max(L.tapeW + 10, Math.ceil(ro * 0.62 * 6 + 14));
      const boxes = {
        speedTape: [L.speed.x - L.tapeW, L.cy - L.tapeH / 2, L.speed.x, L.cy + L.tapeH / 2],
        speedBox: [L.speed.x - 7 - boxW, L.cy - ro, L.speed.x, L.cy + ro],
        speedLabels: [L.speed.x - 15 - ro * 0.62 * 3, L.cy - L.tapeH / 2, L.speed.x, L.cy + L.tapeH / 2],
        altTape: [L.alt.x, L.cy - L.tapeH / 2, L.alt.x + L.tapeW, L.cy + L.tapeH / 2],
        altBox: [L.alt.x, L.cy - ro, L.alt.x + 7 + boxW, L.cy + ro],
        altLabels: [L.alt.x, L.cy - L.tapeH / 2, L.alt.x + 15 + font * 0.62 * 6, L.cy + L.tapeH / 2],
        heading: [L.cx - L.heading.w / 2, L.heading.y - 18 - font, L.cx + L.heading.w / 2, L.heading.y + 9 + font * 2],
        annunciators: [L.speed.x - L.tapeW, L.cy + L.tapeH / 2, L.alt.x + L.tapeW, L.cy + L.tapeH / 2 + 16 + font * 2.2],
      };
      out.layouts[name] = { w, h, kind: L.kind, field: L.field, ladder: L.ladder, boxes, speedOuter: Math.min(L.speed.x - L.tapeW, L.speed.x - 7 - boxW) };
    }
    // (4) projection agreement
    const W = 1600, H = 900;
    const errs = [];
    const cams = [];
    const c1 = new THREE.PerspectiveCamera(60, W / H, 0.5, 1e7);
    c1.position.set(120, 900, -40);
    c1.lookAt(400, 860, -2000);
    cams.push(['plain', c1]);
    const c2 = c1.clone();
    c2.rotateZ(0.31);
    cams.push(['rolled', c2]);
    const c3 = new THREE.PerspectiveCamera(42, W / H, 0.1, 6000);
    c3.position.set(10, 8, -25);
    c3.lookAt(0, 1, 0);
    c3.setViewOffset(W, H, W * 0.08, 0, W, H);
    cams.push(['view-offset', c3]);
    const out2 = [0, 0];
    for (const [name, cam] of cams) {
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      // Directions inside the view: the camera's forward nudged along its own right and up.
      const fwd0 = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
      cam.getWorldDirection(fwd0);
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      for (const [a, b] of [[0.1, -0.05], [-0.3, 0.12], [0.02, 0.3], [0.45, -0.2]]) {
        const v = fwd0.clone().addScaledVector(right, a).addScaledVector(up, b).normalize();
        const far = cam.position.clone().addScaledVector(v, 1e6).project(cam);
        const ok = FI.projectDirection(cam, v.x, v.y, v.z, W, H, out2);
        const fx = ((far.x + 1) / 2) * W;
        const fy = ((1 - far.y) / 2) * H;
        errs.push({ cam: name, ok, err: Math.hypot(out2[0] - fx, out2[1] - fy) });
      }
      const fwd = new THREE.Vector3();
      cam.getWorldDirection(fwd);
      errs.push({ cam: name, behind: FI.projectDirection(cam, -fwd.x, -fwd.y, -fwd.z, W, H, out2) });
    }
    out.projection = errs;
  }
  return out;
}

if (leg) {
  const r = await runLeg(leg === 'on');
  process.stdout.write(JSON.stringify(r));
  process.exit(0);
}

let pass = 0, fail = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  ok ? pass++ : (fail++, fails.push(name));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const run = (l) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${l}`], { cwd: ROOT, maxBuffer: 64 << 20 }).toString());
const testids = (html) => [...html.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]).sort();

console.log('[node]');
const off = run('off');
const on = run('on');

// (1) flag off = today's HUD markup
for (const s of Object.keys(STATES)) {
  check(`(1) ${s}: FLIGHT_INSTRUMENTS off renders the starting commit's FlyHUD byte for byte`, off.markups[s] === off.base[s] && off.markups[s].length > 500, `${off.markups[s].length} chars`);
}
// (2) flag on carries the additions, keeps every testid
for (const s of Object.keys(STATES)) {
  const m = on.markups[s];
  const missing = testids(off.markups[s]).filter((t) => !m.includes(`data-testid="${t}"`));
  check(`(2) ${s}: instruments mounted, strip marked, every testid kept`, m.includes('data-testid="hud-instruments"') && /data-testid="flight-stats-strip"[^>]*data-instruments="1"/.test(m) && missing.length === 0 && !off.markups[s].includes('hud-instruments'), missing.length ? `missing ${missing}` : '');
}

// (3) geometry
const inside = (b, w, h, m = 2) => b[0] >= m && b[1] >= m && b[2] <= w - m && b[3] <= h - m;
for (const [name, L] of Object.entries(on.layouts)) {
  const out = Object.entries(L.boxes).filter(([, b]) => !inside(b, L.w, L.h)).map(([k, b]) => `${k} ${b.map((v) => Math.round(v))}`);
  check(`(3a) ${name}: every instrument inside the ${L.w}×${L.h} viewport`, out.length === 0, out.join('; '));
  check(`(3b) ${name}: the glass sits between the tapes and under the heading readout`, L.field.x0 > L.boxes.speedTape[2] && L.field.x1 < L.boxes.altTape[0] && L.field.y0 > L.boxes.heading[3] - 1);
  if (L.kind === 'desktop') check(`(3c) ${name}: the speed tape clears the 296 px operations panel`, L.speedOuter >= 320, `outer ${Math.round(L.speedOuter)} px`);
  else check(`(3c) ${name}: no pitch ladder on a phone`, L.ladder === false);
}

// (4) projection
const projErr = on.projection.filter((r) => r.err !== undefined);
const worst = Math.max(...projErr.map((r) => r.err));
check('(4a) projectDirection agrees with Vector3.project (plain, rolled, view-offset)', projErr.every((r) => r.ok) && worst < 0.05, `worst ${worst.toExponential(2)} px`);
check('(4b) a direction behind the camera is refused', on.projection.filter((r) => 'behind' in r).every((r) => r.behind === false));

// (5) the classic hangar is untouched
const hsNow = lf(readFileSync(path.join(ROOT, 'components/fly/hud/HangarScene.jsx'), 'utf8'));
const hsBase = lf(git('show', `${BASE}:components/fly/hud/HangarScene.jsx`));
const fn = (src, name) => {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return null;
  const j = src.indexOf('\nfunction ', i + 10);
  const k = src.indexOf('\nexport function ', i + 10);
  const l = src.indexOf('\n/*', i + 10);
  const ends = [j, k, l].filter((x) => x > 0);
  return src.slice(i, Math.min(...ends));
};
check('(5a) the classic Bay is byte-identical to the starting commit (line endings normalised)', fn(hsNow, 'Bay') !== null && fn(hsNow, 'Bay') === fn(hsBase, 'Bay'), `${fn(hsNow, 'Bay')?.length ?? 0} chars`);
const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, '');
check('(5b) the shared Aircraft differs from the starting commit by comments only', strip(fn(hsNow, 'Aircraft')) === strip(fn(hsBase, 'Aircraft')));
check('(5c) HangarScene renders Bay unless HANGAR_STAGE is on (one page-load decision)', /const STAGE = livingWorldOn\('HANGAR_STAGE'\);/.test(hsNow) && /\{STAGE\s*\?<StageBay [^>]*\/>\s*:<Bay aircraft=\{aircraft\} airport=\{airport\} onReady=\{onReady\} onError=\{onError\} onExteriorReady=\{onExteriorReady\} view=\{view\}\/>\}/.test(hsNow.replace(/\n\s*/g, '')));
registerHooks();
const stage = await import(pathToFileURL(path.join(ROOT, 'components/fly/hud/hangar-stage.js')).href);
const table = Function(`return (${fn(hsBase, 'Bay').match(/const positions=(\{[^;]*\});/)[1]})`)();
check("(5d) the stage frames each view exactly where the Bay cuts to", JSON.stringify(table) === JSON.stringify(stage.VIEW_POSITIONS));

// (6) stage contracts, from source
const body = fn(hsNow, 'StageBay') ?? '';
check('(6a) the reflector floor is off the cheap path only (phones and Low keep a plain floor)', /const cheap=isPhoneClass\(\)\|\|tier==='low';/.test(body) && /\{cheap\?<meshStandardMaterial[^>]*\/>\s*:<MeshReflectorMaterial /.test(body) && (body.match(/MeshReflectorMaterial/g) || []).length === 1);
check('(6b) reduced motion: the camera cuts, the turntable stops, the dust holds still', /if\(readReducedMotion\(\)\|\|previous===next\)\{/.test(body) && /if\(m\.homing\|\|reduced\)/.test(body) && /if\(!reduced\)advanceHaze\(haze,dt\);/.test(body));
check('(6c) the AIRFRAME_DETAIL integration point is marked inside Aircraft', /AIRFRAME_DETAIL integration point[\s\S]*applyAirframeDetail\(object, aircraft\.id, \{ context: 'hangar' \}\);[\s\S]*return object;/.test(fn(hsNow, 'Aircraft')));
const constants = lf(readFileSync(path.join(ROOT, 'lib/fly/fly-constants.js'), 'utf8'));
check('(6d) both blocks ship on (their consumers are in this tree)', /export const FLIGHT_INSTRUMENTS = \{\n  enabled: true,/.test(constants) && /export const HANGAR_STAGE = \{\n  enabled: true,/.test(constants));

// (7) CameraGlide
{
  const { Vector3 } = await import(pathToFileURL(path.join(ROOT, 'node_modules/three/build/three.module.js')).href);
  const g = new stage.CameraGlide();
  const from = new Vector3(20, 9, -30), fromT = new Vector3(0, 1, 0), to = new Vector3(-12, 8, 30), toT = new Vector3(0, 2.5, 0);
  g.start(from, fromT, to, toT, { minSec: 1, maxSec: 1.4 });
  const pos = new Vector3(), look = new Vector3();
  let minR = Infinity, steps = 0, maxJump = 0, total = 0, prev = from.clone();
  const stepsLen = [];
  while (g.step(1 / 60, pos, look) && steps < 1000) {
    steps++;
    minR = Math.min(minR, pos.distanceTo(look));
    const d = pos.distanceTo(prev);
    stepsLen.push(d);
    total += d;
    maxJump = Math.max(maxJump, d);
    prev.copy(pos);
  }
  const r0 = from.distanceTo(fromT), r1 = to.distanceTo(toT);
  check('(7a) a glide ends exactly on its goal', pos.distanceTo(to) < 1e-9 && look.distanceTo(toT) < 1e-9 && !g.active, `${steps} frames`);
  check('(7b) it swings round the target, never through it', minR >= Math.min(r0, r1) * 0.97, `min radius ${minR.toFixed(2)} vs ${Math.min(r0, r1).toFixed(2)}`);
  // easeInOutCubic peaks at 3x its mean speed; anything above that is a jump.
  const mean = total / steps;
  check('(7c) no frame jumps: eased in, eased out, never faster than the cubic peak', maxJump <= mean * 3.15 && stepsLen[0] < maxJump * 0.05 && stepsLen.at(-1) < maxJump * 0.05, `peak ${(maxJump / mean).toFixed(2)}x mean, first ${stepsLen[0].toFixed(3)} m, last ${stepsLen.at(-1).toFixed(3)} m`);
  const g2 = new stage.CameraGlide();
  g2.start(new Vector3(10, 5, -1), new Vector3(), new Vector3(10, 5, 1), new Vector3());
  g2.step(g2.duration / 2, pos, look);
  check('(7d) the short way round (a small swing stays on its side)', pos.x > 9, `mid x ${pos.x.toFixed(2)}`);
}

// ------------------------------------------------------------------- browser
if (urlArg) {
  console.log(`\n[browser ${urlArg}]`);
  const { chromium } = await import('playwright');
  const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({
    executablePath: existsSync(exe) ? exe : undefined,
    headless: true,
    args: process.platform === 'win32' ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const CTX = {
    desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 },
    portrait: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA },
    landscape: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA },
  };
  const HANGAR_IDS = ['hangar', 'hangar-fly', 'hangar-customize', 'hangar-back', 'hangar-pick-fighter', 'hangar-pick-airliner'];
  const HUD_IDS = ['flight-stats-strip', 'hud-poi', 'hud-chase-chip', 'hud-quality-tier'];
  async function session(device, onArm) {
    const ctx = await browser.newContext(CTX[device]);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 300)));
    await page.addInitScript(() => {
      window.__flyGovPin = 'hold';
      window.__flyVisualsOverride = 'enhanced';
      const hook = new EventTarget();
      window.__THREE_DEVTOOLS__ = hook;
      window.__lwScenes = [];
      hook.addEventListener('observe', (e) => { if (e.detail?.isScene) window.__lwScenes.push(e.detail); });
      try {
        localStorage.setItem('fly-map-style-2', 'satellite');
        localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-sound-on', '0');
        localStorage.setItem('fly-encounters', '0');
      } catch { /* private mode */ }
    });
    await page.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
    const flags = onArm ? '' : '&flags=-FLIGHT_INSTRUMENTS,-HANGAR_STAGE';
    await page.goto(`${urlArg}/?graphicsReview=1${flags}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
    return { ctx, page, errors };
  }
  const tag = (onArm) => (onArm ? 'on' : 'off');

  for (const onArm of [false, true]) {
    const { ctx, page, errors } = await session('desktop', onArm);
    try {
      await page.waitForSelector('[data-testid="title-screen"]', { timeout: 300000 });
      await page.click('[data-testid="title-explore"]');
      await page.waitForSelector('[data-testid="hangar"]', { timeout: 60000 });
      await page.waitForFunction(() => !/Loading aircraft/.test(document.querySelector('[data-testid="hangar-fly"]')?.textContent || 'Loading aircraft'), undefined, { timeout: 180000 });
      const ids = await page.evaluate((ids) => ids.filter((id) => !document.querySelector(`[data-testid="${id}"]`)), HANGAR_IDS);
      check(`(8a) ${tag(onArm)}: every hangar testid present`, ids.length === 0, ids.join(', '));
      const census = () => page.evaluate(() => {
        const scene = window.__lwScenes.find((s) => s.getObjectByName('hangar-architecture'));
        if (!scene) return null;
        const lights = [];
        const stage = [];
        scene.traverse((o) => {
          if (o.isLight) lights.push(`${o.type}:${o.intensity.toFixed(2)}`);
          if (o.name?.startsWith('hangar-stage')) stage.push(o.name);
        });
        const arch = scene.getObjectByName('hangar-architecture');
        const floor = arch.children[0];
        const turn = scene.getObjectByName('hangar-stage-turntable');
        const haze = scene.getObjectByName('hangar-stage-haze');
        return { lights: lights.sort(), stage: [...new Set(stage)].sort(), floorColor: `#${floor.material.color.getHexString()}`, reflector: 'tDiffuse' in floor.material || !!floor.material.uniforms?.tDiffuse || floor.material.constructor.name.includes('Reflector'), yaw: turn ? turn.rotation.y : null, haze: haze ? haze.children.length : 0 };
      });
      const c0 = await census();
      if (!onArm) {
        check('(8b) off: the hangar scene is today\'s (lights, no stage object, classic floor)', !!c0 && JSON.stringify(c0.lights) === JSON.stringify(['DirectionalLight:0.80', 'DirectionalLight:3.00', 'HemisphereLight:0.65']) && c0.stage.length === 0 && c0.floorColor === '#263844' && !c0.reflector, JSON.stringify(c0));
      } else {
        const want = ['hangar-stage-floor', 'hangar-stage-haze', 'hangar-stage-key', 'hangar-stage-pool', 'hangar-stage-rim', 'hangar-stage-sun', 'hangar-stage-turntable'];
        check('(8b) on: the stage is lit and dressed (key, pool, rims, door sun, haze, reflector floor)', !!c0 && want.every((n) => c0.stage.includes(n)) && c0.reflector && c0.haze >= 4 && c0.lights.filter((l) => l.startsWith('SpotLight')).length === 4, JSON.stringify(c0));
        await page.mouse.move(5, 5);
        await page.waitForTimeout(10500);
        const c1 = await census();
        check('(8c) on: the turntable turns after the idle delay', !!c1 && Math.abs(c1.yaw) > 0.05, `yaw ${c1?.yaw?.toFixed(3)}`);
      }

      // Into flight, held level (the capture idiom).
      await page.evaluate(() => {
        const rt = window.__fly, store = window.__flyStore.getState();
        rt.operations.phase = 'airborne'; rt.operations.profile = null; rt.operations.warp(rt.flight);
        store.setHangarOpen(false);
        rt.warpToGeo(47.215, 11.33, { altM: 2900, headingRad: 160 * Math.PI / 180, name: null });
      });
      await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, { timeout: 300000, polling: 1000 }).catch(() => {});
      await page.evaluate(() => {
        const f = window.__fly.flight;
        const y = f.pos.y, h = f.heading;
        const step = f.step.bind(f);
        f.step = (dt, cmd) => { step(dt, { ...cmd, turn: 0, pitch: 0, boost: false }); f.pos.y = y; f.heading = h; f.pitch = 0; f.bank = 0; f.agl = f.pos.y - f.groundElev; };
      });
      await page.waitForTimeout(6000);
      const hud = await page.evaluate((ids) => {
        const fi = document.querySelector('[data-testid="hud-instruments"]');
        const strip = document.querySelector('[data-testid="flight-stats-strip"]');
        const fpm = document.querySelector('[data-testid="hud-flight-path-marker"]');
        const horizon = document.querySelector('.fi-rung[data-deg="0"]');
        const xy = (el) => { const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(el?.getAttribute('transform') || ''); return m ? [Number(m[1]), Number(m[2])] : null; };
        return {
          missing: ids.filter((id) => !document.querySelector(`[data-testid="${id}"]`)),
          instruments: !!fi, kind: fi?.getAttribute('data-kind'),
          stripMarked: strip?.getAttribute('data-instruments') ?? null,
          speed: document.querySelector('[data-testid="hud-tape-speed-value"]')?.textContent ?? null,
          alt: document.querySelector('[data-testid="hud-tape-altitude-value"]')?.textContent ?? null,
          fpmState: fpm?.getAttribute('data-state') ?? null, fpm: xy(fpm), horizon: horizon?.getAttribute('data-on') === '1' ? xy(horizon) : null,
        };
      }, HUD_IDS);
      check(`(9a) ${tag(onArm)}: every HUD testid present in flight`, hud.missing.length === 0, hud.missing.join(', '));
      if (!onArm) check('(9b) off: no instruments, the strip unmarked', !hud.instruments && hud.stripMarked === null);
      else {
        check('(9b) on: the instruments fly (tapes read, marker up)', hud.instruments && hud.kind === 'desktop' && hud.stripMarked === '1' && /^\d+$/.test(hud.speed || '') && /\d/.test(hud.alt || '') && hud.fpmState === 'on', JSON.stringify(hud));
        const dy = hud.fpm && hud.horizon ? Math.abs(hud.fpm[1] - hud.horizon[1]) : Infinity;
        check('(9c) on: in level flight the marker sits on the horizon rung (same frame, same camera)', dy < 3, `|dy| ${Number.isFinite(dy) ? dy.toFixed(2) : 'n/a'} px`);
      }
      check(`(10a) ${tag(onArm)} desktop: zero page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    } catch (e) {
      check(`(8) ${tag(onArm)} desktop run`, false, e.message.split('\n')[0]);
    } finally {
      await ctx.close();
    }
  }

  for (const device of ['portrait', 'landscape']) {
    const { ctx, page, errors } = await session(device, true);
    try {
      await page.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 300000 });
      await page.evaluate(() => {
        const rt = window.__fly, store = window.__flyStore.getState();
        rt.operations.phase = 'airborne'; rt.operations.profile = null; rt.operations.warp(rt.flight);
        store.setHangarOpen(false);
        rt.warpToGeo(47.215, 11.33, { altM: 2900, headingRad: 160 * Math.PI / 180, name: null });
      });
      await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, { timeout: 300000, polling: 1000 }).catch(() => {});
      await page.waitForTimeout(5000);
      const geo = await page.evaluate(() => {
        const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; };
        const fi = document.querySelector('[data-testid="hud-instruments"]');
        const parts = fi ? [...fi.querySelectorAll('[data-testid^="hud-tape-"], [data-testid="hud-heading-scale"], [data-testid="hud-throttle-mode"], [data-testid="hud-vertical-speed"], [data-testid="hud-radar-altitude"]')]
          .filter((el) => getComputedStyle(el).visibility !== 'hidden').map((el) => ({ id: el.dataset.testid, ...rect(el) })).filter((p) => p.r > p.x) : [];
        const controls = [...document.querySelectorAll('[data-fly-root] button, [data-fly-root] [role="button"], [data-testid^="touch-"], [data-zone] canvas, [data-testid="contracts-panel"]')]
          .filter((el) => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.01 && !el.closest('[data-testid="hud-instruments"]'); })
          .map((el) => ({ id: el.dataset.testid || el.getAttribute('aria-label') || el.className?.toString().slice(0, 24) || el.tagName, ...rect(el) }))
          .filter((c) => c.r - c.x > 1 && c.b - c.y > 1);
        return { kind: fi?.getAttribute('data-kind'), parts, controls, w: innerWidth, h: innerHeight };
      });
      const hit = (a, b) => a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1;
      const clashes = [];
      for (const p of geo.parts) for (const c of geo.controls) if (hit(p, c)) clashes.push(`${p.id} × ${c.id}`);
      const outside = geo.parts.filter((p) => p.x < 0 || p.y < 0 || p.r > geo.w || p.b > geo.h).map((p) => p.id);
      check(`(10b) ${device}: the instruments are up in the ${device} layout`, geo.kind === device && geo.parts.length >= 4, `${geo.parts.length} parts`);
      check(`(10c) ${device}: no instrument overlaps a touch control or HUD zone member`, clashes.length === 0, clashes.slice(0, 6).join('; '));
      check(`(10d) ${device}: every instrument inside the viewport`, outside.length === 0, outside.join(', '));
      check(`(10e) ${device}: zero page errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    } catch (e) {
      check(`(10) ${device} run`, false, e.message.split('\n')[0]);
    } finally {
      await ctx.close();
    }
  }
  await browser.close();
} else {
  console.log('\n(browser legs skipped: pass --url=http://localhost:PORT to run (8)-(10))');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log(`FAILED: ${fails.join(' | ')}`);
process.exit(fail ? 1 : 0);

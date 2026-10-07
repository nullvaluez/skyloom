/**
 * MULTIPLAYER — verify-mp-smoke: smoke rendering and the Atlas pilots
 * (MULTIPLAYER.md; design §6 smoke, §8 key 7, §9 Atlas). Node only, no browser,
 * no network, no relay:
 *
 *   node scripts/verify-mp-smoke.mjs
 *
 * The real Contrail.jsx / TrafficContrails.jsx run here: compiled with Next's
 * bundled babel preset-react, rendered once with react-dom/server, and their
 * useFrame callbacks (captured by a stub @react-three/fiber) driven frame by
 * frame against the real WakeBatch, whose mesh is read straight back.
 *
 * OFF (this process, shipped constants — the harness fleet's state):
 * (1) smokeStations: every AIRCRAFT_IDS id -> a memoized (same reference every
 *     call) array of finite xyz stations; a jet's IS playerEngineOffsets(id),
 *     an engine-less type's is ONE tail [0, 0, targetLenM/2] (the mirror of
 *     lib/fly/player-aircraft.js).
 * (2) The flag-off premise: contrail.enabled <=> the type has engines, and no
 *     trail-less type has an afterburner (wing vapor) — so every <Contrail>
 *     mounted without multiplayer keeps its exact stations and density.
 * (3) wakeDensity: smoking = 1, grounded too (viewers have no ground bit);
 *     otherwise a jet's is
 *     contrailStrength bit for bit and an engine-less type's is 0 everywhere.
 * (4) FLAG-OFF IDENTITY A/B against the pre-multiplayer tree (BASE): Contrail
 *     over a scripted flight for every trailing type (fed the PRESENTATION
 *     engines PlayerPlane publishes — the Talon's 2 for its 1 wake), and TrafficContrails over
 *     an ADS-B fleet — every frame's ribbon buffers, draw range and visibility
 *     byte-identical. NOT CALIBRATED (not a fail) if BASE is not in the clone.
 * (5) Own smoke: a Skylark (mounted only for smoke) issues NO ribbon in the
 *     contrail band until runtime.mp.smoke; then one tail plume; a fighter
 *     smokes from both engines below the band and on the ground (as viewers
 *     see it); smoke off ends the plume and it ages out to no draw.
 * (6) Remote smoke: F.SMOKE on a low remote — a prop draws one tail ribbon, a
 *     fighter one per engine; a non-smoking glider in the band draws nothing,
 *     a remote airliner still condenses; a snapEpoch bump restarts a wake;
 *     smoke off ages out; the whole fleet stays ONE mesh.
 * (7) Source: FlyScene mounts <Contrail> on (aircraft.contrail.enabled ||
 *     MP_SMOKE) with MP_SMOKE = mpAvailable() at module scope.
 * (8) Atlas pilots: pilotEntry / pilotsWarpOpts; with the flag off the Atlas
 *     hands AtlasMap exactly the filtered POI list even with an online store
 *     full of clusters; PilotsCard renders its testids; the pilots warp never
 *     logs a visit; where() is asked on open and every 5 s.
 *
 * ON (a child process with the URL-flag pin and a wss:// relay URL):
 * (9) online -> one 'pilots' map entry per cluster after the POIs (key
 *     'mp:'+cell, dot 2.6 + log2 n, n = 0 dropped); not online -> none.
 *
 * The browser half (keys, the Atlas round trip to a live relay) belongs to
 * verify-mp-browser.js.
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const ON = process.argv[2] === '--on';
// The last pre-multiplayer commit (the parent of e8b0ddf, the flag scaffold).
const BASE = '213dae3';

// Loader: '@/' + extensionless (the shared hook); .css -> empty; the fiber
// stub for the two wake components; AtlasMap -> a props recorder; .jsx -> babel
// (classic pragma, so every <primitive object> is captured). `?base` loads the
// BASE revision's text of the same file.
const HOOKS = `
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const req = createRequire(${JSON.stringify(path.join(ROOT, 'package.json'))});
const babel = req('next/dist/compiled/babel/core');
const presetReact = req('next/dist/compiled/babel/preset-react');
const ROOT = ${JSON.stringify(ROOT)};
const FIBER = 'export const useFrame = (fn) => { (globalThis.__mpFrames ??= []).push(fn); };';
const ATLAS_MAP = 'export function AtlasMap(p) { (globalThis.__mpAtlasMap ??= []).push(p); return null; }';
const PRAGMA = "import { createElement as __mpCE } from 'react';\\n" +
  "const __mpH = (t, p, ...c) => { if (t === 'primitive') (globalThis.__mpPrims ??= []).push(p.object); return __mpCE(t, p, ...c); };\\n";
export async function resolve(spec, ctx, next) {
  if (spec.endsWith('.css')) return { url: 'data:text/javascript,export default {}', shortCircuit: true };
  const parent = ctx.parentURL ?? '';
  if (spec === '@react-three/fiber' && /\\/components\\/fly\\/(TrafficContrails|Contrail)\\.jsx/.test(parent))
    return { url: 'data:text/javascript,' + encodeURIComponent(FIBER), shortCircuit: true };
  if (spec === './atlas/AtlasMap' && /\\/components\\/fly\\/hud\\/Atlas\\.jsx/.test(parent))
    return { url: 'data:text/javascript,' + encodeURIComponent(ATLAS_MAP), shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (!url.startsWith('file:') || !/\\.jsx(\\?|$)/.test(url)) return next(url, ctx);
  const [u, q] = url.split('?');
  const file = fileURLToPath(u);
  const rev = q?.startsWith('base=') ? q.slice(5) : null;
  const src = rev
    ? execFileSync('git', ['show', rev + ':' + file.slice(ROOT.length + 1)], { cwd: ROOT, encoding: 'utf8' })
    : readFileSync(file, 'utf8');
  const out = babel.transformSync(src, { filename: file, babelrc: false, configFile: false,
    presets: [[presetReact, { runtime: 'classic', pragma: '__mpH', pragmaFrag: '__mpCE.Fragment' }]], sourceType: 'module' });
  return { format: 'module', source: PRAGMA + out.code, shortCircuit: true };
}`;
register('./_node-resolve.mjs', import.meta.url);
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`, import.meta.url);

// three-tile's vendored bundle builds an OffscreenCanvas at module scope; node has none.
globalThis.OffscreenCanvas ??= class {
  getContext() {
    return new Proxy({}, { get: () => () => ({ data: [] }) });
  }
};
globalThis.document ??= { hidden: false };
if (ON) {
  // The URL-flag pin, exactly what installUrlFlags leaves on window.
  globalThis.window = {
    __flyMultiplayerOverride: { enabled: true, url: 'wss://relay.example/mp' },
    location: { protocol: 'https:', host: 'skyloom.test', search: '' },
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
  };
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const info = (name, detail) => console.log(`INFO  ${name}  — ${detail}`);

const { default: React, createElement: h } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
// zustand's SERVER snapshot is getInitialState(); render the live store instead.
const useSES = React.useSyncExternalStore;
React.useSyncExternalStore = (sub, get) => useSES(sub, get, get);

const { PerspectiveCamera, Vector3 } = await import('three');
const { mpAvailable } = await import('../lib/fly/mp/mp-flag.js');
const { F, AIRCRAFT_IDS } = await import('../lib/fly/mp/protocol.mjs');
const { useMpStore } = await import('../stores/mp-store.js');
const { useFlyStore } = await import('../stores/fly-store.js');
const { buildAtlasList } = await import('../lib/fly/poi-data.js');
const FXM = await import('../lib/fly/aircraft-effects.js');
const { AIRCRAFT_EFFECTS: FX, contrailStrength, playerEngineOffsets, smokeStations, wakeDensity } = FXM;
const { PLAYER_AIRCRAFT, resolveAircraft } = await import('../lib/fly/player-aircraft.js');
const { aircraftPresentation } = await import('../lib/fly/cinematic-earth.js');
const C = (rel) => pathToFileURL(path.join(ROOT, 'components/fly', rel)).href;
const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const render = (el) => renderToStaticMarkup(el).replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>');
const quiet = (fn) => {
  const err = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = err;
  }
};

const ENGINELESS = AIRCRAFT_IDS.filter((id) => playerEngineOffsets(id).length === 0);
const TRAILING = AIRCRAFT_IDS.filter((id) => resolveAircraft(id).contrail.enabled);

if (!ON) {
  // ─── (1) smokeStations ───────────────────────────────────────────────────
  {
    const bad = [];
    for (const id of AIRCRAFT_IDS) {
      const s = smokeStations(id);
      if (s !== smokeStations(id)) bad.push(`${id}: not memoized`);
      if (!Array.isArray(s) || !s.length) bad.push(`${id}: empty`);
      if (!s.every((p) => p.length === 3 && p.every(Number.isFinite))) bad.push(`${id}: not xyz`);
      const engines = playerEngineOffsets(id);
      if (engines.length && s !== engines) bad.push(`${id}: jet smoke is not its engine array`);
      if (!engines.length) {
        const len = PLAYER_AIRCRAFT.find((a) => a.id === id)?.targetLenM;
        if (!(s.length === 1 && s[0][0] === 0 && s[0][1] === 0 && s[0][2] === len / 2))
          bad.push(`${id}: tail ${JSON.stringify(s)} vs targetLenM ${len}`);
      }
    }
    check(
      '(1) smokeStations: memoized xyz stations for every aircraft; jets = their engine array, engine-less = one tail at targetLenM/2',
      bad.length === 0 && ENGINELESS.length === 3,
      bad.join('; ') || `engine-less: ${ENGINELESS.join(', ')}`
    );
  }

  // ─── (2) the flag-off premise ────────────────────────────────────────────
  {
    const bad = PLAYER_AIRCRAFT.filter((a) => {
      const r = resolveAircraft(a.id);
      const engines = playerEngineOffsets(a.id).length > 0;
      return r.contrail.enabled !== engines || (!r.contrail.enabled && r.afterburner.enabled);
    }).map((a) => a.id);
    check(
      '(2) premise: contrail.enabled <=> engines, and no trail-less type has an afterburner (wing vapor)',
      bad.length === 0 && TRAILING.length === AIRCRAFT_IDS.length - ENGINELESS.length,
      bad.join(', ') || `trailing: ${TRAILING.join(', ')}`
    );
  }

  // ─── (3) wakeDensity ─────────────────────────────────────────────────────
  {
    const bad = [];
    for (const id of AIRCRAFT_IDS) {
      if (wakeDensity(id, true, 1500, 80) !== 1 || wakeDensity(id, true, 1500, 80, true) !== 1)
        bad.push(`${id}: smoke`);
      for (const alt of [0, 3000, 5800, 7000, 9200, 12000, NaN])
        for (const spd of [0, 55, 90, 115, 240, NaN])
          for (const g of [undefined, false, true, 0, 1]) {
            const d = wakeDensity(id, false, alt, spd, g);
            const want = ENGINELESS.includes(id) ? 0 : contrailStrength(alt, spd, g);
            if (!Object.is(d, want)) bad.push(`${id} ${alt}/${spd}/${g}: ${d} vs ${want}`);
          }
    }
    check(
      '(3) wakeDensity: smoke 1 airborne and grounded; jets = contrailStrength bit for bit; engine-less never condense',
      bad.length === 0,
      bad.slice(0, 4).join('; ')
    );
  }
}

// ─── rigs ──────────────────────────────────────────────────────────────────
const camera = new PerspectiveCamera(60, 1.6, 1, 2e6);
function aimCamera(x, y, z) {
  camera.position.set(x + 220, y + 60, z + 420);
  camera.lookAt(x, y, z);
  camera.updateMatrixWorld(true);
}
function mount(mod, Comp, props) {
  globalThis.__mpFrames = [];
  globalThis.__mpPrims = [];
  quiet(() => render(h(mod[Comp], props)));
  return { frame: globalThis.__mpFrames[0], mesh: globalThis.__mpPrims[0], prims: globalThis.__mpPrims.length };
}
const ribbonsOf = (mesh, points) => mesh.geometry.drawRange.count / ((points - 1) * 6);
function sameMesh(a, b) {
  if (a.visible !== b.visible || a.geometry.drawRange.count !== b.geometry.drawRange.count) return false;
  if (!a.material.color.equals(b.material.color) || a.material.opacity !== b.material.opacity) return false;
  for (const k of ['position', 'aWake', 'aWakeAge']) {
    const x = a.geometry.attributes[k].array;
    const y = b.geometry.attributes[k].array;
    if (!Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(Buffer.from(y.buffer, y.byteOffset, y.byteLength)))
      return false;
  }
  return true;
}
function contrailRig(mod, id, runtime, withVisual) {
  const aircraft = resolveAircraft(id);
  const flight = {
    pos: new Vector3(0, 5000, 0),
    pitch: 0.05,
    heading: 0,
    bank: 0,
    speed: 230,
    operations: { grounded: false, gear: 0 },
    aircraftVisual: null,
  };
  if (withVisual) {
    // What PlayerPlane publishes: the PRESENTATION engines (which may outnumber
    // the wake stations — the Talon's twin-jet nacelles feed ONE wake), scaled
    // by the model correction; the measured GLB anchors only when none.
    const presented = aircraftPresentation(aircraft, false).engines ?? playerEngineOffsets(id);
    flight.aircraftVisual = {
      id,
      engines: presented.map(([x, y, z]) => [x * 1.04 + 0.1, y * 1.04 - 0.2, z * 1.04 + 0.3]),
      tips: [
        [-6, 0, 1],
        [6, 0, 1],
      ],
    };
  }
  const rig = mount(mod, 'Contrail', { flight, origin: { anchor: new Vector3() }, aircraft, runtime });
  return { ...rig, flight };
}
function stepFlight(f, i, dt) {
  f.heading += 0.004 * Math.sin(i / 90);
  f.bank = 0.6 * Math.sin(i / 70);
  f.speed = 200 + 60 * Math.sin(i / 110);
  f.pos.x -= Math.sin(f.heading) * f.speed * dt;
  f.pos.z -= Math.cos(f.heading) * f.speed * dt;
  f.pos.y += 7;
}
const flightState = { phase: 'flying', screen: 'flight', atlasOpen: false, logbookOpen: false, inspectHex: null, mapStyle: 'satellite', qualityTier: 'medium' };
useFlyStore.setState(flightState);

function adsbFleet(n) {
  const types = ['B738', 'A320', 'C130', 'B77W', '', 'E75L', 'C172', 'A388'];
  return Array.from({ length: n }, (_, i) => ({
    hex: `a${(0x10000 + i).toString(16)}`,
    meta: { t: types[i % types.length] },
    archetype: i % 11,
    fix1: { vE: 120 + (i % 7) * 20, vN: -80 + (i % 5) * 30, vUp: (i % 3) - 1, latRad: 0.7 },
    distM: 600 + i * 900,
    opacity: i % 9 === 0 ? 0.5 : 1,
    horizonFade: i % 13 === 0 ? 0.02 : undefined,
    ry: 4000 + (i % 9) * 900,
    ryd: 0,
    rx: -4000 + i * 250,
    rz: -3000 - i * 400,
    yaw: i * 0.4,
    bank: (i % 4) * 0.1,
    scaleK: 1,
    stale: i % 17 === 0 ? 2 : 0,
    flags: i % 19 === 0 ? 1 : 0,
  }));
}
function stepFleet(items, dt) {
  for (const t of items) {
    if (t.remote === true && t.paused) continue;
    const k = 1 / Math.cos(t.fix1.latRad);
    t.rx += t.fix1.vE * k * dt;
    t.rz -= t.fix1.vN * k * dt;
    t.ry += t.fix1.vUp * dt;
    t.ryd = t.ry;
  }
}

if (!ON) {
  // ─── (4) FLAG-OFF IDENTITY A/B ───────────────────────────────────────────
  let baseOk = true;
  try {
    execFileSync('git', ['cat-file', '-e', `${BASE}:components/fly/Contrail.jsx`], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    baseOk = false;
  }
  if (!baseOk) {
    info('(4) flag-off identity A/B', `NOT CALIBRATED: ${BASE} is not in this clone (git fetch --unshallow)`);
  } else {
    const BaseC = await import(`${C('Contrail.jsx')}?base=${BASE}`);
    const NowC = await import(C('Contrail.jsx'));
    const report = [];
    let frames = 0;
    for (const [id, visual, runtime] of [
      ['fighter', false, {}],
      ['fighter', true, { weather: { wx: { windX: 6, windZ: -4 } }, sun: { frac: 0.6 } }],
      ...TRAILING.filter((id) => id !== 'fighter').map((id) => [id, true, {}]),
    ]) {
      const a = contrailRig(BaseC, id, runtime, visual);
      const b = contrailRig(NowC, id, runtime, visual);
      let ok = a.frame && b.frame && a.mesh && b.mesh;
      let maxRibbons = 0;
      for (let i = 0; ok && i < 700; i++) {
        useFlyStore.setState({ ...flightState, phase: i >= 300 && i < 330 ? 'paused' : 'flying' });
        for (const r of [a, b]) {
          stepFlight(r.flight, i, 1 / 60);
          aimCamera(r.flight.pos.x, r.flight.pos.y, r.flight.pos.z);
          r.frame({ camera }, 1 / 60);
        }
        ok = sameMesh(a.mesh, b.mesh);
        maxRibbons = Math.max(maxRibbons, ribbonsOf(b.mesh, FX.points));
        frames++;
      }
      useFlyStore.setState(flightState);
      report.push(`${id}${visual ? '+visual' : ''}:${ok ? maxRibbons : 'DIFF'}`);
      if (!ok || maxRibbons < 1) baseOk = false;
    }
    check(
      `(4a) flag off: Contrail is byte-identical to ${BASE} for every trailing type (700 frames each, ribbons drawn)`,
      baseOk,
      `${frames} frames · max ribbons ${report.join(' ')}`
    );

    const BaseT = await import(`${C('TrafficContrails.jsx')}?base=${BASE}`);
    const NowT = await import(C('TrafficContrails.jsx'));
    const fa = adsbFleet(40);
    const fb = adsbFleet(40);
    const ta = mount(BaseT, 'TrafficContrails', { runtime: { traffic: { items: fa } }, origin: { anchor: new Vector3() } });
    const tb = mount(NowT, 'TrafficContrails', { runtime: { traffic: { items: fb } }, origin: { anchor: new Vector3() } });
    let ok = !!(ta.frame && tb.frame);
    let maxR = 0;
    let n = 0;
    aimCamera(0, 6000, -6000);
    for (let i = 0; ok && i < 600; i++) {
      useFlyStore.setState({ ...flightState, qualityTier: i < 300 ? 'medium' : 'low' });
      const dt = i % 50 === 49 ? 0.25 : 1 / 30;
      stepFleet(fa, dt);
      stepFleet(fb, dt);
      ta.frame({ camera }, dt);
      tb.frame({ camera }, dt);
      ok = sameMesh(ta.mesh, tb.mesh);
      maxR = Math.max(maxR, ribbonsOf(tb.mesh, 96));
      n++;
    }
    useFlyStore.setState(flightState);
    check(
      `(4b) flag off: TrafficContrails over a 40-track ADS-B fleet is byte-identical to ${BASE}`,
      ok && maxR > 4,
      `${n} frames · max ribbons ${maxR}`
    );
  }

  // ─── (5) own smoke (Contrail) ────────────────────────────────────────────
  {
    const NowC = await import(C('Contrail.jsx'));
    const runtime = { mp: { smoke: false } };
    const prop = contrailRig(NowC, 'prop', runtime, true); // PlayerPlane publishes engines: []
    prop.flight.pos.set(0, 9000, 0);
    prop.flight.speed = 200;
    const run = (rig, frames, dt = 1 / 60) => {
      for (let i = 0; i < frames; i++) {
        rig.flight.pos.z -= rig.flight.speed * dt;
        aimCamera(rig.flight.pos.x, rig.flight.pos.y, rig.flight.pos.z);
        rig.frame({ camera }, dt);
      }
      return ribbonsOf(rig.mesh, FX.points);
    };
    const offBand = run(prop, 240);
    const offVisible = prop.mesh.visible;
    runtime.mp.smoke = true;
    const smoking = run(prop, 240);
    runtime.mp.smoke = false;
    const justOff = run(prop, 60);
    const agedOut = run(prop, 450, 0.1); // 45 s > FX.lifeSec
    check(
      '(5a) own smoke: a Skylark draws NOTHING in the contrail band until smoke, then one tail plume; off -> ages out to no draw',
      offBand === 0 && offVisible === false && smoking === 1 && justOff === 1 && agedOut === 0 && prop.mesh.visible === false,
      `off ${offBand} · smoking ${smoking} · just off ${justOff} · aged ${agedOut}`
    );

    const jetRt = { mp: { smoke: true } };
    const jet = contrailRig(NowC, 'fighter', jetRt, true);
    jet.flight.pos.set(0, 1500, 0);
    jet.flight.speed = 150;
    const low = run(jet, 240);
    const ground = contrailRig(NowC, 'fighter', { mp: { smoke: true } }, true);
    ground.flight.pos.set(0, 1500, 0);
    ground.flight.speed = 150;
    ground.flight.operations.grounded = true;
    const grounded = run(ground, 240);
    check(
      '(5b) own smoke: a fighter smokes from both engines below the contrail band, and grounded (as viewers see it)',
      low === 2 && grounded === 2 && contrailStrength(1500, 150) === 0,
      `low ${low} · grounded ${grounded}`
    );
  }

  // ─── (6) remote smoke (TrafficContrails) ─────────────────────────────────
  {
    const NowT = await import(C('TrafficContrails.jsx'));
    const remote = (hex, aircraftId, ry, speed, flags) => ({
      hex,
      remote: true,
      meta: { aircraftId, flight: hex.toUpperCase() },
      archetype: 0,
      fix1: { vE: 0, vN: speed, vUp: 0, latRad: 0.7 },
      distM: 900,
      opacity: 1,
      ry,
      ryd: ry,
      rx: 0,
      rz: -1500,
      yaw: 0,
      bank: 0,
      pitch: 0,
      scaleK: 1,
      stale: 0,
      flags: 0,
      snapEpoch: 0,
      mpFlags: flags,
    });
    const prop = remote('p:1', 'prop', 1500, 60, F.SMOKE);
    const fighter = remote('p:2', 'fighter', 1500, 150, F.SMOKE | F.BOOST);
    const glider = remote('p:3', 'glider', 9500, 200, 0);
    const airliner = remote('p:4', 'airliner', 10500, 230, 0);
    const items = [prop, fighter, glider, airliner];
    const rig = mount(NowT, 'TrafficContrails', { runtime: { traffic: { items } }, origin: { anchor: new Vector3() } });
    aimCamera(0, 3000, -3000);
    const run = (frames, dt = 1 / 30) => {
      for (let i = 0; i < frames; i++) {
        stepFleet(items, dt);
        rig.frame({ camera }, dt);
      }
      return ribbonsOf(rig.mesh, 96);
    };
    useFlyStore.setState({ ...flightState, qualityTier: 'high' });
    const all = run(120);
    fighter.snapEpoch = 1;
    const afterSnap = run(1);
    const regrown = run(60);
    prop.mpFlags = 0;
    fighter.mpFlags = F.BOOST;
    const smokeOff = run(30);
    const aged = run(450, 0.1); // 45 s > FX.lifeSec
    useFlyStore.setState(flightState);
    check(
      '(6) remote smoke: prop 1 tail + fighter 2 engines + airliner 2 contrails, glider none; snap restarts; off ages out; ONE mesh',
      all === 5 && afterSnap === 3 && regrown === 5 && smokeOff === 5 && aged === 2 && rig.prims === 1,
      `all ${all} · after snap ${afterSnap} · regrown ${regrown} · smoke off ${smokeOff} · aged ${aged} · meshes ${rig.prims}`
    );
  }

  // ─── (7) FlyScene mount ──────────────────────────────────────────────────
  {
    const scene = src('components/fly/FlyScene.jsx');
    check(
      '(7) FlyScene: <Contrail> mounts on (aircraft.contrail.enabled || MP_SMOKE), MP_SMOKE = mpAvailable() at module scope',
      /^const MP_SMOKE = mpAvailable\(\);$/m.test(scene) &&
        /\{\(aircraft\.contrail\.enabled \|\| MP_SMOKE\) && \(\s*<Contrail /.test(scene) &&
        (scene.match(/<Contrail /g) ?? []).length === 1 &&
        mpAvailable() === false
    );
  }
}

// ─── (8)/(9) Atlas pilots ──────────────────────────────────────────────────
const { pilotEntry, pilotsWarpOpts, PilotsCard } = await import(C('hud/atlas/PilotsCard.jsx'));
const { Atlas } = await import(C('hud/Atlas.jsx'));
const CLUSTERS = [
  { key: 'mp:6043', cell: 6043, lat: 40.7, lon: -74, n: 4, altM: 1200 },
  { key: 'mp:6300', cell: 6300, lat: 51.5, lon: -0.1, n: 1, altM: 3100 },
  { key: 'mp:7000', cell: 7000, lat: 35.7, lon: 139.7, n: 0, altM: 900 },
];
const FILTERS = { city: true, airport: true, military: true, hotspot: true, landmark: false };
const POIS = buildAtlasList().filter((e) => FILTERS[e.kind]);
const asked = { n: 0 };
const atlasRuntime = { geo: { x: -73.9, y: 40.6 }, mp: { where: () => asked.n++ } };
function atlasEntries(status) {
  useFlyStore.setState({ atlasOpen: true });
  useMpStore.setState({ status, clusters: CLUSTERS });
  globalThis.__mpAtlasMap = [];
  const html = quiet(() => render(h(Atlas, { runtime: atlasRuntime })));
  useFlyStore.setState({ atlasOpen: false });
  useMpStore.getState().resetSession();
  return { html, entries: globalThis.__mpAtlasMap.at(-1)?.entries ?? null };
}
const samePois = (list) => list.length >= POIS.length && POIS.every((e, i) => list[i].key === e.key && list[i].kind === e.kind);

if (!ON) {
  const e4 = pilotEntry(CLUSTERS[0]);
  const e1 = pilotEntry(CLUSTERS[1]);
  const lo = pilotsWarpOpts({ altM: 200, name: '4 pilots' }, () => 0.25);
  const hi = pilotsWarpOpts({ altM: 9000, name: 'x' }, () => 0);
  const nan = pilotsWarpOpts({ altM: NaN, name: 'x' }, () => 0.999);
  check(
    '(8a) pilotEntry keys by cell, sizes by log2 n; pilotsWarpOpts: alt clamped 800..6000, 3 km out, random bearing, kind pilots',
    e4.key === 'mp:6043' && e4.kind === 'pilots' && e4.name === '4 pilots' && e4.dot === 4.6 && e4.n === 4 &&
      e1.name === '1 pilot' && e1.dot === 2.6 &&
      lo.altM === 800 && lo.offsetM === 3000 && lo.offsetBearingRad === Math.PI / 2 && lo.name === '4 pilots' && lo.kind === 'pilots' &&
      hi.altM === 6000 && hi.offsetBearingRad === 0 && nan.altM === 800 && nan.offsetBearingRad < 2 * Math.PI,
    JSON.stringify(e4)
  );
  const off = atlasEntries('online');
  check(
    '(8b) flag off: an online store full of clusters still hands AtlasMap exactly the filtered POI list',
    mpAvailable() === false && off.entries && off.entries.length === POIS.length && samePois(off.entries) &&
      !off.html.includes('atlas-pilots-card') && /data-testid="atlas"/.test(off.html),
    `${off.entries?.length} entries`
  );
  const card = quiet(() =>
    render(h(PilotsCard, { entry: e4, runtime: { geo: { x: -74, y: 40.7 } }, onFly() {} }))
  );
  check(
    '(8c) PilotsCard: atlas-pilots-card / atlas-pilots-fly, count, distance, typical altitude',
    /data-testid="atlas-pilots-card"/.test(card) && /data-testid="atlas-pilots-fly"/.test(card) &&
      card.includes('4 pilots') && card.includes('0.0nm') && card.includes('~3,900 ft') && card.includes('FLY THERE'),
    card.length + ' B'
  );
  const atlas = src('components/fly/hud/Atlas.jsx');
  const fly = atlas.slice(atlas.indexOf('const flyToPilots'), atlas.indexOf('const randomCity'));
  check(
    '(8d) source: the pilots warp never logs a visit; where() on open + every 5 s; MP_ATLAS = mpAvailable()',
    fly.length > 0 && !/logVisit|toggleFavorite|recents/.test(fly.replace(/\/\/.*$/gm, '')) &&
      /pilotsWarpOpts\(entry\)/.test(fly) &&
      /^const MP_ATLAS = mpAvailable\(\);$/m.test(atlas) && /const WHERE_EVERY_MS = 5000;/.test(atlas) &&
      /runtime\?\.mp\?\.where\?\.\(\)/.test(atlas) && /setInterval\(ask, WHERE_EVERY_MS\)/.test(atlas) &&
      /e\.dot \?\? kind\.dot/.test(src('components/fly/hud/atlas/AtlasMap.jsx'))
  );

  // ─── ON arm ──────────────────────────────────────────────────────────────
  try {
    const out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--on'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    process.stdout.write(out);
    const m = out.match(/^ON: (\d+) pass, (\d+) fail$/m);
    if (!m) fail++;
    else {
      pass += +m[1];
      fail += +m[2];
    }
  } catch (e) {
    process.stdout.write(e.stdout ?? '');
    check('(9) ON arm ran', false, String(e.message).split('\n')[0]);
  }
  console.log(`\nverify-mp-smoke: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
} else {
  const on = atlasEntries('online');
  const pilots = on.entries?.filter((e) => e.kind === 'pilots') ?? [];
  const idle = atlasEntries('connecting');
  check(
    '(9) flag on: online -> one pilots entry per cluster after the POIs (n = 0 dropped); not online -> none',
    mpAvailable() === true && samePois(on.entries ?? []) &&
      on.entries.length === POIS.length + 2 &&
      pilots.map((e) => `${e.key}:${e.dot}`).join() === 'mp:6043:4.6,mp:6300:2.6' &&
      on.entries.slice(POIS.length).every((e) => e.kind === 'pilots') &&
      idle.entries?.length === POIS.length && !idle.entries.some((e) => e.kind === 'pilots'),
    `${pilots.length} pilots of ${on.entries?.length}`
  );
  console.log(`ON: ${pass} pass, ${fail} fail`);
}

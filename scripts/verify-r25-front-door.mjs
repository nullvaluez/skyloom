/**
 * R25 (A FRONT DOOR) — verify-r25-front-door (NODE gate; no browser, no GL).
 *
 * The front door's logic, measured on the REAL modules (the R24 lod-fade /
 * R25 flag-off idiom — import, never source-parse, wherever a behaviour can be
 * called): lib/fly/front-door.js, lib/fly/title-camera.js,
 * lib/fly/visuals-profile.js, hooks/use-overlay-back.js and the store.
 *
 * GATES
 *  [1] resolvers: resolveInitialScreen (flag off / on / bypass pin, pin read
 *      only in development), and the Visuals precedence
 *      (pin > saved > default-when-available > classic).
 *  [2] predicates: menuOpen / inFlight / gameplayLive / spotAllowed / onTitle /
 *      bootCompactFor / exitGoesToTitle over every screen, both flag arms.
 *  [3] frameloopFor: 'always' on title + flight, 'demand' in the hangar; the
 *      flag-off arm equals the r25-w0 function over the whole state grid.
 *  [4] the Esc/Back table (escapeStep + anyOverlayOpen), both arms; the
 *      flag-off arm equals the r25-w0 hook over the reachable grid.
 *  [5] exitToTitle: every field reset the plan's UX table names, the runtime
 *      calls, the title camera blend request; a no-op with the flag off.
 *  [6] TitleCamera geometry: orbit radius exact, terrain floor respected on a
 *      rising slope, eye height rule, period (normal + reduced motion), blend
 *      endpoints, snap on teleport, needsSnap on leave, flag-off install no-op.
 *  [7] <StagePump> policy table + rate (desktop 10 Hz / phone 4 Hz).
 *  [8] source posture: FlyScene's W0 call sites are intact; FlyMode installs
 *      the rig + mounts the title; exit replaces the reload (the error
 *      boundary keeps it as "Restart Skyloom"); title testids; branding with
 *      the OG url and the passport key unchanged; geolocation gone and the
 *      fly-last-pos writer kept; (8j-8l, fix pass) the SPICY tick, the lock
 *      blip and the credit-under-overlays wiring.
 *  [9] (fix pass) the audio bed on the REAL FlyAudio over a mock AudioContext
 *      that sums connected nodes onto an AudioParam (the Web Audio rule the
 *      'prop' tremolo rides): quietBed silences engine + wind for all nine
 *      aircraft INCLUDING the LFO depth; wakeBed restores a fresh graph's
 *      depth exactly; a prop installed while quiet is silenced at once;
 *      lockBlipWanted = `hex && !prev` flag-off, flight-only flag-on.
 *      RED (the pre-fix quietBed moved verbatim into front-door): 62 / 6 —
 *      (9b) prop + warbird-prop engine amplitude 0.121 on the title, (9d),
 *      (9f) title + hangar blip, (8j/8k/8l)
 *      (.graphics-review/r25/a/red-front-door-audio.txt).
 *
 * RED FIRST (scripts/r25-a-front-door.md §2): run against the r25-w0 tree
 * (`git worktree add <tmp> r25-w0`, copy this file in, run it) the ON arm of
 * FAILS: MEASURED 21 passed / 15 failed on r25-w0 (the W0 stubs answer
 * 'hangar' with the flag forced on, have no gameplayLive / exitToTitle /
 * stagePumpWanted, the hook has no settings/title branch, title-camera.js does
 * not exist, and the branding / title sources are absent). The 21 that pass
 * there are the flag-off arms and the W0 invariants — by design.
 *
 * Run:  node scripts/verify-r25-front-door.mjs      (exit 1 on any FAIL)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register, createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
register(pathToFileURL(path.join(HERE, '_node-resolve.mjs')).href);
register(pathToFileURL(path.join(HERE, '_alias-loader.mjs')).href);
process.env.NODE_ENV = 'development';

let pass = 0;
let fail = 0;
const gate = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const tryGate = async (name, fn) => {
  try {
    const r = await fn();
    if (r === undefined) return;
    gate(name, !!r.ok, r.detail);
  } catch (e) {
    gate(name, false, `threw: ${String(e?.message || e).slice(0, 160)}`);
  }
};

// A browser-ish window for the pins / storage / graphicsReview reads.
const storage = new Map();
globalThis.window = {
  location: { search: '', href: 'http://localhost/' },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
};

const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const tryImp = async (rel) => {
  try {
    return await imp(rel);
  } catch (e) {
    console.log(`       (import ${rel} failed: ${String(e?.message || e).slice(0, 120)})`);
    return null;
  }
};

const C = await imp('lib/fly/fly-constants.js');
const { useFlyStore, menuOpen, inFlight } = await imp('stores/fly-store.js');
const FD = await imp('lib/fly/front-door.js');
const VP = await imp('lib/fly/visuals-profile.js');
const TC = await tryImp('lib/fly/title-camera.js');
const OB = await imp('hooks/use-overlay-back.js');
const THREE = await import('three');

// The r25-w0 versions of the two stub modules, loaded from git so the flag-off
// arm is compared against the REAL baseline, not a transcription of it.
const W0 = await (async () => {
  try {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r25-a-w0-'));
    const show = (rel) => execFileSync('git', ['-C', ROOT, 'show', `r25-w0:${rel}`], { encoding: 'utf8' });
    const fdSrc = show('lib/fly/front-door.js').replace(
      "from './satellite-visuals'",
      `from '${pathToFileURL(path.join(ROOT, 'lib/fly/satellite-visuals.js')).href}'`
    );
    fs.writeFileSync(path.join(tmp, 'front-door.w0.mjs'), fdSrc);
    const reactUrl = pathToFileURL(createRequire(import.meta.url).resolve('react')).href;
    fs.writeFileSync(path.join(tmp, 'overlay-back.w0.mjs'), show('hooks/use-overlay-back.js').replace("from 'react'", `from '${reactUrl}'`));
    return {
      fd: await import(pathToFileURL(path.join(tmp, 'front-door.w0.mjs')).href),
      ob: await import(pathToFileURL(path.join(tmp, 'overlay-back.w0.mjs')).href),
    };
  } catch (e) {
    console.log(`       (r25-w0 baseline unavailable: ${String(e?.message || e).slice(0, 120)})`);
    return null;
  }
})();

const SHIPPED = { fd: C.FRONT_DOOR.enabled, fp: C.FLIGHT_PLAN.enabled, sky: C.R25_SKY.enabled, ground: C.R25_GROUND.enabled };
const setFD = (on) => {
  C.FRONT_DOOR.enabled = on;
};
const restore = () => {
  C.FRONT_DOOR.enabled = SHIPPED.fd;
  C.FLIGHT_PLAN.enabled = SHIPPED.fp;
  C.R25_SKY.enabled = SHIPPED.sky;
  C.R25_GROUND.enabled = SHIPPED.ground;
  delete window.__flyTitleBypass;
  delete window.__flyVisualsOverride;
  storage.clear();
  useFlyStore.getState().reset();
};

const SCREENS = ['title', 'hangar', 'flight'];
const stateFor = (screen, extra = {}) => ({ ...useFlyStore.getState(), screen, hangarOpen: screen === 'hangar', ...extra });

// --- [1] resolvers ------------------------------------------------------------
console.log('\n[1] resolvers');
setFD(false);
gate('(1a) flag OFF: the session opens on today\'s mandatory hangar', FD.resolveInitialScreen() === 'hangar');
setFD(true);
gate('(1b) flag ON: the session opens on the TITLE', FD.resolveInitialScreen() === 'title', FD.resolveInitialScreen());
window.__flyTitleBypass = true;
gate('(1c) flag ON + harness bypass pin: today\'s hangar (the legacy fleet posture)', FD.resolveInitialScreen() === 'hangar');
process.env.NODE_ENV = 'production';
gate('(1d) the bypass pin is unreadable outside development / graphicsReview', FD.resolveInitialScreen() === 'title');
window.location.search = '?graphicsReview=1';
gate('(1e) ... and readable again under ?graphicsReview=1', FD.resolveInitialScreen() === 'hangar');
window.location.search = '';
process.env.NODE_ENV = 'development';
restore();
{
  // Visuals precedence (visuals-profile.js is A's): pin > saved > default > classic.
  const resolve = () => {
    useFlyStore.getState().setVisuals('classic');
    VP.resolveInitialVisuals();
    return useFlyStore.getState().visuals;
  };
  C.R25_SKY.enabled = false;
  C.R25_GROUND.enabled = false;
  storage.set(C.VISUALS.key, 'enhanced');
  const unavailable = resolve();
  C.R25_SKY.enabled = true;
  storage.clear();
  const dflt = resolve();
  storage.set(C.VISUALS.key, 'classic');
  const saved = resolve();
  window.__flyVisualsOverride = 'enhanced';
  const pinned = resolve();
  process.env.NODE_ENV = 'production';
  const prodPin = resolve();
  process.env.NODE_ENV = 'development';
  storage.set(C.VISUALS.key, 'garbage');
  delete window.__flyVisualsOverride;
  const corrupt = resolve();
  gate('(1f) Visuals precedence: no R25 block ON ⇒ classic even over a saved "enhanced"', unavailable === 'classic', unavailable);
  gate('(1g) ... block ON, nothing saved ⇒ VISUALS.defaultProfile', dflt === C.VISUALS.defaultProfile, dflt);
  gate('(1h) ... a saved pick beats the default', saved === 'classic', saved);
  gate('(1i) ... the dev pin beats a saved pick', pinned === 'enhanced', pinned);
  gate('(1j) ... the pin is ignored in production (saved wins)', prodPin === 'classic', prodPin);
  gate('(1k) ... corrupt storage falls back to the default', corrupt === C.VISUALS.defaultProfile, corrupt);
  const e0 = useFlyStore.getState().visualsEpoch;
  VP.setVisualsLive('enhanced');
  VP.setVisualsLive('enhanced');
  VP.setVisualsLive('bogus');
  const e1 = useFlyStore.getState().visualsEpoch;
  VP.saveVisuals('enhanced');
  gate('(1l) setVisualsLive bumps visualsEpoch once per REAL change; saveVisuals persists',
    e1 - e0 <= 1 && useFlyStore.getState().visuals === 'enhanced' && storage.get(C.VISUALS.key) === 'enhanced',
    `epoch +${e1 - e0}, stored ${storage.get(C.VISUALS.key)}`);
  C.R25_SKY.enabled = false;
  gate('(1m) r25On is false when no block ships, whatever the profile', VP.r25On(C.R25_SKY) === false && VP.visualsEnhanced() === false);
  restore();
}

// --- [2] predicates ------------------------------------------------------------
console.log('\n[2] predicates');
try {
  const row = (on) =>
    SCREENS.map((sc) => {
      setFD(on);
      const s = stateFor(sc);
      return `${sc}:${[menuOpen(s), inFlight(s), FD.gameplayLive(s), FD.spotAllowed(s), FD.onTitle(s), FD.bootCompactFor(s)].map((b) => (b ? 1 : 0)).join('')}`;
    }).join(' ');
  const off = row(false);
  const on = row(true);
  gate('(2a) flag OFF: gameplay/spots live on every screen, no title, no compact boot',
    off === 'title:101100 hangar:101100 flight:011100', off);
  gate('(2b) flag ON: gameplay/spots ONLY in flight; onTitle + compact boot only on the title',
    on === 'title:100011 hangar:100000 flight:011100', on);
  setFD(false);
  const x0 = FD.exitGoesToTitle();
  setFD(true);
  const x1 = FD.exitGoesToTitle();
  C.FRONT_DOOR.exitToTitle = false;
  const x2 = FD.exitGoesToTitle();
  C.FRONT_DOOR.exitToTitle = true;
  gate('(2c) exitGoesToTitle = FRONT_DOOR.enabled && exitToTitle', !x0 && x1 && !x2, `${x0}/${x1}/${x2}`);
  C.FLIGHT_PLAN.enabled = false;
  const f0 = FD.freeFlightAvailable();
  C.FLIGHT_PLAN.enabled = true;
  const f1 = FD.freeFlightAvailable();
  gate('(2d) the Free Flight card follows FLIGHT_PLAN.enabled', !f0 && f1);
  restore();
} catch (e) {
  gate('(2) section ran', false, `threw: ${String(e?.message || e).slice(0, 160)}`);
  restore();
}

// --- [3] frameloopFor ------------------------------------------------------------
console.log('\n[3] frameloopFor');
try {
  setFD(true);
  const on = SCREENS.map((sc) => `${sc}:${FD.frameloopFor(stateFor(sc))}`).join(' ');
  gate('(3a) flag ON: title + flight "always", hangar "demand"', on === 'title:always hangar:demand flight:always', on);
  setFD(false);
  let same = true;
  let n = 0;
  for (const sc of SCREENS)
    for (const ho of [true, false]) {
      const s = stateFor(sc, { hangarOpen: ho });
      n++;
      if (!W0 || FD.frameloopFor(s) !== W0.fd.frameloopFor(s)) same = false;
    }
  gate('(3b) flag OFF: equals the r25-w0 frameloopFor over every screen × hangarOpen', same && !!W0, `${n} states${W0 ? '' : ' (no W0 baseline)'}`);
  restore();
} catch (e) {
  gate('(3) section ran', false, `threw: ${String(e?.message || e).slice(0, 160)}`);
  restore();
}

// --- [4] Esc / Back table -------------------------------------------------------------
console.log('\n[4] Esc/Back table (escapeStep + anyOverlayOpen)');
try {
  // A plain mutable store with the real action semantics (incl. the W0 mirror).
  const mk = (patch = {}) => {
    const st = {
      phase: 'flying', cameraMode: 'chase', inspectHex: null, atlasOpen: false, logbookOpen: false,
      hangarOpen: false, hangarDismissible: false, creditsOpen: false, screen: 'flight', settingsOpen: false, ...patch,
    };
    Object.assign(st, {
      setInspectHex: (v) => (st.inspectHex = v),
      setCameraMode: (v) => (st.cameraMode = v),
      setAtlasOpen: (v) => (st.atlasOpen = v),
      setLogbookOpen: (v) => (st.logbookOpen = v),
      setSettingsOpen: (v) => (st.settingsOpen = v),
      setHangarOpen: (v) => Object.assign(st, { hangarOpen: v, screen: v ? 'hangar' : 'flight' }),
      setScreen: (v) => Object.assign(st, { screen: v, hangarOpen: v === 'hangar' }),
      closeCredits: () => (st.creditsOpen = false),
      setPhase: (v) => (st.phase = v),
    });
    return st;
  };
  const step = (patch, on, esc = OB.escapeStep) => {
    setFD(on);
    const st = mk(patch);
    esc(st);
    return st;
  };
  setFD(true);
  // Precedence walk: everything open at once unwinds one surface per Back.
  const all = mk({ inspectHex: 'a1', cameraMode: 'photo', atlasOpen: true, logbookOpen: true, settingsOpen: true, creditsOpen: true, phase: 'paused' });
  const order = [];
  for (let i = 0; i < 8 && OB.anyOverlayOpen(all); i++) {
    const before = JSON.stringify(all);
    OB.escapeStep(all);
    const a = JSON.parse(before);
    const changed = ['inspectHex', 'cameraMode', 'atlasOpen', 'logbookOpen', 'settingsOpen', 'creditsOpen', 'phase'].find((k) => a[k] !== all[k]);
    order.push(changed);
  }
  gate('(4a) precedence: inspect → photo → atlas → logbook → settings → credits → pause',
    order.join(',') === 'inspectHex,cameraMode,atlasOpen,logbookOpen,settingsOpen,creditsOpen,phase', order.join(','));
  const pre = step({ screen: 'hangar', hangarOpen: true, hangarDismissible: false }, true);
  gate('(4b) ON: Back in the PRE-FLIGHT hangar returns to the title', pre.screen === 'title' && !pre.hangarOpen, `${pre.screen}`);
  const conf = step({ screen: 'hangar', hangarOpen: true, hangarDismissible: true }, true);
  gate('(4c) ON: the mid-flight return confirmation still cancels back to the flight', conf.screen === 'flight' && !conf.hangarOpen);
  const root = step({ screen: 'title' }, true);
  gate('(4d) ON: Back on the title root is a no-op and pushes no sentinel',
    root.screen === 'title' && OB.anyOverlayOpen(mk({ screen: 'title' })) === false);
  const sheet = step({ screen: 'title', settingsOpen: true }, true);
  gate('(4e) ON: the Settings sheet closes and the title stays', !sheet.settingsOpen && sheet.screen === 'title');
  const pausedSheet = step({ phase: 'paused', settingsOpen: true }, true);
  gate('(4f) ON: the Settings sheet closes before a paused game resumes', !pausedSheet.settingsOpen && pausedSheet.phase === 'paused');
  const offPre = step({ screen: 'hangar', hangarOpen: true, hangarDismissible: false }, false);
  gate('(4g) OFF: the pre-flight hangar stays mandatory (today)', offPre.screen === 'hangar' && offPre.hangarOpen);
  // Flag-off identity vs the r25-w0 hook over the reachable grid (settingsOpen
  // cannot be true without the title).
  let same = !!W0;
  let n = 0;
  if (W0) {
    const keys = ['inspectHex', 'cameraMode', 'atlasOpen', 'logbookOpen', 'hangarOpen', 'creditsOpen', 'phase'];
    for (let mask = 0; mask < 1 << keys.length; mask++)
      for (const dis of [false, true]) {
        const patch = { hangarDismissible: dis };
        keys.forEach((k, i) => {
          if (!(mask & (1 << i))) return;
          patch[k] = k === 'inspectHex' ? 'a1' : k === 'cameraMode' ? 'photo' : k === 'phase' ? 'paused' : true;
        });
        if (patch.hangarOpen) patch.screen = 'hangar';
        const a = step(patch, false);
        const b = step(patch, false, W0.ob.escapeStep);
        n++;
        if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
        setFD(false);
        if (OB.anyOverlayOpen(mk(patch)) !== W0.ob.anyOverlayOpen(mk(patch))) same = false;
      }
  }
  gate('(4h) OFF: escapeStep + anyOverlayOpen equal the r25-w0 hook over the reachable grid', same, `${n} states`);
  restore();
} catch (e) {
  gate('(4) section ran', false, `threw: ${String(e?.message || e).slice(0, 160)}`);
  restore();
}

// --- [5] exitToTitle -------------------------------------------------------------------
console.log('\n[5] exitToTitle');
try {
  const calls = [];
  const rt = {
    operations: { phase: 'airborne', returnToHangar() { calls.push('returnToHangar'); this.phase = 'hangar'; } },
    autopilot: { disengage: () => calls.push('disengage') },
    crashSys: { disarm: () => calls.push('disarm') },
    crash: { state: 'tumbling', track: { x: 1 } },
    input: { neutralize: () => calls.push('neutralize') },
    camera: { tag: 'cam' },
    titleCam: { blendFrom: (c) => calls.push(`blendFrom:${c?.tag}`) },
  };
  const dirty = {
    screen: 'flight', hangarOpen: false, phase: 'paused', inspectHex: 'abc', atlasOpen: true, logbookOpen: true,
    creditsOpen: true, settingsOpen: true, runSummaryOpen: true, arrival: { name: 'X' }, cameraMode: 'photo', hangarDismissible: true,
  };
  setFD(false);
  useFlyStore.setState(dirty);
  const offRet = FD.exitToTitle(rt);
  const offSame = Object.entries(dirty).every(([k, v]) => useFlyStore.getState()[k] === v);
  gate('(5a) flag OFF: exitToTitle does nothing (the reload stays)', offRet === false && offSame && calls.length === 0);
  setFD(true);
  useFlyStore.setState(dirty);
  const ret = FD.exitToTitle(rt);
  const s = useFlyStore.getState();
  const want = { screen: 'title', hangarOpen: false, phase: 'flying', inspectHex: null, atlasOpen: false, logbookOpen: false,
    creditsOpen: false, settingsOpen: false, runSummaryOpen: false, arrival: null, cameraMode: 'chase', hangarDismissible: false };
  const bad = Object.entries(want).filter(([k, v]) => s[k] !== v).map(([k]) => `${k}=${JSON.stringify(s[k])}`);
  gate('(5b) flag ON: every overlay closed, unpaused, screen "title" (hangarOpen mirror false)', ret === true && bad.length === 0, bad.join(' ') || 'all reset');
  gate('(5c) ... operations back to the hangar phase, autopilot off, crash disarmed + sequence idle, stick neutral',
    ['returnToHangar', 'disengage', 'disarm', 'neutralize'].every((c) => calls.includes(c)) && rt.operations.phase === 'hangar' && rt.crash.state === 'idle' && rt.crash.track === null,
    calls.join(','));
  gate('(5d) ... the title camera eases out of the current camera (blendFrom)', calls.includes('blendFrom:cam'));
  gate('(5e) ... tolerant of a runtime with no handles (never throws)', FD.exitToTitle({}) === true);
  restore();
} catch (e) {
  gate('(5) section ran', false, `threw: ${String(e?.message || e).slice(0, 160)}`);
  restore();
}

// --- [6] TitleCamera ----------------------------------------------------------------------
console.log('\n[6] TitleCamera geometry');
if (!TC) {
  gate('(6) lib/fly/title-camera.js exists and imports', false, 'module missing');
} else try {
  const O = C.FRONT_DOOR.orbit;
  const k = 1.3; // mercator scale at ~40° N
  const mkFlight = (x, y, z, heading = 0) => ({ pos: new THREE.Vector3(x, y, z), heading });
  const mkCam = () => {
    const c = new THREE.PerspectiveCamera(60, 16 / 9, 1, 1e6);
    c.position.set(0, 150, 400);
    return c;
  };
  // Terrain: flat 300 m, then a ridge rising east of x = 1000 to 2600 m.
  const terrain = (x) => (x > 1000 ? Math.min(2600, 300 + (x - 1000) * 1.2) : 300);
  const tc = new TC.TitleCamera({ sampleGround: (x) => terrain(x), readSpot: () => null, readStyle: () => 'satellite', readReduced: () => false });
  const f = mkFlight(0, 800, 0, 0);
  const cam = mkCam();
  tc.activate();
  tc.update(1 / 60, f, cam, k, 300);
  const r0 = Math.hypot(cam.position.x - f.pos.x, cam.position.z - f.pos.z) / k;
  gate('(6a) first frame SNAPS onto the orbit: radius = orbit.radiusM (±5 %)', Math.abs(r0 - O.radiusM) <= 0.05 * O.radiusM, `${r0.toFixed(1)} m vs ${O.radiusM}`);
  const behind = cam.position.z > f.pos.z && Math.abs(cam.position.x) < 0.01 * O.radiusM * k;
  gate('(6b) ... starting BEHIND the flight heading (heading 0 = north = -z ⇒ eye at +z)', behind, `eye ${cam.position.x.toFixed(1)}, ${cam.position.z.toFixed(1)}`);
  gate('(6c) eye height = max(flight y, centre ground + aglM, floor)', Math.abs(cam.position.y - Math.max(800, 300 + O.aglM)) < 1e-6, `${cam.position.y}`);
  // Pitch: look point never below the centre ground, ~pitchDeg down.
  const dir = new THREE.Vector3();
  cam.getWorldDirection(dir);
  const pitch = (Math.asin(-dir.y) * 180) / Math.PI;
  gate('(6d) looks down toward the centre at ≈ orbit.pitchDeg', Math.abs(pitch - (O.pitchDeg ?? 16)) < 1.5, `${pitch.toFixed(2)}°`);
  // Period: 10 s of frames advance 10·360/240 = 15°.
  const a0 = tc.stats.angleDeg;
  for (let i = 0; i < 600; i++) tc.update(1 / 60, f, cam, k, 300);
  const adv = (tc.stats.angleDeg - a0 + 360) % 360;
  gate('(6e) orbit period = orbit.periodSec (10 s ⇒ 15°)', Math.abs(adv - (10 * 360) / O.periodSec) < 0.05, `${adv.toFixed(3)}°`);
  // Radius holds all the way round and the terrain floor holds on the ridge.
  let worstR = 0;
  let worstAgl = Infinity;
  for (let i = 0; i < 240 * 20; i++) {
    tc.update(1 / 20, f, cam, k, 300);
    const r = Math.hypot(cam.position.x - f.pos.x, cam.position.z - f.pos.z) / k;
    worstR = Math.max(worstR, Math.abs(r - O.radiusM) / O.radiusM);
    worstAgl = Math.min(worstAgl, cam.position.y - terrain(cam.position.x));
  }
  gate('(6f) a full revolution: radius within ±5 % every frame', worstR <= 0.05, `worst ${(worstR * 100).toFixed(3)} %`);
  gate('(6g) ... and eye AGL ≥ orbit.minAglM over a 2.6 km ridge (terrain floor)', worstAgl >= O.minAglM - 1, `min AGL ${worstAgl.toFixed(1)} m`);
  // Reduced motion: the slow period.
  const tr = new TC.TitleCamera({ sampleGround: () => 300, readReduced: () => true, readStyle: () => 'satellite' });
  tr.activate();
  tr.update(1 / 60, f, cam, k, 300);
  const b0 = tr.stats.angleDeg;
  for (let i = 0; i < 600; i++) tr.update(1 / 60, f, cam, k, 300);
  const advR = (tr.stats.angleDeg - b0 + 360) % 360;
  gate('(6h) reduced motion: orbit.reducedMotionPeriodSec (10 s ⇒ 4°)', Math.abs(advR - (10 * 360) / O.reducedMotionPeriodSec) < 0.05, `${advR.toFixed(3)}°`);
  // Blend: from a chase pose behind the plane, over easeSec.
  const tb = new TC.TitleCamera({ sampleGround: () => 300, readStyle: () => 'satellite', readReduced: () => false });
  const cam2 = mkCam();
  cam2.position.set(0, 820, 60);
  cam2.lookAt(0, 800, -1000);
  const p0 = cam2.position.clone();
  tb.blendFrom(cam2);
  tb.activate();
  tb.update(0, f, cam2, k, 300);
  const d0 = cam2.position.distanceTo(p0);
  for (let t = 0; t < O.easeSec + 0.2; t += 1 / 30) tb.update(1 / 30, f, cam2, k, 300);
  const rB = Math.hypot(cam2.position.x - f.pos.x, cam2.position.z - f.pos.z) / k;
  gate('(6i) blendFrom: starts exactly at the captured pose and lands on the orbit after easeSec',
    d0 < 1e-6 && Math.abs(rB - O.radiusM) <= 0.05 * O.radiusM && tb.stats.blending === false && tb.stats.blends === 1,
    `start Δ ${d0.toExponential(1)}, end radius ${rB.toFixed(1)} m`);
  // Teleport under the title snaps; leaving sets needsSnap.
  const snaps0 = tb.stats.snaps;
  const far = mkFlight(500000, 900, -300000, 1);
  tb.update(1 / 30, far, cam2, k, 300);
  const rT = Math.hypot(cam2.position.x - far.pos.x, cam2.position.z - far.pos.z) / k;
  gate('(6j) a teleport under the title (spawn / staging) SNAPS to the new centre', tb.stats.snaps === snaps0 + 1 && Math.abs(rT - O.radiusM) <= 0.05 * O.radiusM, `radius ${rT.toFixed(1)} m`);
  tb.deactivate();
  const moved = cam2.position.clone();
  tb.update(1 / 30, far, cam2, k, 300);
  gate('(6k) leaving the title: needsSnap for the chase rig, and the rig stops writing the camera',
    tb.needsSnap === true && tb.active === false && cam2.position.equals(moved));
  // Per-spot override.
  const ts = new TC.TitleCamera({ sampleGround: () => 0, readSpot: () => ({ radiusM: 4000, aglM: 1500 }), readStyle: () => 'satellite', readReduced: () => false });
  ts.activate();
  ts.update(1 / 60, mkFlight(0, 100, 0), cam, k, 0);
  const rS = Math.hypot(cam.position.x, cam.position.z) / k;
  gate('(6l) per-spot {radiusM, aglM} override (B destinations / runtime.titleSpot)', Math.abs(rS - 4000) < 1 && Math.abs(cam.position.y - 1500) < 1e-6, `r ${rS.toFixed(1)} y ${cam.position.y}`);
  // Toy draws terrain exaggerated: the floor follows the DRAWN ground.
  const tt = new TC.TitleCamera({ sampleGround: () => 2000, readStyle: () => 'toy', readReduced: () => false });
  tt.activate();
  tt.update(1 / 60, mkFlight(0, 100, 0), cam, k, 2000);
  const drawn = 2000 * C.TOY_WORLD.terrainExaggeration + C.TOY_WORLD.groundLift;
  gate('(6m) toy: the floor is the DRAWN (exaggerated) ground', cam.position.y >= drawn + O.minAglM - 1e-6, `eye ${cam.position.y.toFixed(1)} vs drawn ${drawn.toFixed(1)}`);
  // Install: flag off leaves runtime.titleCam undefined; on follows `screen`.
  setFD(false);
  const rtOff = {};
  const un0 = TC.installTitleCamera(rtOff);
  gate('(6n) flag OFF: installTitleCamera is a no-op (runtime.titleCam never exists)', rtOff.titleCam === undefined);
  un0();
  setFD(true);
  useFlyStore.getState().setScreen('hangar');
  const rtOn = {};
  const un1 = TC.installTitleCamera(rtOn);
  const seq = [];
  seq.push(rtOn.titleCam?.active);
  useFlyStore.getState().setScreen('title');
  seq.push(rtOn.titleCam?.active);
  useFlyStore.getState().setScreen('hangar');
  seq.push(rtOn.titleCam?.active, rtOn.titleCam?.needsSnap);
  un1();
  gate('(6o) flag ON: the rig follows screen (hangar→title activates, title→hangar deactivates + needsSnap); uninstall removes it',
    seq.join(',') === 'false,true,false,true' && rtOn.titleCam === undefined, seq.join(','));
  restore();
} catch (e) {
  gate('(6) section ran', false, `threw: ${String(e?.message || e).slice(0, 160)}`);
  restore();
}

// --- [7] StagePump policy ---------------------------------------------------------------
console.log('\n[7] <StagePump> policy');
try {
  const env = (o = {}) => ({ hidden: false, bootPct: 100, bypass: false, ...o });
  const W = (sc, staging, e, on = true) => {
    setFD(on);
    return FD.stagePumpWanted(stateFor(sc), { staging }, env(e));
  };
  const table = [
    ['off: hangar + staging pending', W('hangar', { ready: false }, {}, false), false],
    ['title (already "always")', W('title', { ready: false }, {}), false],
    ['flight', W('flight', { ready: false }, {}), false],
    ['hangar + staging pending', W('hangar', { ready: false }, {}), true],
    ['hangar + staging ready, revealed', W('hangar', { ready: true }, {}), false],
    ['hangar + staging pending, tab hidden', W('hangar', { ready: false }, { hidden: true }), false],
    ['hangar, no staging, boot unrevealed', W('hangar', undefined, { bootPct: 60 }), true],
    ['hangar, no staging, boot unrevealed, BYPASS pin', W('hangar', undefined, { bootPct: 60, bypass: true }), false],
    ['hangar, no staging, revealed', W('hangar', undefined, { bootPct: 100 }), false],
  ];
  const bad = table.filter(([, got, want]) => got !== want).map(([n, got]) => `${n}=${got}`);
  gate('(7a) pump only while the hangar holds a pending stage / unrevealed title boot, never hidden, never flag-off', bad.length === 0, bad.join(' | ') || `${table.length} rows`);
  gate('(7b) rate: FLIGHT_PLAN.stage.hzDesktop / hzPhone', FD.stagePumpHz(false) === C.FLIGHT_PLAN.stage.hzDesktop && FD.stagePumpHz(true) === C.FLIGHT_PLAN.stage.hzPhone,
    `${FD.stagePumpHz(false)} / ${FD.stagePumpHz(true)} Hz`);
  restore();
} catch (e) {
  gate('(7) section ran', false, `threw: ${String(e?.message || e).slice(0, 160)}`);
  restore();
}

// --- [9] the audio bed + title one-shots (fix pass) ------------------------------------------
// The REAL FlyAudio on a mock AudioContext that models the one Web Audio rule
// the review turned on: a node connected to an AudioParam is SUMMED onto the
// param's intrinsic value. The 'prop' tremolo LFO (audio-engine _applyProfile)
// feeds engGain.gain, so the audible engine amplitude on the title is
// |intrinsic| + Σ|connected depth|, not the intrinsic alone.
console.log('\n[9] audio bed + title one-shots');
try {
  class MockParam {
    constructor(v) {
      this._v = v;
      this.last = v; // the value the param settles to (last scheduled target)
      this.inputs = [];
    }
    get value() {
      return this._v;
    }
    set value(v) {
      this._v = v;
      this.last = v;
    }
    setTargetAtTime(v) {
      this.last = v;
    }
    setValueAtTime(v) {
      this._v = v;
      this.last = v;
    }
    linearRampToValueAtTime(v) {
      this.last = v;
    }
    exponentialRampToValueAtTime(v) {
      this.last = v;
    }
    cancelScheduledValues() {
      this.last = this._v;
    }
  }
  class MockNode {
    constructor() {
      this.outs = [];
    }
    connect(d) {
      if (d instanceof MockParam) d.inputs.push(this);
      this.outs.push(d);
      return d;
    }
    disconnect() {
      for (const d of this.outs) if (d instanceof MockParam) d.inputs = d.inputs.filter((n) => n !== this);
      this.outs = [];
    }
    start() {}
    stop() {}
  }
  class MockAC {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.sampleRate = 8000;
      this.destination = new MockNode();
    }
    createGain() {
      const n = new MockNode();
      n.gain = new MockParam(1);
      return n;
    }
    createOscillator() {
      const n = new MockNode();
      n.frequency = new MockParam(440);
      n.detune = new MockParam(0);
      return n;
    }
    createBiquadFilter() {
      const n = new MockNode();
      n.frequency = new MockParam(350);
      n.Q = new MockParam(1);
      n.gain = new MockParam(0);
      return n;
    }
    createBuffer(_c, len) {
      const d = new Float32Array(len);
      return { getChannelData: () => d };
    }
    createBufferSource() {
      return new MockNode();
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  window.AudioContext = MockAC;
  const { FlyAudio } = await imp('lib/fly/audio-engine.js');
  const PA = await imp('lib/fly/player-aircraft.js');
  const amp = (p) => Math.abs(p.last) + p.inputs.reduce((s, n) => s + (n.gain ? Math.abs(n.gain.last) : 0), 0);
  const build = (id) => {
    const a = new FlyAudio();
    const ac = PA.resolveAircraft(id);
    a.setProfile(ac.audio, ac.cfg.speeds);
    a.resume(); // builds the graph on the mock context (the first-click path)
    return { a, ac };
  };
  const cruise = (a, ac) => a.update(ac.cfg.speeds.cruise, false, null);
  const ids = PA.PLAYER_AIRCRAFT.map((p) => p.id);
  const props = ids.filter((id) => PA.resolveAircraft(id).audio.mode === 'prop');
  const hasQuiet = typeof FD.quietBed === 'function' && typeof FD.wakeBed === 'function';
  gate('(9-) front-door exports quietBed / wakeBed / lockBlipWanted (the hook calls them)', hasQuiet && typeof FD.lockBlipWanted === 'function');

  // (9a) the thrum exists in flight — the instrument sees the LFO.
  const f = props.map((id) => {
    const { a, ac } = build(id);
    cruise(a, ac);
    return { id, amp: +amp(a.engGain.gain).toFixed(4), lfo: a.engGain.gain.inputs.length };
  });
  gate(`(9a) in flight the 'prop' voices (${props.join(', ')}) carry the tremolo LFO on engGain.gain (instrument sanity)`,
    props.length >= 2 && f.every((r) => r.lfo === 1 && r.amp > C.AUDIO.engineMaxGain * C.HANGAR.audioDefaults.thrumDepth), JSON.stringify(f));

  if (hasQuiet) {
    setFD(true);
    // (9b) every aircraft's engine is SILENT on the title / in the hangar.
    const q = ids.map((id) => {
      const { a, ac } = build(id);
      cruise(a, ac);
      FD.quietBed(a);
      return { id, eng: +amp(a.engGain.gain).toFixed(4), wind: +amp(a.windGain.gain).toFixed(4) };
    });
    gate(`(9b) quietBed: engine + wind amplitude 0 for all ${ids.length} aircraft (incl. the LFO summed onto engGain.gain)`,
      q.every((r) => r.eng === 0 && r.wind === 0), q.some((r) => r.eng || r.wind) ? JSON.stringify(q.filter((r) => r.eng || r.wind)) : `all ${ids.length} at 0 (${ids.join(', ')})`);
    // (9c) back in flight the tremolo depth is exactly a fresh graph's, and the
    // bed is exactly the never-quieted bed.
    const w = props.map((id) => {
      const fresh = build(id);
      cruise(fresh.a, fresh.ac);
      const { a, ac } = build(id);
      cruise(a, ac);
      FD.quietBed(a);
      FD.wakeBed(a);
      cruise(a, ac);
      return { id, depth: a._lfoGain.gain.last, freshDepth: fresh.a._lfoGain.gain.value, amp: amp(a.engGain.gain), freshAmp: amp(fresh.a.engGain.gain) };
    });
    gate('(9c) wakeBed + update restore the flight bed exactly (tremolo depth = a freshly built graph\'s)',
      w.every((r) => r.depth === r.freshDepth && Math.abs(r.amp - r.freshAmp) < 1e-12), JSON.stringify(w));
    // (9d) a prop picked WHILE quiet (the hangar pick builds a new LFO at full
    // depth): quietBed(audio, true) zeroes it at once (value, not a ramp).
    const { a: j } = build('fighter');
    FD.quietBed(j);
    const pr = PA.resolveAircraft(props[0]);
    j.setProfile(pr.audio, pr.cfg.speeds);
    const before = j._lfoGain?.gain.value;
    FD.quietBed(j, true);
    gate('(9d) a prop voice installed while quiet is silenced immediately (LFO value 0, engine amplitude 0)',
      before > 0 && j._lfoGain.gain.value === 0 && amp(j.engGain.gain) === 0, `LFO ${before} → ${j._lfoGain?.gain.value}`);
    restore();
  }

  // (9e) lock blip: flag off == today's `hex && !prev`; flag on: flight only.
  if (typeof FD.lockBlipWanted === 'function') {
    const pairs = [[null, null], ['abc', null], ['abc', 'abd'], [null, 'abc']];
    setFD(false);
    const offBad = [];
    for (const scr of SCREENS) for (const [h, p] of pairs) if (FD.lockBlipWanted(h, p, stateFor(scr)) !== !!(h && !p)) offBad.push(`${scr}:${h}/${p}`);
    setFD(true);
    const on = Object.fromEntries(SCREENS.map((scr) => [scr, FD.lockBlipWanted('abc', null, stateFor(scr))]));
    restore();
    gate('(9e) lockBlipWanted: flag off equals `hex && !prev` on every screen', offBad.length === 0, offBad.join(',') || '12 cases');
    gate('(9f) lockBlipWanted: flag on — an acquisition blips in flight only (not on the title, not in the hangar)',
      on.flight === true && on.title === false && on.hangar === false, JSON.stringify(on));
  }
} catch (e) {
  gate('(9) section ran', false, `threw: ${String(e?.message || e).slice(0, 160)}`);
  restore();
}

// --- [8] source posture ------------------------------------------------------------------
console.log('\n[8] source posture');
try {
  const rd = (rel) => {
    try {
      return fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
      return '';
    }
  };
  const scene = rd('components/fly/FlyScene.jsx');
  const mode = rd('components/fly/FlyMode.jsx');
  const pause = rd('components/fly/PauseMenu.jsx');
  const canvas = rd('components/fly/FlyCanvas.jsx');
  const title = rd('components/fly/hud/TitleScreen.jsx');
  const boot = rd('components/fly/hud/BootScreen.jsx');
  const eb = rd('components/fly/FlyErrorBoundary.jsx');
  const layout = rd('app/layout.js');
  const manifest = rd('public/manifest.json');
  const loading = rd('app/loading.js');
  gate('(8a) FlyScene W0 call sites intact (titleCam needsSnap/active, spotAllowed, menuOpen gates)',
    /runtime\.titleCam\?\.needsSnap/.test(scene) && /runtime\.titleCam\?\.active/.test(scene) && /spotAllowed\(store\)/.test(scene) && /menuOpen\(/.test(scene));
  gate('(8b) FlyMode installs the title camera and mounts the title; FlyCanvas mounts <StagePump> behind the flag',
    /installTitleCamera\(runtime\)/.test(mode) && /<TitleScreen runtime=\{runtime\}/.test(mode) && /FRONT_DOOR\.enabled && <StagePump/.test(canvas));
  gate('(8c) exit goes to the title (pause-exit-title "Exit to title"); the error boundary keeps the reload as "Restart Skyloom"',
    /data-testid|testid="pause-exit-title"/.test(pause) && /Exit to title/.test(pause) && /exitToTitle\(runtime\)/.test(mode) && /Restart Skyloom/.test(eb) && /onExit=\{onClose\}/.test(mode));
  const ids = ['title-screen', 'title-continue', 'title-free-flight', 'title-takeoff-landing', 'title-logbook', 'title-settings', 'title-credits', 'title-spot', 'settings-sheet'];
  const missing = ids.filter((id) => !title.includes(`"${id}"`));
  gate('(8d) title testids + data-overlay="title" + data-ready', missing.length === 0 && /data-overlay="title"/.test(title) && /data-ready=/.test(title), missing.join(',') || `${ids.length} ids`);
  gate('(8e) BootScreen keeps boot-screen / boot-caption / data-stage and the __flyBoot publisher',
    /data-testid="boot-screen"/.test(boot) && /data-testid="boot-caption"/.test(boot) && /data-stage=\{stage\}/.test(boot) && /window\.__flyBoot = \{ phase, pct \}/.test(boot));
  gate('(8f) Skyloom branding: layout metadata, manifest, loading, BootScreen wordmark, "Welcome to Skyloom"',
    !/ShadowADSB/.test(layout) && /Skyloom/.test(layout) && /"short_name": "Skyloom"/.test(manifest) && /Skyloom/.test(loading) && /Sky\s*<span[^>]*>loom<\/span>/.test(boot) && /Welcome to Skyloom/.test(pause));
  gate('(8g) ... the OG url and the passport storage key are unchanged',
    /url: "https:\/\/shadowadsb\.app"/.test(layout) && /shadowadsb-passport/.test(rd('stores/passport-store.js')));
  gate('(8h) the dead geolocation spawn is gone; the fly-last-pos WRITER stays (verify-boot reads it)',
    !/navigator\.geolocation/.test(mode) && /'fly-last-pos'/.test(mode) && /localStorage\.setItem\(\s*LAST_POS_KEY/.test(mode));
  gate('(8i) no new <canvas> in the title layer (67 harness sites read .fixed.inset-0 canvas)', !/<canvas/.test(title));
  // Fix pass (adversarial review). Behaviour is certified in the browser
  // (verify-r25-title leg attr) and in [9]; these pin the wiring.
  const toast = rd('components/fly/hud/SpotToast.jsx');
  const spicy = toast.slice(toast.indexOf('SPICY scan'));
  gate('(8j) the SPICY scan tick returns while !gameplayLive (no ping, no pulse, no once-per-session `seen` spent on the title)',
    /if \(!gameplayLive\(useFlyStore\.getState\(\)\)\) return;/.test(spicy.slice(0, spicy.indexOf('for (const it of traffic.items)'))));
  const hook = rd('hooks/use-fly-audio.js');
  gate('(8k) the audio hook: lockBlipWanted gates the lock blip; quietBed / wakeBed from front-door (no local copy)',
    /lockBlipWanted\(hex, prev, useFlyStore\.getState\(\)\)/.test(hook) && /wakeBed\(audio\)/.test(hook) && !/function quietBed/.test(hook));
  gate('(8l) the credit survives the title overlays: the flight bar mounts under the title Logbook; the title modal reserves the credit strip',
    /\(!titleUp \|\| logbookUp\) && <AttributionBar \/>/.test(mode) && /--fly-title-attr-reserve/.test(title) && /inset:0 0 var\(--fly-title-attr-reserve/.test(rd('components/fly/hud/title.css')));
} catch (e) {
  gate('(8) section ran', false, `threw: ${String(e?.message || e).slice(0, 160)}`);
  restore();
}

console.log(`\nVERIFY r25-front-door: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

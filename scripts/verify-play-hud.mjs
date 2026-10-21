/**
 * PLAY PASS — verify-play-hud: the HUD workstream's gate (CALM_HUD;
 * FLY_PLAY_PASS.md F1–F3, F7).
 *
 * NODE (always):
 *  (1) Flag off = the previous HUD. FlyHUD and the Settings rows (pause and
 *      title sheet, glass and zinc) are server-rendered with CALM_HUD pinned
 *      off and compared byte for byte with the files of the commit the pass
 *      started from, in every store state that changes them; ExplorerGuide
 *      keeps its pre-pass lines verbatim and adds only CALM-guarded work.
 *  (2) Flag on: the calm HUD is mounted, every testid of the off markup is
 *      still there, the stats strip is the same table (its .font-mono cells
 *      in the same order — the harnesses index them), Explorer and Clean draw
 *      no instruments and no permanent centre dot, Instruments draws exactly
 *      the FLIGHT_INSTRUMENTS HUD (the same element as the off arm, the strip
 *      marked data-instruments, the dot).
 *  (3) The block: its tunables sit inside CALM_HUD and are sane, and nothing
 *      reads CALM_HUD except lib/fly/play-pass.js.
 *  (4) Modes: the cycle, normalisation, and persistence (round trip, junk and
 *      a throwing storage read as the default).
 *  (5) The steering cue: off at the centre, on past showAt × deadzone, the
 *      needle points at the cursor, and its command is the input
 *      controller's own deadzone + expo shaping.
 *  (6) The legend's schedule: full for the first flights, then the hint; the
 *      first-flight tips suppress it.
 *  (7) The notice lane: streaming scenery alone never speaks; a held,
 *      blocking degradation retries once, speaks once at its delay, goes away
 *      on its own and stays quiet; flickering traffic never speaks; a
 *      discovery wins; a warp resets.
 *  (8) placeDock: the base when clear, the lowest clear lift otherwise, per
 *      row, never past maxBottom.
 *  (9) H is free: no other consumer reads it in flight.
 * (10) calm-hud.css: every rule is scoped to something only the flag renders.
 * (11) The HUD row: three modes in Settings with the flag on (glass), absent
 *      with it off.
 *
 * BROWSER (with --url=http://localhost:PORT, a running dev server; live data):
 * (12) Flag on, 1440×900 free flight: the dock is up inside the viewport, the
 *      strip is visually hidden, no instruments; the cue shows on an
 *      off-centre move and fades at rest; calm dims after the delay and wakes
 *      on input; H cycles Instruments → Clean → Explorer and persists.
 * (13) The overlap audit at 1440×900, 1920×1080 and 1280×720 (Nearby open,
 *      escort flying where traffic allows): the dock and the notice lane
 *      overlap no other HUD surface.
 * (14) Flag off (?flags=-CALM_HUD): today's HUD — instruments, the Spotting
 *      button, the legend — and no calm element.
 * (15) Zero page errors and zero shader errors in every run.
 *
 * Run:  node scripts/verify-play-hud.mjs [--url=http://localhost:3131]
 */
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'a08407c'; // main when the Play Pass HUD stream started
const leg = process.argv.find((a) => a.startsWith('--leg='))?.slice(6);
const urlArg = (process.argv.find((a) => a.startsWith('--url='))?.slice(6) || process.env.FLY_URL || '').replace(/\/$/, '');
const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' });
const lf = (s) => s.replace(/\r\n/g, '\n');
const read = (rel) => lf(readFileSync(path.join(ROOT, rel), 'utf8'));

/** Node hooks: JSX through the repo's TypeScript, CSS and R3F stubbed, `?phbase` = the file at BASE. */
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
      'phud-stub:css': 'export default {};',
      'phud-stub:fiber': 'export const addAfterEffect = () => () => {}; export const useFrame = () => {}; export const useThree = () => ({});',
    };
    export async function resolve(spec, ctx, next) {
      if (spec.endsWith('.css')) return { url: 'phud-stub:css', shortCircuit: true };
      if (spec === '@react-three/fiber') return { url: 'phud-stub:fiber', shortCircuit: true };
      return next(spec, ctx);
    }
    export async function load(url, ctx, next) {
      if (STUB[url]) return { format: 'module', source: STUB[url], shortCircuit: true };
      if (!url.startsWith('file:')) return next(url, ctx);
      const u = new URL(url);
      const base = u.searchParams.get('phbase');
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

/** One arm, in its own process (a page-load decision cannot be flipped in place). */
async function runLeg(arm) {
  const on = arm === 'on';
  globalThis.window = { location: { search: '', href: 'http://localhost/' } };
  globalThis.window.__flyCalmHudOverride = { enabled: on };
  globalThis.OffscreenCanvas ??= class {
    constructor(w, h) {
      this.width = w;
      this.height = h;
    }
    getContext() {
      return null;
    }
  };
  process.env.NODE_ENV = 'production';
  registerHooks();
  const imp = (rel, q = '') => import(pathToFileURL(path.join(ROOT, rel)).href + q);
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { useFlyStore } = await imp('stores/fly-store.js');
  const now = await imp('components/fly/hud/FlyHUD.jsx');
  const rowsNow = await imp('components/fly/hud/SettingsRows.jsx');
  const base = on ? null : await imp('components/fly/hud/FlyHUD.jsx', `?phbase=${BASE}`);
  const rowsBase = on ? null : await imp('components/fly/hud/SettingsRows.jsx', `?phbase=${BASE}`);
  const runtime = { flight: null, geo: null };
  const init = { ...useFlyStore.getInitialState() };
  const render = (el, state) => {
    const s = { ...init, qualityTier: 'high', qualityPreset: 'high', cameraMode: 'chase', lockState: 'idle', ...state };
    Object.assign(useFlyStore.getInitialState(), s);
    useFlyStore.setState(s);
    return renderToStaticMarkup(el);
  };
  const out = { markups: {}, base: {}, rows: {}, rowsBase: {} };
  for (const [name, state] of Object.entries(STATES)) {
    out.markups[name] = render(React.createElement(now.FlyHUD, { runtime }), state);
    if (base) out.base[name] = render(React.createElement(base.FlyHUD, { runtime }), state);
  }
  if (on) {
    for (const mode of ['explorer', 'instruments', 'clean']) out.markups[`mode-${mode}`] = render(React.createElement(now.FlyHUD, { runtime }), { ...STATES.enhanced, hudMode: mode });
  }
  const flight = { screen: 'flight', phase: 'paused', mapStyle: 'satellite' };
  const title = { screen: 'title', phase: 'flying', mapStyle: 'satellite' };
  for (const [name, state, props] of [['pause', flight, { includeConditions: false }], ['sheet', title, { sheet: true }]]) {
    out.rows[name] = render(React.createElement(rowsNow.SettingsRows, props), state);
    if (rowsBase) out.rowsBase[name] = render(React.createElement(rowsBase.SettingsRows, props), state);
  }
  if (on) {
    const hud = await imp('components/fly/hud/calm-hud.js');
    const { FLIGHT, CALM_HUD } = await imp('lib/fly/fly-constants.js');
    out.flight = { deadzone: FLIGHT.mouseDeadzone, expo: FLIGHT.mouseExpo };
    out.block = CALM_HUD;
    const store = () => {
      const m = new Map();
      return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m };
    };
    const s1 = store();
    const thrower = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    out.modes = {
      list: hud.HUD_MODES,
      cycle: hud.HUD_MODES.map((m) => hud.nextHudMode(m)),
      junk: [hud.normalizeHudMode('fighter'), hud.normalizeHudMode(null), hud.normalizeHudMode(undefined)],
      empty: hud.readHudMode(s1),
      saved: (hud.saveHudMode('clean', s1), hud.readHudMode(s1)),
      junkSaved: (s1.setItem(CALM_HUD.storageKey, 'tapes'), hud.readHudMode(s1)),
      thrower: [hud.readHudMode(thrower), hud.saveHudMode('instruments', thrower)],
      labels: hud.HUD_MODES.map(hud.hudModeLabel),
    };
    const cue = { deadzone: FLIGHT.mouseDeadzone, expo: FLIGHT.mouseExpo, ...CALM_HUD.cue };
    out.cue = {
      centre: hud.steerCue(0, 0, 1440, 900, cue),
      inDead: hud.steerCue(cue.deadzone * 0.9, 0, 1440, 900, cue),
      justIn: hud.steerCue(cue.deadzone * (cue.showAt - 0.1), 0, 1440, 900, cue),
      justOut: hud.steerCue(cue.deadzone * (cue.showAt + 0.1), 0, 1440, 900, cue),
      right: hud.steerCue(0.4, 0, 1440, 900, cue),
      down: hud.steerCue(0, 0.4, 1440, 900, cue),
      upLeft: hud.steerCue(-0.3, -0.3 * (1440 / 900), 1440, 900, cue),
      full: hud.steerCue(1, 1, 1440, 900, cue),
      junk: hud.steerCue(NaN, undefined, 1440, 900, cue),
    };
    out.legend = {
      first: hud.legendMode({ flights: 0, shownSec: 0, tutorial: 'done' }),
      last: hud.legendMode({ flights: CALM_HUD.legend.flights - 1, shownSec: CALM_HUD.legend.seconds - 1, tutorial: 'skipped' }),
      timeUp: hud.legendMode({ flights: 0, shownSec: CALM_HUD.legend.seconds, tutorial: 'done' }),
      later: hud.legendMode({ flights: CALM_HUD.legend.flights, shownSec: 0, tutorial: 'done' }),
      tips: hud.legendMode({ flights: 0, shownSec: 0, tutorial: 'new' }),
      storage: (() => {
        const s2 = store();
        const a = hud.readLegendFlights(s2);
        hud.saveLegendFlights(2, s2);
        const b = hud.readLegendFlights(s2);
        s2.setItem(CALM_HUD.legend.storageKey, '{bad');
        return [a, b, hud.readLegendFlights(s2), hud.readLegendFlights(thrower)];
      })(),
    };
    // (7) the notice lane over scripted timelines (1 Hz, like ExplorerGuide)
    const N = CALM_HUD.notices;
    const run = (secs, input) => {
      const lane = hud.createNoticeLane(N);
      const tl = [];
      for (let t = 0; t <= secs; t++) {
        const r = lane.step(t, typeof input === 'function' ? input(t, lane) : input);
        tl.push({ t, kind: r.notice?.kind ?? null, retry: r.retry, text: r.notice?.text ?? null });
      }
      return tl;
    };
    out.lane = {
      streaming: run(900, { blocking: false, traffic: null }),
      blocking: run(N.sceneryAfterSec + N.showSec + N.repeatSec + 60, { blocking: true }),
      recovered: run(N.sceneryAfterSec + 4, (t) => ({ blocking: t < N.sceneryAfterSec + 2 })),
      traffic: run(N.trafficAfterSec + N.showSec + 30, { traffic: 'delayed' }),
      flicker: run(600, (t) => ({ traffic: Math.floor(t / 5) % 2 ? 'delayed' : 'live' })),
      unavailable: run(N.trafficAfterSec + 2, { traffic: 'unavailable' }),
      discovery: run(N.sceneryAfterSec + 4, (t) => ({ blocking: true, discovery: { text: 'Discovered X', until: N.sceneryAfterSec + 2 } })),
      warp: run(N.sceneryAfterSec + 10, (t, lane) => {
        if (t === N.sceneryAfterSec - 5) lane.reset();
        return { blocking: true };
      }),
    };
    out.place = {
      clear: hud.placeDock([{ left: 500, right: 940, y0: 0, y1: 44 }], [{ left: 1060, right: 1240, top: 815, bottom: 861 }], { base: 62, vh: 900 }),
      lift: hud.placeDock([{ left: 500, right: 940, y0: 0, y1: 44 }], [{ left: 16, right: 600, top: 740, bottom: 860 }], { base: 62, vh: 900 }),
      rowAbove: hud.placeDock([{ left: 500, right: 940, y0: 0, y1: 44 }, { left: 370, right: 1075, y0: 54, y1: 74 }], [{ left: 1060, right: 1240, top: 815, bottom: 861 }], { base: 62, vh: 900 }),
      capped: hud.placeDock([{ left: 500, right: 940, y0: 0, y1: 44 }], [{ left: 400, right: 1000, top: 100, bottom: 860 }], { base: 62, vh: 900, maxBottom: 900 * 0.42 }),
      stacked: hud.placeDock([{ left: 500, right: 940, y0: 0, y1: 44 }], [{ left: 16, right: 600, top: 740, bottom: 860 }, { left: 900, right: 1100, top: 690, bottom: 735 }], { base: 62, vh: 900 }),
    };
  }
  return out;
}

if (leg) {
  const r = await runLeg(leg);
  process.stdout.write(JSON.stringify(r));
  process.exit(0);
}

let pass = 0;
let fail = 0;
const fails = [];
const check = (name, ok, detail = '') => {
  ok ? pass++ : (fail++, fails.push(name));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const run = (l) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), `--leg=${l}`], { cwd: ROOT, maxBuffer: 64 << 20 }).toString());
const testids = (html) => [...new Set([...html.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1]))].sort();
const strip = (html) => /<div data-testid="flight-stats-strip"[\s\S]*?<\/button>(?:<div[^>]*>[\s\S]*?<\/div>){2}<\/div>/.exec(html)?.[0] ?? '';
const monoCells = (html) => [...strip(html).matchAll(/<span class="font-mono[^"]*"[^>]*>/g)].length;

console.log('[node]');
const off = run('off');
const on = run('on');

// (1) flag off = the previous HUD
for (const s of Object.keys(STATES)) {
  check(`(1a) ${s}: CALM_HUD off renders the pre-pass FlyHUD byte for byte`, off.markups[s] === off.base[s] && off.markups[s].length > 500, `${off.markups[s].length} chars`);
}
for (const r of ['pause', 'sheet']) {
  check(`(1b) Settings ${r}: CALM_HUD off renders the pre-pass rows byte for byte`, off.rows[r] === off.rowsBase[r] && off.rows[r].length > 200, `${off.rows[r].length} chars`);
}
{
  const nowSrc = read('components/fly/hud/ExplorerGuide.jsx');
  const baseSrc = lf(git('show', `${BASE}:components/fly/hud/ExplorerGuide.jsx`));
  const baseLines = baseSrc.split('\n').filter((l) => l.trim());
  // The two JSX lines gained one flag term each; everything else is verbatim.
  const allowed = (l) => nowSrc.includes(l) || nowSrc.includes(l.replace('data-testid="explorer-guide">', 'data-testid="explorer-guide" data-calm={CALM?\'1\':undefined}>')) || nowSrc.includes(l.replace("{prefs.tutorial!=='new'&&!guidedJourney&&(degraded?", "{prefs.tutorial!=='new'&&!guidedJourney&&!CALM&&(degraded?"));
  const gone = baseLines.filter((l) => !allowed(l));
  const added = nowSrc.split('\n').filter((l) => l.trim() && !baseSrc.includes(l));
  const unguarded = added.filter((l) => !/CALM|notices|laneEpoch|discovery|setLane|blocking|retryWorldContent|^\s*\/\/|^\s*\}\s*$|^\s*if\(r\.retry\)|^\s*const r=notices/.test(l));
  check('(1c) ExplorerGuide keeps every pre-pass line and adds only CALM-guarded work', gone.length === 0 && unguarded.length === 0, [...gone.map((l) => `gone: ${l.trim().slice(0, 60)}`), ...unguarded.map((l) => `unguarded: ${l.trim().slice(0, 60)}`)].join(' | '));
}

// (2) flag on
for (const s of Object.keys(STATES)) {
  const m = on.markups[s];
  // The instruments' own testids belong to the Instruments mode, (2e).
  const missing = testids(off.markups[s]).filter((t) => !/^hud-(instruments|tape-|heading-|throttle-mode|vertical-speed|radar-altitude|flight-path)/.test(t) && !m.includes(`data-testid="${t}"`));
  check(`(2a) ${s}: the calm HUD is mounted and every off-arm testid is kept`, m.includes('data-testid="hud-calm"') && m.includes('data-testid="hud-dock"') && m.includes('data-testid="hud-steer-cue"') && missing.length === 0, missing.length ? `missing ${missing}` : '');
  const a = strip(off.markups[s]).replace(/ data-instruments="1"/, '');
  const b = strip(m).replace(/ data-calm="[a-z]+"/, '');
  check(`(2b) ${s}: the stats strip is the same table (same cells, same .font-mono order)`, a.length > 300 && a === b && monoCells(m) === monoCells(off.markups[s]) && monoCells(m) >= 5, `${monoCells(m)} mono cells`);
}
{
  const dot = 'h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60';
  const ex = on.markups['mode-explorer'];
  const ins = on.markups['mode-instruments'];
  const cl = on.markups['mode-clean'];
  check('(2c) Explorer: no instruments, no permanent centre dot, the cluster and the place spans', !ex.includes('hud-instruments') && !ex.includes(dot) && ex.includes('data-testid="hud-cluster"') && ex.includes('class="calm-place-name"') && /data-testid="hud-poi"[^>]*data-calm="explorer"/.test(ex));
  check('(2d) Clean: no instruments, no dot, no cluster', !cl.includes('hud-instruments') && !cl.includes(dot) && !cl.includes('data-testid="hud-cluster"') && cl.includes('data-mode="clean"'));
  const fiOff = /<svg class="fi"[\s\S]*?<\/svg>/.exec(off.markups.enhanced)?.[0];
  const fiOn = /<svg class="fi"[\s\S]*?<\/svg>/.exec(ins)?.[0];
  check('(2e) Instruments: the FLIGHT_INSTRUMENTS element exactly, the strip marked, the dot', !!fiOff && fiOn === fiOff && /data-testid="flight-stats-strip"[^>]*data-instruments="1"/.test(ins) && ins.includes(dot) && !ins.includes('data-testid="hud-cluster"'));
  check('(2f) the Spotting toggle lives in the dock (Enhanced), the old floating one is gone on desktop', /class="calm-spotting"[^>]*>[\s\S]*?Spotting · Off/.test(on.markups.enhanced) && !on.markups.enhanced.includes('class="cinema-spotting"') && off.markups.enhanced.includes('class="cinema-spotting"'));
}

// (3) the block
{
  const b = on.block;
  const consts = read('lib/fly/fly-constants.js');
  const block = (consts.match(/export const CALM_HUD = \{[\s\S]*?\n\};/) || [''])[0];
  const sane =
    b.enabled === true && JSON.stringify(b.modes) === '["explorer","instruments","clean"]' && b.modes.includes(b.defaultMode) && b.defaultMode === 'explorer' &&
    /^[a-z]$/.test(b.key) && b.calm.afterSec >= 3 && b.calm.afterSec <= 20 && [b.calm.cluster, b.calm.chrome, b.calm.minimap].every((v) => v > 0.2 && v < 1) &&
    b.cue.showAt >= 1 && b.cue.idleSec > 0.5 && b.cue.needlePx > 10 && b.cue.needlePx < 120 && b.legend.flights >= 1 && b.legend.seconds >= 10 &&
    b.notices.sceneryAfterSec >= 15 && b.notices.retryAfterSec < b.notices.sceneryAfterSec && b.notices.showSec >= 4 && b.notices.repeatSec >= 60 && b.notices.trafficAfterSec >= 5 &&
    b.lowAglFt > 0 && b.vsArrowFpm > 0 && b.cleanPlaceSec > 0;
  check('(3a) CALM_HUD carries its tunables inside its own block, and they are sane', sane && /storageKey: 'fly-hud-mode'/.test(block) && /calm: \{/.test(block) && /notices: \{/.test(block), JSON.stringify({ calm: b.calm, notices: b.notices }));
  const direct = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (f === 'node_modules' || f === 'vendor') continue;
      if (statSync(p).isDirectory()) walk(p);
      // device-report.js lists every flag block for the device report (verify-true-earth-flags (6)).
      else if (/\.(m?js|jsx)$/.test(f) && !p.endsWith('fly-constants.js') && !p.endsWith('play-pass.js') && !p.endsWith('device-report.js')) {
        if (/\bCALM_HUD\b/.test(readFileSync(p, 'utf8').replace(/playPass(On|Block)\('CALM_HUD'\)|['"]CALM_HUD['"]|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, ''))) direct.push(path.relative(ROOT, p));
      }
    }
  };
  for (const d of ['lib', 'components', 'hooks', 'stores', 'app']) walk(path.join(ROOT, d));
  check('(3b) CALM_HUD is read only through lib/fly/play-pass.js', direct.length === 0, direct.join(', '));
}

// (4) modes
{
  const m = on.modes;
  check('(4a) H cycles Explorer → Instruments → Clean → Explorer', JSON.stringify(m.cycle) === '["instruments","clean","explorer"]' && JSON.stringify(m.labels) === '["Explorer","Instruments","Clean"]');
  check('(4b) junk and missing picks read as Explorer', m.junk.every((v) => v === 'explorer') && m.empty === 'explorer' && m.junkSaved === 'explorer');
  check('(4c) a pick persists, and a blocked storage still answers', m.saved === 'clean' && m.thrower[0] === 'explorer' && m.thrower[1] === 'instruments');
}

// (5) the steering cue
{
  const c = on.cue;
  const { deadzone, expo } = on.flight;
  const shape = (v) => (Math.abs(v) < deadzone ? 0 : Math.sign(v) * Math.pow(Math.min(1, (Math.abs(v) - deadzone) / (1 - deadzone)), expo));
  check('(5a) centred and inside the deadzone: no cue, and the cue knows it is home', !c.centre.on && c.centre.centred && !c.inDead.on && c.inDead.centred && c.centre.mag === 0);
  check('(5b) it appears past showAt × the deadzone, not before', !c.justIn.on && c.justOut.on);
  check('(5c) the needle points at the cursor (right 0°, down 90°, up-left −135°)', Math.abs(c.right.angle) < 1e-9 && Math.abs(c.down.angle - 90) < 1e-9 && Math.abs(c.upLeft.angle + 135) < 0.01, `${c.right.angle}, ${c.down.angle}, ${c.upLeft.angle.toFixed(2)}`);
  check("(5d) the command is the input controller's shaping (deadzone + expo, per axis)", Math.abs(c.right.turn - shape(0.4)) < 1e-12 && Math.abs(c.down.pitch + shape(0.4)) < 1e-12 && c.full.mag === 1 && c.full.len > c.right.len && c.right.len > c.justOut.len);
  check('(5e) junk input is a centred cue, never NaN', !c.junk.on && Number.isFinite(c.junk.angle) && Number.isFinite(c.junk.len));
}

// (6) the legend
{
  const L = on.legend;
  check('(6a) full for the first flights, the hint after them or after the time', L.first === 'full' && L.last === 'full' && L.timeUp === 'hint' && L.later === 'hint');
  check('(6b) the first-flight tips do the teaching (no legend under them)', L.tips === 'none');
  check('(6c) the flight count persists and junk reads as zero', JSON.stringify(L.storage) === '[0,2,0,0]', JSON.stringify(L.storage));
}

// (7) the notice lane
{
  const N = on.block.notices;
  const said = (tl, kind) => tl.filter((x) => x.kind === kind).map((x) => x.t);
  const S = on.lane;
  check('(7a) streaming scenery alone never speaks (15 minutes)', S.streaming.every((x) => !x.kind && !x.retry));
  const sc = said(S.blocking, 'scenery');
  const retries = S.blocking.filter((x) => x.retry).map((x) => x.t);
  const first = sc.filter((t) => t < N.sceneryAfterSec + N.showSec);
  const again = sc.filter((t) => t >= N.sceneryAfterSec + N.showSec);
  check('(7b) a held, blocking degradation retries once, then speaks at its delay for showSec', JSON.stringify(retries) === JSON.stringify([N.retryAfterSec]) && first.length === N.showSec && first[0] === N.sceneryAfterSec, `retry at ${retries} · said ${first[0]}…${first.at(-1)}`);
  check('(7c) it goes away on its own and stays quiet for repeatSec', again.length === 0 || again[0] >= N.sceneryAfterSec + N.showSec + N.repeatSec, `next at ${again[0] ?? 'never'}`);
  check('(7d) recovery ends the notice at once', S.recovered.at(-1).kind === null && S.recovered.some((x) => x.kind === 'scenery'));
  const tr = said(S.traffic, 'traffic');
  check('(7e) traffic speaks after trafficAfterSec, for showSec', tr[0] === N.trafficAfterSec && tr.length === N.showSec, `${tr[0]} × ${tr.length}`);
  check('(7f) traffic flickering delayed/live never speaks', S.flicker.every((x) => !x.kind));
  check('(7g) the copy is calm and specific', /offline for now/.test(S.unavailable.at(-1).text ?? '') && /fill in as you fly/.test(S.blocking[N.sceneryAfterSec].text));
  check('(7h) a discovery wins over scenery while it lasts', S.discovery[N.sceneryAfterSec].kind === 'discovery' && S.discovery[N.sceneryAfterSec + 3].kind === 'scenery');
  check('(7i) a warp starts the clock again', said(S.warp, 'scenery').length === 0);
}

// (8) placeDock
{
  const P = on.place;
  check('(8a) clear column: the base', P.clear === 62);
  check('(8b) an obstacle in its column: lifted just above it', P.lift === 900 - 740 + 10, `${P.lift}`);
  check('(8c) per row: a row above an obstacle does not lift the dock', P.rowAbove === 62, `${P.rowAbove}`);
  check('(8d) never past maxBottom (a tall surface wins; the dock stays home)', P.capped === 62);
  check('(8e) stacked obstacles: the lowest height that clears them all', P.stacked === 900 - 690 + 10, `${P.stacked}`);
}

// (9) H is free
{
  const hits = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (f === 'node_modules' || f === 'vendor') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|jsx)$/.test(f)) {
        const src = readFileSync(p, 'utf8');
        if (/consumePress\(['"]h['"]\)|key(?:\.toLowerCase\(\))?\s*===\s*['"][hH]['"]|k\s*===\s*['"][hH]['"]|case ['"][hH]['"]/.test(src)) hits.push(path.relative(ROOT, p).split(path.sep).join('/'));
      }
    }
  };
  for (const d of ['lib', 'components', 'hooks']) walk(path.join(ROOT, d));
  const others = hits.filter((p) => p !== 'components/fly/hud/CinemaTitle.jsx');
  check('(9) H belongs to the HUD in flight (the title uses it only on its own root)', others.length === 0 && on.block.key === 'h', others.join(', '));
}

// (10) css scoping
{
  const css = read('components/fly/hud/calm-hud.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const body = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const sels = [];
  const re = /([^{}]+)\{/g;
  let m;
  while ((m = re.exec(body))) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@')) continue;
    sels.push(...sel.split(/,(?![^(]*\))/).map((s) => s.trim()));
  }
  const loose = sels.filter((s) => !/\.calm-|data-calm|calm-root|explorer-guide\[data-calm\]/.test(s));
  check('(10) every calm-hud.css rule is scoped to something only the flag renders', sels.length > 30 && loose.length === 0, loose.slice(0, 5).join(' | '));
}

// (11) the Settings row
{
  const ids = ['settings-hud-explorer', 'settings-hud-instruments', 'settings-hud-clean'];
  check('(11a) flag on: Settings offers the three HUD modes (pause and title sheet)', ['pause', 'sheet'].every((r) => ids.every((id) => on.rows[r].includes(`data-testid="${id}"`))) && on.rows.pause.includes('data-testid="pause-hud"') && on.rows.sheet.includes('data-testid="settings-hud"'));
  check('(11b) flag off: no HUD row', ['pause', 'sheet'].every((r) => !off.rows[r].includes('settings-hud')));
}

// ------------------------------------------------------------------- browser
if (urlArg) {
  console.log(`\n[browser ${urlArg}]`);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const SITE = { lat: 40.705, lon: -74.03, altM: 900, headingDeg: 30 };
  async function session(size, flags = '') {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 300)}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && /shader|WebGLProgram|GLSL/i.test(m.text())) errors.push(`shader: ${m.text().slice(0, 300)}`);
    });
    await page.addInitScript(() => {
      window.__flyVisualsOverride = 'enhanced';
      window.__flyWeatherOverride = 'baseline';
      const d = new Date();
      window.__flySunOverride = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17);
      try {
        localStorage.setItem('fly-map-style-2', 'satellite');
        localStorage.setItem('fly-sound-on', '0');
        localStorage.setItem('fly-controls-seen', '1');
        localStorage.setItem('fly-crash-mode', 'forgiving');
        localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { sensitivity: 1, invertPitch: false, master: 1, effects: 1, music: 0.65, tutorial: 'done' } }));
      } catch {
        /* private mode */
      }
    });
    await page.goto(`${urlArg}/?graphicsReview=1${flags}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
    await page.waitForFunction(() => typeof window.__fly?.launchSetup === 'function' && !!window.__flyStore, undefined, { timeout: 300000 });
    await page.evaluate((g) => window.__fly.launchSetup({ flightMode: 'free', aircraftId: 'fighter', dest: { id: 'poi:verify-play-hud', name: 'Manhattan', kind: 'city', region: 'Gate', ...g } }), SITE);
    await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, { timeout: 300000, polling: 500 });
    await page.mouse.move(size.width / 2, size.height / 2);
    await page.waitForTimeout(9000);
    return { page, errors };
  }
  const rect = (page, sel) => page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x: r.x, y: r.y, r: r.right, b: r.bottom, w: r.width, h: r.height, vis: cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.02 && r.width > 2 && r.height > 2 };
  }, sel);
  // Every other HUD surface the dock and the lane must stay clear of.
  const audit = (page) => page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      for (let e = el; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null;
      }
      return { x: r.x, y: r.y, r: r.right, b: r.bottom };
    };
    const mine = [...document.querySelectorAll('.calm-dock > *, .calm-notice')].map((el) => ({ id: el.className.split(' ')[0], box: vis(el) })).filter((m) => m.box);
    const sel = { attribution: '[data-zone="attribution"] > div', minimap: '[data-zone="minimap"] canvas', contracts: '[data-zone="contracts"] > *', toasts: '[data-zone="toasts"] > *', info: '[data-testid="infocard"], [data-testid="infocard-chip"]', exit: '[data-zone="exit"] > *', nearby: '.tgt-scope-btn', nearbyPanel: '[data-testid="nearby-panel"]', escort: '.tgt-escort[data-active="1"]', encounter: '[data-testid="encounter-card"]', poi: '[data-testid="hud-poi"]', juice: '[data-testid="juice-hud"]', ops: '[data-testid="operations-hud"]' };
    const others = [];
    for (const [id, s] of Object.entries(sel)) for (const el of document.querySelectorAll(s)) { const box = vis(el); if (box) others.push({ id, box }); }
    const hit = (a, b) => a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1;
    const clashes = [];
    for (const m of mine) for (const o of others) if (hit(m.box, o.box)) clashes.push(`${m.id} × ${o.id}`);
    for (const m of mine) if (m.box.x < 0 || m.box.y < 0 || m.box.r > innerWidth || m.box.b > innerHeight) clashes.push(`${m.id} outside`);
    return { mine: mine.map((m) => m.id), others: [...new Set(others.map((o) => o.id))], clashes };
  });

  // (12) behaviour at 1440×900
  {
    const { page, errors } = await session({ width: 1440, height: 900 });
    try {
      const st = await page.evaluate(() => ({ mode: window.__flyStore.getState().hudMode, fi: !!document.querySelector('[data-testid="hud-instruments"]'), strip: (() => { const r = document.querySelector('[data-testid="flight-stats-strip"]').getBoundingClientRect(); return r.width * r.height; })(), spd: document.querySelector('.calm-cell[data-k="spd"] b')?.textContent }));
      const dock = await rect(page, '[data-testid="hud-dock"]');
      check('(12a) Explorer: the dock is up inside the viewport, the strip hidden, no instruments, live figures', st.mode === 'explorer' && !st.fi && st.strip <= 1 && dock?.vis && dock.x >= 0 && dock.r <= 1440 && dock.b <= 900 && /^\d+$/.test(st.spd ?? ''), JSON.stringify({ ...st, dock }));
      await page.mouse.move(720 + 200, 450 - 80, { steps: 6 });
      await page.waitForTimeout(400);
      const cueOn = await page.evaluate(() => document.querySelector('[data-testid="hud-steer-cue"]')?.dataset.on);
      await page.mouse.move(720, 450, { steps: 6 });
      await page.waitForTimeout(1600);
      const cueHome = await page.evaluate(() => document.querySelector('[data-testid="hud-steer-cue"]')?.dataset.on);
      check('(12b) the steering cue shows off-centre and fades at the centre', cueOn === '1' && cueHome === '0', `${cueOn} → ${cueHome}`);
      const afterSec = on.block.calm.afterSec;
      // Live traffic can raise an event (an invitation) at any moment, so wait
      // for the first calm stretch rather than one fixed instant.
      const calm = await page
        .waitForFunction(() => document.querySelector('[data-testid="hud-calm"]')?.dataset.calm === '1', undefined, { timeout: (afterSec + 20) * 1000, polling: 200 })
        .then(() => '1', () => '0');
      await page.waitForTimeout(1600);
      const dimmed = await page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-zone="minimap"]')).opacity));
      await page.mouse.move(700, 440, { steps: 3 });
      await page.waitForTimeout(500);
      const woke = await page.evaluate(() => document.querySelector('[data-testid="hud-calm"]')?.dataset.calm);
      check('(12c) calm dims the chrome after the delay and wakes on input', calm === '1' && dimmed < 0.9 && woke === '0', `${calm} (minimap ${dimmed.toFixed(2)}) → ${woke}`);
      const modes = [];
      for (let i = 0; i < 3; i++) {
        await page.keyboard.press('h');
        await page.waitForTimeout(700);
        modes.push(await page.evaluate(() => ({ mode: window.__flyStore.getState().hudMode, saved: localStorage.getItem('fly-hud-mode'), fi: document.querySelector('[data-testid="hud-instruments"]')?.dataset.kind ?? null, dock: getComputedStyle(document.querySelector('[data-testid="hud-dock"]')).visibility, minimap: getComputedStyle(document.querySelector('[data-zone="minimap"]')).visibility, caption: !!document.querySelector('[data-testid="hud-mode-caption"]') })));
      }
      const [a, b, c] = modes;
      check('(12d) H: Instruments (the FLIGHT_INSTRUMENTS HUD), Clean (dock and dial away), Explorer; each persisted and captioned',
        a.mode === 'instruments' && a.fi === 'desktop' && b.mode === 'clean' && !b.fi && b.dock === 'hidden' && b.minimap === 'hidden' && c.mode === 'explorer' && !c.fi && c.dock === 'visible' && modes.every((m) => m.saved === m.mode && m.caption), JSON.stringify(modes));
      const au = await audit(page);
      check('(13a) 1440×900 cruise: the dock overlaps nothing', au.clashes.length === 0 && au.mine.length >= 2, `${au.clashes.join('; ')} · mine ${au.mine} · others ${au.others}`);
      await page.keyboard.press('n');
      await page.waitForTimeout(1500);
      const au2 = await audit(page);
      check('(13b) 1440×900 Nearby open: the dock overlaps nothing', au2.clashes.length === 0, au2.clashes.join('; '));
      const go = await page.$('[data-testid="nearby-panel"] .tgt-go');
      if (go) {
        await go.click();
        await page.waitForTimeout(6000);
        const au3 = await audit(page);
        check('(13c) 1440×900 escort: the dock and the lane overlap nothing', au3.clashes.length === 0, `${au3.clashes.join('; ')} · others ${au3.others}`);
        await page.keyboard.press('f');
      } else console.log('      (13c) skipped: no live traffic in reach to escort');
      check('(15a) 1440×900 flag on: zero page and shader errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    } catch (e) {
      check('(12) 1440×900 run', false, e.message.split('\n')[0]);
    } finally {
      await page.close();
    }
  }
  for (const size of [{ width: 1920, height: 1080 }, { width: 1280, height: 720 }]) {
    const { page, errors } = await session(size);
    try {
      const au = await audit(page);
      await page.keyboard.press('n');
      await page.waitForTimeout(1500);
      const au2 = await audit(page);
      check(`(13d) ${size.width}×${size.height}: the dock overlaps nothing (cruise, Nearby open)`, au.clashes.length === 0 && au2.clashes.length === 0 && au.mine.length >= 2, [...au.clashes, ...au2.clashes].join('; '));
      check(`(15b) ${size.width}×${size.height}: zero page and shader errors`, errors.length === 0, errors.slice(0, 2).join(' | '));
    } catch (e) {
      check(`(13d) ${size.width}×${size.height} run`, false, e.message.split('\n')[0]);
    } finally {
      await page.close();
    }
  }
  // (14) flag off
  {
    const { page, errors } = await session({ width: 1440, height: 900 }, '&flags=-CALM_HUD');
    try {
      const st = await page.evaluate(() => ({
        calm: !!document.querySelector('[data-testid="hud-calm"]'),
        fi: document.querySelector('[data-testid="hud-instruments"]')?.dataset.kind ?? null,
        spotting: !!document.querySelector('.cinema-spotting'),
        legend: /Esc controls|Esc menu/.test(document.body.innerText),
        notice: !!document.querySelector('.calm-notice'),
      }));
      check("(14) flag off: today's HUD (instruments, the floating Spotting button, the legend), no calm element", !st.calm && st.fi === 'desktop' && st.spotting && st.legend && !st.notice, JSON.stringify(st));
      check('(15c) flag off: zero page and shader errors', errors.length === 0, errors.slice(0, 2).join(' | '));
    } catch (e) {
      check('(14) flag-off run', false, e.message.split('\n')[0]);
    } finally {
      await page.close();
    }
  }
  await browser.close();
} else {
  console.log('\n(browser legs skipped: pass --url=http://localhost:PORT to run (12)-(15))');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log(`FAILED: ${fails.join(' | ')}`);
process.exit(fail ? 1 : 0);

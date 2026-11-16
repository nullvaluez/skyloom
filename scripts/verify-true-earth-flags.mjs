/**
 * TRUE EARTH — verify-true-earth-flags: the `?flags=` URL mechanism and the
 * flag registry it serves.
 *
 * (1-4) parse/map/install behave as documented in lib/fly/fly-pins.js, with a
 *       harness or console pin always winning over the URL.
 * (5)   every `export const NAME = {` block after the TRUE EARTH FLAGS marker
 *       in lib/fly/fly-constants.js is read somewhere in the app as
 *       pinned(NAME, '<overrideGlobalName(NAME)>'). A flag nothing reads, or
 *       one read under a different global, would make `?flags=NAME` a silent
 *       no-op — the R24 "pre-set and read by NOTHING" lesson.
 *  (6)   the device report (lib/fly/device-report.js FLAGS) lists every block,
 *       so a report always says which flags were on.
 * (8-9) WORLD PASS: one reader (lib/fly/world-pass.js), never named in the
 *       worker, and the reader's latched tier test.
 *
 * Run: node scripts/verify-true-earth-flags.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { overrideGlobalName, parseFlagParam, installUrlFlags, pinned } from '../lib/fly/fly-pins.js';

const ROOT = path.resolve(import.meta.dirname, '..');
let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// (1) names match the existing pins
const names = {
  HUD_SYNC: '__flyHudSyncOverride',
  FINALIZE_PACE: '__flyFinalizePaceOverride',
  REBASE_CALM: '__flyRebaseCalmOverride',
  TWILIGHT_FIX: '__flyTwilightFixOverride',
};
const bad = Object.entries(names).filter(([k, v]) => overrideGlobalName(k) !== v);
check('(1) NAME maps to the existing __fly<Name>Override pin', bad.length === 0, bad.map(([k]) => k).join(', '));

// (2) parsing
const cases = [
  ['?flags=A,-B', { A: true, B: false }],
  ['?flags=twilight_fix&flags=-hdr_guard', { TWILIGHT_FIX: true, HDR_GUARD: false }],
  ['?x=1&flags=%20A%20,,1BAD,-,B-C', { A: true }],
  ['', {}],
  ['?flags=', {}],
];
const badParse = cases.filter(([q, want]) => !eq(parseFlagParam(q), want));
check('(2) ?flags= parses on, off, repeats, case and junk', badParse.length === 0, badParse.map(([q]) => q).join(' | '));

// (3) install: URL sets pins; existing pins win; non-object pins untouched
const win = {
  location: { search: '?flags=TWILIGHT_FIX,-HDR_GUARD,HUD_SYNC,VISUALS,ROUTE' },
  __flyHudSyncOverride: { enabled: false },
  __flyVisualsOverride: 'classic',
  __flyRouteOverride: { k: 2 },
  console: { info() {} },
};
const applied = installUrlFlags(win);
check(
  '(3) URL flags install, an existing pin wins, a string pin is untouched, a partial pin merges',
  eq(applied, { TWILIGHT_FIX: true, HDR_GUARD: false, ROUTE: true }) &&
    win.__flyTwilightFixOverride?.enabled === true &&
    win.__flyHdrGuardOverride?.enabled === false &&
    win.__flyHudSyncOverride.enabled === false &&
    win.__flyVisualsOverride === 'classic' &&
    eq(win.__flyRouteOverride, { k: 2, enabled: true }) &&
    eq(win.__flyUrlFlags, applied),
  JSON.stringify(applied),
);

// (3b) condition pins: ?sunUtc= and ?weather=, an existing pin wins
{
  const a = { location: { search: '?sunUtc=2026-06-21T00:30:00Z&weather=overcast' }, console: { info() {} } };
  installUrlFlags(a);
  const b = { location: { search: '?sunUtc=1750000000000&weather=BAD;x' }, __flyWeatherOverride: 'baseline', console: { info() {} } };
  installUrlFlags(b);
  const c = { location: { search: '?sunUtc=not-a-date' }, __flySunOverride: 5, console: { info() {} } };
  installUrlFlags(c);
  check(
    '(3b) ?sunUtc= and ?weather= set the sun and weather pins; junk and existing pins are respected',
    a.__flySunOverride === Date.parse('2026-06-21T00:30:00Z') && a.__flyWeatherOverride === 'overcast' &&
      b.__flySunOverride === 1750000000000 && b.__flyWeatherOverride === 'baseline' &&
      c.__flySunOverride === 5,
  );
}

// (4) pinned() sees the installed flag
globalThis.window = win;
const base = { enabled: false, k: 1 };
const got = pinned(base, '__flyTwilightFixOverride');
delete globalThis.window;
check('(4) pinned() reads the URL-installed pin', got.enabled === true && got.k === 1 && base.enabled === false);

// (5) registry: every TRUE EARTH block is read under its own pin name
const constants = readFileSync(path.join(ROOT, 'lib/fly/fly-constants.js'), 'utf8');
const marker = constants.indexOf('TRUE EARTH FLAGS');
const section = marker < 0 ? '' : constants.slice(marker);
const blocks = [...section.matchAll(/^export const ([A-Z][A-Z0-9_]*) = \{/gm)].map((m) => m[1]);
const sources = [];
for (const dir of ['lib', 'components', 'app', 'hooks', 'stores']) {
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (f === 'node_modules' || f === 'vendor') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(m?js|jsx)$/.test(f) && !p.endsWith('fly-constants.js')) sources.push(readFileSync(p, 'utf8'));
    }
  };
  walk(path.join(ROOT, dir));
}
const all = sources.join('\n');
const unread = blocks.filter((b) => !new RegExp(`pinned\\(\\s*${b}\\s*,\\s*['"]${overrideGlobalName(b)}['"]`).test(all));
check(
  '(5) every TRUE EARTH flag block is read as pinned(NAME, its URL pin)',
  marker >= 0 && unread.length === 0,
  marker < 0 ? 'marker missing' : `${blocks.length} block(s)${unread.length ? `; unread: ${unread.join(', ')}` : ''}`,
);

// (6) the device report lists every flag (owners read flags off the report)
{
  const report = readFileSync(path.join(ROOT, 'lib/fly/device-report.js'), 'utf8');
  const m = report.match(/const FLAGS = \{([^}]*)\}/);
  const listed = m ? m[1].split(',').map((x) => x.trim()).filter(Boolean) : [];
  const missing = blocks.filter((b) => !listed.includes(b));
  check('(6) the device report lists every TRUE EARTH flag', m != null && missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : `${listed.length} listed`);
}

// (7) nothing but flag blocks after the marker (GATE TO GATE rule): every
//     export in the section is `export const NAME = {` with an `enabled` key,
//     so (5) can treat every block it finds there as a flag.
{
  const exports = [...section.matchAll(/^export\s+(?:const|let|var|function|class|default)\s*([A-Za-z_$][\w$]*)?[^\n]*/gm)].map((m) => m[0]);
  const stray = exports.filter((line) => !/^export const [A-Z][A-Z0-9_]* = \{/.test(line));
  const noEnabled = blocks.filter((b) => {
    const at = section.indexOf(`export const ${b} = {`);
    const next = section.indexOf('\nexport ', at + 1);
    return !/\benabled\s*:/.test(section.slice(at, next < 0 ? undefined : next));
  });
  check(
    '(7) only flag blocks (export const NAME = { enabled, ... }) follow the TRUE EARTH marker',
    stray.length === 0 && noEnabled.length === 0,
    stray.length || noEnabled.length ? `stray: ${stray.join(' | ')}; no enabled: ${noEnabled.join(', ')}` : `${blocks.length} blocks`,
  );
}

// (8) WORLD PASS (FLY_WORLD_PASS.md, rules 1-3): the five WORLD_* blocks have
//     exactly ONE pinned reader, lib/fly/world-pass.js; only that file and the
//     device report import them; the worker (vector-tile.worker.js and
//     lib/fly/toy-world/worker/**) never names them, because a worker has no
//     pins and must take the resolved values from the build request.
{
  const WP = blocks.filter((b) => /^WORLD_/.test(b));
  const files = [];
  for (const dir of ['lib', 'components', 'app', 'hooks', 'stores']) {
    const walk = (d) => {
      for (const f of readdirSync(d)) {
        const p = path.join(d, f);
        if (f === 'node_modules' || f === 'vendor') continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(m?js|jsx)$/.test(f) && !p.endsWith('fly-constants.js')) files.push([path.relative(ROOT, p).split(path.sep).join('/'), readFileSync(p, 'utf8')]);
      }
    };
    walk(path.join(ROOT, dir));
  }
  const problems = [];
  for (const b of WP) {
    const readers = files.filter(([, t]) => new RegExp(`pinned\\(\\s*${b}\\s*,`).test(t)).map(([f]) => f);
    if (readers.length !== 1 || readers[0] !== 'lib/fly/world-pass.js') problems.push(`${b} readers: ${readers.join(', ') || 'none'}`);
    const importers = files.filter(([, t]) => new RegExp(`import\\s*\\{[^}]*\\b${b}\\b[^}]*\\}\\s*from\\s*['"][^'"]*fly-constants`).test(t)).map(([f]) => f);
    const stray = importers.filter((f) => f !== 'lib/fly/world-pass.js' && f !== 'lib/fly/device-report.js');
    if (stray.length) problems.push(`${b} imported by ${stray.join(', ')}`);
    const inWorker = files.filter(([f, t]) => (f === 'lib/fly/toy-world/vector-tile.worker.js' || f.startsWith('lib/fly/toy-world/worker/')) && new RegExp(`\\b${b}\\b`).test(t)).map(([f]) => f);
    if (inWorker.length) problems.push(`${b} named in the worker: ${inWorker.join(', ')}`);
  }
  check('(8) every WORLD PASS block has one reader (lib/fly/world-pass.js) and the worker never names it', WP.length === 5 && problems.length === 0, problems.length ? problems.join(' | ') : `${WP.length} blocks`);
}

// (8b) WORLD PASS, the worker half of the request (W0-C): the worker's own
//      all-off copy (lib/fly/toy-world/worker/tile-ctx.js OFF_STREAMS, which it
//      keeps because it cannot import the store-reading reader) names the same
//      streams and sub-switches, in the same order, as lib/fly/world-pass.js
//      WORLD_PASS_STREAMS; and `options.worldPass` is read in tile-ctx.js only
//      (every builder takes tileCtx.worldPass).
{
  const W = await import('../lib/fly/world-pass.js');
  const ctxSrc = readFileSync(path.join(ROOT, 'lib/fly/toy-world/worker/tile-ctx.js'), 'utf8');
  const m = /const OFF_STREAMS = (\{[\s\S]*?\n\});/.exec(ctxSrc);
  let off = null;
  try {
    off = m ? new Function(`return (${m[1]});`)() : null;
  } catch {
    off = null;
  }
  const want = Object.fromEntries(Object.entries(W.WORLD_PASS_STREAMS).map(([s, d]) => [s, [...d.subs]]));
  const same = off !== null && JSON.stringify(off) === JSON.stringify(want);
  const workerDir = path.join(ROOT, 'lib/fly/toy-world/worker');
  const readers = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.m?js$/.test(f) && /options\??\.worldPass/.test(readFileSync(p, 'utf8'))) readers.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  };
  walk(workerDir);
  const workerMain = readFileSync(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js'), 'utf8');
  if (/options\??\.worldPass/.test(workerMain)) readers.push('lib/fly/toy-world/vector-tile.worker.js');
  const readersOk = readers.length === 1 && readers[0] === 'lib/fly/toy-world/worker/tile-ctx.js';
  check(
    '(8b) the worker\'s all-off request matches the reader\'s streams, and only tile-ctx.js reads options.worldPass',
    same && readersOk,
    `${same ? 'schema same' : `schema drift: worker ${JSON.stringify(off)} vs reader ${JSON.stringify(want)}`}; options.worldPass read in: ${readers.join(', ') || 'none'}`
  );
}

// (9) the World Pass reader: off by default; ?flags=NAME is on only at a
//     desktop High/Ultra boot preset; Medium and the mobile class get the
//     all-off request; the latch survives a governor tier step.
{
  const W = await import('../lib/fly/world-pass.js');
  const { useFlyStore } = await import('../stores/fly-store.js');
  const st = useFlyStore.getState();
  const prev = { preset: st.qualityPreset, tier: st.qualityTier };
  const run = (preset, pins) => {
    globalThis.window = { matchMedia: () => ({ matches: false }), ...pins };
    st.setQualityPreset(preset);
    W.__resetWorldPassLatchForTests();
    const r = { req: W.worldPassRequest(), key: W.worldPassKey(), allowed: W.worldPassTierAllowed() };
    st.setQualityTier('low'); // a governor step after the latch
    r.after = W.worldPassRequest();
    delete globalThis.window;
    return r;
  };
  const off = run('ultra', {});
  const on = run('ultra', { __flyWorldTruthOverride: { enabled: true } });
  const onHigh = run('high', { __flyWorldTruthOverride: { enabled: true } });
  const med = run('medium', { __flyWorldTruthOverride: { enabled: true } });
  const mob = run('high', { __flyWorldTruthOverride: { enabled: true }, __flyWorldPassTierOverride: { mobile: true } });
  const all = run('ultra', Object.fromEntries(['Truth', 'Arrival', 'Reach', 'Look', 'Ground'].map((n) => [`__flyWorld${n}Override`, { enabled: true }])));
  W.__resetWorldPassLatchForTests();
  st.setQualityPreset(prev.preset);
  st.setQualityTier(prev.tier);
  const allOff = (r) => r.key === 'wp1-0' && r.req.any === false && r.req.tier === null && Object.keys(W.WORLD_PASS_STREAMS).every((s) => Object.entries(r.req[s]).every(([k, v]) => (k === 'worker' ? v === null : v === false)));
  const ok =
    allOff(off) && off.allowed &&
    on.req.truth.on && on.req.truth.heights && on.req.tier === 'ultra' && !on.req.arrival.on && on.after === on.req && Object.isFrozen(on.req.truth) &&
    onHigh.req.truth.on && onHigh.req.tier === 'high' && onHigh.key !== on.key &&
    allOff(med) && !med.allowed && allOff(mob) && !mob.allowed &&
    Object.keys(W.WORLD_PASS_STREAMS).every((s) => all.req[s].on) &&
    JSON.stringify(structuredClone(on.req)) === JSON.stringify(on.req);
  check('(9) world-pass reader: all-off by default, ?flags=WORLD_TRUTH on at desktop High/Ultra only, latched', ok, `off ${off.key}; on ${on.key}; high ${onHigh.key}; medium ${med.key}; mobile ${mob.key}; all ${all.key}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

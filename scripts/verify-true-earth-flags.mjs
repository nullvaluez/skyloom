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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

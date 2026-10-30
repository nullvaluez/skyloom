/**
 * SHIP PASS (FLY_SHIP_PASS.md 3.5) — the shared node battery every landing
 * on `main` runs, in one command:
 *
 *   node scripts/ship-pass-gates.mjs [--stream=FRAME] [--base=<ref>] (default the W0 commit) [--quick]
 *                                    [--also=verify-x.mjs,verify-y.cjs] [--require-stream-gates]
 *
 * Rows print PASS / KNOWN-RED / FAIL / SKIP. A failing gate listed in
 * scripts/ship-pass-known-reds.json prints as KNOWN-RED (it does not fail the
 * run); a listed gate that passes prints "KNOWN-RED (now passing)" so its row
 * can be retired. Exit 1 on any FAIL.
 *
 * Battery:
 *   verify-true-earth-flags, verify-import-integrity, verify-ops-golden,
 *   FLY_TILE_FIXTURE=1 verify-worker-window (skipped by --quick), graphics-unit,
 *   beta-checks source | gameplay | world (gate by gate), every
 *   verify-ship-<stream>.mjs that exists (SKIP until the stream lands it;
 *   --require-stream-gates makes a missing one a FAIL, for the close), the
 *   seam markers (every SHIP PASS block exactly once), and — with --stream
 *   (or on a `ship/<stream>` branch) — the seam rule: the stream's diff from
 *   the merge-base with --base touches hot files only inside its own blocks.
 *
 * CRLF is normalized everywhere (the owner's checkout is Windows).
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { SHIP_PASS_W0 } from './_ship-pass-base.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const STREAMS = ['FRAME', 'SKY', 'CITY', 'LIGHT', 'RELEASE'];
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 }).replace(/\r\n/g, '\n');

let stream = typeof args.stream === 'string' ? args.stream.toUpperCase() : process.env.SHIP_STREAM?.toUpperCase() ?? null;
if (!stream) {
  try {
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
    const m = branch.match(/^ship\/(frame|sky|city|light|release)$/i);
    if (m) stream = m[1].toUpperCase();
  } catch {
    // not a git checkout: no seam check
  }
}
if (stream && !STREAMS.includes(stream)) throw new Error(`--stream must be one of ${STREAMS.join(', ')}`);

const known = new Map(JSON.parse(read('scripts/ship-pass-known-reds.json')).reds.map((r) => [r.gate, r]));
const rows = [];
function row(name, status, detail = '') {
  rows.push({ name, status, detail });
  console.log(`${status.padEnd(25)} ${name}${detail ? `  — ${detail}` : ''}`);
}

const ran = new Set();
function runGate(file, { env = {}, label = file } = {}) {
  if (ran.has(file)) return;
  ran.add(file);
  const p = path.join(ROOT, 'scripts', file);
  if (!existsSync(p)) return row(label, 'FAIL', 'script missing');
  const started = Date.now();
  const r = spawnSync(process.execPath, [p], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 900000,
    maxBuffer: 64 << 20,
    env: { ...process.env, NODE_NO_WARNINGS: '1', ...env },
  });
  const ok = r.status === 0 && !r.error;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const tail = ((r.stdout || '') + (r.stderr || '')).replace(/\r\n/g, '\n').trim().split('\n').filter((l) => /FAIL|Error|passed|failed/.test(l)).slice(-3).join(' | ');
  const red = known.get(file);
  if (ok) row(label, red ? 'KNOWN-RED (now passing)' : 'PASS', `${secs}s`);
  else if (red) row(label, 'KNOWN-RED', `${red.failure} (owner ${red.owner})`);
  else row(label, 'FAIL', `${secs}s ${r.error ? r.error.message : tail.slice(0, 400)}`);
}

// --- the battery ---------------------------------------------------------
console.log(`SHIP PASS gates${stream ? ` (stream ${stream})` : ''}\n`);
runGate('verify-true-earth-flags.mjs');
runGate('verify-import-integrity.mjs');
runGate('verify-ops-golden.mjs');
if (args.quick) row('verify-worker-window.mjs (FLY_TILE_FIXTURE=1)', 'SKIP', '--quick');
else runGate('verify-worker-window.mjs', { env: { FLY_TILE_FIXTURE: '1' }, label: 'verify-worker-window.mjs (FLY_TILE_FIXTURE=1)' });
runGate('graphics-unit.mjs');

{
  const src = read('scripts/beta-checks.mjs');
  const groups = {};
  for (const m of src.matchAll(/(\w+):\[([^\]]*)\]/g)) groups[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  for (const g of ['source', 'gameplay', 'world']) {
    if (!groups[g]?.length) {
      row(`beta-checks ${g}`, 'FAIL', 'group not found in scripts/beta-checks.mjs');
      continue;
    }
    for (const file of groups[g]) runGate(file, { env: file === 'verify-true-areas.cjs' ? { FLY_TILE_FIXTURE: '1' } : {} });
  }
}

for (const s of STREAMS) {
  const file = `verify-ship-${s.toLowerCase()}.mjs`;
  if (existsSync(path.join(ROOT, 'scripts', file))) runGate(file);
  else row(file, args['require-stream-gates'] ? 'FAIL' : 'SKIP', 'not written yet');
}

if (typeof args.also === 'string') for (const file of args.also.split(',').map((s) => s.trim()).filter(Boolean)) runGate(file);

// --- seam markers ----------------------------------------------------------
// Every block FLY_SHIP_PASS.md section 7 seeds, exactly once per file.
const MARKERS = {
  'components/fly/FlyScene.jsx': [
    ...STREAMS.map((s) => [s, 'imports']),
    ['FRAME', 'frame'], ['SKY', 'frame'], ['LIGHT', 'frame'],
    ['CITY', 'mounts'], ['LIGHT', 'mounts'], ['SKY', 'mounts'],
  ],
  'components/fly/FlyMode.jsx': [['RELEASE', 'imports'], ['FRAME', 'imports'], ['RELEASE', 'mounts'], ['FRAME', 'mounts']],
  'components/fly/PlayerPlane.jsx': [['LIGHT', 'imports'], ['LIGHT', '']],
  'lib/fly/device-report.js': [['FRAME', 'imports'], ['FRAME', 'report body']],
  'lib/fly/fly-settings.js': [['FRAME', 'imports'], ['RELEASE', 'imports'], ['FRAME', 'start tier'], ['RELEASE', 'stakes']],
  'lib/fly/front-door.js': [['RELEASE', 'imports'], ['RELEASE', 'entry']],
  'lib/fly/flight-plan.js': [['RELEASE', 'imports'], ['RELEASE', 'spawn']],
  'components/fly/hud/SettingsRows.jsx': [['FRAME', 'rows imports'], ['FRAME', 'rows']],
  'stores/fly-store.js': [['FRAME', 'fields'], ['RELEASE', 'fields'], ['FRAME', 'setters'], ['RELEASE', 'setters']],
  'lib/fly/prewarm-registry.js': STREAMS.map((s) => [s, 'prewarm']),
};
const MARK_RE = /SHIP PASS (FRAME|SKY|CITY|LIGHT|RELEASE)\b ?([a-z][a-z ]*?)? ?\b(begin|end)\b/;

/** [{stream, label, begin, end}] (1-based marker line numbers) for a file's text. */
function blocksOf(text) {
  const open = new Map();
  const out = [];
  text.split('\n').forEach((line, i) => {
    const m = line.match(MARK_RE);
    if (!m) return;
    const key = `${m[1]}|${(m[2] ?? '').trim()}`;
    if (m[3] === 'begin') open.set(key, i + 1);
    else if (open.has(key)) {
      out.push({ stream: m[1], label: (m[2] ?? '').trim(), begin: open.get(key), end: i + 1 });
      open.delete(key);
    }
  });
  return out;
}

{
  const problems = [];
  let count = 0;
  for (const [file, expected] of Object.entries(MARKERS)) {
    const text = read(file);
    const lines = text.split('\n');
    for (const [s, label] of expected) {
      const tag = `SHIP PASS ${s}${label ? ` ${label}` : ''}`;
      const begins = lines.filter((l) => l.includes(`${tag} begin`)).length;
      const ends = lines.filter((l) => l.includes(`${tag} end`)).length;
      const b = blocksOf(text).find((x) => x.stream === s && x.label === label);
      if (begins !== 1 || ends !== 1 || !b) problems.push(`${file}: "${tag}" begin×${begins} end×${ends}`);
      else count++;
    }
  }
  const constants = read('lib/fly/fly-constants.js');
  const te = constants.indexOf('TRUE EARTH FLAGS');
  const sp = constants.indexOf('SHIP PASS (2026-10-30; FLY_SHIP_PASS.md)');
  if (te < 0 || sp < te) problems.push('fly-constants.js: the SHIP PASS header must follow the TRUE EARTH marker');
  for (const names of Object.values(OWNED_CONSTANTS())) {
    for (const n of names) {
      const hits = constants.split('\n').filter((l) => l.startsWith(`export const ${n} = {`)).length;
      if (hits !== 1) problems.push(`fly-constants.js: export const ${n} ×${hits}`);
    }
  }
  row('seam markers', problems.length ? 'FAIL' : 'PASS', problems.length ? problems.join('; ') : `${count} blocks in ${Object.keys(MARKERS).length} files + 22 owned constants blocks`);
}

// --- the seam rule (a stream's diff) ----------------------------------------
function OWNED_CONSTANTS() {
  return {
    FRAME: ['SHADER_READY', 'PACE_ADAPT', 'DEVICE_POLICY', 'ULTRA_SUPERSAMPLE'],
    SKY: ['AERIAL_CLARITY', 'REAL_MOON', 'SKY_LITE'],
    CITY: ['CITY_RANGE', 'NIGHT_LITE', 'NIGHT_RHYTHM'],
    LIGHT: ['TERRAIN_SHADOW', 'TRAFFIC_SHADOWS', 'AIRFRAME_SHADOW', 'SHADOW_REACH', 'PHOTO_HIRES', 'HANGAR_EXPOSURE', 'MOBILE_ENHANCED'],
    RELEASE: ['CHALLENGE_LAYER', 'DEEP_LINKS', 'ANALYTICS_V2', 'OFFLINE_SHELL', 'PLAYER_SURFACE'],
  };
}

/** Inner line ranges [from, to] (1-based, inclusive) a stream may edit in `file`. */
function allowedRanges(file, text, s) {
  const lines = text.split('\n');
  if (file === 'lib/fly/fly-constants.js') {
    const out = [];
    for (const n of OWNED_CONSTANTS()[s]) {
      const at = lines.findIndex((l) => l.startsWith(`export const ${n} = {`));
      if (at < 0) continue;
      const close = lines.findIndex((l, i) => i > at && /^\};\s*$/.test(l));
      if (close > at) out.push([at + 2, close]);
    }
    return out;
  }
  const out = blocksOf(text).filter((b) => b.stream === s).map((b) => [b.begin + 1, b.end - 1]);
  if (file === 'components/fly/PlayerPlane.jsx' && s === 'LIGHT') {
    const b = lines.findIndex((l) => l.includes('LIVING WORLD AIRFRAME — begin'));
    const e = lines.findIndex((l) => l.includes('LIVING WORLD AIRFRAME — end'));
    if (b >= 0 && e > b) out.push([b + 2, e]);
  }
  return out;
}

/** Ranges another stream owns inside a file the stream owns as a whole. */
function foreignRanges(text, s) {
  return blocksOf(text).filter((b) => b.stream !== s).map((b) => [b.begin, b.end]);
}

const HOT = {
  'components/fly/FlyScene.jsx': {},
  'components/fly/FlyMode.jsx': {},
  'components/fly/PlayerPlane.jsx': {},
  'components/fly/TrafficLayer.jsx': { frozen: true },
  'lib/fly/toy-world/world-bend.js': { frozen: true },
  'lib/fly/operations-runtime.js': {},
  'lib/fly/fly-constants.js': {},
  'lib/fly/device-report.js': {},
  'stores/fly-store.js': {},
  'lib/fly/fly-settings.js': {},
  'lib/fly/front-door.js': {},
  'lib/fly/flight-plan.js': {},
  'components/fly/hud/SettingsRows.jsx': { wholeFile: 'RELEASE' },
  'lib/fly/prewarm-registry.js': {},
};

if (stream) {
  const baseRef = typeof args.base === 'string' ? args.base : SHIP_PASS_W0;
  let base = null;
  try {
    base = git('merge-base', 'HEAD', baseRef).trim();
  } catch (e) {
    row('seam rule', 'FAIL', `no merge-base with ${baseRef}: ${String(e.message).slice(0, 120)}`);
  }
  if (base) {
    const changed = git('diff', '--name-only', base).split('\n').filter(Boolean);
    const untracked = git('ls-files', '--others', '--exclude-standard').split('\n').filter(Boolean);
    const violations = [];
    for (const file of [...new Set([...changed, ...untracked])]) {
      const rule = HOT[file];
      if (!rule) continue;
      if (rule.frozen) {
        violations.push(`${file} is frozen`);
        continue;
      }
      const now = existsSync(path.join(ROOT, file)) ? read(file) : '';
      let then = '';
      try {
        then = git('show', `${base}:${file}`);
      } catch {
        // a hot file that did not exist at the base
      }
      const inAny = (n, ranges) => ranges.some(([a, b]) => n >= a && n <= b);
      const diff = git('diff', '-U0', '--no-color', base, '--', file);
      const hunks = [...diff.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)].map((m) => ({
        oldAt: +m[1], oldN: m[2] == null ? 1 : +m[2], newAt: +m[3], newN: m[4] == null ? 1 : +m[4],
      }));
      const bad = [];
      for (const h of hunks) {
        const removed = Array.from({ length: h.oldN }, (_, i) => h.oldAt + i);
        const added = Array.from({ length: h.newN }, (_, i) => h.newAt + i);
        if (rule.wholeFile === stream) {
          const fo = foreignRanges(then, stream);
          const fn = foreignRanges(now, stream);
          if (removed.some((n) => inAny(n, fo)) || added.some((n) => inAny(n, fn))) bad.push(`@@ -${h.oldAt} +${h.newAt} touches another stream's block`);
        } else {
          const ao = allowedRanges(file, then, stream);
          const an = allowedRanges(file, now, stream);
          if (removed.some((n) => !inAny(n, ao)) || added.some((n) => !inAny(n, an))) bad.push(`@@ -${h.oldAt},${h.oldN} +${h.newAt},${h.newN}`);
        }
      }
      if (bad.length) violations.push(`${file}: outside ${stream} blocks at ${bad.slice(0, 6).join(', ')}${bad.length > 6 ? ` (+${bad.length - 6})` : ''}`);
    }
    row(`seam rule (${stream} vs ${baseRef})`, violations.length ? 'FAIL' : 'PASS', violations.length ? violations.join('; ') : `${changed.length} changed file(s)`);
  }
} else {
  row('seam rule', 'SKIP', 'no --stream (lead / main)');
}

// --- summary -----------------------------------------------------------------
const by = (s) => rows.filter((r) => r.status === s);
console.log('\nKNOWN-RED (printed separately; FLY_SHIP_PASS.md 12.3):');
for (const r of rows.filter((x) => x.status.startsWith('KNOWN-RED'))) console.log(`  ${r.status.padEnd(25)} ${r.name}  — ${r.detail}`);
console.log(`\nSHIP PASS gates: ${by('PASS').length} PASS, ${rows.filter((x) => x.status.startsWith('KNOWN-RED')).length} KNOWN-RED, ${by('FAIL').length} FAIL, ${by('SKIP').length} SKIP`);
process.exit(by('FAIL').length ? 1 : 0);

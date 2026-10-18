// Lounge second-level pass — the gate suite runner (node; no GPU, no network).
//
// Runs every node gate the lounge depends on, one after another (this box has
// four cores; the gates are single-threaded and some are heavy), prints a
// pass/fail table and exits non-zero when any gate fails. It also asserts the
// CLASSIC room invariant from the classic verify-airport-lounge.mjs run: the
// pass scopes every change to the pier variant / LOUNGE_INSTRUMENTS, so the
// classic room must keep printing exactly 12 draws, 120198 triangles and 28
// practicals (FLY_LOUNGE_SECOND_LEVEL.md "Contracts").
//
//   node --no-warnings scripts/lounge-pass-gates.mjs
//   node --no-warnings scripts/lounge-pass-gates.mjs verify-my-new-gate.mjs "verify-x.mjs --flag"
//   node --no-warnings scripts/lounge-pass-gates.mjs --only verify-lounge-upper.mjs,verify-lounge-pier.mjs
//
// Extra arguments name extra gates (a script in scripts/, optionally with its
// own arguments in one quoted string); they run after the standard list.
// --only restricts the run to the named gates (the classic invariant is then
// checked only when the classic room gate is among them). --keep-going is the
// default: every gate runs even after a failure, so one table shows them all.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The standard suite, in run order. Each entry: [script, ...args]. */
export const STANDARD_GATES = [
  ['verify-airport-lounge.mjs'],
  ['verify-airport-lounge.mjs', '--pier'],
  ['verify-lounge-upper.mjs'],
  ['verify-observatory-presentation.mjs'],
  ['verify-lounge-second-level.mjs'], // this pass's cross-lane contract (upper-dressing.mjs)
  ['verify-lounge-pier.mjs'],
  ['verify-lounge-walk.mjs'],
  ['verify-lounge-elevation.mjs'],
  ['verify-lounge-seat.mjs'],
  ['verify-lounge-vantage.mjs'],
  ['verify-lounge-observatory.mjs'],
  ['verify-lounge-prewarm.mjs'],
  ['verify-lounge-texture-lifecycle.mjs'],
  ['verify-lounge-practical-boundary.mjs'],
  ['verify-lounge-occlusion.mjs'],
  ['verify-lounge-placement.mjs'],
  ['verify-room-program-lifecycle.mjs'],
  ['verify-airport-observation.mjs'],
  ['verify-airport-lifecycle.mjs'],
  ['verify-airport-audio.mjs'],
  ['verify-airport-set.mjs'],
  ['verify-fleet-airframes.mjs'],
  ['verify-true-earth-flags.mjs'],
  ['verify-ops-golden.mjs'],
  ['verify-attribution.mjs'],
  ['verify-import-integrity.mjs'],
];

/**
 * The classic room's frozen summary (verify-airport-lounge.mjs, classic run).
 * Texture MiB is printed rounded to 0.1 and is checked too.
 */
export const CLASSIC_INVARIANT = Object.freeze({ draws: 12, triangles: 120198, practicals: 28, textureMiB: '21.9' });

function parseArgs(argv) {
  const extra = [];
  let only = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') { only = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean); continue; }
    if (a.startsWith('--only=')) { only = a.slice(7).split(',').map((s) => s.trim()).filter(Boolean); continue; }
    if (a === '--keep-going') continue;
    extra.push(a.split(/\s+/).filter(Boolean));
  }
  return { extra, only };
}

const label = (gate) => gate.join(' ');

function run(gate) {
  return new Promise((resolve) => {
    const [script, ...args] = gate;
    const started = Date.now();
    const child = spawn(process.execPath, ['--no-warnings', path.join('scripts', script), ...args], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', (error) => resolve({ gate, code: -1, out: String(error), ms: Date.now() - started }));
    child.on('close', (code, signal) => resolve({ gate, code: code ?? (signal ? 128 : 1), out, ms: Date.now() - started }));
  });
}

/** The last line that looks like a summary (PASS/FAIL/ok), for the table. */
function summary(out) {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pick = [...lines].reverse().find((l) => /^(PASS|FAIL|ok|OK|✓|✗)\b|passed|failed|checks?\b/i.test(l)) ?? lines.at(-1) ?? '';
  return pick.length > 150 ? `${pick.slice(0, 147)}...` : pick;
}

function classicInvariant(out) {
  const m = out.match(/PASS lounge: (\d+) checks · (\d+) draws · (\d+) triangles · ([\d.]+) MiB textures · (\d+) practicals/);
  if (!m) return { ok: false, why: 'the classic summary line was not found' };
  const got = { draws: Number(m[2]), triangles: Number(m[3]), textureMiB: m[4], practicals: Number(m[5]) };
  const bad = Object.entries(CLASSIC_INVARIANT).filter(([k, v]) => got[k] !== v);
  return bad.length ? { ok: false, why: `classic room drifted: ${bad.map(([k, v]) => `${k} ${got[k]} != ${v}`).join(', ')}` } : { ok: true, why: `12 draws · 120198 triangles · 21.9 MiB · 28 practicals` };
}

async function main() {
  const { extra, only } = parseArgs(process.argv.slice(2));
  let gates = [...STANDARD_GATES, ...extra];
  if (only) gates = gates.filter((g) => only.includes(g[0]) || only.includes(label(g)));
  if (!gates.length) { console.error('lounge-pass-gates: no gates selected'); process.exit(2); }
  const results = [];
  for (const gate of gates) {
    process.stdout.write(`… ${label(gate)}\n`);
    const r = await run(gate);
    results.push(r);
    const ok = r.code === 0;
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${label(gate)} (${(r.ms / 1000).toFixed(1)} s)\n`);
    if (!ok) process.stdout.write(r.out.split(/\r?\n/).slice(-25).map((l) => `    ${l}`).join('\n') + '\n');
  }
  const classic = results.find((r) => label(r.gate) === 'verify-airport-lounge.mjs');
  const inv = classic ? classicInvariant(classic.out) : null;

  const w = Math.max(...results.map((r) => label(r.gate).length), 30);
  console.log('\nLounge pass gate suite');
  console.log(`${'gate'.padEnd(w)}  result  time     summary`);
  console.log(`${'-'.repeat(w)}  ------  -------  -------`);
  for (const r of results) console.log(`${label(r.gate).padEnd(w)}  ${r.code === 0 ? 'PASS  ' : 'FAIL  '}  ${`${(r.ms / 1000).toFixed(1)}s`.padEnd(7)}  ${summary(r.out)}`);
  if (inv) console.log(`${'classic invariant'.padEnd(w)}  ${inv.ok ? 'PASS  ' : 'FAIL  '}  ${''.padEnd(7)}  ${inv.why}`);
  const failed = results.filter((r) => r.code !== 0).length + (inv && !inv.ok ? 1 : 0);
  console.log(`\n${failed ? `FAIL ${failed} of ${results.length + (inv ? 1 : 0)}` : `PASS all ${results.length + (inv ? 1 : 0)}`}`);
  process.exit(failed ? 1 : 0);
}

main();

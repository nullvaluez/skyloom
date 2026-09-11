/**
 * R24 (E CERT) — verify-artifact-hygiene: no round may overwrite a previous
 * round's calibration evidence.
 *
 * WHY (recon HARN-HYG-9, and it bit this round). Thirty harnesses write their
 * evidence BESIDE themselves: `scripts/r21-e-red-seam.json`,
 * `scripts/r21-e-red-stability.json`, `scripts/r19d-*.png`, and so on. Those
 * files are not scratch — they are the RED records a future round compares
 * against, measured on LIVE third-party tile bytes that nobody can
 * re-measure later.
 *
 * Running R24's OFFLINE verify-seam leg rewrote `scripts/r21-e-red-seam.json`
 * in place with FIXTURE data, and the commit carried it: R21's live-tileset
 * RED record replaced by numbers from a synthetic planet. Nothing failed.
 * Nothing warned. The file simply stopped meaning what its name says.
 *
 * TWO DEFENCES, and this gate is the second:
 *   1. `scripts/_fixture.js` installs an artifact REDIRECT when
 *      FLY_TILE_FIXTURE is set: every write landing directly in `scripts/` is
 *      rewritten to `scripts/r24-out/fixture-<name>`. It wraps
 *      `fs.writeFileSync`, `fs.writeFile`, `fs.promises.writeFile` (which is
 *      what Playwright's `page.screenshot({ path })` uses) and
 *      `fs.createWriteStream` — one redirect at the one place a file reaches
 *      disk, rather than thirty harness edits.
 *   2. THIS GATE, which asserts the outcome rather than the mechanism: no
 *      R15–R23 calibration artifact differs from the round's base commit.
 *
 * A mechanism can be bypassed by the next harness someone writes. An outcome
 * check cannot.
 *
 * THE ALLOWANCE (R25, E CERT) — and the rule that keeps gate (1) honest.
 *
 * A previous round's file sometimes has to be REPAIRED rather than preserved:
 * `scripts/r24-c-agl.js` referenced two identifiers (`agl`, `speed`) that its
 * `page.evaluate` callback never destructured, so the probe threw a
 * ReferenceError the moment it ran — `verify-import-integrity` is red on the
 * untouched R25 base because of it. Freezing a broken instrument forever is
 * not hygiene, it is taxidermy.
 *
 * So there is an ALLOWANCE list — and one rule that stops it becoming a
 * loophole: **an allowance may only ever name an INSTRUMENT (`.js` / `.mjs`),
 * never EVIDENCE.** The thing this gate exists to protect is the measured
 * record — `.json` RED files, `.png` calibration pairs, `.md` ledgers — taken
 * on live third-party tile bytes that nobody can re-measure. Those can never
 * be allowed, and gate (1b) asserts exactly that, by extension, for every
 * entry present and every entry anyone adds later. A script can be re-read and
 * re-judged; a number measured on a planet that has since changed cannot.
 *
 * RUN (no browser, no GPU, no network — belongs in every smoke):
 *   node scripts/verify-artifact-hygiene.mjs
 *   R24_BASE=<sha> node scripts/verify-artifact-hygiene.mjs
 *   R25_BASE=<sha> node scripts/verify-artifact-hygiene.mjs   (R25: base f0cd81e)
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// R25 (Fable, W0): the base is the R25 pre-scaffold tree — the Codex overhaul
// tip the round starts from. R24's own ledgers and artifacts join the frozen set.
const BASE = process.env.R25_BASE || process.env.R24_BASE || 'f0cd81e';
// R15..R23 artifact name shapes, as they actually appear in scripts/.
// R25 (E CERT): the last three globs are the hole the R24 version left open,
// found by falling into it. The MOBILE fleet writes its baselines as
// `scripts/mobile-*.png`, `scripts/hangar-*.png` and `scripts/logbook-*.png`,
// which no previous pattern matched — and it does not require `_boot.js`, so
// the fixture's write redirect never reached it either. Four runs in one
// afternoon rewrote fourteen tracked PNGs in place while this gate stayed
// green. Both defences are now closed: `scripts/_mobile-boot.js` requires
// `_fixture` for the redirect, and these globs make the OUTCOME checkable.
const PATTERNS = [
  'scripts/r1*-*',
  'scripts/r2[0-4]-*',
  'scripts/soak-results*.json',
  'scripts/mobile-*.png',
  'scripts/hangar-*.png',
  'scripts/logbook-*.png',
];
// R25 (E CERT, W1). Each entry is one INSTRUMENT repaired this round, with the
// reason. Evidence extensions are refused by gate (1b) — see the header.
const ALLOW = [
  {
    path: 'scripts/r24-c-agl.js',
    why:
      'R25 W1: the page.evaluate callback at :326 read `agl` and `speed` without ' +
      'destructuring them out of the argument object it was handed at :367, so the ' +
      'probe threw a ReferenceError on every run. verify-import-integrity reports ' +
      'both on the untouched base f0cd81e. The repair is the destructure only; no ' +
      'measurement, threshold or logic line moves.',
  },
];
const EVIDENCE_EXT = ['.json', '.png', '.jpg', '.jpeg', '.md', '.csv', '.txt', '.bin'];
const ALLOWED_PATHS = new Set(ALLOW.map((a) => a.path));

let pass = 0;
let fail = 0;
function gate(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
}

// (1) THE OUTCOME. Nothing from a previous round may differ from the base.
let diff = '';
let baseOk = true;
try {
  git('cat-file', '-e', `${BASE}^{commit}`);
} catch {
  baseOk = false;
}
gate(
  `(0) THE BASE COMMIT ${BASE} IS PRESENT — a hygiene gate that cannot resolve its base proves nothing`,
  baseOk,
  baseOk ? '' : `set R24_BASE to this round's base sha`
);
// The diff is taken by NAME, not by --stat, so an allowance can be subtracted
// from it precisely. A --stat line cannot be matched back to a path reliably
// once a filename contains a space or an arrow.
let changed = [];
if (baseOk) {
  changed = git('diff', '--name-only', BASE, '--', ...PATTERNS)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const offenders = changed.filter((f) => !ALLOWED_PATHS.has(f));
  diff = offenders.join('\n');
  gate(
    '(1) NO R15–R24 CALIBRATION ARTIFACT HAS CHANGED THIS ROUND (allowances excepted)',
    offenders.length === 0,
    offenders.length === 0
      ? `${PATTERNS.join(' ')} — identical to ${BASE} except ${changed.length} named allowance(s)`
      : `\n${offenders
          .map((l) => '      ' + l)
          .join('\n')}\n      Restore with: git checkout ${BASE} -- <path>`
  );
}

// (1b) THE ALLOWANCE IS AN INSTRUMENT, NEVER EVIDENCE. This is the assertion
// that keeps (1) meaning what its name says: a round may repair a broken
// probe, and may never rewrite a measured record. It judges the LIST, so it
// binds every future entry, not just today's.
const badAllow = ALLOW.filter(
  (a) => EVIDENCE_EXT.some((e) => a.path.toLowerCase().endsWith(e)) || !a.why || a.why.length < 40
);
gate(
  '(1b) EVERY ALLOWANCE IS A REPAIRED INSTRUMENT WITH A STATED REASON — no evidence file may ever be allowed',
  badAllow.length === 0,
  badAllow.length === 0
    ? ALLOW.length === 0
      ? 'no allowances on this tree'
      : ALLOW.map((a) => a.path).join(', ')
    : `refused: ${badAllow.map((a) => a.path).join(', ')} (evidence extension or missing reason)`
);

// (1c) AN ALLOWANCE THAT IS NOT IN USE IS DEAD TEXT. Report it rather than
// fail on it: a stale entry is a documentation bug, not a hygiene breach, but
// it must not rot in silence into a standing permission.
if (baseOk) {
  const unused = ALLOW.map((a) => a.path).filter((p) => !changed.includes(p));
  gate(
    '(1c) EVERY ALLOWANCE IS ACTUALLY IN USE (a stale one is a standing permission nobody asked for)',
    unused.length === 0,
    unused.length === 0 ? `${ALLOW.length} in use` : `unused: ${unused.join(', ')} — remove the entry`
  );
}

// (2) THE MECHANISM, so a green above is not luck.
// Read the WORKING TREE copy, not the index: this gate must judge the file
// that a run will actually load, not the one that happens to be staged.
const fixtureSrc = (await import('node:fs')).readFileSync(
  path.join(ROOT, 'scripts/_fixture.js'),
  'utf8'
);
gate(
  '(2) THE ARTIFACT REDIRECT IS INSTALLED UNDER THE FIXTURE ENV',
  /installArtifactRedirect/.test(fixtureSrc) &&
    /if \(fixtureEnabled\(\)\) installArtifactRedirect\(\);/.test(fixtureSrc),
  'scripts/_fixture.js installs it at module load when FLY_TILE_FIXTURE is set'
);
gate(
  '(3) THE REDIRECT COVERS THE FOUR WAYS A FILE REACHES DISK HERE',
  ['fs.writeFileSync', 'fs.writeFile', 'fs.promises.writeFile', 'fs.createWriteStream'].every((k) =>
    fixtureSrc.includes(k)
  ),
  'writeFileSync / writeFile / promises.writeFile (Playwright screenshots) / createWriteStream'
);

// (3) THE WORKING TREE, for a run that just happened.
// UNSTAGED only: a deliberate `git checkout <base> -- <path>` restore is
// staged, and must not read as a violation. What this catches is the thing
// that actually happens — a gate run silently rewriting a tracked artifact.
const dirtyAll = git('diff', '--name-only', '--', ...PATTERNS)
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean);
const dirty = dirtyAll.filter((f) => !ALLOWED_PATHS.has(f)).join('\n');
gate(
  '(4) NO PREVIOUS-ROUND ARTIFACT WAS DIRTIED BY A RUN (unstaged changes)',
  dirty === '',
  dirty === ''
    ? 'clean'
    : `\n${dirty.split('\n').map((l) => '      ' + l).join('\n')}\n      A fixture run wrote over it; ` +
      `restore with: git checkout ${BASE} -- <path>`
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

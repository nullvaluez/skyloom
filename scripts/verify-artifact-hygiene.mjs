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
 * RUN (no browser, no GPU, no network — belongs in every smoke):
 *   node scripts/verify-artifact-hygiene.mjs
 *   R24_BASE=<sha> node scripts/verify-artifact-hygiene.mjs
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.R24_BASE || '6116fc5';
// R15..R23 artifact name shapes, as they actually appear in scripts/.
const PATTERNS = ['scripts/r1*-*', 'scripts/r2[0-3]-*', 'scripts/soak-results*.json'];

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
if (baseOk) {
  diff = git('diff', '--stat', BASE, '--', ...PATTERNS).trim();
  gate(
    '(1) NO R15–R23 CALIBRATION ARTIFACT HAS CHANGED THIS ROUND',
    diff === '',
    diff === ''
      ? `${PATTERNS.join(' ')} — all identical to ${BASE}`
      : `\n${diff
          .split('\n')
          .map((l) => '      ' + l)
          .join('\n')}\n      Restore with: git checkout ${BASE} -- <path>`
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
const dirty = git('diff', '--name-only', '--', ...PATTERNS).trim();
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

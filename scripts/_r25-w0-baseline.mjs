/**
 * SHIP PASS RL-1 — the r25-w0 baseline for gates that diff a flag-off arm
 * against the Round 25 W0 scaffold (commit db78bdf, tag `r25-w0`).
 *
 * `r25w0Show(rel)` returns `git show r25-w0:<rel>` when the tag exists (the
 * owner's machine), and otherwise the committed fixture in
 * scripts/fixtures/r25-w0/, after re-hashing it to the git blob id recorded
 * in its header. CI checks out depth 1 and the tag is not on origin, so before
 * this the flag-off rows could never run there. A fixture whose bytes do not
 * hash to its recorded blob throws: a baseline that drifted is no baseline.
 * `pinnedShow(ref, rel)` is the same for any other pinned ref with a fixture
 * (verify-r25-flight-plan's 9ee7e79 baseline).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
// `<ref>:<path>` -> the committed fixture. r25-w0 is the R25 W0 scaffold
// (db78bdf); 9ee7e79 is the operations-runtime baseline verify-r25-flight-plan
// [8] compares against.
const FIXTURES = {
  'r25-w0:lib/fly/front-door.js': 'scripts/fixtures/r25-w0/front-door.js',
  'r25-w0:hooks/use-overlay-back.js': 'scripts/fixtures/r25-w0/use-overlay-back.js',
  'r25-w0:components/fly/hud/Atlas.jsx': 'scripts/fixtures/r25-w0/Atlas.jsx',
  'r25-w0:components/fly/hud/GroundHangar.jsx': 'scripts/fixtures/r25-w0/GroundHangar.jsx',
  'r25-w0:lib/fly/flight-plan.js': 'scripts/fixtures/r25-w0/flight-plan.js',
  'r25-w0:lib/fly/operations-runtime.js': 'scripts/fixtures/r25-w0/operations-runtime.js',
  '9ee7e79:lib/fly/operations-runtime.js': 'scripts/fixtures/9ee7e79/operations-runtime.js',
};

/** git's blob id for `text` (sha1 of "blob <bytes>\0<text>"). */
export function gitBlobId(text) {
  const body = Buffer.from(text, 'utf8');
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest('hex');
}

/** True when `<ref>:<rel>` has a committed fixture. */
export function hasPinnedFixture(ref, rel) {
  return Object.prototype.hasOwnProperty.call(FIXTURES, `${ref}:${rel}`);
}

/** The fixture body for `<ref>:<rel>`, verified against its recorded blob id. */
export function pinnedFixture(ref, rel) {
  const file = FIXTURES[`${ref}:${rel}`];
  if (!file) throw new Error(`no ${ref} fixture for ${rel}`);
  // CRLF-normalized: a Windows checkout converts the fixture, not the blob.
  const text = readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  const marker = `// ---- ${ref} blob below ----\n`;
  const at = text.indexOf(marker);
  const want = text.slice(0, at).match(/git blob ([0-9a-f]{40})/)?.[1];
  if (at < 0 || !want) throw new Error(`${file}: no provenance header`);
  const body = text.slice(at + marker.length);
  const got = gitBlobId(body);
  if (got !== want) throw new Error(`${file}: blob ${got} is not the recorded ${ref} blob ${want}`);
  return body;
}

/** `git show <ref>:<rel>`, or the verified fixture when the ref is absent. */
export function pinnedShow(ref, rel) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${ref}:${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    if (hasPinnedFixture(ref, rel)) return pinnedFixture(ref, rel);
    throw e;
  }
}

/** The r25-w0 fixture body for `rel`, verified against its recorded blob id. */
export function r25w0Fixture(rel) {
  return pinnedFixture('r25-w0', rel);
}

/** `git show r25-w0:<rel>`, or the verified fixture when the tag is absent. */
export function r25w0Show(rel) {
  return pinnedShow('r25-w0', rel);
}

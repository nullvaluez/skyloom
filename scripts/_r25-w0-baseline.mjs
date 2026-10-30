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
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURES = {
  'lib/fly/front-door.js': 'scripts/fixtures/r25-w0/front-door.js',
  'hooks/use-overlay-back.js': 'scripts/fixtures/r25-w0/use-overlay-back.js',
};
const MARKER = '// ---- r25-w0 blob below ----\n';

/** git's blob id for `text` (sha1 of "blob <bytes>\0<text>"). */
export function gitBlobId(text) {
  const body = Buffer.from(text, 'utf8');
  return createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${body.length}\0`), body])).digest('hex');
}

/** The fixture body for `rel`, verified against its recorded blob id. */
export function r25w0Fixture(rel) {
  const file = FIXTURES[rel];
  if (!file) throw new Error(`no r25-w0 fixture for ${rel}`);
  // CRLF-normalized: a Windows checkout converts the fixture, not the blob.
  const text = readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  const at = text.indexOf(MARKER);
  const want = text.slice(0, at).match(/git blob ([0-9a-f]{40})/)?.[1];
  if (at < 0 || !want) throw new Error(`${file}: no provenance header`);
  const body = text.slice(at + MARKER.length);
  const got = gitBlobId(body);
  if (got !== want) throw new Error(`${file}: blob ${got} is not the recorded r25-w0 blob ${want}`);
  return body;
}

/** `git show r25-w0:<rel>`, or the verified fixture when the tag is absent. */
export function r25w0Show(rel) {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `r25-w0:${rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return r25w0Fixture(rel);
  }
}

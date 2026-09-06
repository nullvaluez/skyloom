#!/usr/bin/env node
/**
 * R24 C LIGHT — verify-depth-offset (recon T11). A NODE gate: no browser, no
 * dev server, no tiles. Runs anywhere, including this container.
 *
 * THE DEFECT IT PINS: three negates only the polygonOffset FACTOR when the
 * renderer runs a reversed depth buffer (WebGLState.js:860-876) and leaves the
 * UNITS alone, so an authored `(-f, -u)` reaches GL as `(+f, -u)` with its two
 * terms pushing opposite ways. R21 (P8) fixed that at exactly two call sites,
 * each with its own inline copy of the test — which is how a sign trap
 * survives a round: the next overlay author copies a material, not a lesson.
 *
 * THE CONTRACT: `polygonOffsetUnits:` may be written in exactly ONE place,
 * `offsetUnits()` / `groundOverlayOffset()` in lib/fly/toy-world/world-bend.js.
 * Everywhere else it must be a CALL to that helper.
 *
 * Run: node scripts/verify-depth-offset.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const SKIP = new Set(['node_modules', '.next', '.git', 'public', 'scripts']);
const HOME = 'lib/fly/toy-world/world-bend.js';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

const fails = [];
const gates = [];
const gate = (name, ok, detail = '') => {
  gates.push({ name, ok, detail });
  if (!ok) fails.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const files = walk(ROOT);
const offenders = [];
let helperDecls = 0;
for (const f of files) {
  const rel = relative(ROOT, f);
  const src = readFileSync(f, 'utf8');
  for (const [i, line] of src.split('\n').entries()) {
    if (!/polygonOffsetUnits\s*:/.test(line)) continue;
    // A CALL to the helper is the sanctioned form.
    if (/polygonOffsetUnits\s*:\s*offsetUnits\s*\(/.test(line)) continue;
    if (rel === HOME) {
      helperDecls++;
      continue;
    }
    offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
  }
}

gate(
  'no raw polygonOffsetUnits literal outside world-bend.js',
  offenders.length === 0,
  offenders.length ? offenders.slice(0, 5).join(' | ') : `${files.length} files scanned`
);
gate('the helper itself exists exactly once', helperDecls === 1, `declarations=${helperDecls}`);

const wb = readFileSync(join(ROOT, HOME), 'utf8');
gate('offsetUnits is exported from world-bend.js', /export function offsetUnits\(/.test(wb));
gate(
  'groundOverlayOffset is exported and flag-gated',
  /export function groundOverlayOffset\(/.test(wb) && /if \(!SHADOW_CALM\.enabled\) return null;/.test(wb)
);
gate(
  'setDepthReversed is latched from the live renderer at context creation',
  /setDepthReversed\(gl\?\.capabilities\?\.reversedDepthBuffer === true\)/.test(
    readFileSync(join(ROOT, 'components/fly/FlyCanvas.jsx'), 'utf8')
  )
);
// The two R21 sites must now be CALLS, not copies.
for (const [rel, what] of [
  ['components/fly/SatTintLayer.jsx', 'landcover tint drape'],
  ['components/fly/FlyScene.jsx', 'satellite shadow catcher'],
]) {
  const src = readFileSync(join(ROOT, rel), 'utf8');
  gate(
    `${what} uses the shared helper`,
    /polygonOffsetUnits:\s*offsetUnits\(/.test(src) &&
      !/reversedDepthBuffer === true\s*\n?\s*\?\s*1/.test(src),
    rel
  );
}

console.log(
  fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : `VERIFY: PASS (${gates.length} gates)`
);
process.exit(fails.length ? 1 : 0);

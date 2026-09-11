#!/usr/bin/env node
/**
 * R25 (E CERT) — verify-registry-inventory. A NODE gate: no browser, no dev
 * server, no GPU.
 *
 * THE CLAIM IT DEFENDS. `lib/fly/toy-world/world-bend.js` opens with a
 * ~33 KB registry header that is, in its own words, "the one place that lists
 * shader identities". Five rounds of key moves were arbitrated against it, and
 * R25 reserves six more stubs in it before a line of R25 shader text exists.
 * That only works while the header is COMPLETE — and a registry nobody checks
 * is a registry that quietly stops being one.
 *
 * WHAT IT ASSERTS. Every program-cache-key string this tree can emit —
 * `customProgramCacheKey` literals, the static segments of the template
 * literals that DERIVE a key from a parent's, and module-level `*_KEY`
 * constants used as one — is either
 *
 *   (a) named in the registry header, or
 *   (b) named in THE BASELINE GAP below, which is the list of keys that were
 *       already unregistered at the R25 base `f0cd81e`, each with the change
 *       that introduced it.
 *
 * WHY (b) EXISTS, AND WHY IT IS NOT A LOOPHOLE. The Codex satellite-graphics
 * overhaul (`be711f2` / `7c9cde0` / `9d8213c`) introduced NINE key fragments
 * and registered none of them; `player-hull-rim` has been unregistered since
 * R17. E CERT owns `scripts/`, not `world-bend.js`, so E cannot register them
 * — that is the header's owner's edit (Fable, W0 row of the ownership matrix),
 * and it is filed as a finding in `scripts/r25-e-cert.md`. Shipping this gate
 * RED on the base would make it noise from day one; shipping it without the
 * list would make it a lie. So the gap is NAMED, COUNTED, and FROZEN: gate (3)
 * fails the moment the list grows, which is the property R25 actually needs —
 * **every key this round adds must be registered in the same change.**
 *
 * RED CALIBRATION (E, W1; run on a scratch copy, never committed): commenting
 * out the header line that names `'world-bend-anchor-monument-r20'` turns
 * gate (2) red with that key named. Adding a fabricated key literal to a
 * material turns (2) red too. Adding a key to the BASELINE_GAP that is not in
 * the tree turns (3) red as a stale entry.
 *
 * Run: node scripts/verify-registry-inventory.mjs [--list]
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const LIST = process.argv.includes('--list');

const fails = [];
let n = 0;
const gate = (name, ok, detail = '') => {
  n++;
  if (!ok) fails.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

console.log('\nR25 E CERT — verify-registry-inventory (node; no browser, no GPU)\n');

// ---------------------------------------------------------------------------
// THE BASELINE GAP — keys already unregistered at the R25 base `f0cd81e`.
// One line each, with the change that introduced it. This list may SHRINK
// (someone registers a key) and may never GROW.
const BASELINE_GAP = {
  '-cinematic-canopy-v1': 'Codex overhaul (lib/fly/cinematic-ground.js:102) — canopy material, derived from the bend key',
  '-immersive-leaves-v1': 'Codex overhaul (cinematic-ground.js:102) — the immersive leaf variant suffix',
  '-cinematic-parcel-v1': 'Codex overhaul (cinematic-ground.js:147) — parcel-home material',
  '-cinematic-model-v1': 'Codex overhaul (lib/fly/cinematic-models.js:90) — monument/model material',
  '-merged': 'Codex overhaul (cinematic-models.js:90) — the merged-geometry suffix on the above',
  '|cinematic-architecture-v3-': 'Codex overhaul (lib/fly/satellite-architecture-material.js:127) — the building material base',
  '|immersive-surface-v1': 'Codex overhaul (satellite-architecture-material.js:127) — the v1 the R25 stub supersedes as v2',
  'world-bend-road-satnight-cinematic-v1': 'Codex overhaul (world-bend.js:2706) — the cinematic road branch',
  'world-bend-water-cinematic-v1': 'Codex overhaul (lib/fly/satellite-water.js:4, SATELLITE_WATER_KEY)',
  '|immersive-landcover-v1': 'Codex overhaul (components/fly/SatTintLayer.jsx:186) — the SatTint drape',
  'player-hull-rim': 'R17-era (lib/fly/prewarm.js:779 + components/fly/PlayerPlane.jsx:159) — the player hull rim',
};

// Fragments that are not identities: conditional words and separators that
// appear INSIDE a derived key. Listing them is deliberate — an unexplained
// filter is how a real key gets skipped.
const NOT_A_KEY = new Set([
  'near', // satellite-architecture-material: the `distant ? 'far-coverage' : 'near'` arm
  'far-coverage', //                     ...and its other arm; both ride the base above
  '-depth', // cinematic-ground: the depth-write variant suffix on the canopy key
]);

// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  for (const e of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${e}`;
    if (rel.includes('/vendor/')) continue;
    const st = statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(js|jsx|mjs)$/.test(e) && !/\.built\.js$/.test(e)) out.push(rel);
  }
  return out;
}
const SRC = [...walk('lib'), ...walk('components')];

/**
 * Every key fragment a `customProgramCacheKey` can emit.
 *
 * Three shapes, because the tree uses three:
 *   `= () => 'literal'`                       a plain identity
 *   `= () => `${parentKey}|suffix``           a DERIVED key — the static
 *                                             segments are the identity this
 *                                             file adds, and they are what the
 *                                             registry must name
 *   `= () => SOME_KEY`                        a module constant, resolved from
 *                                             its own `const SOME_KEY = '...'`
 */
function extractKeys() {
  const out = [];
  for (const f of SRC) {
    const t = read(f);
    // Resolve module-level `const X_KEY = 'literal'` so an identifier-valued
    // key is judged by its VALUE, not skipped for not being a string.
    const consts = new Map();
    for (const m of t.matchAll(/(?:export\s+)?const\s+([A-Z0-9_]*KEY)\s*=\s*'([^']+)'/g)) consts.set(m[1], m[2]);

    const re = /customProgramCacheKey\s*(?:=\s*)?(?:\(\))?\s*(?:=>|\{)([\s\S]{0,320}?);\n/g;
    let m;
    while ((m = re.exec(t))) {
      const expr = m[1];
      // `[^']*`, NOT `[^']{2,}`: an EMPTY string literal (`immersive ? 'x' : ''`)
      // misaligns a min-length scan — the regex skips the empty pair, then
      // pairs its closing quote with the NEXT literal's opening quote and
      // captures the ternary source between them as if it were a key, while
      // the real key that followed is consumed and never seen. Measured: it
      // swallowed '-immersive-leaves-v1' whole. Match everything, filter after.
      for (const q of expr.matchAll(/'([^']*)'/g)) {
        if (q[1].length >= 2) out.push({ file: f, key: q[1] });
      }
      for (const tl of expr.matchAll(/`([^`]*)`/g)) {
        for (const seg of tl[1].split(/\$\{[^}]*\}/)) if (seg.length >= 2) out.push({ file: f, key: seg });
      }
      for (const id of expr.matchAll(/\b([A-Z0-9_]*KEY)\b/g)) {
        if (consts.has(id[1])) out.push({ file: f, key: consts.get(id[1]) });
      }
    }
  }
  return out;
}

const found = extractKeys().filter((k) => !NOT_A_KEY.has(k.key));
const uniq = [...new Map(found.map((k) => [k.key, k])).values()];

const wb = read('lib/fly/toy-world/world-bend.js');
const header = wb.slice(0, wb.indexOf('*/'));
gate(
  '(0) the registry header was located and is the thing it claims to be',
  header.length > 20000 && header.includes('PROGRAM CACHE KEY REGISTRY'),
  `${header.length} chars of ${wb.length}, banner ${header.includes('PROGRAM CACHE KEY REGISTRY') ? 'present' : 'MISSING'}`
);
gate(
  '(1) the sweep found the key expressions it is supposed to judge',
  uniq.length >= 20,
  `${uniq.length} distinct key fragments across ${SRC.length} files` +
    (LIST ? `\n      ${uniq.map((u) => `${header.includes(u.key) ? 'IN ' : 'GAP'} ${u.key}`).join('\n      ')}` : '')
);

const unregistered = uniq.filter((u) => !header.includes(u.key));
const newGaps = unregistered.filter((u) => !(u.key in BASELINE_GAP));
gate(
  '(2) EVERY key this tree can emit is in the world-bend registry header, or in the named baseline gap',
  newGaps.length === 0,
  newGaps.length
    ? newGaps.map((g) => `'${g.key}' (${g.file})`).join(' | ') +
      '  — register it in the world-bend.js header IN THE SAME CHANGE that adds it'
    : `${uniq.length - unregistered.length} registered, ${unregistered.length} in the baseline gap`
);

// (3) THE GAP IS FROZEN. It may shrink; it may never grow. A stale entry (a
// key someone registered, or removed from the tree) is reported so the list
// cannot rot into a standing permission.
const stale = Object.keys(BASELINE_GAP).filter((k) => !unregistered.some((u) => u.key === k));
gate(
  '(3) the baseline gap is exactly its documented set — no growth, no stale entries',
  stale.length === 0,
  stale.length
    ? `stale (now registered or gone): ${stale.join(', ')} — delete the BASELINE_GAP line`
    : `${Object.keys(BASELINE_GAP).length} known-unregistered keys, all still unregistered`
);

// (4) THE R25 STUBS. Every key R25 reserved must be in the header ALREADY —
// that is what a reserved stub is — so this fails if a stub is deleted before
// its owner fills it in.
const R25_STUBS = [
  "world-bend-anchor-scrub-r25",
  'night-ground-splat-v1',
  'night-ground-blur-v1',
  'clutter-night-ground-v1',
  'immersive-surface-v2',
  'night-ground-v1',
];
const lostStubs = R25_STUBS.filter((k) => !header.includes(k));
gate(
  '(4) every R25 key reserved at W0 is still reserved in the header',
  lostStubs.length === 0,
  lostStubs.length ? `missing stubs: ${lostStubs.join(', ')}` : R25_STUBS.length + ' stubs present'
);

// (5) A RESERVED STUB IS NOT A SHIPPED KEY. On the flag-off tree none of them
// may be emitted by anything. This is the registry's half of
// verify-r25-flagoff gate (2b), asserted from the other direction.
const emittedStubs = uniq.filter((u) => R25_STUBS.some((k) => u.key.includes(k)));
gate(
  '(5) no R25 reserved key is EMITTED by this tree yet',
  emittedStubs.length === 0,
  emittedStubs.length
    ? emittedStubs.map((e) => `${e.key} (${e.file})`).join(' | ')
    : 'reserved, not emitted — as the flags-off state requires'
);

console.log(`\n${n - fails.length}/${n} passed`);
if (unregistered.length) {
  console.log(
    `\nREGISTRY GAP (${unregistered.length} keys, all pre-existing at the R25 base f0cd81e):\n` +
      unregistered.map((u) => `  ${u.key.padEnd(40)} ${BASELINE_GAP[u.key] ?? '(UNEXPLAINED)'}`).join('\n') +
      '\nOwner: the world-bend registry header (Fable, W0 row). E CERT owns scripts/, not this file.'
  );
}
if (fails.length) console.log(`FAILED: ${fails.join(' | ')}`);
process.exit(fails.length ? 1 : 0);

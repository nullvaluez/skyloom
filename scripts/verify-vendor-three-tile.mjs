#!/usr/bin/env node
/**
 * verify-vendor-three-tile — Round 24 (A PACE, W1a).
 *
 * Proves the vendored three-tile copy under lib/fly/vendor/three-tile/ is the
 * upstream 0.12.1 dist, byte-for-byte, except the ONE recorded import rewrite,
 * and that the dependency wiring left no second copy behind.
 *
 * NODE-ONLY: no browser, no dev server, no network — it runs in this container
 * and on the user's machine identically.
 *
 *   node scripts/verify-vendor-three-tile.mjs
 *
 * Two legs, and it says which one it ran:
 *   FULL   node_modules/three-tile is present → real line-by-line diff.
 *   SHA    the package has been uninstalled  → the recorded sha256 pair from
 *          VENDOR.md is the evidence (the FULL leg ran at the vendoring commit).
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
// Already supplied by the installed Next/Babel toolchain; parse, never execute,
// either vendored snapshot when computing the integration function inventory.
const { parse } = createRequire(import.meta.url)('@babel/parser');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V = path.join(root, 'lib/fly/vendor/three-tile');

// Recorded at the vendoring commit (VENDOR.md's table is the human copy).
const EXPECT = {
  upstreamIndex: '99a4e751a6412940b5432947904ad8399b30b70b66a5927929bf2da0590293d7',
  upstreamPlugin: '0eac27756b8e36cdef89e278dadd90cd8900f2febe68972a63f933900f8d94c5',
  vendorIndex: '99a4e751a6412940b5432947904ad8399b30b70b66a5927929bf2da0590293d7',
  vendorPlugin: 'a8b8b7afbb5c51f787ad048993e23715eb3f8a3382e94783e703aadb8c1e2e21',
};
// The commit that vendored the files VERBATIM. git holds that tree forever, so
// the byte-identity proof survives every later patch: the gate hashes the file
// AS OF that commit, and separately proves the working copy differs from it
// only inside marked patch regions.
const VENDOR_COMMIT = 'b64457b';
const MAIN_COMMIT = '0ff2a3f3f6721265c285a02bbc87f130b161ff77';
// Upstream lines a patch is allowed to EDIT rather than leave verbatim (each
// one is a ledger row that says why). Today: exactly TWO, both signature-only.
//   `Tile._getDistRatio()` gains an optional parameter so PATCH 2 can ask for
//   the in-frustum law; `Tile.LOD()` gains one so PATCH 22 can withhold a load
//   start while the loader is saturated. Every upstream call site passes the
//   original argument list and is unaffected.
const DELETED_UPSTREAM_LINES = 2;
// The ONE sanctioned difference: plugin.js line 2's core import.
const REWRITE_FROM = 'from "three-tile";';
const REWRITE_TO = 'from "./index.js";';
const REWRITE_LINE = 2; // 1-based

let pass = 0;
let fail = 0;
const gate = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const read = (p) => readFileSync(p, 'utf8');
const lf = (text) => text.replace(/\r\n/g, '\n');
const textSha = (text) => createHash('sha256').update(lf(text)).digest('hex');
const relative = (file) => path.relative(root, file).split(path.sep).join('/');

// Include every declared top-level function and class method (including
// getters/setters), named by its public export where one exists. Nested work
// is covered by its enclosing function's exact source, and module constants /
// inline worker strings are covered by the separate whole-file digest.
function functionsIn(source) {
  const nodes = parse(source, { sourceType: 'module' }).program.body;
  const aliases = new Map(), result = new Map();
  for (const node of nodes) if (node.type === 'ExportNamedDeclaration') {
    for (const spec of node.specifiers) aliases.set(spec.local.name, spec.exported.name);
  }
  for (let node of nodes) {
    node = node.declaration || node;
    if (node.type === 'FunctionDeclaration') {
      result.set(aliases.get(node.id.name) || node.id.name, source.slice(node.start, node.end));
    }
    if (node.type === 'ClassDeclaration') for (const method of node.body.body) {
      if (method.type !== 'ClassMethod') continue;
      const kind = method.kind === 'get' || method.kind === 'set' ? `${method.kind} ` : '';
      const name = `${aliases.get(node.id.name) || node.id.name}.${kind}${method.key.name || method.key.value}`;
      result.set(name, source.slice(method.start, method.end));
    }
  }
  return result;
}
function changedFunctions(before, after) {
  const a = functionsIn(lf(before)), b = functionsIn(lf(after));
  return [...new Set([...a.keys(), ...b.keys()])].sort().filter((name) => a.get(name) !== b.get(name))
    .map((name) => ({ name, change: !a.has(name) ? 'added' : !b.has(name) ? 'removed' : 'modified' }));
}

console.log('verify-vendor-three-tile — vendored three-tile 0.12.1 integrity\n');

// ---------------------------------------------------------------- 1. presence
const vIndex = path.join(V, 'index.js');
const vPlugin = path.join(V, 'plugin.js');
const vDoc = path.join(V, 'VENDOR.md');
gate('1 vendored index.js exists', existsSync(vIndex));
gate('2 vendored plugin.js exists', existsSync(vPlugin));
gate('3 VENDOR.md exists', existsSync(vDoc));
if (fail) {
  console.log('\nvendored files missing — nothing else can be checked');
  process.exit(1);
}

// -------------------------------------------------------------- 2. the copies
// Leg A (always): the files AS OF the vendoring commit are the upstream bytes.
const git = (args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
let atVendorIndex = null;
let atVendorPlugin = null;
try {
  atVendorIndex = createHash('sha256')
    .update(git(['show', `${VENDOR_COMMIT}:lib/fly/vendor/three-tile/index.js`]))
    .digest('hex');
  atVendorPlugin = createHash('sha256')
    .update(git(['show', `${VENDOR_COMMIT}:lib/fly/vendor/three-tile/plugin.js`]))
    .digest('hex');
} catch (e) {
  console.log(`  (git unavailable or commit ${VENDOR_COMMIT} not present: ${e.message.split('\n')[0]})`);
}
gate(`4 at the vendoring commit ${VENDOR_COMMIT}, index.js == upstream 0.12.1 byte-for-byte`,
  atVendorIndex === EXPECT.upstreamIndex, atVendorIndex ? atVendorIndex.slice(0, 16) : 'not checked');
gate(`5 at the vendoring commit ${VENDOR_COMMIT}, plugin.js == upstream + the one import rewrite`,
  atVendorPlugin === EXPECT.vendorPlugin, atVendorPlugin ? atVendorPlugin.slice(0, 16) : 'not checked');

// Leg B (only while the npm package is still installed): the real line-by-line
// diff. After `npm uninstall three-tile` this leg cannot run and says so.
const upstreamDir = path.join(root, 'node_modules/three-tile/dist');
const haveUpstream =
  existsSync(path.join(upstreamDir, 'index.js')) &&
  existsSync(path.join(upstreamDir, 'plugin/index.js'));
if (haveUpstream) {
  console.log('  leg: FULL (node_modules/three-tile present — real line diff too)');
  const uPlugin = path.join(upstreamDir, 'plugin/index.js');
  const uLines = read(uPlugin).split('\n');
  const vLines = git(['show', `${VENDOR_COMMIT}:lib/fly/vendor/three-tile/plugin.js`]).toString('utf8').split('\n');
  const diffs = [];
  for (let i = 0; i < Math.max(uLines.length, vLines.length); i++) {
    if (uLines[i] !== vLines[i]) diffs.push(i + 1);
  }
  gate('6 plugin.js differed from upstream on EXACTLY line 2 at the vendoring commit',
    diffs.length === 1 && diffs[0] === REWRITE_LINE,
    diffs.length ? `lines: ${diffs.join(', ')}` : 'no differences at all');
} else {
  console.log('  leg: SHA (three-tile uninstalled — the git-anchored hashes above are the proof)');
  gate('6 plugin.js line 2 carries the rewritten core import',
    (read(vPlugin).split('\n')[REWRITE_LINE - 1] ?? '').endsWith(REWRITE_TO));
}

// Leg C: retain the original Round 24 proof against its immutable main tree.
// The approved parallel lineage has additional lifecycle edits; it is checked
// separately below, rather than increasing this historical allowance.
let addedOutsidePatch = [];
let deletedUpstream = 0;
try {
  for (const f of ['index.js', 'plugin.js']) {
    const diff = git(['diff', '-U0', VENDOR_COMMIT, MAIN_COMMIT, '--', `lib/fly/vendor/three-tile/${f}`]).toString('utf8');
    if (!diff.trim()) continue;
    const hunks = diff.split(/^@@/m).slice(1);
    for (const h of hunks) {
      const lines = h.split('\n');
      const added = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++'));
      const removed = lines.filter((l) => l.startsWith('-') && !l.startsWith('---'));
      deletedUpstream += removed.length;
      if (!added.some((l) => /R24|r24/.test(l))) {
        addedOutsidePatch.push(`${f}: ${(added[0] ?? '').slice(1, 60).trim()}`);
      }
    }
  }
} catch {
  addedOutsidePatch = null;
}
gate('7 historical main: every edit sits in a marked R24 patch hunk',
  addedOutsidePatch !== null && addedOutsidePatch.length === 0,
  addedOutsidePatch === null ? 'git diff unavailable' : addedOutsidePatch.join(' | '));
gate(`8 historical main: upstream lines EDITED <= the original ${DELETED_UPSTREAM_LINES} allowance`,
  deletedUpstream <= DELETED_UPSTREAM_LINES, `${deletedUpstream} upstream lines replaced`);

// Leg C2: a reviewed integration receipt is deliberately NOT auto-refreshed.
// Both the entire normalized source and the exact changed-function inventory
// must match. Unexplained changes fail even when they carry an R24 comment.
const manifest = JSON.parse(read(path.join(root, 'scripts/vendor-three-tile-integration.json')));
gate('8a integration receipt names the immutable main baseline', manifest.baselineCommit === MAIN_COMMIT);
const vendorFiles = ['index.js', 'plugin.js', 'workers/skirt-tail.src.js', 'workers/skirt-tail.built.js'];
gate('8b integration receipt covers exactly the runtime vendor files',
  JSON.stringify(Object.keys(manifest.files).sort()) === JSON.stringify([...vendorFiles].sort()));
for (const file of vendorFiles) {
  const baseline = git(['show', `${MAIN_COMMIT}:lib/fly/vendor/three-tile/${file}`]).toString('utf8');
  const current = read(path.join(V, file));
  const receipt = manifest.files[file];
  gate(`8c ${file}: immutable main digest`, textSha(baseline) === receipt?.baselineSha256);
  gate(`8d ${file}: reviewed integration digest`, textSha(current) === receipt?.integratedSha256);
  const changes = changedFunctions(baseline, current);
  const recorded = (receipt?.changedFunctions || []).map(({ name, change }) => ({ name, change }));
  gate(`8e ${file}: exact changed-function inventory`, JSON.stringify(changes) === JSON.stringify(recorded),
    changes.length ? changes.map(({ name, change }) => `${name} (${change})`).join(', ') : 'unchanged');
}

// Leg D: the bundle still imports nothing but three (+ the plugin's core).
// The bundle may import `three` and — since PATCH 5 — its OWN generated worker
// source next door. It may never import app code; that is what keeps the
// vendored copy a leaf and its patches switchable from one place.
const ALLOWED_INDEX_IMPORTS = new Set(['three', './workers/skirt-tail.built.js']);
gate('9 index.js imports only three (+ its own generated worker source)',
  [...read(vIndex).matchAll(/from\s*["']([^"']+)["']/g)].every((m) => ALLOWED_INDEX_IMPORTS.has(m[1])),
  [...read(vIndex).matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]).join(', '));
gate('10 plugin.js imports only from "three" and "./index.js"',
  [...read(vPlugin).matchAll(/from\s*["']([^"']+)["']/g)]
    .every((m) => m[1] === 'three' || m[1] === './index.js'));

// --------------------------------------------- 3. no second copy, no dead refs
const srcDirs = ['app', 'components', 'lib', 'hooks', 'stores', 'scripts'];
const files = [];
for (const d of srcDirs) {
  const stack = [path.join(root, d)];
  while (stack.length) {
    const cur = stack.pop();
    if (!existsSync(cur)) continue;
    for (const e of readdirSync(cur, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === 'r24-out') continue;
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.(js|jsx|mjs|cjs)$/.test(e.name)) files.push(p);
    }
  }
}
const bareImporters = files
  .filter((f) => !f.startsWith(V))
  // Real import/export STATEMENTS only — a `from 'three-tile'` inside a comment
  // (tile-sources.js explains the rewrite) or inside this gate's own constants
  // is not a second copy.
  .filter((f) => /^\s*(?:import|export)[^\n]*from\s*['"]three-tile(\/plugin)?['"]/m.test(read(f)))
  .map(relative);
gate('11 no source file imports the bare `three-tile` specifier', bareImporters.length === 0,
  bareImporters.join(', '));

const vendorImporters = files
  .filter((f) => !relative(f).startsWith('scripts/')) // fixtures are not runtime imports
  .filter((f) => /^\s*(?:import|export)[^\n]*from\s*['"][^'"]*vendor\/three-tile\/(index|plugin)\.js['"]/m.test(read(f)))
  .map(relative)
  .sort();
gate('12 exactly the two known runtime files import the vendored copy',
  vendorImporters.length === 2 &&
    vendorImporters.includes('lib/fly/terrain-engine.js') &&
    vendorImporters.includes('lib/fly/tile-sources.js'),
  vendorImporters.join(', '));

const pkg = JSON.parse(read(path.join(root, 'package.json')));
gate('13 package.json has no three-tile dependency',
  !pkg.dependencies?.['three-tile'] && !pkg.devDependencies?.['three-tile']);
gate('14 package.json has no three-tile override', !pkg.overrides?.['three-tile']);
const nextCfg = read(path.join(root, 'next.config.mjs'));
const transpileLine = nextCfg.match(/transpilePackages:\s*\[[^\]]*\]/)?.[0] ?? '';
gate('15 next.config transpilePackages no longer names three-tile',
  !/['"]three-tile['"]/.test(transpileLine), transpileLine.trim());
const lock = read(path.join(root, 'package-lock.json'));
gate('16 package-lock has no three-tile entry', !/"node_modules\/three-tile"/.test(lock));

// ------------------------------- 3b. the bundle's own defaults stay inert
// The switchboard's literal defaults must ALL be false regardless of what the
// app ships: the bundle is imported by a node fixture and by the app alike,
// and only lib/fly/terrain-engine.js decides what is on. A `true` creeping
// into the literal would arm a patch for every importer, including the gates
// whose whole method is forcing each state themselves.
const swBlock = read(vIndex).match(/export const R24_SWITCHES = \{[\s\S]*?\n\};/);
const swTrue = swBlock
  ? [...swBlock[0].matchAll(/^\s*(\w+):\s*true\s*,/gm)].map((m) => m[1])
  : ['<block not found>'];
gate('16b the vendored switchboard literal defaults to every switch OFF',
  !!swBlock && swTrue.length === 0, swTrue.join(', '));

// ------------------------------------------------- 4. patch ledger consistency
const doc = read(vDoc);
const markerRe = /\/\/\s*R24\s+([A-E])\s+PATCH\s+(\d+)\s*\(([^)]+)\)/g;
const markers = [];
for (const f of [vIndex, vPlugin]) {
  const txt = read(f);
  let m;
  while ((m = markerRe.exec(txt))) markers.push({ owner: m[1], n: m[2], sw: m[3], file: path.basename(f) });
}
const ledgerRows = [...doc.matchAll(/^\|\s*(\d+)\s*\|\s*([A-E])\s*\|/gm)].map((m) => ({
  n: m[1],
  owner: m[2],
}));
const markerKeys = markers.map((m) => `${m.owner}${m.n}`).sort();
const ledgerKeys = ledgerRows.map((r) => `${r.owner}${r.n}`).sort();
const historicalMarkers = [];
for (const file of ['index.js', 'plugin.js']) {
  const source = git(['show', `${MAIN_COMMIT}:lib/fly/vendor/three-tile/${file}`]).toString('utf8');
  historicalMarkers.push(...[...source.matchAll(markerRe)].map((m) => `${m[1]}${m[2]}`));
}
gate('17 every PATCH marker in the vendored code has a VENDOR.md row',
  markerKeys.every((k) => ledgerKeys.includes(k)),
  `markers=[${markerKeys.join(',')}] ledger=[${ledgerKeys.join(',')}]`);
const composed = manifest.composedHistoricalMarkers || {};
gate('18 every historical ledger row remains marked or has an inventoried integration method',
  ledgerKeys.every((key) => markerKeys.includes(key) ||
    (historicalMarkers.includes(key) && composed[key]?.length > 0 && composed[key].every((name) =>
      manifest.files['index.js'].changedFunctions.some((entry) => entry.name === name && entry.change === 'modified')))) &&
    Object.keys(composed).every((key) => ledgerKeys.includes(key) && !markerKeys.includes(key)),
  `composed=${Object.entries(composed).map(([key, names]) => `${key}:${names.join('/')}`).join(', ')}`);

// ------------------------------------------- 5. the worker build is not stale
let builderOut = '';
let builderOk = true;
try {
  builderOut = execFileSync('node', ['scripts/build-tile-worker.mjs', '--check'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
} catch (e) {
  builderOk = false;
  builderOut = (e.stdout || e.message || '').toString().trim();
}
gate('19 the generated worker source is up to date with its readable .src.js',
  builderOk, builderOut.split('\n').pop());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

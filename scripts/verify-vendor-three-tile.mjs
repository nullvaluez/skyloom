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
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const V = path.join(root, 'lib/fly/vendor/three-tile');

// Recorded at the vendoring commit (VENDOR.md's table is the human copy).
const EXPECT = {
  upstreamIndex: '99a4e751a6412940b5432947904ad8399b30b70b66a5927929bf2da0590293d7',
  upstreamPlugin: '0eac27756b8e36cdef89e278dadd90cd8900f2febe68972a63f933900f8d94c5',
  vendorIndex: '99a4e751a6412940b5432947904ad8399b30b70b66a5927929bf2da0590293d7',
  vendorPlugin: 'a8b8b7afbb5c51f787ad048993e23715eb3f8a3382e94783e703aadb8c1e2e21',
};
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
const upstreamDir = path.join(root, 'node_modules/three-tile/dist');
const haveUpstream =
  existsSync(path.join(upstreamDir, 'index.js')) &&
  existsSync(path.join(upstreamDir, 'plugin/index.js'));

const vIndexSha = sha(vIndex);
const vPluginSha = sha(vPlugin);

if (haveUpstream) {
  console.log('  leg: FULL (node_modules/three-tile present — real diff)\n');
  const uIndex = path.join(upstreamDir, 'index.js');
  const uPlugin = path.join(upstreamDir, 'plugin/index.js');
  gate('4 upstream index.js is the recorded 0.12.1 file', sha(uIndex) === EXPECT.upstreamIndex);
  gate('5 upstream plugin.js is the recorded 0.12.1 file', sha(uPlugin) === EXPECT.upstreamPlugin);

  gate('6 vendored index.js is BYTE-IDENTICAL to upstream', sha(uIndex) === vIndexSha);

  const uLines = read(uPlugin).split('\n');
  const vLines = read(vPlugin).split('\n');
  gate('7 vendored plugin.js has the same line count as upstream', uLines.length === vLines.length,
    `${vLines.length} lines`);
  const diffs = [];
  for (let i = 0; i < Math.max(uLines.length, vLines.length); i++) {
    if (uLines[i] !== vLines[i]) diffs.push(i + 1);
  }
  gate('8 vendored plugin.js differs from upstream on EXACTLY one line', diffs.length === 1,
    diffs.length ? `lines: ${diffs.join(', ')}` : 'no differences at all (import not rewritten?)');
  gate('9 that one line is line 2 (the core import)', diffs.length === 1 && diffs[0] === REWRITE_LINE,
    diffs.length === 1 ? `line ${diffs[0]}` : '');
  if (diffs.length === 1 && diffs[0] === REWRITE_LINE) {
    const u = uLines[REWRITE_LINE - 1];
    const v = vLines[REWRITE_LINE - 1];
    gate('10 the rewrite is exactly `three-tile` → `./index.js`',
      u.endsWith(REWRITE_FROM) && v === u.slice(0, -REWRITE_FROM.length) + REWRITE_TO);
  } else {
    gate('10 the rewrite is exactly `three-tile` → `./index.js`', false, 'skipped: wrong diff shape');
  }
} else {
  console.log('  leg: SHA (three-tile uninstalled — recorded hashes are the evidence)\n');
  gate('4 vendored index.js sha256 matches the record', vIndexSha === EXPECT.vendorIndex, vIndexSha.slice(0, 16));
  gate('5 vendored plugin.js sha256 matches the record', vPluginSha === EXPECT.vendorPlugin, vPluginSha.slice(0, 16));
  gate('6 vendored index.js sha256 == the recorded UPSTREAM sha256 (verbatim)',
    vIndexSha === EXPECT.upstreamIndex);
  const vLines = read(vPlugin).split('\n');
  gate('7 plugin.js line 2 carries the rewritten core import',
    (vLines[REWRITE_LINE - 1] ?? '').endsWith(REWRITE_TO));
  gate('8 plugin.js has no bare `three-tile` import left',
    !/from\s*["']three-tile["']/.test(read(vPlugin)));
  gate('9 index.js imports only from "three"',
    [...read(vIndex).matchAll(/from\s*["']([^"']+)["']/g)].every((m) => m[1] === 'three'));
  gate('10 plugin.js imports only from "three" and "./index.js"',
    [...read(vPlugin).matchAll(/from\s*["']([^"']+)["']/g)]
      .every((m) => m[1] === 'three' || m[1] === './index.js'));
}

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
  .map((f) => path.relative(root, f));
gate('11 no source file imports the bare `three-tile` specifier', bareImporters.length === 0,
  bareImporters.join(', '));

const vendorImporters = files
  .filter((f) => /^\s*(?:import|export)[^\n]*from\s*['"][^'"]*vendor\/three-tile\/(index|plugin)\.js['"]/m.test(read(f)))
  .map((f) => path.relative(root, f))
  .sort();
gate('12 exactly the two known files import the vendored copy',
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

// ------------------------------------------------- 4. patch ledger consistency
const doc = read(vDoc);
const markerRe = /\/\/\s*R24\s+([A-E])\s+PATCH\s+(\d+)\s*\(([^)]+)\)/g;
const markers = [];
for (const f of [vIndex, vPlugin]) {
  const txt = read(f);
  let m;
  while ((m = markerRe.exec(txt))) markers.push({ owner: m[1], n: m[2], sw: m[3], file: path.basename(f) });
}
const ledgerRows = [...doc.matchAll(/^\|\s*(\d+)\s*\|\s*([A-E])\s*\|\s*`?([^|`]+)`?\s*\|/gm)].map((m) => ({
  n: m[1],
  owner: m[2],
  sw: m[3].trim(),
}));
const markerKeys = markers.map((m) => `${m.owner}${m.n}`).sort();
const ledgerKeys = ledgerRows.map((r) => `${r.owner}${r.n}`).sort();
gate('17 every PATCH marker in the vendored code has a VENDOR.md row',
  markerKeys.every((k) => ledgerKeys.includes(k)),
  `markers=[${markerKeys.join(',')}] ledger=[${ledgerKeys.join(',')}]`);
gate('18 every VENDOR.md patch row has a marker in the vendored code',
  ledgerKeys.every((k) => markerKeys.includes(k)),
  `markers=[${markerKeys.join(',')}] ledger=[${ledgerKeys.join(',')}]`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

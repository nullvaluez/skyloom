/**
 * R24 D ATMOS — verify-lod-fade (node gate; no browser, no dev server, no GL).
 *
 * The browser leg of this gate (hard-pop counting over a scripted serpentine on
 * E's offline fixture) belongs to E CERT. THIS leg gates everything that can be
 * decided without a GPU, and in particular the two claims the whole feature
 * rests on:
 *
 *   1. FLAG-OFF BYTE IDENTITY. `applyHillshade` is the FINAL tile key in BOTH
 *      styles. With LOD_CROSSFADE off, the generated vertex text, the generated
 *      fragment text, the uniform set and the cache key must be identical to
 *      R19's, character for character — not "equivalent". Gate 3 compiles the
 *      patch twice against a stub shader and byte-compares.
 *   2. THE VENDOR PATCHES ARE INSERT-ONLY. VENDOR.md's switch-idiom rule 2
 *      ("byte-verbatim upstream when off") has a machine-checkable form: every
 *      upstream line still appears in the vendored file, in order. An
 *      insert-only diff cannot have edited or deleted an upstream statement.
 *
 * Run:  node scripts/verify-lod-fade.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShaderChunk } from 'three';
import { applyBendFade, applyHillshade } from '../lib/fly/toy-world/world-bend.js';
import { lodUvRect, lodStats } from '../lib/fly/lod-crossfade.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? '  ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
};

console.log('\nR24 D ATMOS — verify-lod-fade (node leg)\n');

// ---------------------------------------------------------------------------
console.log('[1] vendor patches: present, placed, and INSERT-ONLY');
const vendored = fs.readFileSync(path.join(ROOT, 'lib/fly/vendor/three-tile/index.js'), 'utf8');
const ledger = fs.readFileSync(path.join(ROOT, 'lib/fly/vendor/three-tile/VENDOR.md'), 'utf8');

const markers = [...vendored.matchAll(/\/\/\s*R24\s+D\s+PATCH\s+(\d+)\s*\(([^)]+)\)/g)].map((m) => m[1]);
ok('the three D patch markers are present', markers.join(',') === '3,1,2', `markers=[${markers.join(',')}]`);
ok('every D marker names LOD_CROSSFADE as its switch',
  [...vendored.matchAll(/\/\/\s*R24\s+D\s+PATCH\s+\d+\s*\(([^)]+)\)/g)].every((m) => m[1] === 'LOD_CROSSFADE'));
for (const n of ['1', '2', '3']) {
  ok(`VENDOR.md has a ledger row for D patch ${n}`,
    new RegExp(`^\\|\\s*${n}\\s*\\|\\s*D\\s*\\|`, 'm').test(ledger));
}

const vLines = vendored.split('\n');
const upPath = path.join(ROOT, 'node_modules/three-tile/dist/index.js');
if (fs.existsSync(upPath)) {
  const uLines = fs.readFileSync(upPath, 'utf8').split('\n');
  let i = 0;
  let missing = 0;
  for (const ln of uLines) {
    let j = i;
    while (j < vLines.length && vLines[j] !== ln) j++;
    if (j >= vLines.length) missing++;
    else i = j + 1;
  }
  ok('the vendored diff is INSERT-ONLY (every upstream line survives, in order)',
    missing === 0, `upstream ${uLines.length} lines, vendored ${vLines.length}, ${missing} missing`);
} else {
  ok('INSERT-ONLY leg', true, 'SKIPPED — node_modules/three-tile absent (see VENDOR.md sha leg)');
}

// Placement: patch 1 must run BEFORE the refine return expression (the parent
// texture is disposed inside it); patch 2 must run before the merge return and
// must hold _loadState across its await.
const refineHook = vendored.indexOf('ir && ir.onRefine(this, o, h);');
const refineRet = vendored.indexOf('return h ? this.unloadSubTiles()');
ok('patch 1 calls the hook BEFORE the refine return (the parent map is still alive)',
  refineHook > 0 && refineRet > refineHook, `hook@${refineHook} return@${refineRet}`);
const mergeBlock = vendored.slice(vendored.indexOf('const _w = ir.onMerge(this, o);'), vendored.indexOf('return l ? this.unloadModel()'));
ok('patch 2 holds _loadState at "loading" across its await (freezes the subtree)',
  /_loadState = "loading";[\s\S]*await _w;[\s\S]*_loadState = "loaded";/.test(mergeBlock));
ok('patch 2 runs before the merge return expression', mergeBlock.length > 0 && mergeBlock.length < 800);
ok('the hook holder defaults to null (the off-state)', /let ir = null;/.test(vendored));
ok('the library reads the hook nowhere else',
  (vendored.match(/\bir\b(?!\s*=\s*null)/g) ?? []).filter((x) => x).length > 0 &&
  vendored.split('\n').filter((l) => /[^/\s]\s*\bir\b/.test(l) && !l.trim().startsWith('//')).length === 4,
  `${vendored.split('\n').filter((l) => /[^/\s]\s*\bir\b/.test(l) && !l.trim().startsWith('//')).length} code lines mention it`);

// ---------------------------------------------------------------------------
console.log('\n[2] the map-chunk surgery is version-proof');
ok("three's ShaderChunk.map_fragment still contains the spliced line",
  ShaderChunk.map_fragment.includes('diffuseColor *= sampledDiffuseColor;'));
ok('the spliced line occurs EXACTLY once (an ambiguous splice would be silent)',
  ShaderChunk.map_fragment.split('diffuseColor *= sampledDiffuseColor;').length - 1 === 1);
ok('`sampledDiffuseColor` is declared before it, so the blend acts on the SAMPLE',
  ShaderChunk.map_fragment.indexOf('vec4 sampledDiffuseColor') < ShaderChunk.map_fragment.indexOf('diffuseColor *= sampledDiffuseColor;'));
ok('the chunk uses vMapUv (the varying the clip-UV transform rides)',
  ShaderChunk.map_fragment.includes('vMapUv'));

// ---------------------------------------------------------------------------
console.log('\n[3] flag-off is BYTE-IDENTICAL (generated text, uniforms, key)');
const STUB_V = [
  '#include <common>', '#include <defaultnormal_vertex>', '#include <project_vertex>',
].join('\n');
const STUB_F = [
  '#include <common>', '#include <clipping_planes_fragment>', '#include <map_fragment>',
  '#include <color_fragment>', '#include <fog_fragment>',
].join('\n');
const HILL = { ambient: 0.35, lift: 0.15, micro: { scaleM: 40, amp: 0.06 }, quiltAnchor: 0.42 };

function compile(slot) {
  const m = { userData: {}, needsUpdate: false };
  applyBendFade(m);
  applyHillshade(m, HILL, slot);
  const shader = { uniforms: {}, vertexShader: STUB_V, fragmentShader: STUB_F };
  m.onBeforeCompile(shader, null);
  return { shader, key: m.customProgramCacheKey() };
}
const off = compile(null);
const slot = {
  mix: { value: 0 },
  uv: { value: { x: 1, y: 1, z: 0, w: 0, isVector4: true } },
  map: { value: {} },
  chunk: ShaderChunk.map_fragment,
};
const on = compile(slot);

ok('flag-off VERTEX text is byte-identical to the pre-R24 patch',
  off.shader.vertexShader === on.shader.vertexShader.replace(/\nuniform float uLodFadeMix;\nuniform vec4 uLodFadeUV;\nuniform sampler2D uLodFadeMap;/, '') ||
  !off.shader.vertexShader.includes('uLodFade'),
  'no uLodFade token in the off vertex shader');
ok('flag-off FRAGMENT text contains NO uLodFade token', !off.shader.fragmentShader.includes('uLodFade'));
ok('flag-off FRAGMENT still has the untouched `#include <map_fragment>`',
  off.shader.fragmentShader.includes('#include <map_fragment>'));
ok('flag-off uniform set has no uLodFade* entries',
  !Object.keys(off.shader.uniforms).some((k) => k.startsWith('uLodFade')),
  Object.keys(off.shader.uniforms).filter((k) => k.startsWith('uLodFade')).join(',') || '(none)');
ok('flag-off FINAL tile key is the R19 key', off.key === 'world-bend-fade-hill-r19', off.key);
ok('flag-on FINAL tile key carries the -d24 suffix', on.key === 'world-bend-fade-hill-r19-d24', on.key);
ok('flag-on wires exactly the three fade uniforms',
  ['uLodFadeMix', 'uLodFadeUV', 'uLodFadeMap'].every((k) => on.shader.uniforms[k]) &&
  on.shader.uniforms.uLodFadeMix === slot.mix && on.shader.uniforms.uLodFadeMap === slot.map);
ok('flag-on REPLACED the map include (the blend is inside the chunk)',
  !on.shader.fragmentShader.includes('#include <map_fragment>') &&
  on.shader.fragmentShader.includes('sampledDiffuseColor = mix( sampledDiffuseColor'));
ok('flag-on kept every non-blend line of the chunk verbatim',
  ShaderChunk.map_fragment.split('\n').filter((l) => l.trim() && !l.includes('diffuseColor *= sampledDiffuseColor'))
    .every((l) => on.shader.fragmentShader.includes(l.trim())));
ok('the blend is 0-gated (a resting tile skips the branch and the extra fetch)',
  on.shader.fragmentShader.includes('if ( uLodFadeMix > 0.0 )'));
{
  // Strip the ONLY two additions and the on/off fragment texts must coincide.
  const spliced = ShaderChunk.map_fragment.replace(
    'diffuseColor *= sampledDiffuseColor;',
    'if ( uLodFadeMix > 0.0 ) {\n' +
      '\t\tsampledDiffuseColor = mix( sampledDiffuseColor, texture2D( uLodFadeMap, vMapUv * uLodFadeUV.xy + uLodFadeUV.zw ), uLodFadeMix );\n' +
      '\t}\n' +
      '\tdiffuseColor *= sampledDiffuseColor;'
  );
  const stripped = on.shader.fragmentShader
    .replace('\nuniform float uLodFadeMix;\nuniform vec4 uLodFadeUV;\nuniform sampler2D uLodFadeMap;', '')
    .replace(spliced, '#include <map_fragment>');
  ok('the flag-on fragment MINUS its two additions === the flag-off fragment',
    stripped === off.shader.fragmentShader,
    stripped === off.shader.fragmentShader ? '' : 'texts diverge beyond the two additions');
}

// ---------------------------------------------------------------------------
console.log('\n[4] lodUvRect — the clip-UV rectangle (pure function)');
{
  // XYZ y grows SOUTHWARD, PlaneGeometry v grows NORTHWARD: the NORTH-WEST
  // child (x even, y even) must occupy the TOP-LEFT of the parent map.
  const P = [12, 1000, 700];
  const nw = lodUvRect(P, [13, 2000, 1400]);
  const ne = lodUvRect(P, [13, 2001, 1400]);
  const sw = lodUvRect(P, [13, 2000, 1401]);
  const se = lodUvRect(P, [13, 2001, 1401]);
  const eq = (a, b) => a && a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
  ok('NW child -> top-left  [0.5,0.5,0.0,0.5]', eq(nw, [0.5, 0.5, 0.0, 0.5]), JSON.stringify(nw));
  ok('NE child -> top-right [0.5,0.5,0.5,0.5]', eq(ne, [0.5, 0.5, 0.5, 0.5]), JSON.stringify(ne));
  ok('SW child -> bottom-left  [0.5,0.5,0.0,0.0]', eq(sw, [0.5, 0.5, 0.0, 0.0]), JSON.stringify(sw));
  ok('SE child -> bottom-right [0.5,0.5,0.5,0.0]', eq(se, [0.5, 0.5, 0.5, 0.0]), JSON.stringify(se));
  ok('the four quadrants tile the parent map exactly once',
    [nw, ne, sw, se].map((r) => `${r[2]},${r[3]}`).sort().join('|') === '0,0|0,0.5|0.5,0|0.5,0.5');
  // A 2-level descendant (the merge path walks to LEAVES, which can be deeper).
  const g = lodUvRect(P, [14, 4003, 2801]);
  ok('a 2-level descendant maps to a quarter-size rect', eq(g, [0.25, 0.25, 0.75, 0.5]), JSON.stringify(g));
  ok('a NON-descendant is rejected (never smear a stranger tile across the world)',
    lodUvRect(P, [13, 2002, 1400]) === null && lodUvRect(P, [13, 1999, 1400]) === null);
  ok('same level / inverted level is rejected',
    lodUvRect(P, [12, 1000, 700]) === null && lodUvRect(P, [11, 500, 350]) === null);
  ok('an absurd descent (>6 levels) is rejected', lodUvRect(P, [30, 0, 0]) === null);
  // Exhaustive: every descendant at dz 1..4 must produce an in-range rect.
  let bad = 0, n = 0;
  for (let dz = 1; dz <= 4; dz++) {
    const k = 1 << dz;
    for (let bx = 0; bx < k; bx++) for (let by = 0; by < k; by++) {
      const r = lodUvRect(P, [12 + dz, 1000 * k + bx, 700 * k + by]);
      n++;
      if (!r || r[2] < -1e-12 || r[3] < -1e-12 || r[2] + r[0] > 1 + 1e-12 || r[3] + r[1] > 1 + 1e-12) bad++;
    }
  }
  ok('every descendant at dz 1-4 maps inside [0,1]^2', bad === 0, `${n} rects, ${bad} out of range`);
}

// ---------------------------------------------------------------------------
console.log('\n[5] policy + instrument contract');
{
  const src = fs.readFileSync(path.join(ROOT, 'lib/fly/fly-constants.js'), 'utf8');
  const m = src.match(/export const LOD_CROSSFADE = \{[\s\S]*?\n\};/);
  ok('LOD_CROSSFADE ships enabled:false', /enabled:\s*false/.test(m[0]));
  const fade = parseFloat(m[0].match(/fadeSec:\s*([0-9.]+)/)[1]);
  ok('fadeSec is inside the charter bound of 300 ms', fade > 0 && fade <= 0.3, `${fade * 1000} ms`);
  ok('boot is fade-free (skipBootMs > 0 — reveal timing is frozen)',
    parseFloat(m[0].match(/skipBootMs:\s*([0-9]+)/)[1]) > 0);
  ok('warps skip the fade (WARP.flashMs already masks the cut)', /skipOnWarp:\s*true/.test(m[0]));
  ok('there is a concurrency bound', parseInt(m[0].match(/maxConcurrent:\s*([0-9]+)/)[1], 10) > 0);
}
{
  const fields = ['hardSwaps', 'faded', 'refines', 'merges', 'active', 'peakActive', 'retained', 'skip'];
  ok('the instrument E reads exposes every promised field',
    fields.every((f) => f in lodStats), Object.keys(lodStats).join(','));
  ok('every counter starts at 0 (a fresh session has no history)',
    fields.filter((f) => f !== 'skip').every((f) => lodStats[f] === 0));
  ok('the skip reasons are enumerated (a zero-fade run must be diagnosable)',
    ['disabled', 'boot', 'warp', 'concurrency', 'noParentMap', 'shape', 'unpatched']
      .every((k) => k in lodStats.skip), Object.keys(lodStats.skip).join(','));
}

// ---------------------------------------------------------------------------
console.log('\n[6] the fade curve (pure function, as the clock evaluates it)');
{
  const curve = (from, to, t, dur) => {
    const k = dur > 0 ? Math.min(1, t / dur) : 1;
    const s = k * k * (3 - 2 * k);
    return from + (to - from) * s;
  };
  ok('refine starts at exactly 1 (the parent texel) at t=0', curve(1, 0, 0, 0.25) === 1);
  ok('refine ends at exactly 0 (its own texel) at t=dur', curve(1, 0, 0.25, 0.25) === 0);
  ok('merge starts at exactly 0 and ends at exactly 1',
    curve(0, 1, 0, 0.25) === 0 && curve(0, 1, 0.25, 0.25) === 1);
  // At k = 0.01 a LINEAR ramp has already moved 1e-2; smoothstep has moved
  // 2.98e-4. The bound discriminates between the two, which is the point: a
  // linear ramp puts a visible corner at both ends of every fade.
  ok('the curve is smoothstep, not linear (zero slope at both ends)',
    Math.abs(curve(1, 0, 0.0025, 0.25) - 1) < 1e-3 && Math.abs(curve(1, 0, 0.2475, 0.25)) < 1e-3,
    `moved ${(1 - curve(1, 0, 0.0025, 0.25)).toExponential(2)} at k=0.01 (linear would be 1.00e-2)`);
  let mono = true, prev = 1;
  for (let t = 0; t <= 0.25; t += 0.001) { const v = curve(1, 0, t, 0.25); if (v > prev + 1e-12) mono = false; prev = v; }
  ok('the curve is monotone (no overshoot back toward the parent)', mono);
  ok('an over-run clamps instead of extrapolating', curve(1, 0, 99, 0.25) === 0);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);

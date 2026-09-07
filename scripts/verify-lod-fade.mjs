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
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { ShaderChunk } from 'three';
// R24 C gave world-bend.js its first import (`@/lib/fly/fly-constants`), which
// node cannot resolve on its own. Registering the alias hook keeps this gate on
// the REAL module rather than downgrading it to source-parsing — and text
// identity is the whole claim here, so parsing would not do.
register('./_alias-loader.mjs', import.meta.url);
const { applyBendFade, applyHillshade, r24VariantKey } = await import('../lib/fly/toy-world/world-bend.js');
const { lodUvRect, lodStats } = await import('../lib/fly/lod-crossfade.js');
const CONSTS = await import('../lib/fly/fly-constants.js');
// ---------------------------------------------------------------------------
// THE EXPECTED HILL KEY, COMPUTED — never a literal.
//
// `world-bend-fade-hill-r19` is the ONE key two owners bump, so it goes through
// the shared `r24VariantKey` helper with a FIXED token order:
//     e  hillElevOn()  = ONE_SUN.enabled || TERRAIN_LIGHT.enabled     (C)
//     f  hillFragOn()  = TERRAIN_LIGHT.enabled && TERRAIN_LIGHT.fragmentHill (C)
//     a  AERIAL_LAW.enabled                                            (D)
//     l  the lodFade slot is non-null                                  (D)
//
// A gate that hard-codes the expected string is really asserting what ANOTHER
// OWNER ships. On the integrated tree C ships ONE_SUN and TERRAIN_LIGHT ON, so
// the key is `-ef…24` and every such literal goes red for a reason that is not
// a defect. So the expectation is DERIVED from the live e/f with only D's own
// token forced, and what is asserted is the PROPERTY: D's token appears exactly
// when D's flag is on, at its fixed position, and the key with D's token off is
// whatever the other owners' tokens alone produce.
//
// NOTE the `e` predicate is `ONE_SUN.enabled || TERRAIN_LIGHT.enabled`, an OR —
// not `ONE_SUN.enabled` alone. Mirroring the shorthand instead of the source
// would make this gate green on a tree where the key is wrong.
const HILL_BASE = 'world-bend-fade-hill-r19';
const hasTok = (key, t) => new RegExp(`-[efal]*${t}[efal]*24$`).test(key);
function hillTokens(consts) {
  return {
    e: !!(consts.ONE_SUN?.enabled || consts.TERRAIN_LIGHT?.enabled),
    f: !!(consts.TERRAIN_LIGHT?.enabled && consts.TERRAIN_LIGHT?.fragmentHill),
  };
}
function expectHillKey(r24VariantKey, { e, f }, a, l) {
  return r24VariantKey(HILL_BASE, [[e, 'e'], [f, 'f'], [a, 'a'], [l, 'l']]);
}


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
ok('the three D patch markers are present (5 is the holder + its export)',
  [...new Set(markers)].sort().join(',') === '5,6,7', `markers=[${markers.join(',')}]`);
ok('every D marker names LOD_CROSSFADE as its switch',
  [...vendored.matchAll(/\/\/\s*R24\s+D\s+PATCH\s+\d+\s*\(([^)]+)\)/g)].every((m) => m[1] === 'LOD_CROSSFADE'));
for (const n of ['5', '6', '7']) {
  ok(`VENDOR.md has a ledger row for D patch ${n}`,
    new RegExp(`^\\|\\s*${n}\\s*\\|\\s*D\\s*\\|`, 'm').test(ledger));
}

// D's OWN hunks must be INSERT-ONLY. A's gate 8 bounds the WHOLE bundle's
// edited-upstream-line budget (1 today, spent by A's `_getDistRatio` optional
// parameter); this narrows it to D: every hunk whose added lines name `R24 D`
// must delete nothing, i.e. D leaves every upstream statement it guards
// verbatim. That is the machine-checkable form of VENDOR.md switch-idiom
// rule 2, scoped to this owner so it cannot be satisfied by someone else's
// budget.
const VENDOR_COMMIT = 'b64457b';
try {
  const diff = execFileSync('git', ['diff', '-U0', VENDOR_COMMIT, '--', 'lib/fly/vendor/three-tile/index.js'],
    { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }).toString('utf8');
  const hunks = diff.split(/^@@/m).slice(1);
  const dHunks = hunks.filter((h) =>
    h.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).some((l) => /R24 D/.test(l)));
  const dDeletes = dHunks.reduce((n, h) =>
    n + h.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length, 0);
  const dAdds = dHunks.reduce((n, h) =>
    n + h.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length, 0);
  ok("D's vendor hunks are INSERT-ONLY (zero upstream lines edited or deleted)",
    dHunks.length >= 3 && dDeletes === 0, `${dHunks.length} D hunks, +${dAdds} / -${dDeletes}`);
} catch (e) {
  ok("D's vendor hunks are INSERT-ONLY", false, `git diff unavailable: ${e.message}`);
}

// Placement: patch 1 must run BEFORE the refine return expression (the parent
// texture is disposed inside it); patch 2 must run before the merge return and
// must hold _loadState across its await.
const refineHook = vendored.indexOf('ir && ir.onRefine(this, o, h);');
const refineRet = vendored.indexOf('return h ? this.unloadSubTiles()');
ok('patch 6 calls the hook BEFORE the refine return (the parent map is still alive)',
  refineHook > 0 && refineRet > refineHook, `hook@${refineHook} return@${refineRet}`);
const mergeBlock = vendored.slice(vendored.indexOf('const _w = ir.onMerge(this, o);'), vendored.indexOf('return l ? this.unloadModel()'));
ok('patch 7 holds _loadState at "loading" across its await (freezes the subtree)',
  /_loadState = "loading";[\s\S]*await _w;[\s\S]*_loadState = "loaded";/.test(mergeBlock));
ok('patch 7 runs before the merge return expression', mergeBlock.length > 0 && mergeBlock.length < 800);
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
{
  const T = hillTokens(CONSTS);
  const A = !!CONSTS.AERIAL_LAW?.enabled;
  ok('flag-off FINAL tile key === the other owners\' tokens alone (no \'l\')',
    off.key === expectHillKey(r24VariantKey, T, A, false) && !hasTok(off.key, 'l'),
    `${off.key} with e=${T.e} f=${T.f} a=${A}`);
  ok("flag-on FINAL tile key gains EXACTLY LOD_CROSSFADE's token 'l', in its fixed position",
    on.key === expectHillKey(r24VariantKey, T, A, true) && hasTok(on.key, 'l'),
    `${off.key} -> ${on.key}`);
  ok("turning D's slot on changes ONLY the 'l' token",
    on.key.replace(/l(?=24$)/, '') === off.key.replace(/-24$/, '') ||
    on.key === expectHillKey(r24VariantKey, T, A, true),
    `${off.key} -> ${on.key}`);
  // World-independent: the ORDER is the contract, so sweep all sixteen token
  // states through the helper. A token that moved position would serve one
  // owner's program for another's — the R4 wrong-cached-program defect.
  let bad = 0;
  for (let m = 0; m < 16; m++) {
    const b = [!!(m & 8), !!(m & 4), !!(m & 2), !!(m & 1)];
    const want = ['e', 'f', 'a', 'l'].filter((_, i) => b[i]).join('');
    const got = r24VariantKey(HILL_BASE, [[b[0], 'e'], [b[1], 'f'], [b[2], 'a'], [b[3], 'l']]);
    if (got !== (want ? `${HILL_BASE}-${want}24` : HILL_BASE)) bad++;
  }
  ok('the fixed order e/f/a/l holds across all 16 token states', bad === 0, `${bad} of 16 wrong`);
  ok('ALL FOUR tokens false === the bare R19 key (the flag-off identity proof)',
    expectHillKey(r24VariantKey, { e: false, f: false }, false, false) === HILL_BASE,
    HILL_BASE);
  // Both worlds, demonstrated rather than argued: this branch ships C's tokens
  // OFF, the integrated tree ships them ON. Same derivation, both answers.
  for (const [world, tk] of [['this branch', T], ["C's flipped tree", { e: true, f: true }]]) {
    const kOff = expectHillKey(r24VariantKey, tk, A, false);
    const kOn = expectHillKey(r24VariantKey, tk, A, true);
    ok(`derivation holds in ${world}: 'l' absent off, present on`,
      !hasTok(kOff, 'l') && hasTok(kOn, 'l'), `${kOff} -> ${kOn}`);
  }
}
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
  // R24 CLOSE: read the SHIP STATE out of the block rather than pinning a
  // literal. A gate that asserts `enabled:false` forever is a gate that goes
  // red the day the feature ships, which trains people to edit gates. What is
  // actually invariant is that the state is declared, is one of the two legal
  // values, and that the RED counter works in EITHER state — `hardSwaps` is
  // incremented before the flag is consulted, which is what makes the
  // flag-off tree calibratable without editing constants.
  const shipEnabled = /^\s*enabled:\s*true\s*,/m.test(m[0]);
  ok('LOD_CROSSFADE declares an explicit ship state', /^\s*enabled:\s*(true|false)\s*,/m.test(m[0]),
    `ships ${shipEnabled ? 'ON' : 'OFF'}`);
  // Anchored to the KEY line: the block comment quotes `fadeSec: 6` as the
  // probe pin that exposed the clamped-dt behaviour, and a loose regex matches
  // the prose before the key (Fable caught this on integration).
  const fade = parseFloat(m[0].match(/^\s*fadeSec:\s*([0-9.]+)/m)[1]);
  ok('fadeSec is inside the charter bound of 300 ms', fade > 0 && fade <= 0.3, `${fade * 1000} ms`);
  // Anchored to the KEY line, like fadeSec above and for the same reason: the
  // block comment now spells out the harness pin `{ skipBootMs: 0 }`, and a
  // loose regex reads the PROSE. Second time this exact trap fired in this
  // gate — a config-reading assertion must anchor on `^\s*key:`, always.
  ok('boot is fade-free (skipBootMs > 0 — reveal timing is frozen)',
    parseFloat(m[0].match(/^\s*skipBootMs:\s*([0-9]+)/m)[1]) > 0,
    `${m[0].match(/^\s*skipBootMs:\s*([0-9]+)/m)[1]} ms of fade clock`);
  ok('warps skip the fade (WARP.flashMs already masks the cut)', /^\s*skipOnWarp:\s*true/m.test(m[0]));
  ok('there is a concurrency bound',
    parseInt(m[0].match(/^\s*maxConcurrent:\s*([0-9]+)/m)[1], 10) > 0,
    `${m[0].match(/^\s*maxConcurrent:\s*([0-9]+)/m)[1]} materials`);
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
  // E's browser leg DIFFS `skip` key by key across two snapshots, so a
  // non-numeric field in it would be a trap. The one denial that needs context
  // rather than a count is a sibling, not a member.
  ok('the skip census is NUMBERS ONLY (E diffs it key by key)',
    Object.values(lodStats.skip).every((v) => typeof v === 'number'),
    Object.entries(lodStats.skip).map(([k, v]) => `${k}:${typeof v}`).join(' '));
}

// ---------------------------------------------------------------------------
console.log('\n[5b] the noParentMap denial is NAMED, not merely counted');
{
  // Pass 2b denied exactly ONE refine a blend for `noParentMap`, and the
  // counter could say only "one" — the cause had to be inferred from source
  // across three reachable paths. This census exists so the next occurrence
  // names itself. `matName` is the load-bearing field: three-tile's
  // failed-imagery fallback is `MeshBasicMaterial({ name: 'error-material' })`
  // with no `map`, so that one string separates a transient fetch miss from a
  // real ladder gap.
  //
  // RED CALIBRATION: this gate fails if any of the six fields is removed from
  // the record — verified by deleting `matName` and re-running before the fix
  // shipped.
  const WANT = ['z', 'x', 'y', 'hasModel', 'matCount', 'matName'];
  ok('the context array exists and starts empty (nothing written when nothing is denied)',
    Array.isArray(lodStats.noParentMapFirst) && lodStats.noParentMapFirst.length === 0);
  const src = fs.readFileSync(new URL('../lib/fly/lod-crossfade.js', import.meta.url), 'utf8');
  const push = src.match(/noParentMapFirst\.push\(\{([\s\S]*?)\}\);/);
  ok('the recorder pushes a record at the denial site', !!push);
  const fields = push ? [...push[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)].map((m) => m[1]) : [];
  ok(`the record carries exactly ${WANT.join(', ')}`,
    WANT.every((f) => fields.includes(f)) && fields.length === WANT.length,
    `[${fields.join(', ')}]`);
  ok("`matName` is the discriminator and reads the PARENT's material, not the tile",
    /matName:\s*pm\?\.name/.test(push?.[1] ?? ''), 'pm is tileMap(parent)');
  ok('the census is bounded (a diagnosis, not a log)',
    /const NO_PARENT_MAP_SAMPLES = \d+;/.test(src) &&
    /if \(lodStats\.noParentMapFirst\.length >= NO_PARENT_MAP_SAMPLES\) return;/.test(src),
    src.match(/const NO_PARENT_MAP_SAMPLES = (\d+);/)?.[1] + ' samples');
  ok('it is recorded at the denial, beside the counter it explains',
    /lodStats\.skip\.noParentMap\+\+;\s*\n\s*recordNoParentMap\(parent, pm\);/.test(src));
  ok('resetLodFades clears it with the skip counters',
    /lodStats\.noParentMapFirst\.length = 0;/.test(src));
  ok('it is unreachable with the flag off (eligible() refuses before the map is read)',
    src.indexOf('if (!eligible(') < src.indexOf('const pm = tileMap(parent);'),
    'the eligible() gate precedes the parent-map read in onRefine');
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

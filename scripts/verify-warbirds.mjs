/**
 * R14 "AirVenture" — deterministic warbird dataset audit (node, NO browser,
 * NO deps). Mirrors the style of scripts/gen-credits.mjs / inspect-glb.mjs:
 * lib/warbirds.js is dynamically imported (it is zero-import ESM); every other
 * file is SOURCE-PARSED as text so the gate proves the checked-in reality, not
 * a re-derived model.
 *
 * Gates (each prints PASS/FAIL; any FAIL → exit 1):
 *   a. exports consistent — 170 keys × 3, identical key sets, code shape,
 *      archetype value domain.
 *   b. no exact collision with the modern-code space (rarity substring table,
 *      names DB present-once, WIDEBODY_TYPES, SPICY.gaTypes).
 *   c. worker inline WARBIRD_ARCHETYPE ≡ canonical; worker FLY_ARCHETYPES is
 *      the 9 base + 4 new in exact order.
 *   d. cross-file archetype arity — TRAFFIC_MODELS === 13 === geometry entries.
 *   e. tier bands hold — base+bonus ≤ 97, every score in a valid band;
 *      histogram reported.
 *   f. rarity behaviour — OLD substring-only === NEW exact-first for the modern
 *      corpus (proves zero modern-fleet change); B29 exact ≠ B29-via-substring
 *      (proves the short-circuit is load-bearing).
 *
 * Usage: node scripts/verify-warbirds.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

let fails = 0;
const gate = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
};

const CODE_RE = /^[A-Z0-9]{2,4}$/;
const ALLOWED_ARCH = new Set([
  'warbird-prop', 'warbird-jet', 'warbird-heavy', 'classic-transport',
  'prop', 'jet', 'helicopter',
]);
const BASE_MAP = {
  'warbird-prop': 45, 'warbird-jet': 45, 'warbird-heavy': 50,
  'classic-transport': 40, prop: 0, jet: 0, helicopter: 30,
};

// --- source-parse helpers ---------------------------------------------------

// Strip // line comments and /* */ block comments (dataset files use only line
// comments, but be defensive). String literals in these files never contain
// "//" so this is safe for the scoped slices we hand it.
function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

// Slice the body of a named object literal `NAME = { ... }` (brace-balanced).
function objectBody(src, name) {
  const m = new RegExp(`${name}\\s*=\\s*\\{`).exec(src);
  if (!m) throw new Error(`object ${name} not found`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
  }
  return src.slice(start, i - 1);
}

// Slice the body of a named array literal `NAME = [ ... ]` (bracket-balanced).
function arrayBody(src, opener) {
  const m = new RegExp(opener).exec(src);
  if (!m) throw new Error(`array ${opener} not found`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    const c = src[i];
    if (c === '[') depth++;
    else if (c === ']') depth--;
  }
  return src.slice(start, i - 1);
}

// Count top-level elements of an (comment-stripped) array body by depth-0 commas.
function arrayElementCount(body) {
  const clean = stripComments(body);
  let depth = 0;
  const segs = [];
  let cur = '';
  for (const c of clean) {
    if (c === '{' || c === '[' || c === '(') depth++;
    else if (c === '}' || c === ']' || c === ')') depth--;
    if (c === ',' && depth === 0) {
      segs.push(cur);
      cur = '';
    } else cur += c;
  }
  segs.push(cur);
  return segs.filter((s) => s.trim().length > 0).length;
}

// Parse `KEY: <number>` pairs from a comment-stripped object body. Keys may be
// quoted + hyphenated (e.g. 'warbird-prop'), so allow up to 24 chars.
function parseNumberMap(body) {
  const clean = stripComments(body);
  const out = {};
  const re = /(['"]?)([A-Za-z0-9_-]{1,24})\1\s*:\s*(\d+)/g;
  let m;
  while ((m = re.exec(clean)) !== null) out[m[2]] = Number(m[3]);
  return out;
}

// Parse `KEY: 'value'` string pairs from a comment-stripped object body.
function parseStringMap(body) {
  const clean = stripComments(body);
  const out = {};
  const re = /(['"]?)([A-Za-z0-9_-]{1,6})\1\s*:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(clean)) !== null) out[m[2]] = m[3];
  return out;
}

// Parse quoted string members from a comment-stripped array/Set body, in order.
function parseStringList(body) {
  const clean = stripComments(body);
  const out = [];
  const re = /'([^']+)'/g;
  let m;
  while ((m = re.exec(clean)) !== null) out.push(m[1]);
  return out;
}

const setsEqual = (a, b) => a.size === b.size && [...a].every((k) => b.has(k));

// ---------------------------------------------------------------------------
(async () => {
  const warbirds = await import(new URL('../lib/warbirds.js', import.meta.url));
  const { WARBIRD_TYPE_RARITY, WARBIRD_ARCHETYPE, WARBIRD_TYPES } = warbirds;

  const rarityKeys = Object.keys(WARBIRD_TYPE_RARITY);
  const archKeys = Object.keys(WARBIRD_ARCHETYPE);

  // === Gate a: exports consistent =========================================
  {
    const rSet = new Set(rarityKeys);
    const aSet = new Set(archKeys);
    const count170 =
      rarityKeys.length === 170 && archKeys.length === 170 && WARBIRD_TYPES.size === 170;
    gate('a1 three exports each hold 170 keys', count170,
      `rarity ${rarityKeys.length}, archetype ${archKeys.length}, types ${WARBIRD_TYPES.size}`);
    gate('a2 rarity/archetype key sets identical', setsEqual(rSet, aSet));
    gate('a3 WARBIRD_TYPES equals rarity key set',
      setsEqual(WARBIRD_TYPES, rSet));
    const badCodes = rarityKeys.filter((k) => !CODE_RE.test(k));
    gate('a4 every code matches ^[A-Z0-9]{2,4}$', badCodes.length === 0,
      badCodes.length ? `bad: ${badCodes.join(', ')}` : 'all valid');
    const badArch = archKeys.filter((k) => !ALLOWED_ARCH.has(WARBIRD_ARCHETYPE[k]));
    gate('a5 every archetype value in allowed set', badArch.length === 0,
      badArch.length ? `bad: ${badArch.map((k) => `${k}=${WARBIRD_ARCHETYPE[k]}`).join(', ')}` : 'all valid');
  }

  // === Gate b: no exact collision with modern-code space ===================
  {
    const raritySrc = read('lib/rarity.js');
    const typeBonus = parseNumberMap(objectBody(raritySrc, 'TYPE_RARITY_BONUS'));
    const modernBonusKeys = new Set(Object.keys(typeBonus));
    const clashBonus = rarityKeys.filter((k) => modernBonusKeys.has(k));
    gate('b1 no warbird key ∈ TYPE_RARITY_BONUS keys', clashBonus.length === 0,
      clashBonus.length ? `clash: ${clashBonus.join(', ')}` : 'disjoint');

    // Names DB: every warbird key present EXACTLY once as an object key.
    const namesSrc = read('lib/aircraft-type-names.js');
    const namesBody = objectBody(namesSrc, 'AIRCRAFT_TYPE_NAMES');
    const nameKeyCounts = {};
    {
      const clean = stripComments(namesBody);
      const re = /(?:^|[\{,])\s*([A-Z0-9]{2,4})\s*:\s*['"]/gm;
      let m;
      while ((m = re.exec(clean)) !== null)
        nameKeyCounts[m[1]] = (nameKeyCounts[m[1]] || 0) + 1;
    }
    const missingName = rarityKeys.filter((k) => !nameKeyCounts[k]);
    const dupName = rarityKeys.filter((k) => (nameKeyCounts[k] || 0) > 1);
    gate('b2 every warbird key named exactly once',
      missingName.length === 0 && dupName.length === 0,
      `missing ${missingName.length ? missingName.join(',') : 'none'}; dup ${dupName.length ? dupName.join(',') : 'none'}`);

    // WIDEBODY_TYPES
    const contractsSrc = read('lib/fly/contracts.js');
    const widebody = new Set(parseStringList(arrayBody(contractsSrc, 'WIDEBODY_TYPES\\s*=\\s*new Set\\(\\[')));
    const clashWide = rarityKeys.filter((k) => widebody.has(k));
    gate('b3 no warbird key ∈ WIDEBODY_TYPES', clashWide.length === 0,
      clashWide.length ? `clash: ${clashWide.join(', ')}` : `disjoint (${widebody.size} widebody codes)`);

    // SPICY.gaTypes
    const constSrc = read('lib/fly/fly-constants.js');
    const gaTypes = new Set(parseStringList(arrayBody(constSrc, 'gaTypes\\s*:\\s*\\[')));
    const clashGa = rarityKeys.filter((k) => gaTypes.has(k));
    gate('b4 no warbird key ∈ SPICY.gaTypes', clashGa.length === 0,
      clashGa.length ? `clash: ${clashGa.join(', ')}` : `disjoint (${gaTypes.size} gaTypes)`);
  }

  // === Gate c: worker sync =================================================
  {
    const workerSrc = read('lib/workers/aircraft-processor.worker.js');
    const inlineArch = parseStringMap(objectBody(workerSrc, 'WARBIRD_ARCHETYPE'));
    const inlineKeys = Object.keys(inlineArch);
    let mismatch = [];
    for (const k of new Set([...archKeys, ...inlineKeys])) {
      if (WARBIRD_ARCHETYPE[k] !== inlineArch[k])
        mismatch.push(`${k}(canon=${WARBIRD_ARCHETYPE[k] ?? '∅'}/worker=${inlineArch[k] ?? '∅'})`);
    }
    gate('c1 worker WARBIRD_ARCHETYPE ≡ canonical (170 pairs)',
      inlineKeys.length === 170 && mismatch.length === 0,
      mismatch.length ? mismatch.slice(0, 6).join(', ') : `${inlineKeys.length} pairs identical`);

    const flyArch = parseStringList(arrayBody(workerSrc, 'FLY_ARCHETYPES\\s*=\\s*\\['));
    const expected = [
      'airliner', 'jet', 'prop', 'helicopter', 'military', 'cargo', 'glider',
      'drone', 'unknown', 'warbird-prop', 'warbird-jet', 'warbird-heavy',
      'classic-transport',
    ];
    gate('c2 worker FLY_ARCHETYPES = 9 base + 4 new in order',
      flyArch.length === expected.length && flyArch.every((v, i) => v === expected[i]),
      `[${flyArch.join(', ')}]`);
  }

  // === Gate d: cross-file archetype arity =================================
  {
    const assetsSrc = read('lib/fly/assets.js');
    const trafficLen = arrayElementCount(arrayBody(assetsSrc, 'TRAFFIC_MODELS\\s*=\\s*\\['));
    const geomSrc = read('lib/fly/traffic-geometries.js');
    const geomLen = arrayElementCount(arrayBody(geomSrc, 'buildArchetypeGeometries\\(\\)\\s*\\{\\s*return\\s*\\['));
    gate('d1 TRAFFIC_MODELS length === 13', trafficLen === 13, `got ${trafficLen}`);
    gate('d2 buildArchetypeGeometries entries === 13', geomLen === 13, `got ${geomLen}`);
    gate('d3 arity aligned (13 === 13)', trafficLen === 13 && geomLen === 13);
  }

  // === Gate e: tier bands =================================================
  {
    // cross-check the hard-coded base map against source CLASSIFICATION_RARITY
    const raritySrc = read('lib/rarity.js');
    const classBase = parseNumberMap(objectBody(raritySrc, 'CLASSIFICATION_RARITY'));
    const baseOk = ['warbird-prop', 'warbird-jet', 'warbird-heavy', 'classic-transport', 'helicopter']
      .every((a) => classBase[a] === BASE_MAP[a]) &&
      classBase.prop === undefined && classBase.jet === undefined; // prop/jet fall to || 0
    gate('e0 base map matches CLASSIFICATION_RARITY (prop/jet → 0)', baseOk,
      `wp=${classBase['warbird-prop']} wj=${classBase['warbird-jet']} wh=${classBase['warbird-heavy']} ct=${classBase['classic-transport']} heli=${classBase.helicopter} prop=${classBase.prop} jet=${classBase.jet}`);

    const TIERS = [
      ['common', 0, 29], ['uncommon', 30, 49], ['rare', 50, 69],
      ['epic', 70, 84], ['legendary', 85, 94], ['mythic', 95, 100],
    ];
    const tierOf = (s) => (TIERS.find(([, lo, hi]) => s >= lo && s <= hi) || [null])[0];
    const hist = {};
    let over97 = [];
    let noBand = [];
    for (const k of rarityKeys) {
      const score = BASE_MAP[WARBIRD_ARCHETYPE[k]] + WARBIRD_TYPE_RARITY[k];
      if (score > 97) over97.push(`${k}=${score}`);
      const t = tierOf(score);
      if (!t) noBand.push(`${k}=${score}`);
      else hist[t] = (hist[t] || 0) + 1;
    }
    gate('e1 every base+bonus ≤ 97', over97.length === 0,
      over97.length ? over97.join(', ') : 'max ≤ 97');
    gate('e2 every score lands in a valid band', noBand.length === 0,
      noBand.length ? noBand.join(', ') : 'all banded');
    const order = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    console.log('     tier histogram: ' + order.map((t) => `${t} ${hist[t] || 0}`).join(' | '));
  }

  // === Gate f: rarity behaviour simulation ================================
  {
    const raritySrc = read('lib/rarity.js');
    const typeBonus = parseNumberMap(objectBody(raritySrc, 'TYPE_RARITY_BONUS'));
    // OLD: substring-only sum over TYPE_RARITY_BONUS (pre-R14 behaviour).
    const oldScore = (code) => {
      let r = 0;
      for (const [pat, bonus] of Object.entries(typeBonus)) if (code.includes(pat)) r += bonus;
      return r;
    };
    // NEW: exact warbird lookup first (short-circuit), else the substring loop.
    const newScore = (code) =>
      WARBIRD_TYPE_RARITY[code] !== undefined ? WARBIRD_TYPE_RARITY[code] : oldScore(code);

    const corpus = [
      'A320', 'B738', 'B744', 'B748', 'A388', 'F16', 'C130', 'MD11', 'DC10',
      'C560', 'KC135', 'TBM9', 'B06', 'H60', ...Object.keys(typeBonus),
    ];
    const diverged = corpus.filter((c) => oldScore(c) !== newScore(c));
    gate('f1 OLD===NEW for every modern code (zero fleet change)',
      diverged.length === 0,
      diverged.length ? diverged.map((c) => `${c}:${oldScore(c)}≠${newScore(c)}`).join(', ')
        : `${corpus.length} codes identical`);

    const b29Exact = WARBIRD_TYPE_RARITY.B29;
    const b29Sub = oldScore('B29');
    gate('f2 B29 exact ≠ B29-via-substring (short-circuit is load-bearing)',
      b29Exact !== b29Sub && b29Exact !== undefined,
      `exact ${b29Exact} vs substring ${b29Sub} (matches ${Object.keys(typeBonus).filter((p) => 'B29'.includes(p)).join('+') || 'none'})`);
  }

  console.log(fails ? `\nVERIFY: FAIL (${fails} gate${fails > 1 ? 's' : ''})` : '\nVERIFY: PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});

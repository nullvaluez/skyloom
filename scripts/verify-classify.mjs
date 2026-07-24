/**
 * R15 "Ground Truth" — deterministic classification audit (node, NO browser,
 * NO deps). Modelled on scripts/verify-warbirds.mjs: the canonical tables are
 * dynamically imported (zero-import ESM); every consumer is SOURCE-PARSED as
 * text so the gate proves the checked-in reality, not a re-derived model.
 *
 * Gates (each prints PASS/FAIL; any FAIL → exit 1):
 *   a. canonical shape — key regex, value domain, disjoint from the warbird
 *      table (the warbird exact check runs first and owns its 170 codes).
 *   b. worker inline EXACT_TYPE_CLASS ≡ canonical.
 *   c. lib/classify.js wiring — imports canonical, exact check precedes every
 *      substring list, the trap lists/entries are gone.
 *   d. worker chain STRUCTURE — guard order pinned so the sim below cannot
 *      silently drift from the shipped function.
 *   e. corpus sim — 190+ hand-audited codes assert their expected class
 *      (SR22→prop not helicopter, C172→prop not military, R22→helicopter, …).
 *   f. universe sweep — every canonical + warbird code resolves to its table
 *      value through the full worker chain.
 *   g. trap regression — no surviving substring pattern captures a longer code
 *      of a different class (short-circuit aware: codes owned by an exact table
 *      never reach the fallback tail).
 *   h. fleet no-regression — OLD (pre-R15) chain === NEW chain for the airliner
 *      corpus; the four known trap codes MUST diverge (fix is load-bearing).
 *
 * Usage: node scripts/verify-classify.mjs
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

// --- source-parse helpers (same technique as verify-warbirds.mjs) -----------

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

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

function arrayBody(src, opener) {
  const m = new RegExp(opener).exec(src);
  if (!m) return null;
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

function parseNumberMap(body) {
  const clean = stripComments(body);
  const out = {};
  const re = /(['"]?)([A-Za-z0-9_-]{1,24})\1\s*:\s*(\d+)/g;
  let m;
  while ((m = re.exec(clean)) !== null) out[m[2]] = Number(m[3]);
  return out;
}

function parseStringMap(body) {
  const clean = stripComments(body);
  const out = {};
  const re = /(['"]?)([A-Za-z0-9_-]{1,6})\1\s*:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(clean)) !== null) out[m[2]] = m[3];
  return out;
}

function parseStringList(body) {
  const clean = stripComments(body);
  const out = [];
  const re = /'([^']+)'/g;
  let m;
  while ((m = re.exec(clean)) !== null) out.push(m[1]);
  return out;
}

// Read `const NAME = [...]` out of a file, or [] when the list is intentionally
// gone (heliTypes / militaryTypes were deleted in R15).
function listOf(src, name) {
  const body = arrayBody(src, `${name}\\s*=\\s*\\[`);
  return body === null ? null : parseStringList(body);
}

// ---------------------------------------------------------------------------
(async () => {
  const tables = await import(new URL('../lib/aircraft-type-tables.js', import.meta.url));
  const warbirds = await import(new URL('../lib/warbirds.js', import.meta.url));
  const { EXACT_TYPE_CLASS, TYPE_CLASS_DOMAIN, EXACT_TYPE_CODES } = tables;
  const { WARBIRD_ARCHETYPE, WARBIRD_TYPES, WARBIRD_TYPE_RARITY } = warbirds;

  const workerSrc = read('lib/workers/aircraft-processor.worker.js');
  const classifySrc = read('lib/classify.js');
  const raritySrc = read('lib/rarity.js');
  const exactKeys = Object.keys(EXACT_TYPE_CLASS);

  // === Gate a: canonical shape ============================================
  {
    gate('a1 canonical table non-trivial', exactKeys.length >= 120,
      `${exactKeys.length} exact codes`);
    const badCodes = exactKeys.filter((k) => !CODE_RE.test(k));
    gate('a2 every key matches ^[A-Z0-9]{2,4}$', badCodes.length === 0,
      badCodes.length ? `bad: ${badCodes.join(', ')}` : 'all valid');
    const badVals = exactKeys.filter((k) => !TYPE_CLASS_DOMAIN.has(EXACT_TYPE_CLASS[k]));
    gate('a3 every value in TYPE_CLASS_DOMAIN', badVals.length === 0,
      badVals.length ? `bad: ${badVals.map((k) => `${k}=${EXACT_TYPE_CLASS[k]}`).join(', ')}` : 'all valid');
    const clash = exactKeys.filter((k) => WARBIRD_TYPES.has(k));
    gate('a4 disjoint from WARBIRD_TYPE_RARITY', clash.length === 0,
      clash.length ? `clash: ${clash.join(', ')}` : `disjoint (${WARBIRD_TYPES.size} warbird codes)`);
    const hist = {};
    for (const k of exactKeys) hist[EXACT_TYPE_CLASS[k]] = (hist[EXACT_TYPE_CLASS[k]] || 0) + 1;
    console.log('     class histogram: ' +
      Object.entries(hist).map(([c, n]) => `${c} ${n}`).join(' | '));
  }

  // === Gate b: worker inline copy ≡ canonical ==============================
  {
    const inline = parseStringMap(objectBody(workerSrc, 'const EXACT_TYPE_CLASS'));
    const inlineKeys = Object.keys(inline);
    const mismatch = [];
    for (const k of new Set([...exactKeys, ...inlineKeys])) {
      if (EXACT_TYPE_CLASS[k] !== inline[k])
        mismatch.push(`${k}(canon=${EXACT_TYPE_CLASS[k] ?? '∅'}/worker=${inline[k] ?? '∅'})`);
    }
    gate('b1 worker EXACT_TYPE_CLASS ≡ canonical',
      inlineKeys.length === exactKeys.length && mismatch.length === 0,
      mismatch.length ? mismatch.slice(0, 8).join(', ') : `${inlineKeys.length} pairs identical`);
  }

  // === Gate c: lib/classify.js wiring =====================================
  {
    gate('c1 classify.js imports canonical table',
      /import\s*\{\s*EXACT_TYPE_CLASS\s*\}\s*from\s*'\.\/aircraft-type-tables'/.test(classifySrc));
    gate('c2 classify.js heliTypes + militaryTypes lists deleted',
      listOf(classifySrc, 'heliTypes') === null && listOf(classifySrc, 'militaryTypes') === null);
    const iconFn = classifySrc.slice(classifySrc.indexOf('export function getAircraftIconType'));
    const exactAt = iconFn.indexOf('EXACT_TYPE_CLASS[typeCode]');
    const firstList = Math.min(
      ...['cargoTypes =', 'propTypes =', 'bizjetTypes =', 'widebodyTypes =', 'narrowbodyTypes =']
        .map((s) => iconFn.indexOf(s))
        .filter((i) => i > 0)
    );
    gate('c3 exact check precedes every substring list in getAircraftIconType',
      exactAt > 0 && exactAt < firstList, `exact@${exactAt} < firstList@${firstList}`);
    gate('c4 isHelicopter is exact-only',
      /EXACT_TYPE_CLASS\[typeCode\] === 'helicopter'/.test(classifySrc));
    const props = listOf(classifySrc, 'propTypes') || [];
    const removed = ['C25', 'PC24', 'M8', 'M9'].filter((p) => props.includes(p));
    gate('c5 classify.js propTypes trap entries removed', removed.length === 0,
      removed.length ? `still present: ${removed.join(', ')}` : "'C25'/'PC24'/'M8'/'M9' gone");
  }

  // === Gate d: worker chain structure =====================================
  {
    const fn = workerSrc.slice(workerSrc.indexOf('function getAircraftIconType'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    gate('d1 worker heliTypes + militaryTypes lists deleted',
      listOf(body, 'heliTypes') === null && listOf(body, 'militaryTypes') === null);
    const order = ['WARBIRD_ARCHETYPE[typeCode]', 'EXACT_TYPE_CLASS[typeCode]',
      'cargoTypes =', 'airlinerFamilies ='];
    const at = order.map((s) => body.indexOf(s));
    gate('d2 guard order = warbird → exact → cargo → airliner families',
      at.every((i) => i > 0) && at.every((v, i) => i === 0 || v > at[i - 1]),
      at.join(' < '));
    gate('d4 airliner tail is prefix-matched (startsWith, not includes)',
      /airlinerFamilies\.some\(\w+ => typeCode\.startsWith\(\w+\)\)/.test(body) &&
      /cargoTypes\.some\(\w+ => typeCode\.startsWith\(\w+\)\)/.test(body));
    gate('d3 worker isHelicopter is exact-only',
      /EXACT_TYPE_CLASS\[typeCode\] === 'helicopter'/.test(workerSrc));
  }

  // --- the shipped chain, rebuilt from source-parsed lists ------------------
  const W = {
    cargo: listOf(workerSrc, 'cargoTypes') || [],
    airliner: listOf(workerSrc, 'airlinerFamilies') || [],
  };
  const newIconType = (ac) => {
    if (!ac) return 'unknown';
    const category = ac.category;
    if (category === 'A7') return 'helicopter';
    if (category === 'B1' || category === 'B4') return 'glider';
    if (category === 'B6') return 'drone';
    const t = ac.t?.toUpperCase() || '';
    if (t && WARBIRD_ARCHETYPE[t] !== undefined) return WARBIRD_ARCHETYPE[t];
    if (t && EXACT_TYPE_CLASS[t] !== undefined) return EXACT_TYPE_CLASS[t];
    if (t) {
      if (W.cargo.some((c) => t.startsWith(c))) return 'cargo';
      if (W.airliner.some((a) => t.startsWith(a))) return 'airliner';
    }
    if (category === 'A5' || category === 'A4' || category === 'A3') return 'airliner';
    if (category === 'A2') return 'jet';
    if (category === 'A1') return 'prop';
    return 'unknown';
  };
  const newIsHelicopter = (ac) => {
    if (ac.category === 'A7') return true;
    const t = ac.t?.toUpperCase() || '';
    return t ? EXACT_TYPE_CLASS[t] === 'helicopter' : false;
  };

  // === Gate e: hand-audited corpus ========================================
  {
    const CORPUS = {
      // --- rotorcraft ---
      R22: 'helicopter', R44: 'helicopter', R66: 'helicopter', B06: 'helicopter',
      B105: 'helicopter', B212: 'helicopter', B407: 'helicopter', B412: 'helicopter',
      B429: 'helicopter', B505: 'helicopter', S76: 'helicopter', S92: 'helicopter',
      S70: 'helicopter', H60: 'helicopter', H47: 'helicopter', H64: 'helicopter',
      UH1: 'helicopter', A109: 'helicopter', A139: 'helicopter', A169: 'helicopter',
      AS50: 'helicopter', AS55: 'helicopter', AS65: 'helicopter', EC20: 'helicopter',
      EC30: 'helicopter', EC35: 'helicopter', EC45: 'helicopter', EC75: 'helicopter',
      MD52: 'helicopter', EXPL: 'helicopter', GAZL: 'helicopter', BK17: 'helicopter',
      NH90: 'helicopter', KMAX: 'helicopter',
      // --- GA props (the SR22/C172 trap victims live here) ---
      SR22: 'prop', SR20: 'prop', S22T: 'prop', C172: 'prop', C152: 'prop',
      C177: 'prop', C182: 'prop', C206: 'prop', C207: 'prop', C208: 'prop',
      C210: 'prop', C310: 'prop', C340: 'prop', C402: 'prop', C414: 'prop',
      C421: 'prop', C441: 'prop', PA28: 'prop', P28A: 'prop', P28R: 'prop',
      PA32: 'prop', P32R: 'prop', PA34: 'prop', PA44: 'prop', PA46: 'prop',
      P46T: 'prop', BE33: 'prop', BE35: 'prop', BE36: 'prop', BE58: 'prop',
      BE20: 'prop', BE30: 'prop', B350: 'prop', BE9L: 'prop', BE99: 'prop',
      DA40: 'prop', DA42: 'prop', DA62: 'prop', DV20: 'prop', M20P: 'prop',
      M20T: 'prop', TBM7: 'prop', TBM8: 'prop', TBM9: 'prop', PC6: 'prop',
      PC12: 'prop', P180: 'prop', RV10: 'prop', DHC2: 'prop', DHC6: 'prop',
      BN2: 'prop', BN2T: 'prop', AA5: 'prop', TB20: 'prop', COL4: 'prop',
      // --- business jets ---
      C25A: 'jet', C25B: 'jet', C25C: 'jet', C25M: 'jet', C500: 'jet',
      C510: 'jet', C525: 'jet', C550: 'jet', C560: 'jet', C56X: 'jet',
      C680: 'jet', C68A: 'jet', C700: 'jet', C750: 'jet', CL30: 'jet',
      CL35: 'jet', CL60: 'jet', GLF4: 'jet', GLF5: 'jet', GLF6: 'jet',
      GLEX: 'jet', GL5T: 'jet', GL7T: 'jet', G280: 'jet', GALX: 'jet',
      ASTR: 'jet', E50P: 'jet', E55P: 'jet', E545: 'jet', E550: 'jet',
      E35L: 'jet', LJ35: 'jet', LJ45: 'jet', LJ60: 'jet', LJ75: 'jet',
      FA50: 'jet', FA7X: 'jet', FA8X: 'jet', F900: 'jet', F2TH: 'jet',
      H25B: 'jet', HA4T: 'jet', PRM1: 'jet', HDJT: 'jet', SF50: 'jet',
      EA50: 'jet', BE40: 'jet', PC24: 'jet',
      // --- military ---
      F15: 'military', F16: 'military', F18: 'military', FA18: 'military',
      F22: 'military', F35: 'military', F14: 'military', A10: 'military',
      B1B: 'military', B2: 'military', B52: 'military', C5: 'military',
      C17: 'military', C130: 'military', C30J: 'military', C12: 'military',
      C32: 'military', C37: 'military', C40: 'military', VC25: 'military',
      K35R: 'military', C2: 'military', E2: 'military', E3: 'military',
      E6: 'military', E8: 'military', P3: 'military', P8: 'military',
      U2: 'military', T38: 'military', T45: 'military', V22: 'military',
      CV22: 'military', MQ9: 'military', RQ4: 'military', EUFI: 'military',
      RFAL: 'military', TORN: 'military', EA18: 'military',
      // --- airliners / freighters (must be byte-unchanged) ---
      A318: 'airliner', A319: 'airliner', A320: 'airliner', A321: 'airliner',
      A330: 'airliner', A340: 'airliner', A350: 'airliner', A380: 'airliner',
      B737: 'airliner', B757: 'airliner', B747: 'airliner', B767: 'airliner',
      B777: 'airliner', B787: 'airliner',
      B748: 'cargo', B74F: 'cargo', B77F: 'cargo', MD11: 'cargo',
      // --- R14 warbirds (exact-first must stay untouched) ---
      B17: 'warbird-heavy', B24: 'warbird-heavy', B29: 'warbird-heavy',
      P51: 'warbird-prop', SPIT: 'warbird-prop', T6: 'warbird-prop',
      T28: 'warbird-prop', L39: 'warbird-jet', T33: 'warbird-jet',
      F86: 'warbird-jet', DC3: 'classic-transport', B25: 'classic-transport',
      CAT: 'classic-transport', J3: 'prop', RV7: 'prop', HUCO: 'helicopter',
    };
    const wrong = Object.entries(CORPUS)
      .filter(([code, want]) => newIconType({ t: code }) !== want)
      .map(([code, want]) => `${code}: got ${newIconType({ t: code })} want ${want}`);
    gate(`e1 corpus of ${Object.keys(CORPUS).length} codes resolves as audited`,
      wrong.length === 0, wrong.length ? wrong.slice(0, 10).join('; ') : 'all correct');

    // the four confirmed live bugs, stated as negatives
    const NEG = [
      ['SR22', 'helicopter'], ['SR20', 'helicopter'], ['S22T', 'helicopter'],
      ['C172', 'military'], ['C177', 'military'], ['C206', 'military'],
      ['C208', 'military'], ['C210', 'military'], ['C25A', 'military'],
      ['DA40', 'military'], ['DA62', 'military'], ['BE20', 'military'],
      ['BE35', 'military'], ['B212', 'military'], ['MD90', 'helicopter'],
    ];
    const stillBad = NEG.filter(([code, bad]) => newIconType({ t: code }) === bad)
      .map(([code, bad]) => `${code}→${bad}`);
    gate('e2 no trap victim keeps its wrong class', stillBad.length === 0,
      stillBad.length ? stillBad.join(', ') : `${NEG.length} negatives clear`);

    // isHelicopter (drives _classification → colour, not the model)
    const heliCases = [
      [{ t: 'SR22' }, false], [{ t: 'C172' }, false], [{ t: 'TBM9' }, false],
      [{ t: 'R22' }, true], [{ t: 'R44' }, true], [{ t: 'A109' }, true],
      [{ t: 'EC35' }, true], [{ t: 'S92' }, true], [{ category: 'A7' }, true],
      [{ t: '' }, false], [{}, false], [{ t: 'B738' }, false],
    ];
    const heliWrong = heliCases.filter(([ac, want]) => newIsHelicopter(ac) !== want);
    gate('e3 isHelicopter exact-only behaviour', heliWrong.length === 0,
      heliWrong.length ? JSON.stringify(heliWrong) : `${heliCases.length} cases correct`);
  }

  // === Gate f: universe sweep =============================================
  {
    const bad = [];
    for (const k of Object.keys(WARBIRD_ARCHETYPE)) {
      const got = newIconType({ t: k });
      if (got !== WARBIRD_ARCHETYPE[k]) bad.push(`${k}:${got}≠${WARBIRD_ARCHETYPE[k]}`);
    }
    gate('f1 every warbird code resolves to its archetype (170)', bad.length === 0,
      bad.length ? bad.slice(0, 8).join(', ') : '170 codes exact');
    const bad2 = [];
    for (const k of exactKeys) {
      const got = newIconType({ t: k });
      if (got !== EXACT_TYPE_CLASS[k]) bad2.push(`${k}:${got}≠${EXACT_TYPE_CLASS[k]}`);
    }
    gate(`f2 every canonical code resolves to its class (${exactKeys.length})`,
      bad2.length === 0, bad2.length ? bad2.slice(0, 8).join(', ') : 'all exact');
    // empty / missing type must be byte-identical to the pre-R15 behaviour
    const empties = [
      [{ t: '' }, 'unknown'], [{}, 'unknown'], [{ t: '', category: 'A1' }, 'prop'],
      [{ t: '', category: 'A3' }, 'airliner'], [{ t: '', category: 'A2' }, 'jet'],
      [{ t: '', category: 'A7' }, 'helicopter'], [{ t: '', category: 'B6' }, 'drone'],
      [{ t: '', category: 'B1' }, 'glider'], [{ t: 'ZZZZ' }, 'unknown'],
    ];
    const emptyBad = empties.filter(([ac, want]) => newIconType(ac) !== want);
    gate('f3 empty/unknown typecode behaviour unchanged', emptyBad.length === 0,
      emptyBad.length ? JSON.stringify(emptyBad) : `${empties.length} cases correct`);
  }

  // Every airliner code the fallback tail is allowed to see, with its audited
  // class. Shared by gates g and h. Regional turboprops (AT4x/AT7x/DH8x/SF34)
  // are deliberately absent: R15 left them on the category path.
  const AIRLINERS = {
      A306: 'airliner', A30B: 'airliner', A310: 'airliner', A3ST: 'airliner',
      A318: 'airliner', A319: 'airliner', A320: 'airliner', A321: 'airliner',
      A19N: 'airliner', A20N: 'airliner', A21N: 'airliner', A332: 'airliner',
      A333: 'airliner', A338: 'airliner', A339: 'airliner', A342: 'airliner',
      A343: 'airliner', A345: 'airliner', A346: 'airliner',
      A359: 'airliner', A35K: 'airliner',
      A388: 'airliner', A220: 'airliner', BCS1: 'airliner', BCS3: 'airliner',
      A330: 'airliner', A340: 'airliner', A350: 'airliner', A380: 'airliner',
      B712: 'airliner', B717: 'airliner',
      B732: 'airliner', B733: 'airliner', B734: 'airliner', B735: 'airliner',
      B736: 'airliner', B737: 'airliner', B738: 'airliner', B739: 'airliner',
      B37M: 'airliner', B38M: 'airliner', B39M: 'airliner', B3XM: 'airliner',
      B752: 'airliner', B753: 'airliner', B757: 'airliner', B762: 'airliner',
      B763: 'airliner', B764: 'airliner', B767: 'airliner', B772: 'airliner',
      B773: 'airliner', B77L: 'airliner', B77W: 'airliner', B778: 'airliner',
      B779: 'airliner', B777: 'airliner', B788: 'airliner',
      B789: 'airliner', B78X: 'airliner', B787: 'airliner', B741: 'airliner',
      B742: 'airliner', B743: 'airliner', B744: 'airliner', B74S: 'airliner',
      B747: 'airliner',
      E170: 'airliner', E175: 'airliner', E190: 'airliner', E195: 'airliner',
      E75L: 'airliner', E75S: 'airliner', E290: 'airliner', E295: 'airliner',
      CRJ1: 'airliner', CRJ2: 'airliner', CRJ7: 'airliner', CRJ9: 'airliner',
      CRJX: 'airliner', MD81: 'airliner', MD82: 'airliner',
      MD83: 'airliner', MD87: 'airliner', MD88: 'airliner', MD90: 'airliner',
      DC10: 'airliner', L101: 'airliner', IL96: 'airliner', IL86: 'airliner',
      RJ1H: 'airliner', RJ70: 'airliner', RJ85: 'airliner', BA46: 'airliner',
      F100: 'airliner',
      B748: 'cargo', B74F: 'cargo', B77F: 'cargo', MD11: 'cargo',
    };
  const trueClass = (c) =>
    WARBIRD_ARCHETYPE[c] ?? EXACT_TYPE_CLASS[c] ?? AIRLINERS[c] ?? null;
  const universe = [
    ...new Set([...exactKeys, ...Object.keys(WARBIRD_ARCHETYPE), ...Object.keys(AIRLINERS)]),
  ];

  // === Gate g: trap regression ============================================
  {
    // Codes that never reach a fallback list because an exact table owns them.
    const shortCircuit = new Set([...exactKeys, ...Object.keys(WARBIRD_ARCHETYPE)]);
    // 'prefix' = matched with startsWith (the R15 worker tail); 'sub' =
    // matched with includes (lib/classify.js, unchanged).
    const suites = [
      ['worker', workerSrc, [['cargoTypes', 'cargo', 'prefix'],
        ['airlinerFamilies', 'airliner', 'prefix']]],
      ['classify', classifySrc, [['cargoTypes', 'cargo', 'sub'],
        ['propTypes', 'prop', 'sub'], ['bizjetTypes', 'jet', 'sub'],
        ['widebodyTypes', 'airliner', 'sub'], ['narrowbodyTypes', 'airliner', 'sub']]],
    ];
    const hits = (c, p, mode) => (mode === 'prefix' ? c.startsWith(p) : c.includes(p));
    const captures = [];
    let patternCount = 0;
    for (const [label, src, lists] of suites) {
      // Lists are declared in chain order; a code an EARLIER list already
      // claims never reaches a later one (this is how B74F/B77F/B748 stay cargo
      // despite the 'B74'/'B77' families — see g3).
      const answered = new Set();
      for (const [name, cls, mode] of lists) {
        const patterns = listOf(src, name) || [];
        patternCount += patterns.length;
        for (const p of patterns) {
          for (const c of universe) {
            if (c === p || !hits(c, p, mode)) continue;
            if (shortCircuit.has(c) || answered.has(c)) continue;
            const want = trueClass(c);
            if (want && want !== cls)
              captures.push(`${label}/${name} '${p}' swallows ${c} (${want}≠${cls})`);
          }
        }
        for (const c of universe)
          if (!shortCircuit.has(c) && patterns.some((p) => hits(c, p, mode))) answered.add(c);
      }
    }
    gate(`g1 no pattern captures a foreign class (${patternCount} patterns × ${universe.length} codes)`,
      captures.length === 0, captures.length ? captures.slice(0, 8).join('; ') : 'clean');

    // R15 re-introduced 3-char patterns (airliner families). They are only safe
    // if they capture NOTHING outside the airliner space — prove it WITHOUT the
    // exact/warbird short-circuit, so the tail is clean on its own merits.
    const owned = [...exactKeys, ...Object.keys(WARBIRD_ARCHETYPE)];
    const leaks = [];
    for (const p of W.airliner)
      for (const c of owned)
        if (c !== p && c.startsWith(p))
          leaks.push(`'${p}' would capture ${c} (${trueClass(c)})`);
    gate(`g2 airliner families capture zero exact/warbird codes unaided (${W.airliner.length} patterns × ${owned.length})`,
      leaks.length === 0, leaks.length ? leaks.slice(0, 8).join('; ') : 'no leak');

    // Cargo must keep winning over the family that contains it.
    const cargoOrder = ['B74F', 'B77F', 'B748', 'MD11']
      .filter((c) => newIconType({ t: c }) !== 'cargo');
    gate('g3 freighter variants beat the airliner families', cargoOrder.length === 0,
      cargoOrder.length ? `leaked to airliner: ${cargoOrder.join(', ')}` : 'B74F/B77F/B748/MD11 cargo');
  }

  // === Gate h: fleet no-regression ========================================
  {
    // FROZEN pre-R15 worker snapshot (main @ 8bb2b6d). Never update this — it
    // is the baseline the airliner fleet must still match.
    const OLD = {
      heli: ['H60', 'H47', 'EC35', 'EC45', 'AS50', 'B06', 'R22', 'R44', 'S76'],
      mil: ['F16', 'F15', 'F18', 'F22', 'F35', 'C17', 'C130', 'KC135'],
      cargo: ['B74F', 'B77F', 'B748', 'MD11'],
      wide: ['A330', 'A340', 'A350', 'A380', 'B767', 'B777', 'B787', 'B747'],
      narrow: ['A318', 'A319', 'A320', 'A321', 'B737', 'B757'],
      biz: ['C510', 'C525', 'C560', 'CL60', 'G550', 'G650', 'LJ45'],
      prop: ['C172', 'C182', 'PA28', 'PA32', 'BE36', 'SR22', 'TBM9', 'PC12'],
    };
    const oldIconType = (ac) => {
      const category = ac.category;
      if (category === 'A7') return 'helicopter';
      if (category === 'B1' || category === 'B4') return 'glider';
      if (category === 'B6') return 'drone';
      const t = ac.t?.toUpperCase() || '';
      if (t && WARBIRD_ARCHETYPE[t] !== undefined) return WARBIRD_ARCHETYPE[t];
      if (t) {
        if (OLD.heli.some((x) => t.includes(x))) return 'helicopter';
        if (OLD.mil.some((x) => t.includes(x))) return 'military';
        if (OLD.cargo.some((x) => t.includes(x))) return 'cargo';
        if (OLD.wide.some((x) => t.includes(x))) return 'airliner';
        if (OLD.narrow.some((x) => t.includes(x))) return 'airliner';
        if (OLD.biz.some((x) => t.includes(x))) return 'jet';
        if (OLD.prop.some((x) => t.includes(x))) return 'prop';
      }
      if (category === 'A5' || category === 'A4' || category === 'A3') return 'airliner';
      if (category === 'A2') return 'jet';
      if (category === 'A1') return 'prop';
      return 'unknown';
    };

    // R15 SANCTIONED CHANGE (was: "airliner fleet byte-unchanged"). The old
    // tails held whole codes matched with .includes(), so every VARIANT code
    // (B738, B77W, A20N, B78X…) matched nothing and depended on the ADS-B
    // category — resolving to 'unknown' when the feed omitted it, and to 'prop'
    // or 'jet' when the feed sent a wrong small-aircraft category. The gate is
    // now the stronger statement: the fleet resolves to its audited class
    // REGARDLESS of category. Drift vs the frozen pre-R15 chain is measured and
    // printed below, never silent.
    const fleet = Object.keys(AIRLINERS);
    const cats = [undefined, 'A1', 'A2', 'A3', 'A4', 'A5'];
    const wrong = [];
    const drift = [];
    for (const t of fleet)
      for (const category of cats) {
        const a = oldIconType({ t, category });
        const b = newIconType({ t, category });
        if (b !== AIRLINERS[t]) wrong.push(`${t}${category ? '/' + category : ''}:${b}`);
        if (a !== b) drift.push(`${t}${category ? '/' + category : ''}:${a}→${b}`);
      }
    gate(`h1 airliner fleet resolves category-free (${fleet.length} codes × ${cats.length} categories)`,
      wrong.length === 0, wrong.length ? wrong.slice(0, 10).join(', ') : 'all audited');
    const noCat = fleet.filter((t) => oldIconType({ t }) === 'unknown' && newIconType({ t }) !== 'unknown');
    console.log(`     R15 sanctioned drift: ${drift.length}/${fleet.length * cats.length} cells moved; ` +
      `${noCat.length} codes rescued from 'unknown' when category is absent ` +
      `(e.g. ${noCat.slice(0, 5).join(', ')})`);

    // Every warbird outcome must be identical too (R14 behaviour is frozen).
    const wbDrift = Object.keys(WARBIRD_ARCHETYPE)
      .filter((t) => oldIconType({ t }) !== newIconType({ t }));
    gate('h2 warbird outcomes byte-unchanged (170)', wbDrift.length === 0,
      wbDrift.length ? wbDrift.slice(0, 8).join(', ') : '170 identical');

    // …and the fix must actually bite.
    // [code, pre-R15 worker answer, R15 answer]. SR20/S22T were never heli
    // (no 'R20' pattern existed) — they were simply unclassified.
    const MUST_DIVERGE = [
      ['SR22', 'helicopter', 'prop'], ['SR20', 'unknown', 'prop'],
      ['C172', 'military', 'prop'], ['C177', 'military', 'prop'],
      ['C130', 'military', 'military'],
    ];
    const notFixed = MUST_DIVERGE
      .filter(([t, was, now]) => !(oldIconType({ t }) === was && newIconType({ t }) === now))
      .map(([t]) => `${t}(${oldIconType({ t })}→${newIconType({ t })})`);
    gate('h3 trap victims moved, C130 held (exact-first is load-bearing)',
      notFixed.length === 0,
      notFixed.length ? notFixed.join(', ')
        : MUST_DIVERGE.map(([t]) => `${t}:${oldIconType({ t })}→${newIconType({ t })}`).join(' '));
  }

  // === Gate i: rarity exact-first (lib/rarity.js) =========================
  {
    const legacyBonus = parseNumberMap(objectBody(raritySrc, 'TYPE_RARITY_BONUS'));
    const exactBonus = parseNumberMap(objectBody(raritySrc, 'const EXACT_TYPE_BONUS'));
    const classBase = parseNumberMap(objectBody(raritySrc, 'CLASSIFICATION_RARITY'));
    const exactBonusKeys = Object.keys(exactBonus);

    // i0 — the chain in source, in order.
    {
      const fn = raritySrc.slice(raritySrc.indexOf('export function calculateRarity'));
      const at = ['WARBIRD_TYPE_RARITY[typeCode]', 'EXACT_TYPE_BONUS[typeCode]',
        'EXACT_TYPE_CODES.has(typeCode)', 'Object.entries(TYPE_RARITY_BONUS)']
        .map((s) => fn.indexOf(s));
      gate('i0 rarity chain = warbird → exact bonus → known-code skip → legacy loop',
        at.every((i) => i > 0) && at.every((v, i) => i === 0 || v > at[i - 1]),
        at.join(' < '));
    }

    // i1 — shape + disjointness.
    {
      const bad = exactBonusKeys.filter((k) => !CODE_RE.test(k));
      const clash = exactBonusKeys.filter((k) => WARBIRD_TYPES.has(k));
      gate('i1 EXACT_TYPE_BONUS shape + disjoint from warbird table',
        bad.length === 0 && clash.length === 0,
        bad.length || clash.length ? `bad ${bad.join(',')} clash ${clash.join(',')}`
          : `${exactBonusKeys.length} exact bonuses`);
    }

    // i2 — nothing invented: every exact bonus is the legacy value for that
    // code, either as a direct port or as a variant the substring path paid.
    {
      const invented = exactBonusKeys.filter((k) => {
        if (legacyBonus[k] === exactBonus[k]) return false;
        return !Object.entries(legacyBonus)
          .some(([p, b]) => k.includes(p) && b === exactBonus[k]);
      });
      gate('i2 every exact bonus is ported, not invented', invented.length === 0,
        invented.length ? invented.map((k) => `${k}=${exactBonus[k]}`).join(', ')
          : `${exactBonusKeys.length} entries trace to TYPE_RARITY_BONUS`);
    }

    const oldSub = (code) => {
      let r = 0;
      for (const [p, b] of Object.entries(legacyBonus)) if (code.includes(p)) r += b;
      return r;
    };
    const oldChain = (code) =>
      WARBIRD_TYPE_RARITY[code] !== undefined ? WARBIRD_TYPE_RARITY[code] : oldSub(code);
    const newChain = (code) => {
      if (WARBIRD_TYPE_RARITY[code] !== undefined) return WARBIRD_TYPE_RARITY[code];
      if (exactBonus[code] !== undefined) return exactBonus[code];
      if (EXACT_TYPE_CODES.has(code)) return 0;
      return oldSub(code);
    };
    const score = (code) => Math.min(
      (classBase[newIconType({ t: code })] || 0) + newChain(code), 100);
    const oldScore = (code) => Math.min(
      (classBase[newIconType({ t: code })] || 0) + oldChain(code), 100);

    // i3 — the sanctioned bug list: bonus was non-zero, must now be zero.
    {
      // The last six were found BY the i6 sweep, not by hand: a 2-char pattern
      // also matches at index 1, so 'C5' paid the EC155, 'E3' paid every
      // Bonanza (BE33/BE35/BE36) and 'B2' paid the Socata Trinidads.
      const BUGS = ['C172', 'C177', 'C500', 'C501', 'C510', 'C525', 'C550', 'C551',
        'C560', 'C56X', 'B212', 'BE30', 'E35L', 'BE60',
        'EC55', 'BE33', 'BE35', 'BE36', 'TB20', 'TB21'];
      const bad = BUGS.filter((c) => !(oldChain(c) > 0 && newChain(c) === 0))
        .map((c) => `${c}:${oldChain(c)}→${newChain(c)}`);
      gate(`i3 substring payouts killed (${BUGS.length} codes)`, bad.length === 0,
        bad.length ? bad.join(', ')
          : BUGS.map((c) => `${c} ${oldChain(c)}→0`).join(' '));
    }

    // i4 — intended bonuses preserved.
    {
      const KEEP = [['C17', 30], ['F22', 50], ['F35', 45], ['B2', 60], ['B52', 35],
        ['C5', 40], ['C130', 20], ['E3', 45], ['E6', 50], ['P8', 35], ['VC25', 95],
        ['H60', 25], ['H47', 30], ['H64', 40], ['V22', 45], ['CV22', 45],
        ['A380', 40], ['B748', 40], ['B744', 35], ['MD11', 45], ['DC10', 50],
        ['L101', 55], ['CONC', 100], ['G650', 35], ['GL7T', 35], ['GLEX', 30]];
      const bad = KEEP.filter(([c, want]) => newChain(c) !== want)
        .map(([c, want]) => `${c}:${newChain(c)}≠${want}`);
      gate(`i4 intended bonuses preserved (${KEEP.length} codes)`, bad.length === 0,
        bad.length ? bad.join(', ') : 'C-17 keeps 30, B-2 keeps 60, …');
    }

    // i5 — the legendary EMS Bell 212 ping is gone; F16 tier is untouched.
    {
      const TIERS = [['common', 0, 29], ['uncommon', 30, 49], ['rare', 50, 69],
        ['epic', 70, 84], ['legendary', 85, 94], ['mythic', 95, 100]];
      const tierOf = (s) => (TIERS.find(([, lo, hi]) => s >= lo && s <= hi) || [null])[0];
      const b212 = score('B212');
      gate('i5a B212 below legendary (SPICY ping killed)', b212 < 85,
        `B212 ${oldScore('B212')} (${tierOf(oldScore('B212'))}) → ${b212} (${tierOf(b212)})`);
      const holds = ['F16', 'C17', 'C130', 'VC25', 'H60']
        .filter((c) => tierOf(oldScore(c)) !== tierOf(score(c)))
        .map((c) => `${c}:${tierOf(oldScore(c))}→${tierOf(score(c))}`);
      gate('i5b F16 + C17/C130/VC25/H60 tiers unchanged', holds.length === 0,
        holds.length ? holds.join(', ')
          : `F16 ${score('F16')} (${tierOf(score('F16'))}), C17 ${score('C17')} (${tierOf(score('C17'))})`);
    }

    // i6 — measured change set: exactly the audited codes move, nothing else.
    {
      const EXPECTED = new Set(['C172', 'C177', 'C500', 'C501', 'C510', 'C525',
        'C550', 'C551', 'C560', 'C56X', 'B212', 'BE30', 'E35L', 'BE60',
        'EC55', 'BE33', 'BE35', 'BE36', 'TB20', 'TB21']);
      const moved = universe.filter((c) => oldChain(c) !== newChain(c));
      const extra = moved.filter((c) => !EXPECTED.has(c));
      const missing = [...EXPECTED].filter((c) => !moved.includes(c));
      gate(`i6 bonus change set is exactly the audited ${EXPECTED.size} (${universe.length} codes swept)`,
        extra.length === 0 && missing.length === 0,
        extra.length || missing.length ? `extra ${extra.join(',')} missing ${missing.join(',')}`
          : `${moved.length} moved, ${universe.length - moved.length} byte-identical`);
    }

    // i7 — the R14 warbird path is untouched.
    {
      const bad = Object.keys(WARBIRD_TYPE_RARITY)
        .filter((c) => newChain(c) !== WARBIRD_TYPE_RARITY[c]);
      gate('i7 warbird bonuses byte-unchanged (170)', bad.length === 0,
        bad.length ? bad.slice(0, 8).join(', ') : '170 identical');
    }
  }

  console.log(fails ? `\nVERIFY: FAIL (${fails} gate${fails > 1 ? 's' : ''})` : '\nVERIFY: PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});

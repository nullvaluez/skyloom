/**
 * R17 "Your Wings" — deterministic contract/daily audit (node, NO browser, NO
 * deps). Same technique as scripts/verify-classify.mjs and verify-warbirds.mjs:
 * the canonical modules are IMPORTED and exercised for real, so the gate proves
 * the shipped functions rather than a re-derived model of them.
 *
 * lib/fly/daily.js is zero-import and loads directly. lib/fly/contracts.js uses
 * the bundler's '@/' alias, which node cannot resolve, so it is loaded through
 * a data: URL with its specifiers rewritten to absolute file: URLs — the module
 * SOURCE is untouched and the real exports are what gets tested.
 *
 * Gates (each prints PASS/FAIL; any FAIL → exit 1):
 *   a. template shape — unique ids, known kinds, positive points, sane targets
 *   b. append-only order — the 11 pre-R17 templates in their exact positions,
 *      every R17 template strictly after `touch-go`, initial three unchanged
 *   c. eligibility matrix — toy NEVER yields a weather/night template, no
 *      matter what wx/sun it is handed; satellite yields them exactly when the
 *      offer thresholds are met; missing data is never "close enough"
 *   d. mulberry32 determinism — reproducible, in range, seed-sensitive
 *   e. daily pool — mechanical kinds only, no `requires`, and picks are
 *      without replacement, day-stable, and cover the whole pool over a year
 *   f. spotAdvances — the three legacy branches byte-identical, spot-night
 *      gated on ctx
 *
 * Usage: node scripts/verify-daily.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let fails = 0;
const gate = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails++;
};

/**
 * Import an app module that uses bundler specifiers. Every `'@/x'` and
 * relative `'./x'` / `'../x'` is rewritten to an absolute file: URL (data:
 * URL modules may only resolve absolute specifiers), then the source is
 * evaluated as-is. One hop deep is enough here: contracts.js pulls
 * lib/warbirds.js and lib/fly/fly-constants.js, both of which are plain ESM
 * that node loads natively.
 */
async function importApp(rel) {
  const abs = path.resolve(root, rel);
  const dir = path.dirname(abs);
  const src = readFileSync(abs, 'utf8').replace(
    /(\bfrom\s+)'([^']+)'/g,
    (m, head, spec) => {
      let target = null;
      if (spec.startsWith('@/')) target = path.resolve(root, spec.slice(2));
      else if (spec.startsWith('./') || spec.startsWith('../')) target = path.resolve(dir, spec);
      if (!target) return m;
      if (!/\.[cm]?js$/.test(target)) target += '.js';
      return `${head}'${pathToFileURL(target).href}'`;
    }
  );
  return import(`data:text/javascript;base64,${Buffer.from(src).toString('base64')}`);
}

// ---------------------------------------------------------------------------
(async () => {
  const daily = await import(new URL('../lib/fly/daily.js', import.meta.url));
  const contracts = await importApp('lib/fly/contracts.js');
  const consts = await import(new URL('../lib/fly/fly-constants.js', import.meta.url));

  const { mulberry32, pickDaily, utcDayKey, utcDayNumber } = daily;
  const {
    CONTRACT_TEMPLATES, DAILY_KINDS, DAILY_TEMPLATES, DAILY_TEMPLATE_IDS,
    contractEligible, nightNow, spotAdvances,
  } = contracts;
  const CL = consts.CONTRACTS_LIVING;

  // The eleven templates that existed before R17, in their frozen order.
  const LEGACY_IDS = [
    'spot-3', 'spot-heli', 'chase-formation', 'overfly-landmarks',
    'spot-widebody', 'spot-warbird', 'alt-fl300', 'visit-base',
    'spot-military', 'buzz-tower', 'touch-go',
  ];
  const R17_IDS = [
    'storm-chaser', 'ifr-legs', 'wind-rider', 'above-weather', 'night-spots',
    'night-buzz', 'visit-boneyard', 'visit-factory', 'overfly-hotspot',
  ];
  const KNOWN_KINDS = new Set([
    'spot-any', 'spot-class', 'spot-type', 'formation', 'overfly', 'altitude',
    'visit-kind', 'airport-buzz', 'touch-go',
    // R17
    'weather-hold', 'weather-distance', 'weather-alt', 'spot-night',
    'buzz-night', 'visit-tag', 'overfly-kind',
  ]);

  // === Gate a: template shape =============================================
  {
    const ids = CONTRACT_TEMPLATES.map((t) => t.id);
    gate('a1 template ids unique', new Set(ids).size === ids.length,
      `${ids.length} templates`);
    const badKind = CONTRACT_TEMPLATES.filter((t) => !KNOWN_KINDS.has(t.kind));
    gate('a2 every kind is known', badKind.length === 0,
      badKind.length ? badKind.map((t) => `${t.id}=${t.kind}`).join(', ')
        : `${KNOWN_KINDS.size} kinds in the vocabulary`);
    const badNum = CONTRACT_TEMPLATES.filter(
      (t) => !(Number.isFinite(t.pts) && t.pts > 0) ||
        !(Number.isInteger(t.target) && t.target > 0) ||
        !(typeof t.label === 'string' && t.label.length > 0)
    );
    gate('a3 pts > 0, integer target > 0, non-empty label', badNum.length === 0,
      badNum.length ? badNum.map((t) => t.id).join(', ') : 'all sane');
    // Every `requires` must name a descriptor contractEligible understands, or
    // it silently becomes a template that can never be offered.
    const WX = new Set(['precip', 'fog', 'wind', 'overcast']);
    const badReq = CONTRACT_TEMPLATES.filter((t) => {
      if (!t.requires) return false;
      const r = t.requires;
      if (r.weather && !WX.has(r.weather)) return true;
      if (r.style && r.style !== 'satellite') return true;
      // weather/night templates MUST also pin satellite explicitly
      return (r.weather || r.night) && r.style !== 'satellite';
    });
    gate('a4 every `requires` descriptor is well formed', badReq.length === 0,
      badReq.length ? badReq.map((t) => t.id).join(', ')
        : `${CONTRACT_TEMPLATES.filter((t) => t.requires).length} live templates`);
    // Kind ⇒ payload: the tick/subscription code reads these fields.
    const missing = CONTRACT_TEMPLATES.filter((t) =>
      (t.kind === 'spot-class' && !t.cls) ||
      (t.kind === 'spot-type' && !(t.types instanceof Set)) ||
      (t.kind === 'altitude' && !Number.isFinite(t.altM)) ||
      (t.kind === 'visit-kind' && !t.poiKind) ||
      (t.kind === 'visit-tag' && !t.tag) ||
      (t.kind === 'overfly-kind' && !t.poiKind) ||
      (t.kind.startsWith('weather-') && !t.wx)
    );
    gate('a5 each kind carries the payload its handler reads', missing.length === 0,
      missing.length ? missing.map((t) => `${t.id}(${t.kind})`).join(', ') : 'complete');
  }

  // === Gate b: append-only order ==========================================
  {
    const ids = CONTRACT_TEMPLATES.map((t) => t.id);
    const legacyOk = LEGACY_IDS.every((id, i) => ids[i] === id);
    gate('b1 the 11 pre-R17 templates hold their exact positions', legacyOk,
      legacyOk ? LEGACY_IDS.join(' → ') : `got ${ids.slice(0, 11).join(', ')}`);
    const tg = ids.indexOf('touch-go');
    const after = R17_IDS.every((id) => ids.indexOf(id) > tg);
    gate('b2 every R17 template lands strictly after touch-go', after,
      `touch-go@${tg}, R17 @ ${R17_IDS.map((id) => ids.indexOf(id)).join(',')}`);
    gate('b3 initial set (slice 0,3) is unchanged',
      ids[0] === 'spot-3' && ids[1] === 'spot-heli' && ids[2] === 'chase-formation',
      ids.slice(0, 3).join(', '));
    const orphan = R17_IDS.filter((id) => !ids.includes(id));
    gate('b4 all nine R17 templates present', orphan.length === 0,
      orphan.length ? `missing ${orphan.join(', ')}` : R17_IDS.join(', '));
  }

  // === Gate c: eligibility matrix =========================================
  {
    const live = CONTRACT_TEMPLATES.filter((t) => t.requires);
    const plain = CONTRACT_TEMPLATES.filter((t) => !t.requires);

    // A wx object that satisfies EVERY weather descriptor at once, plus a
    // midnight sun — the most generous world possible.
    const richWx = {
      found: true, precip: 'rain', precipT: 1, fogT: 1,
      windX: 30, windZ: 0, overcastT: 1,
    };
    const TOY_CTXS = [
      { mapStyle: 'toy', wx: null, sunFrac: null },
      { mapStyle: 'toy', wx: richWx, sunFrac: 0 }, // stale sun + impossible wx
      { mapStyle: 'toy', wx: richWx, sunFrac: 1 },
      { mapStyle: null, wx: richWx, sunFrac: 0 },
      { wx: richWx, sunFrac: 0 },
      {},
      null,
    ];
    const leaked = [];
    for (const ctx of TOY_CTXS)
      for (const t of live)
        if (contractEligible(t, ctx)) leaked.push(`${t.id}@${JSON.stringify(ctx)?.slice(0, 40)}`);
    gate(`c1 toy NEVER yields a weather/night template (${live.length} × ${TOY_CTXS.length} contexts)`,
      leaked.length === 0, leaked.length ? leaked.slice(0, 4).join('; ') : 'sealed');

    // …and no context can make a plain template ineligible.
    const plainBad = [];
    for (const ctx of [...TOY_CTXS, { mapStyle: 'satellite', wx: richWx, sunFrac: 0 }])
      for (const t of plain) if (!contractEligible(t, ctx)) plainBad.push(t.id);
    gate(`c2 templates without \`requires\` are always eligible (${plain.length})`,
      plainBad.length === 0, plainBad.length ? [...new Set(plainBad)].join(', ') : 'all pass');

    // Satellite, per descriptor: on above the offer threshold, off below it.
    const sat = (wx, sunFrac = 1) => ({ mapStyle: 'satellite', wx, sunFrac });
    const base = { found: true, precip: 'none', precipT: 0, fogT: 0, windX: 0, windZ: 0, overcastT: 0 };
    const O = CL.offer;
    const cases = [
      ['storm-chaser', { ...base, precip: 'rain', precipT: O.precipT + 0.05 }, true],
      ['storm-chaser', { ...base, precip: 'rain', precipT: O.precipT - 0.05 }, false],
      ['storm-chaser', { ...base, precip: 'none', precipT: 1 }, false],
      ['ifr-legs', { ...base, fogT: O.fogT + 0.05 }, true],
      ['ifr-legs', { ...base, fogT: O.fogT - 0.05 }, false],
      ['wind-rider', { ...base, windX: O.windMps + 1 }, true],
      ['wind-rider', { ...base, windX: O.windMps - 1 }, false],
      ['wind-rider', { ...base, windX: 0, windZ: -(O.windMps + 1) }, true], // magnitude, not sign
      ['above-weather', { ...base, overcastT: O.overcastT + 0.05 }, true],
      ['above-weather', { ...base, overcastT: O.overcastT - 0.05 }, false],
      // `found: false` is the honest no-weather state — never a green light.
      ['storm-chaser', { ...base, found: false, precip: 'rain', precipT: 1 }, false],
      ['ifr-legs', { ...base, found: false, fogT: 1 }, false],
    ];
    const byId = new Map(CONTRACT_TEMPLATES.map((t) => [t.id, t]));
    const wrong = cases.filter(([id, wx, want]) => contractEligible(byId.get(id), sat(wx)) !== want)
      .map(([id, , want]) => `${id} wanted ${want}`);
    gate(`c3 satellite weather thresholds (${cases.length} cases)`, wrong.length === 0,
      wrong.length ? wrong.join(', ') : 'offer thresholds hold in both directions');

    // Night: gated on sunFrac, and a non-finite sun is never night.
    const nightCases = [
      [0, true], [CL.nightFrac, true], [CL.nightFrac + 0.01, false], [1, false],
      [null, false], [undefined, false], [NaN, false],
    ];
    const nWrong = nightCases.filter(([f, want]) =>
      contractEligible(byId.get('night-spots'), sat(base, f)) !== want ||
      nightNow({ mapStyle: 'satellite', sunFrac: f }) !== want);
    gate(`c4 night gate on sun frac (${nightCases.length} cases, threshold ${CL.nightFrac})`,
      nWrong.length === 0,
      nWrong.length ? JSON.stringify(nWrong) : 'dark below the threshold, never on missing data');

    // Offer must never be STRICTER than progress, or a contract could tick in
    // conditions that would refuse to hand it to you.
    const P = CL.progress;
    gate('c5 offer thresholds are looser than progress thresholds',
      O.precipT <= P.precipT && O.fogT <= P.fogT && O.windMps <= P.windMps &&
        O.overcastT <= P.overcastT,
      `precip ${O.precipT}/${P.precipT} fog ${O.fogT}/${P.fogT} wind ${O.windMps}/${P.windMps} overcast ${O.overcastT}/${P.overcastT}`);
  }

  // === Gate d: mulberry32 =================================================
  {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const c = mulberry32(12346);
    const seqA = Array.from({ length: 32 }, () => a());
    const seqB = Array.from({ length: 32 }, () => b());
    const seqC = Array.from({ length: 32 }, () => c());
    gate('d1 same seed → identical stream', seqA.every((v, i) => v === seqB[i]),
      `${seqA.length} draws`);
    gate('d2 different seed → different stream', seqA.some((v, i) => v !== seqC[i]));
    gate('d3 every draw in [0,1)', seqA.every((v) => v >= 0 && v < 1),
      `min ${Math.min(...seqA).toFixed(4)} max ${Math.max(...seqA).toFixed(4)}`);
    // Sanity on the day helpers (UTC, no local-time drift).
    const t = Date.UTC(2026, 6, 25, 23, 59, 0);
    gate('d4 utcDayNumber/utcDayKey are UTC and agree',
      utcDayKey(t) === '2026-07-25' &&
        utcDayNumber(t) === Math.floor(t / 86400000) &&
        utcDayNumber(t + 60000) === utcDayNumber(t) + 1,
      `${utcDayKey(t)} → ${utcDayKey(t + 60000)}`);
  }

  // === Gate e: the daily pool =============================================
  {
    gate('e1 DAILY_TEMPLATES are mechanical kinds with no `requires`',
      DAILY_TEMPLATES.length > 0 &&
        DAILY_TEMPLATES.every((t) => DAILY_KINDS.has(t.kind) && !t.requires),
      `${DAILY_TEMPLATES.length} of ${CONTRACT_TEMPLATES.length}: ${DAILY_TEMPLATE_IDS.join(', ')}`);
    const liveInPool = DAILY_TEMPLATE_IDS.filter((id) =>
      R17_IDS.includes(id) && CONTRACT_TEMPLATES.find((t) => t.id === id)?.requires);
    gate('e2 no weather/night template can ever be a daily', liveInPool.length === 0,
      liveInPool.length ? liveInPool.join(', ') : 'pool is weather-free');

    const n = CL.daily.count;
    const day = utcDayNumber(Date.UTC(2026, 6, 25));
    const p1 = pickDaily(day, DAILY_TEMPLATE_IDS, n);
    const p2 = pickDaily(day, DAILY_TEMPLATE_IDS, n);
    gate('e3 same day → same picks', p1.length === n && p1.every((v, i) => v === p2[i]),
      p1.join(' + '));
    gate('e4 picks are without replacement', new Set(p1).size === p1.length);
    gate('e5 picks are real template ids',
      p1.every((id) => DAILY_TEMPLATE_IDS.includes(id)));

    // A 365-day sweep: every mechanical template must appear, no day may draw
    // a duplicate, and consecutive days must not be frozen on one pair.
    const hist = new Map(DAILY_TEMPLATE_IDS.map((id) => [id, 0]));
    let dupDays = 0;
    let distinctPairs = new Set();
    for (let d = 0; d < 365; d++) {
      const pick = pickDaily(day + d, DAILY_TEMPLATE_IDS, n);
      if (new Set(pick).size !== pick.length) dupDays++;
      distinctPairs.add(pick.join('|'));
      for (const id of pick) hist.set(id, hist.get(id) + 1);
    }
    const never = [...hist].filter(([, c]) => c === 0).map(([id]) => id);
    gate('e6 365-day sweep hits every mechanical template', never.length === 0,
      never.length ? `never drawn: ${never.join(', ')}`
        : [...hist].map(([id, c]) => `${id} ${c}`).join(' | '));
    gate('e7 no day draws a duplicate', dupDays === 0, `${dupDays} bad days`);
    gate('e8 the set actually varies day to day', distinctPairs.size >= 10,
      `${distinctPairs.size} distinct pairs over 365 days`);

    // Degenerate inputs must not throw or over-draw.
    const edge = pickDaily(day, DAILY_TEMPLATE_IDS, DAILY_TEMPLATE_IDS.length + 5);
    gate('e9 pickDaily clamps to the pool and tolerates junk',
      edge.length === DAILY_TEMPLATE_IDS.length &&
        pickDaily(day, [], 2).length === 0 &&
        pickDaily(day, null, 2).length === 0 &&
        pickDaily(day, DAILY_TEMPLATE_IDS, 0).length === 0,
      `clamped to ${edge.length}`);
  }

  // === Gate f: spotAdvances ===============================================
  {
    const byId = new Map(CONTRACT_TEMPLATES.map((t) => [t.id, t]));
    const heli = byId.get('spot-heli');
    const wide = byId.get('spot-widebody');
    const any = byId.get('spot-3');
    const night = byId.get('night-spots');
    const cases = [
      [any, { classification: 'prop' }, undefined, true],
      [heli, { classification: 'helicopter' }, undefined, true],
      [heli, { classification: 'prop' }, undefined, false],
      [wide, { type: 'A388' }, undefined, true],
      [wide, { type: 'C172' }, undefined, false],
      [wide, {}, undefined, false],
      [night, { classification: 'prop' }, { night: true }, true],
      [night, { classification: 'prop' }, { night: false }, false],
      [night, { classification: 'prop' }, undefined, false],
      [byId.get('alt-fl300'), { classification: 'prop' }, { night: true }, false],
    ];
    const wrong = cases.filter(([t, s, ctx, want]) => spotAdvances(t, s, ctx) !== want)
      .map(([t, , , want]) => `${t.id} wanted ${want}`);
    gate(`f1 spotAdvances (${cases.length} cases, legacy branches unmoved)`,
      wrong.length === 0, wrong.length ? wrong.join(', ') : 'all correct');
  }

  console.log(fails ? `\nVERIFY: FAIL (${fails} gate${fails > 1 ? 's' : ''})` : '\nVERIFY: PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});

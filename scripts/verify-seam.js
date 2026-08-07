/**
 * ROUND 21 (E "CERT") — verify-seam: the tile-seam / coverage-determinism gate.
 *
 * The user's second symptom is "parts of the world load their styled geometry
 * while adjacent areas don't, in BOTH styles". Two of the four causes are
 * WORKER-side and therefore measurable as pure functions of the tile bytes
 * plus the constants — no renderer, no streaming order, no draw-count noise
 * (the R20 A/B method: draw counts breathe, tile data does not):
 *
 *   P4  THE ALL-OR-NOTHING SKYLINE LOCK. buildSatSkyline counts far-mass
 *       ("hatch") candidates per z14 tile and, if the count is below
 *       SAT_POLY_COVER.skyline.minCountPerTile (40), SPLICES EVERY ONE OF THEM
 *       OUT. A tile with 39 candidates renders nothing; the tile next to it
 *       with 44 renders all 44. That is a visible seam in the sky, and it is
 *       the exact shape of the user's report. D replaces it with a ramp
 *       (TILE_PIPELINE.hatchRamp: keepN = 0 at n <= lockLo 24, round(n*(n-
 *       lockLo)/(rampHi-lockLo)) between, n at n >= rampHi 64), which must ALSO
 *       keep Owens Valley at exactly zero BY CONSTRUCTION.
 *   P3  WHICH members survive a capped tile.
 *
 * ---------------------------------------------------------------------------
 * HOW THE NODE LEG DRIVES THE WORKER
 * ---------------------------------------------------------------------------
 * R20's deterministic worker measurements (scripts/r20-a-cover.js,
 * r20-b-parcels.js) drove `window.__toyWorld.worker.buildTile(...)` through a
 * booted browser. That works, but it needs a dev server, a GPU Chrome and a
 * full world boot to measure a pure function. This gate imports the worker
 * MODULE straight into node instead, using two synchronous loader hooks
 * (node:module registerHooks): one aliases the `comlink` specifier to a stub
 * that captures `expose(api)` into a global, the other appends `.js` to the
 * repo's extensionless relative imports (Next resolves those; bare node does
 * not). Nothing in the worker is patched — the SAME `api.buildTile` the app
 * calls runs here, against the same live OpenFreeMap tileset. Cost: ~20 ms per
 * tile after the TileJSON init, versus ~40 s of boot.
 *
 * `skyMeta` (emitted per tile under SAT_POLY_COVER since R20) reports
 * { parsed, kept, hatchCand } around the lock, so the hatch survivors are
 *     hatchKept = hatchCand - (parsed - kept)
 * which is the quantity the lock/ramp actually decides. It is measured, never
 * inferred from geometry.
 *
 * ---------------------------------------------------------------------------
 * RED CALIBRATION (r21/e @ e1077f8 — R20 behaviour, all R21 flags off)
 * ---------------------------------------------------------------------------
 * 5x5 z14 grids over Owens / Owens-town / Powell / Dublin / Columbus /
 * Plain City / Ashley / Manhattan, 195 tiles. The measured (candidates ->
 * hatchKept) map is a PERFECT STEP at 40:
 *
 *     candidates  ... 32 33 34 36 39 | 44 47 48 49 51 52 54 ...
 *     hatchKept   ...  0  0  0  0  0 | 44 47 48 49 51 52 54 ...
 *
 * i.e. every tile below 40 keeps ZERO and every tile at or above 40 keeps
 * ALL. The largest observed jump between adjacent measured candidate counts is
 * 44 over a gap of 5 (39 -> 44) = slope 8.8 per candidate; the ramp's steepest
 * slope is 2.6 (at n = rampHi). Gate (2) draws the line at 4.
 * Powell's own 5x5 contains the seam as literal neighbours: the tile at
 * 34 candidates keeps 0 while the tile immediately east of it, 128 candidates,
 * keeps all 128 — gate (5)'s all-or-nothing neighbour pair.
 * Owens' busiest tile measures 15 candidates (< lockLo 24), so gate (1) holds
 * under BOTH the lock and the ramp — it is the frozen safety assertion that
 * makes the ramp landable, not a red-calibrated one.
 *
 * ---------------------------------------------------------------------------
 * GATES
 * ---------------------------------------------------------------------------
 * NODE (worker fixture, no browser, no dev server):
 *  (1) THE OWENS LOCK — every Owens z14 tile keeps ZERO far-mass. Frozen:
 *      verify-skyline's "EMPTY SCENE ISSUES NO MESH" and verify-suburbia (E)
 *      both rest on it, as does the Owens <= 261 draw ledger.
 *  (2) NO CLIFF — the measured (candidates -> hatchKept) map is Lipschitz:
 *      between adjacent observed candidate counts, |delta hatchKept| <=
 *      4 * max(1, delta candidates). RED: 44 over a gap of 5.
 *  (3) MONOTONE — more candidates never keeps fewer blocks.
 *  (4) RAMP SPEC — measured hatchKept === the mirrored keepN(n). RED by
 *      construction until D merges (prints every mismatch).
 *  (5) NO ALL-OR-NOTHING NEIGHBOURS — no adjacent z14 tile pair where one
 *      keeps 0 of >= lockLo candidates while the other keeps 100% of its own.
 *      This is the seam as the user sees it.
 *  (6) DETERMINISM — the same tile built twice yields byte-identical geometry
 *      (FNV-1a over positions + indices) and the same selection.
 * BROWSER (optional; skipped without FLY_URL):
 *  (7) NO UNBOUNDED RE-REQUEST — over a settled 60 s satellite dwell, no
 *      single tile URL is re-fetched more than STREAM_KEEPER.healCap + 1
 *      times. The R20 engines evict+rebuild a permanently-coarse chunk every
 *      2 s forever.
 *  (8) EMPTY-REASON TELEMETRY — engine stats expose emptyByReason (B), and no
 *      tile whose result was reason 'zero' is re-requested inside the dwell.
 *      SOFT while the instrument is missing.
 *
 * Run:  node scripts/verify-seam.js                     (node leg only)
 *       FLY_URL=http://localhost:3124 node scripts/verify-seam.js   (+browser)
 *       SEAM_WIDE=1 ...  (adds 6 more scenes to the sweep)
 */
const path = require('path');
const fs = require('fs');
const { registerHooks } = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const COMLINK_STUB = 'file:///r21-seam-comlink-stub.mjs';

/* -- loader hooks: capture expose(api), teach node the extensionless paths -- */
registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: COMLINK_STUB, shortCircuit: true };
    if (/^\.{1,2}\//.test(spec) && !/\.[a-z]+$/i.test(spec) && ctx.parentURL?.startsWith('file:')) {
      for (const ext of ['.js', '.mjs', '/index.js']) {
        try {
          if (fs.existsSync(fileURLToPath(new URL(spec + ext, ctx.parentURL))))
            return next(spec + ext, ctx);
        } catch {
          /* not this candidate */
        }
      }
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url === COMLINK_STUB)
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export const expose = (api) => { globalThis.__r21SeamApi = api; };\n' +
          'export const transfer = (v) => v;\n',
      };
    return next(url, ctx);
  },
});

const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** FNV-1a over a numeric array — the R18/R20 fingerprint idiom. */
const fnv = (arr) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < arr.length; i++) {
    const v = Math.round(arr[i] * 1000) | 0;
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
};

const SCENES = [
  ['owens', 36.6, -118.1, true],
  ['owens-town', 36.601, -118.06, true],
  ['powell', 40.1578, -83.0752],
  ['dublin', 40.0992, -83.1141],
  ['columbus', 39.9612, -82.9988],
  ['plaincity', 40.1073, -83.2674],
  ['ashley', 40.4106, -82.9557],
  ['manhattan', 40.7549, -73.984],
  ...(process.env.SEAM_WIDE
    ? [
        ['naperville', 41.7508, -88.1535],
        ['blagnac-fr', 43.635, 1.39],
        ['melton-au', -37.683, 144.585],
        ['piaseczno-pl', 52.07, 21.02],
        ['jaipur-in', 26.9, 75.75],
        ['chicago-loop', 41.8827, -87.6329],
      ]
    : []),
];

(async () => {
  const fails = [];
  const softs = [];
  const red = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const soft = (name, owner, detail = '') => {
    console.log(`SOFT ${name} — instrument missing (owner ${owner})${detail ? ' · ' + detail : ''}`);
    softs.push(name);
  };

  /* ============================ THE NODE LEG ============================= */
  await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
  const C = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
  const api = globalThis.__r21SeamApi;
  gate('(0) worker fixture loaded in-process', !!api?.buildTile, `api=${Object.keys(api ?? {})}`);
  if (!api?.buildTile) {
    console.log('VERIFY: FAIL (worker fixture)');
    process.exit(1);
  }
  await api.init();

  // The ramp spec, MIRRORED from fly-constants (this harness is CommonJS at
  // the top level but reads the real module above — the mirror is only the
  // FORMULA, which lives in the TILE_PIPELINE doc comment, not in code yet).
  const RAMP = C.TILE_PIPELINE?.hatchRamp ?? { lockLo: 24, rampHi: 64 };
  const RAMP_ON = C.TILE_PIPELINE?.enabled === true && C.TILE_PIPELINE?.hatchRamp;
  const keepN = (n) => {
    if (n <= RAMP.lockLo) return 0;
    if (n >= RAMP.rampHi) return n;
    return Math.round((n * (n - RAMP.lockLo)) / (RAMP.rampHi - RAMP.lockLo));
  };
  const LOCK = C.SAT_POLY_COVER?.enabled
    ? C.SAT_POLY_COVER.skyline.minCountPerTile
    : C.SAT_FAR_SUBURB.minCountPerTile;
  console.log(
    `WORKER: protocol pinned by the module · TILE_PIPELINE.enabled=${C.TILE_PIPELINE?.enabled} ` +
      `ramp=${JSON.stringify(RAMP)} · today's lock minCountPerTile=${LOCK}`
  );

  const tiles = []; // { scene, dx, dy, cand, hk, parsed, kept, owens }
  for (const [name, lat, lon, isOwens] of SCENES) {
    const x0 = lonToX(lon, 14);
    const y0 = latToY(lat, 14);
    const grid = [];
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        let r;
        try {
          r = await api.buildTile(14, x0 + dx, y0 + dy, 'sat-skyline');
        } catch (e) {
          grid.push({ dx, dy, err: e.message });
          continue;
        }
        const m = r?.skyMeta;
        if (!m) {
          grid.push({ dx, dy, none: true });
          continue;
        }
        const rec = {
          scene: name,
          x: x0 + dx,
          y: y0 + dy,
          dx,
          dy,
          parsed: m.parsed,
          kept: m.kept,
          cand: m.hatchCand,
          hk: m.hatchCand - (m.parsed - m.kept),
          owens: !!isOwens,
        };
        grid.push(rec);
        tiles.push(rec);
      }
    }
    const cs = grid.filter((g) => g.cand !== undefined);
    console.log(
      `SCENE ${name.padEnd(13)} cand=${JSON.stringify(cs.map((g) => g.cand))} ` +
        `hatchKept=${JSON.stringify(cs.map((g) => g.hk))}`
    );
  }
  gate('(0b) the sweep measured tiles', tiles.length >= 25, `${tiles.length} z14 tiles`);

  // --- (1) THE OWENS LOCK ---------------------------------------------------
  const owens = tiles.filter((t) => t.owens);
  const owensKept = owens.reduce((a, t) => a + t.hk, 0);
  const owensMaxCand = Math.max(0, ...owens.map((t) => t.cand));
  gate(
    '(1) THE OWENS LOCK — every Owens z14 tile keeps ZERO far-mass',
    owensKept === 0,
    `hatchKept sum=${owensKept} over ${owens.length} tiles · busiest tile ${owensMaxCand} ` +
      `candidates (ramp lockLo=${RAMP.lockLo} ⇒ 0 by construction)`
  );

  // --- (2)/(3) the measured (candidates -> hatchKept) map -------------------
  const byCand = new Map();
  for (const t of tiles) {
    const cur = byCand.get(t.cand);
    if (cur === undefined) byCand.set(t.cand, [t.hk, t.hk]);
    else byCand.set(t.cand, [Math.min(cur[0], t.hk), Math.max(cur[1], t.hk)]);
  }
  const pts = [...byCand.entries()].sort((a, b) => a[0] - b[0]);
  console.log(
    'MAP (candidates -> hatchKept):',
    pts.map(([c, [lo, hi]]) => (lo === hi ? `${c}->${lo}` : `${c}->${lo}..${hi}`)).join(' ')
  );
  const SLOPE_MAX = 4; // the ramp's steepest true slope is 2.6 (at n = rampHi)
  let worstSlope = { slope: 0, from: null, to: null };
  let monoBreak = null;
  for (let i = 1; i < pts.length; i++) {
    const [c0, [, hi0]] = pts[i - 1];
    const [c1, [lo1, hi1]] = pts[i];
    const dc = Math.max(1, c1 - c0);
    const slope = Math.abs(hi1 - hi0) / dc;
    if (slope > worstSlope.slope)
      worstSlope = { slope, from: `${c0}->${hi0}`, to: `${c1}->${hi1}`, dc, dhk: hi1 - hi0 };
    if (lo1 < hi0 - 1 && !monoBreak) monoBreak = `${c0}->${hi0} then ${c1}->${lo1}`;
  }
  gate(
    `(2) NO CLIFF — |delta hatchKept| <= ${SLOPE_MAX} per candidate between adjacent measurements`,
    worstSlope.slope <= SLOPE_MAX,
    `worst slope ${worstSlope.slope.toFixed(1)} (${worstSlope.from} .. ${worstSlope.to}: ` +
      `+${worstSlope.dhk} over ${worstSlope.dc} candidates)`
  );
  red.push(['P4 all-or-nothing lock', 'verify-seam (2)', worstSlope.slope.toFixed(1), `<= ${SLOPE_MAX}`]);
  gate('(3) MONOTONE — more candidates never keeps fewer blocks', !monoBreak, monoBreak ?? 'ok');

  // --- (4) RAMP SPEC --------------------------------------------------------
  const mism = tiles.filter((t) => t.hk !== keepN(t.cand));
  gate(
    `(4) RAMP SPEC — hatchKept === keepN(candidates) (lockLo ${RAMP.lockLo} / rampHi ${RAMP.rampHi})`,
    mism.length === 0,
    `${mism.length}/${tiles.length} tiles disagree` +
      (mism.length
        ? ` · e.g. ${mism
            .slice(0, 5)
            .map((t) => `${t.scene}[${t.dx},${t.dy}] ${t.cand}->${t.hk} (want ${keepN(t.cand)})`)
            .join(', ')}`
        : '') +
      (RAMP_ON ? '' : ' · TILE_PIPELINE.enabled=false — RED until D merges')
  );
  red.push(['P4 ramp not implemented', 'verify-seam (4)', `${mism.length}/${tiles.length}`, '0']);

  // --- (5) NO ALL-OR-NOTHING NEIGHBOURS ------------------------------------
  const key = (t) => `${t.x}/${t.y}`;
  const index = new Map(tiles.map((t) => [key(t), t]));
  const pairs = [];
  for (const t of tiles) {
    for (const [ddx, ddy] of [
      [1, 0],
      [0, 1],
    ]) {
      const n = index.get(`${t.x + ddx}/${t.y + ddy}`);
      if (!n) continue;
      const zeroSide = [t, n].find((s) => s.hk === 0 && s.cand >= RAMP.lockLo);
      const allSide = [t, n].find((s) => s.cand > 0 && s.hk === s.cand);
      if (zeroSide && allSide && zeroSide !== allSide)
        pairs.push(
          `${t.scene}[${t.x},${t.y}] ${zeroSide.cand}->0 beside ${allSide.cand}->${allSide.hk}`
        );
    }
  }
  gate(
    '(5) NO ALL-OR-NOTHING NEIGHBOURS — no adjacent pair renders nothing beside everything',
    pairs.length === 0,
    `${pairs.length} seam pair(s)` + (pairs.length ? ` · e.g. ${pairs.slice(0, 4).join(' | ')}` : '')
  );
  red.push(['P4 visible tile seam', 'verify-seam (5)', pairs.length, '0']);

  // --- (6) DETERMINISM ------------------------------------------------------
  // Tiles chosen because they HAVE content: a determinism check on a tile that
  // emits nothing is vacuous (Powell's centre z14 tile keeps 0 and hashes
  // 'empty' — it proves nothing about selection order).
  const detTiles = [
    ['manhattan', 40.7549, -73.984],
    ['columbus', 39.9612, -82.9988],
    ['dublin', 40.0992, -83.1141],
  ];
  const detOut = [];
  for (const [name, lat, lon] of detTiles) {
    const x = lonToX(lon, 14);
    const y = latToY(lat, 14);
    const runs = [];
    for (let i = 0; i < 2; i++) {
      const r = await api.buildTile(14, x, y, 'sat-skyline');
      runs.push({
        kept: r?.skyMeta?.kept ?? -1,
        h: r?.satSkyline
          ? `${fnv(r.satSkyline.pos)}:${fnv(Array.from(r.satSkyline.idx))}:${r.satSkyline.pos.length}`
          : 'empty',
      });
    }
    const same = runs[0].kept === runs[1].kept && runs[0].h === runs[1].h;
    detOut.push(`${name} kept=${runs[0].kept} hash=${runs[0].h}${same ? '' : ' MISMATCH'}`);
    if (!same) fails.push(`(6) determinism ${name}`);
  }
  gate(
    '(6) DETERMINISM — the same tile built twice is byte-identical',
    !fails.some((f) => f.startsWith('(6)')),
    detOut.join(' · ')
  );

  // --- (6b) D's OWN CONTRACT, measured in the fixture --------------------
  // The reason-code contract lives in the TILE_PIPELINE doc comment and B codes
  // against it, so it is worth asserting at the source rather than only through
  // an engine. Both halves SOFT-fail until D merges.
  if (typeof api.setDiag !== 'function') soft('(6b) api.setDiag', 'D', 'vegMeta is not opt-in yet');
  else gate('(6b) api.setDiag exists (vegMeta opt-in)', true, 'present');
  {
    // Mid-Atlantic: OpenFreeMap ships no tile there, so this is the 'no-data'
    // branch. A tile that parses but admits nothing is the 'zero' branch —
    // Owens' own empty skyline tiles above are exactly that population.
    const ocean = await api.buildTile(14, lonToX(-40, 14), latToY(30, 14), 'sat-buildings');
    const owensEmpty = await api.buildTile(
      14,
      lonToX(-118.1, 14) + 2,
      latToY(36.6, 14) + 2,
      'sat-skyline'
    );
    console.log(
      `REASONS: ocean=${JSON.stringify({ empty: ocean?.empty, reason: ocean?.reason })} ` +
        `owens-outer=${JSON.stringify({ empty: owensEmpty?.empty, reason: owensEmpty?.reason })}`
    );
    if (ocean?.reason === undefined && owensEmpty?.reason === undefined)
      soft('(6c) empty results carry a reason code', 'D', 'both empties are untyped (legacy)');
    else
      gate(
        '(6c) empty results carry a reason code',
        ocean?.reason === 'no-data' || owensEmpty?.reason === 'zero',
        `ocean=${ocean?.reason} owens=${owensEmpty?.reason}`
      );
  }

  // P3 evidence (informational): how spread out the selected blocks are inside
  // a CAPPED tile. One corner of a tile rendering is the R20 selection defect;
  // D's hash-shuffle port should raise this without moving any assertion.
  const capTile = ['manhattan', 40.7549, -73.984];
  {
    const r = await api.buildTile(14, lonToX(capTile[2], 14), latToY(capTile[1], 14), 'sat-skyline');
    const a = r?.satSkyline?.anchor;
    if (a) {
      const xs = [];
      const zs = [];
      for (let i = 0; i < a.length; i += 2) {
        xs.push(a[i]);
        zs.push(a[i + 1]);
      }
      const span = (v) => Math.max(...v) - Math.min(...v);
      const cells = new Set();
      const x0 = Math.min(...xs);
      const z0 = Math.min(...zs);
      const sx = span(xs) || 1;
      const sz = span(zs) || 1;
      for (let i = 0; i < xs.length; i++)
        cells.add(
          `${Math.min(3, Math.floor(((xs[i] - x0) / sx) * 4))},${Math.min(3, Math.floor(((zs[i] - z0) / sz) * 4))}`
        );
      console.log(
        `INFO P3 capped-tile spread (${capTile[0]}): parsed=${r.skyMeta.parsed} kept=${r.skyMeta.kept} ` +
          `selected spans ${Math.round(sx)}x${Math.round(sz)} m, occupying ${cells.size}/16 quarter cells`
      );
    }
  }

  /* =========================== THE BROWSER LEG =========================== */
  let browserOut = null;
  if (process.env.FLY_URL) {
    const { chromium } = require('playwright');
    const { bootFly } = require('./_boot');
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--enable-gpu', '--ignore-gpu-blocklist'],
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const reqs = new Map();
    let counting = false;
    page.on('request', (r) => {
      if (!counting) return;
      const u = r.url();
      if (!/openfreemap|\.pbf(\?|$)/.test(u)) return;
      reqs.set(u, (reqs.get(u) ?? 0) + 1);
    });
    await bootFly(page, { style: 'satellite', url: process.env.FLY_URL });
    await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
    await page.mouse.move(800, 450);
    // Powell: a fully-mapped suburb — the detail ring, the skyline ring and
    // the veg ring all have real work, so a heal loop has something to loop on.
    await page.evaluate(
      ([lat, lon, altM, heading, pitch]) => {
        window.__fly.warpToGeo(lat, lon, { altM, name: null });
        const f = window.__fly.flight;
        if (window.__seamPin) clearInterval(window.__seamPin);
        const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
        window.__seamPin = setInterval(() => {
          f.pos.x = p.x;
          f.pos.y = p.y;
          f.pos.z = p.z;
          f.heading = heading;
          f.pitch = pitch;
          f.bank = 0;
          f.speed = 0;
        }, 8);
      },
      [40.1578, -83.0752, 900, 1.9, -0.3]
    );
    await page.waitForTimeout(30000); // settle: first full ring fill
    counting = true;
    await page.waitForTimeout(60000); // the 60 s steady-state window
    counting = false;
    const repeats = [...reqs.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
    const worst = repeats[0]?.[1] ?? 1;
    const healCap = C.STREAM_KEEPER?.healCap ?? 3;
    const stats = await page.evaluate(() => ({
      sb: window.__satBuildings?.stats ?? null,
      sky: window.__satSkyline?.stats ?? null,
      sbReason: window.__satBuildings?.stats?.emptyByReason ?? null,
      skyReason: window.__satSkyline?.stats?.emptyByReason ?? null,
      evictions: window.__satBuildings?.stats?.evictions ?? null,
      heals: window.__satBuildings?.stats?.heals ?? null,
    }));
    console.log(
      `BROWSER: ${reqs.size} distinct tile URLs in the settled 60 s window · ` +
        `${repeats.length} re-requested · worst ${worst}x · stats=${JSON.stringify(stats)}`
    );
    if (repeats.length)
      console.log('  worst offenders:', repeats.slice(0, 5).map(([u, n]) => `${n}x ${u.slice(-28)}`).join(' | '));
    gate(
      `(7) NO UNBOUNDED RE-REQUEST — no tile fetched more than ${healCap + 1}x in a settled 60 s`,
      worst <= healCap + 1,
      `worst=${worst}x across ${reqs.size} tiles`
    );
    red.push(['P2/P6 heal + retry loops', 'verify-seam (7)', `${worst}x`, `<= ${healCap + 1}x`]);
    if (!stats.sbReason && !stats.skyReason)
      soft('(8) emptyByReason telemetry', 'B', `sb=${JSON.stringify(stats.sb)}`);
    else
      gate(
        '(8) EMPTY-REASON TELEMETRY — engines classify their empties',
        !!stats.sbReason,
        JSON.stringify({ sb: stats.sbReason, sky: stats.skyReason })
      );
    gate('(9) zero pageerrors in the browser leg', errs.length === 0, errs.slice(0, 3).join(' | '));
    browserOut = { distinct: reqs.size, repeats: repeats.slice(0, 20), stats };
    await browser.close();
  } else {
    console.log('SKIP browser leg (set FLY_URL to run gates 7-9)');
  }

  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  fs.writeFileSync(
    path.join(__dirname, 'r21-e-red-seam.json'),
    JSON.stringify(
      { when: new Date().toISOString(), lock: LOCK, ramp: RAMP, tiles, map: pts, pairs, browserOut, red, fails, softs },
      null,
      1
    )
  );
  if (softs.length) console.log(`SOFT (instruments missing): ${softs.join(', ')}`);
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  console.error(e.stack?.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
});

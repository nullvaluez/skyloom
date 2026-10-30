/**
 * SHIP PASS SKY (FLY_SHIP_PASS.md SK-1, joint with CITY CT-1) — the grey-veil
 * diagnosis matrix.
 *
 * The owner's report: Manhattan dissolves into a uniform grey veil from about
 * 8,000 ft in clear weather (FLY_SHIP_PASS.md L-01). Before either stream codes
 * a fix, this harness measures WHICH term takes the contrast away: it pins a
 * clear noon over Midtown and, at 5,000 / 6,000 / 7,500 / 8,500 / 10,000 ft,
 * measures the Midtown block-to-street luma contrast and the ground chroma in
 * each arm:
 *
 *   baseline     the shipped frame (Enhanced, aerial perspective NOT pinned —
 *                the fleet's `__flyAerialOverride = 0` is deliberately absent)
 *   aerial-pin   window.__flyAerialOverride = 0 (the fleet pin, live)
 *   air-off      window.__flySkyDiag = { aerial: 0 } (SKY's pin: the whole
 *                Enhanced aerial post pass leaves the ground pixels; see
 *                lib/fly/sky-diag.js) — the atmosphere's full share
 *   no-mist      ?flags=-GROUND_MIST (its own page load: a module-load flag)
 *   city-fade    window.__flyCityDiag = { fadeStartM, fadeEndM } (CITY's
 *                frozen CT-1 pin: the detailed-building fade pushed out)
 *   city-premix  window.__flyCityDiag = { skylinePremix: 0 } (CITY's pin: the
 *                skyline's baked haze premix off)
 *
 * CITY's code is not on the SKY branch. Each city arm boots with its pin and
 * asks the tree whether it honoured it (`window.__flyCityDiagApplied === true`,
 * CITY's published contract); when it did not, every row of that arm reads
 * "pending merged tree" and its altitude legs are skipped. The lead re-runs
 * this harness on the merged tree, where they are measured.
 *
 * MEASUREMENT. Each pose holds the aircraft south-south-west of Midtown so
 * Midtown (40.7549, -73.9840) sits `--depression` degrees (default 20) below
 * the horizon, heading straight at it, clock frozen, lens pinned to 60°. The
 * Midtown point is projected through the live camera and a square crop
 * (`--crop` of the viewport height, default 0.16) is read around it:
 *   contrast  percentile Michelson (P90 − P10) / (P90 + P10) of Rec. 709 luma —
 *             block (bright) against street (dark), robust to a stray pixel
 *   rms       luma standard deviation / mean
 *   chroma    mean CIELAB C* (the grey veil desaturates before it flattens)
 *   luma      mean luma (a veil brightens as it flattens)
 * A second crop 50 km ahead on the same heading carries SK-2's "distant
 * ridges keep their depth" acceptance (contrast at 50 km).
 * Live arms are captured on the SAME settled pose, and the baseline is
 * captured again after them (`baseline-2`): its drift is the noise floor of
 * every Δ in that row.
 *
 * VENUE. In the cloud container this runs on the R24 offline world fixture
 * (FLY_TILE_FIXTURE=1; its Manhattan is the synthetic `manhattan` scene of
 * scripts/r24-fixture/scenes.mjs — procedural blocks and a street lattice, no
 * real imagery) under SwiftShader. Those numbers attribute the MECHANISM;
 * the owner's RTX 5080 over real Esri imagery is where the veil itself is
 * judged (FLY_SHIP_PASS.md section 9, run list step 2). The fixture's
 * tile-identity stamp is switched off (FLY_FIXTURE_STAMP=off) so its digits
 * and hue band do not count as city contrast.
 *
 * USAGE (one browser at a time: hold /home/user/ship-pass-shared/heavy.lock):
 *   FLY_URL=http://localhost:3132 FLY_TILE_FIXTURE=1 node scripts/ship-sky-veil.cjs
 *   options: --arms=baseline,aerial-pin,air-off,no-mist,city-fade,city-premix
 *            (and `clarity`, ?flags=AERIAL_CLARITY, SK-2's own arm, opt-in: it
 *            boots once and measures `clarity` and its same-pose control
 *            `clarity-k0` = window.__flySkyDiag = { clarity: 0 }, k = 0, the
 *            shipped in-scatter on the flag-on text; --clarityFlags= widens
 *            that boot's ?flags=, default AERIAL_CLARITY)
 *            --alts=5000,6000,7500,8500,10000   --depression=20  --crop=0.16
 *            --fadeStartM=4500 --fadeEndM=5000 (the city-fade arm's pin)
 *            --width --height (default 1280x800 live, 480x300 on the fixture:
 *            this venue renders one Enhanced High 960x600 frame in ~30 s, so a
 *            capture cost ~80 s and five altitudes did not fit a lock hold)
 *            --quality=high --settle=4000
 *            --firstSharp (a boot group's first pose, after the far warp from
 *            the spawn; default 240000 live, 45000 on the fixture, whose
 *            terrain sat at z7 of a z16 target after 550 s here and never
 *            reports sharp) --sharpTimeout (60000 live, 20000 fixture)
 *            --bootWait=90000 --legTimeout=300000 --out=.graphics-review/ship-pass/sky/veil
 * Altitudes are MEASURED in priority order (8,500 and 6,000 ft first: the
 * veil's own comparison, then 10,000 / 7,500 / 5,000), so a run cut short by
 * a lock hold still carries the deciding rows; the table is ascending.
 * Writes veil.json, veil.md (the table) and one PNG per arm and altitude.
 * Exit code 0 when every requested, measurable cell was captured.
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const args = Object.fromEntries(process.argv.slice(2).map((s) => {
  const [k, ...v] = s.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : true];
}));
const FIXTURE = !!process.env.FLY_TILE_FIXTURE && process.env.FLY_TILE_FIXTURE !== '0';
// The fixture server is started in this process by attachFixture: clean imagery.
if (FIXTURE && process.env.FLY_FIXTURE_STAMP == null) process.env.FLY_FIXTURE_STAMP = 'off';
const { attachFixture, fixturePin } = require('./_fixture');

const url = (args.url || process.env.FLY_URL || 'http://localhost:3132').replace(/\/$/, '');
const out = path.resolve(args.out || '.graphics-review/ship-pass/sky/veil');
const viewport = FIXTURE ? { width: Number(args.width || 480), height: Number(args.height || 300) } : { width: Number(args.width || 1280), height: Number(args.height || 800) };
const quality = args.quality || 'high';
const settleMs = Number(args.settle || 4000);
const legTimeout = Number(args.legTimeout || 300000);
// terrain `sharp` and the streamers are waited on with their own, shorter cap:
// at SwiftShader's 1-3 fps a settle that never reports sharp would otherwise
// spend the whole leg timeout per pose (the first fixture run lost 300 s a pose).
const sharpTimeout = Number(args.sharpTimeout || (FIXTURE ? 20000 : 60000));
const firstSharp = Number(args.firstSharp || (FIXTURE ? 45000 : 240000));
const bootWait = Number(args.bootWait || 90000);
const warmup = Number(args.warmup || 240000);
// A pose whose lead arm moved more than this between its first capture and
// its re-capture (`baseline-2`, `clarity-2`, `no-mist-2`) was still streaming:
// it is measured once more at the end of its boot group (`--remeasure=0` off).
const remeasureK = Number(args.remeasure ?? 0.05);
const T0 = Date.now();
const log = (...m) => console.log(`[+${Math.round((Date.now() - T0) / 1000)}s]`, ...m);
const depressionDeg = Number(args.depression || 20);
const cropK = Number(args.crop || 0.16);
const ALTS_FT = String(args.alts || '5000,6000,7500,8500,10000').split(',').map(Number);
const PRIORITY = [8500, 6000, 10000, 7500, 5000];
const RUN_ORDER = [...ALTS_FT].sort((a, b) => (PRIORITY.indexOf(a) + 1 || 99) - (PRIORITY.indexOf(b) + 1 || 99));
const FT = 0.3048;
const MIDTOWN = { lat: 40.7549, lon: -73.984 };
const APPROACH_DEG = 22; // the aircraft sits SSW of Midtown and flies NNE at it
const CITY_FADE = { fadeStartM: Number(args.fadeStartM || 4500), fadeEndM: Number(args.fadeEndM || 5000) };

/** The arms: `boot` = its own page load (group key), `live` = a pin on the settled pose. */
const ARMS = {
  baseline: { boot: 'main', live: null },
  'aerial-pin': { boot: 'main', live: { set: 'window.__flyAerialOverride = 0', clear: 'delete window.__flyAerialOverride' } },
  'air-off': { boot: 'main', live: { set: 'window.__flySkyDiag = { aerial: 0 }', clear: 'delete window.__flySkyDiag', applied: 'aerial' } },
  'no-mist': { boot: 'no-mist', flags: '-GROUND_MIST' },
  'city-fade': { boot: 'city-fade', cityPin: { ...CITY_FADE } },
  'city-premix': { boot: 'city-premix', cityPin: { skylinePremix: 0 } },
  // SK-2 (opt-in with --arms): the fix's own arm, and its same-pose control
  // (k = 0 on the same flag-on page: S x 1.0, the shipped in-scatter).
  clarity: { boot: 'clarity', flags: String(args.clarityFlags || 'AERIAL_CLARITY') },
  'clarity-k0': { boot: 'clarity', live: { set: 'window.__flySkyDiag = { clarity: 0 }', clear: 'delete window.__flySkyDiag', applied: 'clarity' } },
};
/** The lead arm of a boot group re-captured after its live arms: that pose's noise floor. */
const RECAPTURE = { main: ['baseline', 'baseline-2'], clarity: ['clarity', 'clarity-2'], 'no-mist': ['no-mist', 'no-mist-2'] };
const SK1_ARMS = ['baseline', 'aerial-pin', 'air-off', 'no-mist', 'city-fade', 'city-premix'];
const wanted = String(args.arms || SK1_ARMS.join(',')).split(',').filter((a) => ARMS[a]);
if (wanted.includes('clarity') && !wanted.includes('clarity-k0')) wanted.push('clarity-k0');
const ROWS = () => [...wanted, ...Object.values(RECAPTURE).filter(([lead]) => wanted.includes(lead)).map(([, again]) => again)];

/** UTC epoch of local SOLAR noon at a longitude on a fixed summer date. */
const solarNoon = (lon, day = Date.UTC(2026, 6, 18)) => day + (12.5 - lon / 15) * 3600000;

// --- a minimal PNG decoder (8-bit RGB/RGBA, non-interlaced: what Chromium writes)
function decodePng(buf) {
  let o = 8, w = 0, h = 0, ct = 0, idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8);
    if (type === 'IHDR') {
      w = buf.readUInt32BE(o + 8); h = buf.readUInt32BE(o + 12); ct = buf[o + 17];
      if (buf[o + 16] !== 8 || buf[o + 20] !== 0) throw new Error('decodePng: only 8-bit non-interlaced');
    } else if (type === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`decodePng: colour type ${ct}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * bpp, px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[row + x - bpp] : 0, b = y ? px[row - stride + x] : 0, c = x >= bpp && y ? px[row - stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const LIN = Float64Array.from({ length: 256 }, (_, i) => lin(i));
function labChroma(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const a = 500 * (f(X) - f(Y)), bb = 200 * (f(Y) - f(Z));
  return Math.hypot(a, bb);
}

/** Statistics of a square crop centred at (cx, cy) with half-size hs (pixels). */
function cropStats(img, cx, cy, hs) {
  const x0 = Math.max(0, Math.round(cx - hs)), x1 = Math.min(img.w, Math.round(cx + hs));
  const y0 = Math.max(0, Math.round(cy - hs)), y1 = Math.min(img.h, Math.round(cy + hs));
  const lumas = [];
  let chroma = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * img.w + x) * img.bpp, r = img.px[i], g = img.px[i + 1], b = img.px[i + 2];
    lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
    chroma += labChroma(r, g, b);
  }
  if (lumas.length < 64) return null;
  const n = lumas.length, mean = lumas.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(lumas.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  lumas.sort((a, b) => a - b);
  const p10 = lumas[Math.floor(n * 0.1)], p90 = lumas[Math.floor(n * 0.9)];
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  return { n, box: [x0, y0, x1, y1], contrast: r4((p90 - p10) / Math.max(1e-6, p90 + p10)), rms: r4(sd / Math.max(1e-6, mean)), chroma: r4(chroma / n), luma: r4(mean), p10: r4(p10), p90: r4(p90) };
}

const report = { harness: 'ship-sky-veil', url, venue: FIXTURE ? 'fixture/SwiftShader (synthetic Manhattan, stamp off)' : 'live providers', viewport, quality, depressionDeg, cropK, cityFade: CITY_FADE, altsFt: ALTS_FT, arms: {}, errors: [], startedAt: new Date().toISOString() };
const save = () => {
  fs.writeFileSync(path.join(out, 'veil.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(out, 'veil.md'), table());
};

function table() {
  const L = [`# Grey-veil matrix (${report.venue})`, '', `Midtown crop ${cropK} of viewport height, ${depressionDeg}° below the horizon; contrast = (P90−P10)/(P90+P10) luma; chroma = mean CIELAB C*.`, ''];
  L.push('| Arm | ' + ALTS_FT.map((a) => `${a} ft contrast / chroma`).join(' | ') + ' |');
  L.push('|---|' + ALTS_FT.map(() => '---').join('|') + '|');
  for (const arm of ROWS()) {
    const rows = report.arms[arm];
    if (!rows) continue;
    L.push(`| ${arm} | ` + ALTS_FT.map((a) => {
      const c = rows[a];
      if (!c) return '—';
      if (c.pending) return c.pending;
      if (c.error) return `error: ${c.error}`;
      return c.midtown ? `${c.midtown.contrast} / ${c.midtown.chroma}` : 'no crop';
    }).join(' | ') + ' |');
  }
  L.push('', '50 km ahead (SK-2 depth check): contrast per arm and altitude', '');
  L.push('| Arm | ' + ALTS_FT.map((a) => `${a} ft`).join(' | ') + ' |');
  L.push('|---|' + ALTS_FT.map(() => '---').join('|') + '|');
  for (const arm of ROWS()) {
    const rows = report.arms[arm];
    if (!rows) continue;
    L.push(`| ${arm} | ` + ALTS_FT.map((a) => (rows[a]?.far ? String(rows[a].far.contrast) : rows[a]?.pending ? 'pending' : '—')).join(' | ') + ' |');
  }
  // Δ against the control: live arms against their own pose's lead capture
  // (same page, same settled frame); boot arms against the baseline of the
  // same altitude (cross-boot: read against baseline-2's drift).
  const CONTROL = { 'aerial-pin': 'baseline', 'air-off': 'baseline', 'baseline-2': 'baseline', 'clarity-k0': 'clarity', 'clarity-2': 'clarity', clarity: 'clarity-k0', 'no-mist': 'baseline', 'no-mist-2': 'no-mist', 'city-fade': 'baseline', 'city-premix': 'baseline' };
  const pct = (v, c) => (Number.isFinite(v) && Number.isFinite(c) && c ? `${v >= c ? '+' : ''}${(((v - c) / c) * 100).toFixed(1)}%` : '—');
  L.push('', 'Midtown contrast Δ against the control (clarity against its k = 0 control; no-mist and the city arms cross-boot against baseline)', '');
  L.push('| Arm (vs control) | ' + ALTS_FT.map((a) => `${a} ft`).join(' | ') + ' |');
  L.push('|---|' + ALTS_FT.map(() => '---').join('|') + '|');
  for (const arm of ROWS()) {
    const ctl = CONTROL[arm], rows = report.arms[arm];
    if (!ctl || !rows) continue;
    L.push(`| ${arm} (vs ${ctl}) | ` + ALTS_FT.map((a) => (rows[a]?.pending ? 'pending' : pct(rows[a]?.midtown?.contrast, report.arms[ctl]?.[a]?.midtown?.contrast))).join(' | ') + ' |');
  }
  return L.join('\n') + '\n';
}

async function newPage(browser, arm) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => report.errors.push({ arm, kind: 'pageerror', message: e.message.slice(0, 400) }));
  page.on('console', (m) => {
    if (m.type() === 'error' && /shader|WebGL|program|GLSL|ReferenceError|TypeError/i.test(m.text())) report.errors.push({ arm, kind: 'console', message: m.text().slice(0, 600) });
  });
  if (FIXTURE) {
    const fx = await attachFixture(ctx);
    await page.addInitScript((pin) => { window.__flyTileFixture = pin; window.__flyFinalizeBudgetK = 40; }, fixturePin(fx.url, Number(process.env.FLY_FIXTURE_DEM_MAXZOOM || 15)));
  } else {
    await page.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
  }
  const A = ARMS[arm];
  await page.addInitScript(({ quality, sun, cityPin }) => {
    window.__flySunOverride = sun;
    window.__flyWeatherOverride = 'clear';
    window.__flyGovPin = 'hold';
    window.__flyBoostInfinite = true;
    window.__flyTitleBypass = true;
    window.__flyVisualsOverride = 'enhanced';
    if (cityPin) window.__flyCityDiag = cityPin;
    try {
      localStorage.setItem('fly-map-style-2', 'satellite');
      localStorage.setItem('fly-quality-tier', quality);
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-encounters', '0');
      localStorage.setItem('fly-visuals', 'enhanced');
    } catch { /* private mode: defaults */ }
  }, { quality, sun: solarNoon(MIDTOWN.lon), cityPin: A.cityPin ?? null });
  const q = `?graphicsReview=1${A.flags ? `&flags=${encodeURIComponent(A.flags)}` : ''}`;
  await page.goto(`${url}/${q}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 300000 });
  await page.evaluate(() => {
    const rt = window.__fly, store = window.__flyStore.getState();
    rt.operations.phase = 'airborne'; rt.operations.profile = null; rt.operations.warp(rt.flight);
    store.setHangarOpen(false);
  });
  return page;
}

/** Aircraft pose for an altitude: Midtown `depressionDeg` below the horizon, dead ahead. */
function poseFor(altFt) {
  const altM = altFt * FT, dM = (altM - 12) / Math.tan((depressionDeg * Math.PI) / 180);
  const back = ((APPROACH_DEG + 180) * Math.PI) / 180;
  return {
    lat: MIDTOWN.lat + (dM * Math.cos(back)) / 111320,
    lon: MIDTOWN.lon + (dM * Math.sin(back)) / (111320 * Math.cos((MIDTOWN.lat * Math.PI) / 180)),
    altM, headingDeg: APPROACH_DEG, dM,
  };
}

async function place(page, p) {
  await page.evaluate((p) => {
    const r = window.__fly, s = window.__flyStore.getState();
    r.operations.profile = null; r.operations.phase = 'airborne';
    s.setPhase('flying');
    r.warpToGeo(p.lat, p.lon, { altM: p.altM, headingRad: (p.headingDeg * Math.PI) / 180, name: null });
    r.autopilot?.disengage?.();
    const f = r.flight;
    window.__veilPose = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: (p.headingDeg * Math.PI) / 180 };
    window.__veilStep ??= f.step.bind(f);
    f.step = (dt, cmd) => {
      window.__veilStep(dt, { ...cmd, turn: 0, pitch: 0, boost: false });
      const q = window.__veilPose;
      f.pos.x = q.x; f.pos.y = q.y; f.pos.z = q.z;
      f.heading = q.heading; f.pitch = 0.02; f.bank = 0; f.agl = f.pos.y - f.groundElev;
    };
    r.chaseCam?.snap?.();
    const cam = r.camera;
    if (!cam.__veilLens) {
      Object.defineProperty(cam, 'fov', { configurable: true, get: () => 60, set: () => {} });
      cam.__veilLens = true; cam.updateProjectionMatrix();
    }
  }, p);
}

async function settle(page, first = false) {
  const t0 = Date.now(), ready = {};
  const sharpCap = Math.min(legTimeout, first ? firstSharp : sharpTimeout);
  const wait = async (name, fn, ms) => { try { await page.waitForFunction(fn, undefined, { timeout: ms, polling: 1000 }); ready[name] = true; } catch { ready[name] = false; } };
  await wait('worldLoading', () => !window.__fly.worldLoading, legTimeout);
  await wait('terrainSharp', () => (window.__fly.terraStats ?? window.__fly.engine?.terraStats)?.sharp === true, sharpCap);
  await wait('streamers', () => {
    const rt = window.__fly;
    return ['satBuildings', 'satRoads', 'satSkyline', 'satVeg'].every((k) => {
      const s = rt[k]?.stats;
      return !s || ['queued', 'building', 'sampling'].every((f) => Number(s[f] ?? 0) === 0);
    });
  }, first ? sharpCap : Math.min(legTimeout, sharpTimeout));
  // The first pose after the far warp: the terrain streams Manhattan from
  // nothing (measured here: z3 of a z15 target 129 s after the warp, z11 by
  // 210 s), so wait until the camera tile is within three levels of target.
  if (first) await wait('warmup', () => {
    const t = window.__fly.terraStats ?? window.__fly.engine?.terraStats;
    return !t || t.sharp === true || (Number.isFinite(t.camTileZ) && Number.isFinite(t.targetZ) && t.camTileZ >= t.targetZ - 3);
  }, warmup);
  ready.terra = await page.evaluate(() => {
    const t = window.__fly.terraStats ?? window.__fly.engine?.terraStats;
    return t ? { sharp: t.sharp, reason: t.sharpReason ?? null, camTileZ: t.camTileZ, targetZ: t.targetZ, downloading: t.downloading } : null;
  });
  await page.waitForTimeout(settleMs);
  ready.ms = Date.now() - t0;
  return ready;
}

async function freeze(page, on) {
  await page.waitForFunction(() => !!window.__fly?.engine?.object, undefined, { timeout: 60000, polling: 500 });
  return page.evaluate((on) => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    const c = scene.__r3f?.root?.getState()?.clock;
    if (!c) return false;
    if (on) {
      window.__veilClock ??= { getDelta: c.getDelta, getElapsedTime: c.getElapsedTime };
      c.elapsedTime = 240; c.getDelta = () => 1 / 60; c.getElapsedTime = () => 240;
      scene.__r3f.root.getState().gl.domElement.setAttribute('data-veil-canvas', '');
    } else if (window.__veilClock) {
      c.getDelta = window.__veilClock.getDelta; c.getElapsedTime = window.__veilClock.getElapsedTime;
      delete window.__veilClock;
    }
    return true;
  }, on);
}

/** Screen points (pixels) of Midtown and of the ground 50 km ahead, through the live camera. */
function project(page, p) {
  return page.evaluate(({ mid, p }) => {
    const r = window.__fly, cam = r.camera, player = window.__flyPlayer;
    if (!player) return null;
    cam.updateMatrixWorld();
    const V = cam.position.constructor;
    const base = player.getWorldPosition(new V());
    const toScreen = (lon, lat, y) => {
      const w = r.engine.geoToWorld(lon, lat, y);
      const v = base.clone().add(new V(w.x - r.flight.pos.x, w.y - r.flight.pos.y, w.z - r.flight.pos.z)).project(cam);
      if (!(v.z > -1 && v.z < 1) || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return null;
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (0.5 - v.y * 0.5) * innerHeight };
    };
    const hd = p.headingDeg * Math.PI / 180, far = 50000;
    const farLat = p.lat + (far * Math.cos(hd)) / 111320;
    const farLon = p.lon + (far * Math.sin(hd)) / (111320 * Math.cos((p.lat * Math.PI) / 180));
    return { midtown: toScreen(mid.lon, mid.lat, 12), far: toScreen(farLon, farLat, 12), agl: r.flight.pos.y - r.flight.groundElev, cinema: !!r.cinemaEnvironment, visuals: window.__flyStore.getState().visuals, tier: window.__flyStore.getState().qualityTier };
  }, { mid: MIDTOWN, p });
}

const CANVAS_ONLY = 'body * { visibility:hidden!important; } canvas[data-veil-canvas] { visibility:visible!important; }';
async function capture(page, arm, altFt, pts) {
  const file = path.join(out, `${arm}-${altFt}ft.png`);
  const buf = await page.screenshot({ path: file, timeout: 300000, style: CANVAS_ONLY });
  const img = decodePng(buf), hs = (cropK * img.h) / 2;
  return {
    file: path.basename(file),
    midtown: pts?.midtown ? cropStats(img, pts.midtown.x, pts.midtown.y, hs) : null,
    far: pts?.far ? cropStats(img, pts.far.x, pts.far.y, hs * 0.4) : null,
  };
}

// Both city arms ride one pin object and one publisher (CITY's
// `__flyCityDiagApplied`): once a booted tree has said it does not honour
// `window.__flyCityDiag`, the other city arm is pending without its own boot.
let cityHonoured = null;
const markPending = (arm, why) => {
  report.arms[arm] = { applied: false };
  for (const a of ALTS_FT) report.arms[arm][a] = { pending: 'pending merged tree' };
  log(`  ${arm}: ${why} — pending merged tree`);
  save();
};

async function runBootGroup(browser, group) {
  const arms = wanted.filter((a) => ARMS[a].boot === group);
  if (!arms.length) return;
  const lead = arms[0];
  if (ARMS[lead].cityPin && cityHonoured === false) {
    markPending(lead, 'this tree does not honour window.__flyCityDiag (seen on the first city boot)');
    return;
  }
  log(`BOOT ${group} (${arms.join(', ')})${ARMS[lead].flags ? ` ?flags=${ARMS[lead].flags}` : ''}`);
  let page;
  try {
    page = await newPage(browser, lead);
    await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, { timeout: bootWait, polling: 1000 }).catch(() => {});
    log(`  booted (pct ${await page.evaluate(() => window.__flyBoot?.pct ?? null)})`);
    if (ARMS[lead].cityPin) {
      await page.waitForTimeout(3000);
      const applied = await page.evaluate(() => window.__flyCityDiagApplied === true);
      cityHonoured = applied;
      if (!applied) {
        markPending(lead, 'this tree does not honour window.__flyCityDiag (no __flyCityDiagApplied after boot)');
        return;
      }
      report.arms[lead] = { applied };
    }
    const order = [...RUN_ORDER];
    const remeasured = new Set();
    for (let li = 0; li < order.length; li++) {
      const altFt = order[li];
      const p = poseFor(altFt);
      const isRepeat = li >= RUN_ORDER.length; // a re-measure: keep the first reading
      const firstPass = {};
      if (isRepeat) for (const arm of Object.keys(report.arms)) if (report.arms[arm]?.[altFt]?.midtown) firstPass[arm] = report.arms[arm][altFt];
      log(`  ${group} ${altFt} ft: aircraft ${(p.dM / 1000).toFixed(2)} km from Midtown`);
      try {
      await place(page, p);
      const ready = await settle(page, li === 0);
      log(`    settled ${JSON.stringify({ ...ready, terra: ready.terra && { sharp: ready.terra.sharp, z: ready.terra.camTileZ, target: ready.terra.targetZ } })}`);
      await freeze(page, true);
      await page.waitForTimeout(2500);
      const pts = await project(page, p);
      const again = RECAPTURE[group] && arms.includes(RECAPTURE[group][0]) ? [RECAPTURE[group][1]] : [];
      for (const arm of [...arms, ...again]) {
        const A = ARMS[arm] && arm !== lead && ARMS[arm].live ? ARMS[arm] : { live: null };
        try {
          if (A.live) {
            await page.evaluate((js) => { (0, eval)(js); }, A.live.set);
            await page.waitForTimeout(2500);
          }
          const cell = await capture(page, arm, altFt, pts);
          cell.ready = ready; cell.pose = { ...p, agl: pts?.agl, cinema: pts?.cinema, visuals: pts?.visuals, tier: pts?.tier };
          if (A.live?.applied) cell.applied = await page.evaluate((k) => window.__flySkyDiagApplied?.[k] === true, A.live.applied);
          if (firstPass[arm]) cell.firstPass = { midtown: firstPass[arm].midtown, far: firstPass[arm].far, ready: firstPass[arm].ready };
          (report.arms[arm] ??= {})[altFt] = cell;
          log(`    ${arm.padEnd(12)} midtown ${JSON.stringify(cell.midtown && { c: cell.midtown.contrast, chroma: cell.midtown.chroma, luma: cell.midtown.luma })} far ${cell.far?.contrast ?? '—'}`);
        } catch (e) {
          (report.arms[arm] ??= {})[altFt] = { error: e.message.split('\n')[0] };
        } finally {
          if (A.live) await page.evaluate((js) => { (0, eval)(js); }, A.live.clear);
        }
      }
      await freeze(page, false);
      } catch (e) {
        for (const arm of arms) (report.arms[arm] ??= {})[altFt] ??= { error: e.message.split('\n')[0] };
        report.errors.push({ arm: group, altFt, kind: 'leg', message: e.message.split('\n')[0] });
        log(`  ${group} ${altFt} ft FAILED: ${e.message.split('\n')[0]}`);
      }
      save();
      // An unsettled pose (its lead drifted past remeasureK before its
      // re-capture) is queued once more at the end of the group; the first
      // reading is kept under `firstPass` for the record.
      const [leadArm, againArm] = RECAPTURE[group] ?? [];
      const c1 = report.arms[leadArm]?.[altFt]?.midtown?.contrast, c2 = report.arms[againArm]?.[altFt]?.midtown?.contrast;
      if (remeasureK > 0 && !remeasured.has(altFt) && Number.isFinite(c1) && Number.isFinite(c2) && Math.abs(c2 - c1) / Math.max(1e-6, c1) > remeasureK) {
        remeasured.add(altFt);
        order.push(altFt);
        log(`  ${group} ${altFt} ft: lead drifted ${(((c2 - c1) / c1) * 100).toFixed(1)}% before its re-capture (still streaming) — measured again at the end`);
      }
    }
  } catch (e) {
    report.errors.push({ arm: group, kind: 'fatal', message: e.message.split('\n')[0] });
    console.error(e);
  } finally {
    await page?.context().close().catch(() => {});
  }
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  try {
    for (const group of [...new Set(wanted.map((a) => ARMS[a].boot))]) await runBootGroup(browser, group);
  } finally {
    report.finishedAt = new Date().toISOString();
    save();
    await browser.close();
  }
  const missing = [];
  for (const arm of wanted) for (const a of ALTS_FT) {
    const c = report.arms[arm]?.[a];
    if (!c || c.error || (!c.pending && !c.midtown)) missing.push(`${arm}@${a}`);
  }
  console.log(table());
  console.log(`DONE ship-sky-veil: ${report.errors.length} page error(s); ${missing.length ? `missing ${missing.join(', ')}` : 'every measurable cell captured'} -> ${out}`);
  process.exit(missing.length || report.errors.some((e) => e.kind === 'pageerror') ? 1 : 0);
})();

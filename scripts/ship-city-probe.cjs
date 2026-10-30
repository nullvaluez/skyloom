/**
 * SHIP PASS CITY (FLY_SHIP_PASS.md 5.3) — the stream's browser probe.
 *
 * THE VENUE (3.8): the cloud container, SwiftShader WebGL (correct pixels,
 * about 1-3 fps) and the R24 OFFLINE WORLD FIXTURE (FLY_TILE_FIXTURE=1). Every
 * number this prints is a FIXTURE / SWIFTSHADER number: it ranks causes and
 * proves mechanisms, it never grades a device, an fps or a look. The owner's
 * RTX 5080 / iPhone runs are the run list in FLY_SHIP_PASS.md section 9.
 *
 * Modes (--mode=…, default veil):
 *   veil    SK-1, the city arms, at SKY's poses and with SKY's metric (ported
 *           from scripts/ship-sky-veil.cjs): Midtown, pinned clear solar noon
 *           (__flySunOverride, __flyWeatherOverride 'clear'), at 5,000 /
 *           6,000 / 7,500 / 8,500 / 10,000 ft, Enhanced and the aerial pass
 *           un-pinned (the product frame). Arms (live pins on one boot):
 *           baseline; `fade` (__flyCityDiag fadeStartM/EndM = 4,500/5,000 m);
 *           `baseline-2` (the noise floor); `--bootPin=premix` boots with
 *           __flyCityDiag skylinePremix 0. Writes veil.json + PNGs.
 *   settle  how long the city takes to land here (streamer stats over time).
 *   smoke   one boot per arm in --arms (e.g. "off,CITY_RANGE,NIGHT_LITE";
 *           "CITY_RANGE+NIGHT_LITE" is one arm with both flags; --census adds
 *           the per-layer draw attribution at each pose):
 *           ?flags=NAME, Midtown at --poses (m AGL; default 900 m and 8,000 ft),
 *           at night when the arm is a NIGHT_* flag or --night; --cls pins the
 *           city's device class (window.__flyCityDeviceClass), --device=phone
 *           emulates touch; counts page errors and shader compile
 *           errors; captures stills; prints a draw census per pose.
 *
 * Draws are counted by an instrument independent of the app: every
 * drawElements / drawArrays (and their instanced forms) between two
 * requestAnimationFrame ticks (gl.info is reset mid-frame by the composer and
 * __flyStats only republishes every 60 frames, i.e. every ~30 s here).
 *
 * Run (under the heavy lock, with the dev server on 3133):
 *   FLY_URL=http://localhost:3133 FLY_TILE_FIXTURE=1 node scripts/ship-city-probe.cjs --mode=veil
 * Browser channel: PLAYWRIGHT_CHANNEL (unset = Playwright's bundled Chromium).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const MODE = args.mode || 'veil';
const OUT = path.resolve(__dirname, '..', '.graphics-review/ship-pass/city', args.out || MODE);
fs.mkdirSync(OUT, { recursive: true });
const VIEW = { width: Number(args.w || 960), height: Number(args.h || 540) };
const DWELL = Number(args.dwell || 45000);
const NOON_UTC = Date.parse('2026-06-21T16:00:00Z'); // 12:00 EDT over Manhattan
const NIGHT_UTC = Date.parse('2026-06-22T03:30:00Z'); // 23:30 EDT
const MIDTOWN = { lat: 40.7549, lon: -73.984 };
const FT = 0.3048;

function log(...a) {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log(line);
  fs.appendFileSync(path.join(OUT, 'probe.log'), line + '\n');
}

/** Installed before the app: per-frame draw counts, shader errors. */
function instrument() {
  let calls = 0;
  const hist = [];
  for (const C of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext]) {
    if (!C) continue;
    const P = C.prototype;
    for (const fn of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
      const orig = P[fn];
      if (typeof orig !== 'function') continue;
      P[fn] = function (...a) {
        calls++;
        return orig.apply(this, a);
      };
    }
  }
  // WEBGL_multi_draw submissions (BatchedMesh: the airport set) are not on the
  // context prototype: count one per call through the extension object.
  for (const C of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext]) {
    if (!C) continue;
    const ge = C.prototype.getExtension;
    C.prototype.getExtension = function (name) {
      const ext = ge.call(this, name);
      if (ext && /multi_draw/i.test(name) && !ext.__cityCounted) {
        for (const fn of Object.keys(Object.getPrototypeOf(ext)).concat(Object.keys(ext))) {
          if (!/^multiDraw/.test(fn) || typeof ext[fn] !== 'function') continue;
          const orig = ext[fn].bind(ext);
          ext[fn] = (...a) => {
            calls++;
            return orig(...a);
          };
        }
        ext.__cityCounted = true;
      }
      return ext;
    };
  }
  let total = 0;
  let frames = 0;
  const tick = () => {
    if (calls > 0) {
      hist.push(calls);
      if (hist.length > 40) hist.shift();
      frames++;
    }
    total += calls;
    calls = 0;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__cityDraws = () => hist.slice();
  // Monotone counters for the per-layer attribution (census): every draw ever
  // submitted, and the number of frames that submitted any.
  window.__cityDrawTotal = () => total + calls;
  window.__cityFrames = () => frames;
}

async function launch() {
  const ch = process.env.PLAYWRIGHT_CHANNEL;
  return chromium.launch({
    ...(ch ? { channel: ch } : {}),
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

async function newPage(browser, { pins = {}, unpin = [], device = null }) {
  const ctx = await browser.newContext({ viewport: VIEW, ...(device === 'phone' ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}) });
  const page = await ctx.newPage();
  const errs = { page: [], shader: [], console: [] };
  page.on('pageerror', (e) => errs.page.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Shader Error|shader|WebGLProgram|VALIDATE_STATUS|could not compile/i.test(t)) errs.shader.push(t.slice(0, 300));
    else errs.console.push(t.slice(0, 200));
  });
  await page.addInitScript(instrument);
  if (unpin.length) await page.addInitScript(unpinPins, unpin);
  // A pin on an un-pinned fleet name (e.g. __flyWeatherOverride: 'clear') is
  // served through _boot's unpin getter (window.__r22Unpinned), so the fleet's
  // own value never lands and ours does.
  await page.addInitScript(([p, un]) => {
    for (const [k, v] of Object.entries(p)) {
      if (un.includes(k)) (window.__r22Unpinned ??= {})[k] = v;
      else window[k] = v;
    }
  }, [pins, unpin]);
  return { page, errs, ctx };
}

/** Pin a pose: south of the target by depressionK·AGL so the city sits mid-frame. */
async function pinPose(page, { lat, lon, altM, heading = 0, pitch = -0.5 }) {
  const back = altM / Math.tan(-pitch) / 111320;
  // The runtime handles are null while FlyScene (re)mounts: wait for them.
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function' && !!window.__fly?.flight, undefined, { timeout: 300000, polling: 1000 });
  await page.evaluate(([la, lo, alt, hd, pt]) => {
    window.__fly.warpToGeo(la, lo, { altM: alt, name: null, headingRad: hd });
    const f = window.__fly.flight;
    if (window.__pin) clearInterval(window.__pin);
    let p = null;
    window.__pin = setInterval(() => {
      if (!p) p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = hd;
      f.pitch = pt;
      f.bank = 0;
      f.speed = 0;
    }, 8);
  }, [lat - back, lon, altM, heading, pitch]);
}

async function stats(page) {
  return page.evaluate(() => {
    const d = window.__cityDraws?.() ?? [];
    const sb = window.__satBuildings?.stats;
    const sk = window.__satSkyline?.stats;
    const f = window.__fly?.flight;
    return {
      draws: d.length ? Math.max(...d.slice(-8)) : null,
      drawsMedian: d.length ? d.slice(-8).sort((a, b) => a - b)[Math.floor(Math.min(8, d.length) / 2)] : null,
      eyeAgl: f ? Math.round(f.pos.y - f.groundElev) : null,
      bReady: sb?.ready ?? null,
      bRing: sb?.ringOn ?? null,
      band: sb?.cityBand ?? 'shipped',
      skReady: sk?.ready ?? null,
      applied: window.__flyCityDiagApplied === true,
      tier: window.__flyStore?.getState().qualityTier,
      preset: window.__flyStore?.getState().qualityPreset,
      nightLite: window.__flyStats?.nightLite ?? null,
    };
  });
}

/**
 * Luma statistics of the ground crop (rows 35%..95%, cols 15%..85%) of a
 * screenshot, decoded IN THE PAGE (a 2D canvas; the harness adds no PNG
 * dependency). Rec. 709 luma on the 8-bit sRGB values.
 */
async function lumaStats(page, png) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const y0 = Math.floor(img.height * 0.35);
    const y1 = Math.floor(img.height * 0.95);
    const x0 = Math.floor(img.width * 0.15);
    const x1 = Math.floor(img.width * 0.85);
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const L = new Float32Array(d.length / 4);
    let chroma = 0;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      L[j] = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      chroma += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    }
    L.sort();
    const n = L.length;
    let sum = 0;
    for (const v of L) sum += v;
    const mean = sum / n;
    let ss = 0;
    for (const v of L) ss += (v - mean) ** 2;
    const sd = Math.sqrt(ss / n);
    const q = (p) => L[Math.min(n - 1, Math.floor(p * n))];
    return { mean: +mean.toFixed(2), rms: +(sd / Math.max(1, mean)).toFixed(4), spread: +((q(0.9) - q(0.1)) / Math.max(1, mean)).toFixed(4), chroma: +(chroma / n).toFixed(2) };
  }, png.toString('base64'));
}

/**
 * The 60 s still diff (CT-4 "no crawl"): two stills of the same pinned pose
 * `ms` apart; the fraction of pixels whose luma moved by more than 8 levels and
 * the mean absolute luma change. Other animated layers (water, traffic, clouds)
 * move in every arm alike, so the reading is the flag-on arm against the
 * flag-off arm, not an absolute zero.
 */
async function stillDiff(page, a, b) {
  return page.evaluate(
    async ([a64, b64]) => {
      const dec = async (b) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, img.width, img.height).data;
      };
      const A = await dec(a64);
      const B = await dec(b64);
      let moved = 0;
      let sum = 0;
      const n = Math.min(A.length, B.length) / 4;
      for (let i = 0; i < n * 4; i += 4) {
        const la = 0.2126 * A[i] + 0.7152 * A[i + 1] + 0.0722 * A[i + 2];
        const lb = 0.2126 * B[i] + 0.7152 * B[i + 1] + 0.0722 * B[i + 2];
        const d = Math.abs(la - lb);
        sum += d;
        if (d > 8) moved++;
      }
      return { movedFrac: +(moved / n).toFixed(5), meanAbs: +(sum / n).toFixed(3) };
    },
    [a.toString('base64'), b.toString('base64')]
  );
}

async function shot(page, name) {
  const png = await page.screenshot({ path: path.join(OUT, `${name}.png`), timeout: 120000 });
  return png;
}

// ---- SK-1 geometry and metric, ported from SKY's scripts/ship-sky-veil.cjs
// (ship/sky 22c31a2) so CITY's arms read the same numbers as SKY's table: the
// aircraft SSW of Midtown flying NNE at it, Midtown 20 deg below the horizon,
// lens 60 deg, clock frozen for the capture; a 0.16-viewport-height crop around
// the projected Midtown point; contrast = (P90-P10)/(P90+P10) of Rec. 709 luma,
// rms = sd/mean, chroma = mean CIELAB C*, luma = mean.
const VEIL_APPROACH_DEG = 22;
const VEIL_DEPRESSION_DEG = Number(args.depression || 20);
const VEIL_CROP = Number(args.crop || 0.16);
const solarNoon = (lon, day = Date.UTC(2026, 6, 18)) => day + (12.5 - lon / 15) * 3600000;
function veilPose(altFt) {
  const altM = altFt * FT;
  const dM = (altM - 12) / Math.tan((VEIL_DEPRESSION_DEG * Math.PI) / 180);
  const back = ((VEIL_APPROACH_DEG + 180) * Math.PI) / 180;
  return {
    lat: MIDTOWN.lat + (dM * Math.cos(back)) / 111320,
    lon: MIDTOWN.lon + (dM * Math.sin(back)) / (111320 * Math.cos((MIDTOWN.lat * Math.PI) / 180)),
    altM,
    headingDeg: VEIL_APPROACH_DEG,
    dM,
  };
}
function decodePng(buf) {
  const zlib = require('zlib');
  let o = 8, w = 0, h = 0, ct = 0;
  const idat = [];
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
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[row + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
const LIN = Float64Array.from({ length: 256 }, (_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
function labChroma(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return Math.hypot(500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z)));
}
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
  const n = lumas.length, mean = lumas.reduce((a, v) => a + v, 0) / n;
  const sd = Math.sqrt(lumas.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
  lumas.sort((a, b) => a - b);
  const p10 = lumas[Math.floor(n * 0.1)], p90 = lumas[Math.floor(n * 0.9)];
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  return { n, contrast: r4((p90 - p10) / Math.max(1e-6, p90 + p10)), rms: r4(sd / Math.max(1e-6, mean)), chroma: r4(chroma / n), luma: r4(mean) };
}
async function veilPlace(page, p) {
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function' && !!window.__fly?.flight, undefined, { timeout: 300000, polling: 1000 });
  await page.evaluate((p) => {
    const r = window.__fly;
    const s = window.__flyStore.getState();
    if (r.operations) { r.operations.profile = null; r.operations.phase = 'airborne'; }
    s.setPhase?.('flying');
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
      cam.__veilLens = true;
      cam.updateProjectionMatrix();
    }
  }, p);
}
async function veilFreeze(page, on) {
  return page.evaluate((on) => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    const c = scene.__r3f?.root?.getState()?.clock;
    if (!c) return false;
    if (on) {
      window.__veilClock ??= { getDelta: c.getDelta, getElapsedTime: c.getElapsedTime };
      const t = c.elapsedTime;
      c.getDelta = () => 1 / 60;
      c.getElapsedTime = () => t;
    } else if (window.__veilClock) {
      c.getDelta = window.__veilClock.getDelta;
      c.getElapsedTime = window.__veilClock.getElapsedTime;
      delete window.__veilClock;
    }
    return true;
  }, on);
}
function veilProject(page) {
  return page.evaluate((mid) => {
    const r = window.__fly, cam = r.camera, player = window.__flyPlayer;
    if (!player) return null;
    cam.updateMatrixWorld();
    const V = cam.position.constructor;
    const base = player.getWorldPosition(new V());
    const w = r.engine.geoToWorld(mid.lon, mid.lat, 12);
    const v = base.clone().add(new V(w.x - r.flight.pos.x, w.y - r.flight.pos.y, w.z - r.flight.pos.z)).project(cam);
    if (!(v.z > -1 && v.z < 1) || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return null;
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (0.5 - v.y * 0.5) * innerHeight, agl: r.flight.pos.y - r.flight.groundElev };
  }, MIDTOWN);
}
/** Poll the city streamers until idle with chunks resident, or `maxMs`. */
async function citySettle(page, maxMs, minMs = 8000) {
  const t0 = Date.now();
  await page.waitForTimeout(minMs);
  let last = null;
  while (Date.now() - t0 < maxMs) {
    last = await page.evaluate(() => {
      const pick = (s) => (s ? { chunks: s.chunks, queued: s.queued, building: s.building, draping: s.draping, ringOn: s.ringOn } : null);
      return { b: pick(window.__satBuildings?.stats), sk: pick(window.__satSkyline?.stats), loading: !!window.__fly?.worldLoading };
    });
    const idle = (x) => !x || (Number(x.queued ?? 0) === 0 && Number(x.building ?? 0) === 0 && Number(x.draping ?? 0) === 0);
    if (idle(last.b) && idle(last.sk)) return { ms: Date.now() - t0, idle: true, ...last };
    await page.waitForTimeout(5000);
  }
  return { ms: Date.now() - t0, idle: false, ...last };
}

/**
 * SK-1, the city arms, on ONE boot: the CT-1 pins are read live every frame,
 * so each arm is a pin on the settled pose (the fade pin also re-arms the
 * detail ring, so its streamers are settled again before the capture). The
 * baseline is captured again last at each altitude (`baseline-2`): its drift
 * is that row's noise floor. --arms=baseline,fade[,premix]; premix is honest
 * only on a boot with the pin (resident skyline groups keep their build), so
 * `--bootPin=premix` boots with it and measures that arm alone.
 */
async function veil() {
  const browser = await launch();
  const bootPin = args.bootPin === 'premix' ? { skylinePremix: 0 } : null;
  const { page, errs } = await newPage(browser, {
    pins: { __flySunOverride: solarNoon(MIDTOWN.lon), __flyWeatherOverride: 'clear', ...(bootPin ? { __flyCityDiag: bootPin } : {}) },
    // The product frame: Enhanced, the aerial pass and the satellite shadows as
    // shipped (the fleet pins them off / Classic for frozen gates), clear sky.
    unpin: ['__flyVisualsOverride', '__flyAerialOverride', '__flySatShadowOverride', '__flyWeatherOverride'],
  });
  const alts = String(args.alts || '5000,6000,7500,8500,10000').split(',').map(Number);
  const p0 = veilPose(alts[0]);
  const t0 = Date.now();
  await bootFly(page, { style: 'satellite', geo: { lat: p0.lat, lon: p0.lon, altM: p0.altM, headingRad: (p0.headingDeg * Math.PI) / 180 }, timeoutMs: 900000 });
  log('booted', { s: Math.round((Date.now() - t0) / 1000), bootPin });
  await page.evaluate((q) => window.__flyStore.getState().setQualityTier(q), args.tier || 'high');
  const rows = [];
  const arms = bootPin ? ['premix'] : String(args.arms || 'baseline,fade').split(',');
  const legMax = Number(args.legMax || 240000);
  const save = () => fs.writeFileSync(path.join(OUT, 'veil.json'), JSON.stringify({ venue: 'fixture/SwiftShader (synthetic Manhattan)', view: VIEW, depressionDeg: VEIL_DEPRESSION_DEG, crop: VEIL_CROP, rows, errs }, null, 1));
  for (const ft of alts) {
    const p = veilPose(ft);
    await veilPlace(page, p);
    let st = await citySettle(page, legMax, 15000);
    log('PLACED', ft, { dKm: +(p.dM / 1000).toFixed(2), settle: st });
    for (const arm of [...arms, ...(arms.length > 1 ? ['baseline-2'] : [])]) {
      const pin = arm === 'fade' ? { fadeStartM: Number(args.fadeStartM || 4500), fadeEndM: Number(args.fadeEndM || 5000) } : arm === 'premix' ? { skylinePremix: 0 } : undefined;
      if (!bootPin) {
        await page.evaluate((a) => {
          if (a) window.__flyCityDiag = a;
          else delete window.__flyCityDiag;
          window.__flyCityDiagApplied = false;
        }, pin ?? null);
        if (arm !== arms[0]) st = await citySettle(page, legMax, 10000);
      }
      await veilFreeze(page, true);
      await page.waitForTimeout(2500);
      const pt = await veilProject(page);
      const buf = await page.screenshot({ path: path.join(OUT, `veil-${arm}-${ft}ft.png`), timeout: 300000 });
      await veilFreeze(page, false);
      const img = decodePng(buf);
      const mid = pt ? cropStats(img, pt.x, pt.y, (VEIL_CROP * img.h) / 2) : null;
      const s2 = await stats(page);
      // The frame's draws per layer at this pose and arm (desktop High, day).
      const attr = await attribute(page, 3).catch(() => null);
      const row = { ft, arm, midtown: mid, agl: pt ? Math.round(pt.agl) : null, applied: s2.applied, settle: { ms: st.ms, idle: st.idle, b: st.b, sk: st.sk }, band: s2.band, bRing: s2.bRing, tier: s2.tier, draws: attr ? { total: attr.total, layers: attr.layers } : null };
      rows.push(row);
      log('VEIL', ft, arm, mid ? { c: mid.contrast, rms: mid.rms, chroma: mid.chroma, luma: mid.luma } : 'no crop', { applied: s2.applied, b: st.b?.chunks, idle: st.idle, s: Math.round(st.ms / 1000), draws: attr?.total ?? null });
      save();
    }
  }
  log('errors', { page: errs.page.length, shader: errs.shader.length, sample: [...errs.page, ...errs.shader].slice(0, 3) });
  save();
  await browser.close();
}

async function smoke() {
  const arms = (args.arms || 'off').split(',');
  const summary = [];
  for (const arm of arms) {
    const browser = await launch();
    const night = args.night === true || args.night === '1' || /NIGHT/.test(arm);
    // An arm of several flags joins them with '+' (the --arms list is comma separated).
    const flags = arm === 'off' ? '' : `?flags=${arm.split('+').join(',')}`;
    const pins = { __flySunOverride: night ? NIGHT_UTC : NOON_UTC };
    if (args.cls) pins.__flyCityDeviceClass = args.cls;
    const { page, errs } = await newPage(browser, { pins, unpin: ['__flyVisualsOverride', '__flyAerialOverride', '__flySatShadowOverride'], device: args.device || null });
    const t0 = Date.now();
    const url = (process.env.FLY_URL || 'http://localhost:3000') + '/' + flags;
    await bootFly(page, { style: 'satellite', url, geo: { lat: MIDTOWN.lat - 0.01, lon: MIDTOWN.lon, altM: 900, headingRad: 0 }, timeoutMs: 900000 });
    log('booted', arm, { s: Math.round((Date.now() - t0) / 1000) });
    if (args.tier) await page.evaluate((t) => window.__flyStore.getState().setQualityTier(t), args.tier);
    const poses = (args.poses || '900,2438').split(',').map(Number);
    const res = { arm, poses: [] };
    for (const m of poses) {
      await pinPose(page, { ...MIDTOWN, altM: m + 12, pitch: m > 2000 ? -0.5 : -0.3 });
      if (args.dwellFirst && m === poses[0]) await page.waitForTimeout(Number(args.dwellFirst));
      await page.waitForTimeout(DWELL);
      // --census: settle (bounded) and book this pose's draws per layer too.
      const settledMs = args.census ? await settle(page) : null;
      const attr = args.census ? await attribute(page) : null;
      if (attr) log('LAYERS', arm, m, { total: attr.total, frames: attr.frames, settledMs }, attr.layers);
      const st = await stats(page);
      const tag = `smoke-${arm.replace(/[^A-Za-z0-9_-]/g, '_')}-${m}m${args.device ? '-' + args.device : ''}`;
      const png = await shot(page, tag);
      const L = await lumaStats(page, png);
      const row = { m, ...st, ...L, ...(attr ? { census: { settledMs, ...attr } } : {}) };
      // --still=MS: a second still of the same pose MS later (the crawl check).
      if (args.still && m === poses[poses.length - 1]) {
        await page.waitForTimeout(Number(args.still));
        const png2 = await shot(page, `${tag}-still`);
        row.still = await stillDiff(page, png, png2);
      }
      res.poses.push(row);
      log('POSE', arm, m, st, L, row.still ? { still: row.still } : '');
    }
    res.errors = { page: errs.page.length, shader: errs.shader.length, sample: [...errs.page, ...errs.shader].slice(0, 4) };
    log('ERRORS', arm, res.errors);
    summary.push(res);
    await browser.close();
  }
  fs.writeFileSync(path.join(OUT, 'smoke.json'), JSON.stringify({ venue: 'fixture/SwiftShader', view: VIEW, summary }, null, 1));
  const bad = summary.filter((s) => s.errors.page || s.errors.shader);
  log(bad.length ? `SMOKE: FAIL (${bad.map((s) => s.arm).join(', ')})` : 'SMOKE: PASS (zero page errors, zero shader errors)');
  process.exitCode = bad.length ? 1 : 0;
}

/** Wait for the streamers to go idle (bounded), the SK-1 harness's settle. */
async function settle(page, maxMs = Number(args.settleMax || 150000)) {
  const t0 = Date.now();
  await page
    .waitForFunction(
      () => {
        const rt = window.__fly;
        if (!rt || rt.worldLoading) return false;
        return [window.__satBuildings, window.__satSkyline, window.__satRoads].every((e) => {
          const s = e?.stats;
          return !s || ['queued', 'building', 'draping', 'sampling'].every((f) => Number(s[f] ?? 0) === 0);
        });
      },
      undefined,
      { timeout: maxMs, polling: 1000 }
    )
    .catch(() => {});
  return Date.now() - t0;
}

/**
 * Per-layer draw attribution over `frames` frames: every submission goes
 * through renderer.renderBufferDirect (three r185: the colour pass, the shadow
 * maps, the post passes, and the building region split, which calls it
 * itself), so the wrapper reads how many GL draws (the independent counter
 * above) each call issued and books them to the object's top-most named
 * ancestor. A draw with another camera on the main scene is booked under
 * `aux:` (shadow maps, reflections), a draw of another scene under `pass:`
 * (post-processing). Per-frame averages; the total is the counter's own.
 */
async function attribute(page, frames = Number(args.frames || 4)) {
  return page.evaluate(async (frames) => {
    let scene = window.__fly.engine.object;
    while (scene.parent) scene = scene.parent;
    const st = scene.__r3f.root.getState();
    const gl = st.gl;
    const cam = st.camera;
    const per = {};
    const keyOf = (camera, sc, material, object) => {
      let top = '';
      for (let o = object; o && o !== sc; o = o.parent) if (o.name) top = o.name;
      const k = top || `unnamed:${object?.type}/${material?.type}`;
      if (sc !== scene) return `pass:${k}`;
      return camera === cam ? k : `aux:${k}`;
    };
    const orig = gl.renderBufferDirect;
    gl.renderBufferDirect = function (camera, sc, geometry, material, object, group) {
      const c0 = window.__cityDrawTotal();
      const r = orig.call(this, camera, sc, geometry, material, object, group);
      const n = window.__cityDrawTotal() - c0;
      if (n > 0) {
        const k = keyOf(camera, sc ?? null, material, object);
        per[k] = (per[k] || 0) + n;
      }
      return r;
    };
    const f0 = window.__cityFrames();
    const d0 = window.__cityDrawTotal();
    const t0 = performance.now();
    await new Promise((res) => {
      const poll = () => (window.__cityFrames() - f0 >= frames || performance.now() - t0 > 60000 ? res() : setTimeout(poll, 50));
      poll();
    });
    gl.renderBufferDirect = orig;
    const n = Math.max(1, window.__cityFrames() - f0);
    const total = (window.__cityDrawTotal() - d0) / n;
    const layers = Object.fromEntries(
      Object.entries(per)
        .map(([k, v]) => [k, +(v / n).toFixed(1)])
        .sort((a, b) => b[1] - a[1])
    );
    const booked = Object.values(per).reduce((a, b) => a + b, 0) / n;
    return { frames: n, total: +total.toFixed(1), unbooked: +(total - booked).toFixed(1), layers };
  }, frames);
}

/**
 * CT-3 census at the city poses (Manhattan 900 m and 8,000 ft), until FRAME's
 * census (FR-4) lands: the per-layer attribution above, and with --toggles the
 * visibility-toggle recipe (verify-sat-buildings') as a cross-check.
 * Fixture / SwiftShader draws: draw COUNTS are venue-independent for a given
 * scene state (same streamed set, same culling), so they rank layers honestly;
 * frame times are not read at all. Page and shader errors are counted, so a
 * census boot with ?flags=NAME doubles as that flag's smoke.
 */
async function census() {
  const browser = await launch();
  const pins = { __flySunOverride: args.night ? NIGHT_UTC : NOON_UTC };
  if (args.cls) pins.__flyCityDeviceClass = args.cls;
  const flags = args.flags ? `?flags=${args.flags}` : '';
  const { page, errs } = await newPage(browser, { pins, unpin: ['__flyVisualsOverride', '__flyAerialOverride', '__flySatShadowOverride'], device: args.device || null });
  const url = (process.env.FLY_URL || 'http://localhost:3000') + '/' + flags;
  const t0 = Date.now();
  await bootFly(page, { style: 'satellite', url, geo: { lat: MIDTOWN.lat - 0.01, lon: MIDTOWN.lon, altM: 900, headingRad: 0 }, timeoutMs: 900000 });
  log('booted', args.flags || 'off', { s: Math.round((Date.now() - t0) / 1000) });
  // --preset=ultra: the Ultra preset (High scene tier + Ultra effects).
  if (args.preset) await page.evaluate((p) => window.__flyStore.getState().setQualityPreset(p), args.preset);
  else if (args.tier) await page.evaluate((t) => window.__flyStore.getState().setQualityTier(t), args.tier);
  const rows = [];
  for (const m of (args.poses || '900,2438').split(',').map(Number)) {
    await pinPose(page, { ...MIDTOWN, altM: m + 12, pitch: m > 2000 ? -0.5 : -0.3 });
    await page.waitForTimeout(DWELL);
    const settled = await settle(page);
    const attr = await attribute(page);
    const layers = {};
    if (args.toggles) {
      const median = async () => {
        await page.waitForTimeout(Number(args.settle || 6000));
        return page.evaluate(() => {
          const d = (window.__cityDraws?.() ?? []).slice(-6).sort((a, b) => a - b);
          return d.length ? d[Math.floor(d.length / 2)] : null;
        });
      };
      const total = await median();
      for (const name of ['buildings', 'skyline', 'roads']) {
        const has = await page.evaluate((n) => {
          const o = { buildings: window.__satBuildings?.object, skyline: window.__satSkyline?.object, roads: window.__satRoads?.object }[n];
          if (!o || !o.isObject3D) return false;
          window.__censusHidden = { o, was: o.visible };
          o.visible = false;
          return true;
        }, name);
        if (!has) continue;
        const without = await median();
        await page.evaluate(() => {
          const h = window.__censusHidden;
          if (h) h.o.visible = h.was;
        });
        layers[name] = total != null && without != null ? total - without : null;
      }
    }
    const st = await stats(page);
    const row = { m, settledMs: settled, ...attr, toggles: args.toggles ? layers : undefined, ...st };
    rows.push(row);
    log('CENSUS', { m, total: attr.total, frames: attr.frames, unbooked: attr.unbooked, draws: st.draws, tier: st.tier, band: st.band, bRing: st.bRing });
    log('LAYERS', m, attr.layers);
    await shot(page, `census-${m}m${args.device ? '-' + args.device : ''}${args.flags ? '-' + args.flags : ''}`);
  }
  const errors = { page: errs.page.length, shader: errs.shader.length, sample: [...errs.page, ...errs.shader].slice(0, 4) };
  fs.writeFileSync(path.join(OUT, 'census.json'), JSON.stringify({ venue: 'fixture/SwiftShader', view: VIEW, device: args.device || 'desktop', cls: args.cls || null, tier: args.tier || 'default', preset: args.preset || null, flags: args.flags || '', rows, errors }, null, 1));
  log('ERRORS', args.flags || 'off', errors);
  log(errors.page || errors.shader ? 'CENSUS: FAIL (page or shader errors)' : 'CENSUS: PASS (zero page errors, zero shader errors)');
  process.exitCode = errors.page || errors.shader ? 1 : 0;
  await browser.close();
}

/**
 * How long the city takes to land in THIS venue: boot at the SK-1 5,000 ft
 * pose (SKY's geometry: Midtown 20 deg below the horizon from the SSW) and
 * poll the streamers every --every ms up to --max ms, with stills.
 */
async function settleProbe() {
  const browser = await launch();
  const pins = { __flySunOverride: NOON_UTC, __flyWeatherOverride: 'clear' };
  const { page, errs } = await newPage(browser, { pins, unpin: ['__flyVisualsOverride', '__flyAerialOverride', '__flySatShadowOverride', '__flyWeatherOverride'] });
  const altM = Number(args.ft || 5000) * FT;
  const dM = (altM - 12) / Math.tan((20 * Math.PI) / 180);
  const back = ((22 + 180) * Math.PI) / 180;
  const lat = MIDTOWN.lat + (dM * Math.cos(back)) / 111320;
  const lon = MIDTOWN.lon + (dM * Math.sin(back)) / (111320 * Math.cos((MIDTOWN.lat * Math.PI) / 180));
  const t0 = Date.now();
  await bootFly(page, { style: 'satellite', geo: { lat, lon, altM, headingRad: (22 * Math.PI) / 180 }, timeoutMs: 900000 });
  log('booted', { s: Math.round((Date.now() - t0) / 1000) });
  if (args.tier) await page.evaluate((t) => window.__flyStore.getState().setQualityTier(t), args.tier);
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, { timeout: 300000, polling: 1000 });
  await page.evaluate(([la, lo, alt, hd]) => {
    const r = window.__fly;
    r.warpToGeo(la, lo, { altM: alt, name: null, headingRad: hd });
    const f = r.flight;
    window.__pose = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: hd };
    window.__step ??= f.step.bind(f);
    f.step = (dt, cmd) => {
      window.__step(dt, { ...cmd, turn: 0, pitch: 0, boost: false });
      const q = window.__pose;
      f.pos.x = q.x; f.pos.y = q.y; f.pos.z = q.z;
      f.heading = q.heading; f.pitch = 0.02; f.bank = 0; f.agl = f.pos.y - f.groundElev;
    };
  }, [lat, lon, altM, (22 * Math.PI) / 180]);
  const tw = Date.now();
  const max = Number(args.max || 420000);
  const every = Number(args.every || 20000);
  let f0 = await page.evaluate(() => window.__cityFrames());
  let last = Date.now();
  for (let i = 1; Date.now() - tw < max; i++) {
    await page.waitForTimeout(every);
    const r = await page.evaluate(() => {
      const pick = (s, ks) => (s ? Object.fromEntries(ks.map((k) => [k, s[k]])) : null);
      return {
        frames: window.__cityFrames(),
        worldLoading: window.__fly.worldLoading,
        sharp: window.__fly.terraStats?.sharp ?? null,
        b: pick(window.__satBuildings?.stats, ['chunks', 'queued', 'building', 'draping', 'ringOn']),
        sk: pick(window.__satSkyline?.stats, ['chunks', 'queued', 'building', 'draping', 'ringOn']),
        draws: (window.__cityDraws?.() ?? []).slice(-1)[0] ?? null,
      };
    });
    const now = Date.now();
    log('T+' + Math.round((now - tw) / 1000) + 's', { fps: +((r.frames - f0) / ((now - last) / 1000)).toFixed(2), ...r });
    f0 = r.frames;
    last = now;
    if (i % Number(args.shotEvery || 6) === 0) await shot(page, `settle-${args.ft || 5000}ft-${Math.round((now - tw) / 1000)}s`);
  }
  await shot(page, `settle-${args.ft || 5000}ft-end`);
  log('ERRORS', { page: errs.page.length, shader: errs.shader.length, sample: [...errs.page, ...errs.shader].slice(0, 3) });
  await browser.close();
}

(async () => {
  if (MODE === 'settle') await settleProbe();
  else if (MODE === 'veil') await veil();
  else if (MODE === 'census') await census();
  else if (MODE === 'smoke') await smoke();
  else throw new Error(`unknown --mode=${MODE}`);
})().catch((e) => {
  log('PROBE FAILED:', String(e.stack || e.message).slice(0, 800));
  process.exit(1);
});

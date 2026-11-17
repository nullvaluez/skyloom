/** WORLD PASS E (GROUND), round 2: the canopy against the photo it stands in, measured in one frame.
 * Per pose__time: warp, settle, then three frames from the same pose a few frames apart:
 *   A  the scene as drawn;
 *   B  the same with every tree mesh hidden (flag on: wp-canopy-near/far; flag off: the legacy SatVeg pool
 *      and every LivingForest stand), i.e. the photo the trees cover;
 *   M  the trees drawn flat magenta (emissive), the mask of the pixels they cover.
 * Reports over the mask: coverage, mean colour of A and B, mean sRGB distance |A - B|, mean CIE76 delta E,
 * and the luma ratio A/B (crowns brighter or darker than the photo under them). Writes the three PNGs and a
 * JSON per shot. Same lock, pins and pose file as the other stream E probes.
 *   node scripts/wp-ground-verify-look.cjs --url=http://localhost:3325 --shots=central-park__noon,tijuca__noon
 *     [--flags=WORLD_GROUND] --out=<dir> [--settle=25000]
 */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const args = Object.fromEntries(process.argv.slice(2).map((s) => { const [k, ...v] = s.replace(/^--/, '').split('='); return [k, v.join('=') || true]; }));
const WT = path.resolve(__dirname, '..');
const POSES = JSON.parse(fs.readFileSync(path.join(WT, 'scripts', 'wp-ground-r2-poses.json'), 'utf8'));
const url = args.url || 'http://localhost:3325', quality = args.quality || 'ultra', flags = typeof args.flags === 'string' ? args.flags : '';
const shots = String(args.shots).split(',').map((s) => s.split('__'));
const out = path.resolve(args.out); fs.mkdirSync(out, { recursive: true });
const arm = String(args.arm || (flags ? 'on' : 'off'));
const lockDir = 'C:/Users/bfecho/skyloom-3/.graphics-review/look-pass/.locks'; fs.mkdirSync(lockDir, { recursive: true });
let held = null;
async function slot() { for (;;) { for (let i = 0; i < 3; i++) { const p = path.join(lockDir, `slot-${i}`); try { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'owner.txt'), `wp-ground-look ${process.pid} ${new Date().toISOString()}`); held = p; return; } catch { try { if (Date.now() - fs.statSync(p).mtimeMs > 25 * 60e3) fs.rmSync(p, { recursive: true, force: true }); } catch {} } } await new Promise((r) => setTimeout(r, 4000)); } }
const release = () => { if (held) { try { fs.rmSync(held, { recursive: true, force: true }); } catch {} held = null; } };
process.on('exit', release);
// sun: noon + 2 h, golden = sun 7 deg up in the afternoon, night = sun 20 deg down (look-pass-capture's TIMES)
const ELEV = { golden: 7, dusk: -3, night: -20 };
async function sunFor(pose, time) {
  const day = Date.parse('2026-09-22T00:00:00Z');
  const noon = day + (12 - pose.lon / 15) * 3600e3;
  if (!(time in ELEV)) return noon + 2 * 3600e3;
  if (!sunFor.reg) { require('node:module').register('./_node-resolve.mjs', require('node:url').pathToFileURL(__filename)); sunFor.reg = true; }
  const { computeSun } = await import('../lib/fly/sun-model.js');
  const el = (utc) => (Math.asin(computeSun(pose.lon, pose.lat, utc).sinEl) * 180) / Math.PI;
  let lo = noon, hi = noon + 14 * 3600e3;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (el(mid) > ELEV[time]) lo = mid; else hi = mid; }
  return lo;
}
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function lab(r, g, b) {
  const R = lin(r), G = lin(g), B = lin(b);
  let x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, y = 0.2126 * R + 0.7152 * G + 0.0722 * B, z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
async function raw(file) { const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true }); return { data, w: info.width, h: info.height }; }
async function metrics(fa, fb, fm) {
  const A = await raw(fa), B = await raw(fb), M = await raw(fm);
  let n = 0, dist = 0, de = 0, la = 0, lb = 0;
  const sa = [0, 0, 0], sb = [0, 0, 0];
  const mag = (d, o) => d[o] - d[o + 1] > 50 && d[o + 2] - d[o + 1] > 50;
  for (let i = 0; i < A.w * A.h; i++) {
    const o = i * 3;
    if (!mag(M.data, o) || mag(B.data, o)) continue;
    n++;
    const a = [A.data[o], A.data[o + 1], A.data[o + 2]], b = [B.data[o], B.data[o + 1], B.data[o + 2]];
    dist += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const L1 = lab(...a), L2 = lab(...b);
    de += Math.hypot(L1[0] - L2[0], L1[1] - L2[1], L1[2] - L2[2]);
    for (let c = 0; c < 3; c++) { sa[c] += a[c]; sb[c] += b[c]; }
    la += 0.2126 * lin(a[0]) + 0.7152 * lin(a[1]) + 0.0722 * lin(a[2]);
    lb += 0.2126 * lin(b[0]) + 0.7152 * lin(b[1]) + 0.0722 * lin(b[2]);
  }
  const r1 = (v) => +v.toFixed(1);
  return n ? { maskPx: n, coverage: +(n / (A.w * A.h)).toFixed(4), meanRgbDist: r1(dist / n), meanDeltaE: r1(de / n), crownMean: sa.map((v) => r1(v / n)), photoMean: sb.map((v) => r1(v / n)), lumaRatio: +(la / lb).toFixed(3) } : { maskPx: 0 };
}
(async () => {
  await slot();
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const errors = [], report = [];
  try {
    const p = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    p.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
    const first = POSES[shots[0][0]];
    await p.addInitScript(({ quality, sun }) => {
      window.__flyGovPin = 'hold'; window.__flyVisualsOverride = 'enhanced'; window.__flyTitleBypass = true; window.__flyBoostInfinite = true; window.__flySunOverride = sun; window.__flyWeatherOverride = 'baseline'; window.__flyWorldPassCounters = true;
      try { localStorage.setItem('fly-map-style-2', 'satellite'); localStorage.setItem('fly-quality-tier', quality); localStorage.setItem('fly-controls-seen', '1'); localStorage.setItem('fly-sound-on', '0'); localStorage.setItem('fly-visuals', 'enhanced'); localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } })); } catch {}
    }, { quality, sun: await sunFor(first, shots[0][1]) });
    await p.route('**/api/aircraft?**', (r) => r.fulfill({ json: { ac: [], now: Date.now(), total: 0 } }));
    await p.route('**/api/weather**', (r) => r.fulfill({ json: { found: false } }));
    await p.goto(`${url}/?graphicsReview=1${flags ? `&flags=${encodeURIComponent(flags)}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 240000 });
    await p.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, { timeout: 240000 });
    await p.evaluate(() => {
      const r = window.__fly, s = window.__flyStore.getState();
      r.operations.phase = 'airborne'; r.operations.profile = null; r.operations.warp(r.flight); s.setHangarOpen(false); s.setPhase('flying');
      const f = r.flight, step = f.step.bind(f);
      f.step = (dt, c) => { const h = window.__lookHold; step(dt, { ...c, turn: 0, pitch: 0, boost: false }); if (h) { f.pos.x = h.x; f.pos.y = h.y; f.pos.z = h.z; f.heading = h.heading; f.bank = 0; f.pitch = 0.02; f.agl = f.pos.y - f.groundElev; } };
      window.__wpTrees = () => {
        let scene = r.engine.object; while (scene.parent) scene = scene.parent;
        const list = [];
        scene.traverse((n) => { if ((n.isMesh || n.isInstancedMesh) && n.visible && (/^wp-canopy-/.test(n.name) || /^forest:/.test(n.name) || n === window.__satVeg?.mesh)) list.push(n); });
        return list;
      };
      window.__raf = (k) => new Promise((res) => { let n = 0; const t = () => { if (++n >= k) res(); else requestAnimationFrame(t); }; requestAnimationFrame(t); });
    });
    for (const [name, time] of shots) {
      const pose = POSES[name];
      const sun = await sunFor(pose, time);
      await p.evaluate(({ pose, sun }) => { const r = window.__fly; window.__lookHold = null; window.__flySunOverride = sun; r.warpToGeo(pose.lat, pose.lon, { altM: pose.altM, headingRad: pose.headingDeg * Math.PI / 180, name: null }); r.autopilot?.disengage?.(); const f = r.flight; window.__lookHold = { x: f.pos.x, y: f.pos.y, z: f.pos.z, heading: pose.headingDeg * Math.PI / 180 }; r.chaseCam?.snap?.(); }, { pose, sun });
      const t0 = Date.now();
      await p.waitForTimeout(5000);
      const settled = await p.waitForFunction(() => { const r = window.__fly; if (!r || r.worldLoading || !r.terraStats?.sharp) return false; for (const k of ['satBuildings', 'satSkyline', 'satRoads']) { const s = r[k]?.stats; if (s && ['queued', 'building', 'draping', 'births', 'dying'].some((f) => Number(s[f] || 0) !== 0)) return false; } const v = window.__satVeg?.engine?.stats; if (v && (v.queued || v.building || v.sampling || v.fine)) return false; const c = window.__wpCanopy?.stats; if (c && (c.held || c.photo?.requested > c.photo?.done)) return false; return true; }, undefined, { timeout: 200000, polling: 1000 }).then(() => true, () => false);
      await p.waitForTimeout(Number(args.settle || 12000));
      const key = `${name}__${time}`;
      const fa = path.join(out, `${key}-${arm}.png`), fb = path.join(out, `${key}-${arm}-bare.png`), fm = path.join(out, `${key}-${arm}-mask.png`);
      await p.evaluate(() => window.__raf(3));
      await p.screenshot({ path: fa });
      const nTrees = await p.evaluate(async () => { const l = window.__wpTrees(); window.__hidden = l; for (const m of l) m.layers.set(31); await window.__raf(3); return l.length; });
      await p.screenshot({ path: fb });
      await p.evaluate(async () => {
        const saved = [], seenMat = new Set();
        for (const m of window.__hidden) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) { if (seenMat.has(mat)) continue; seenMat.add(mat); saved.push([mat, mat.color?.clone(), mat.emissive?.clone(), mat.emissiveIntensity]); if (mat.emissive) { mat.color?.setRGB(0, 0, 0); mat.emissive.setRGB(1, 0, 1); mat.emissiveIntensity = 1; } else mat.color?.setRGB(1, 0, 1); }
          m.layers.set(0);
        }
        window.__saved = saved;
        await window.__raf(3);
      });
      await p.screenshot({ path: fm });
      const info = await p.evaluate(async () => {
        for (const [mat, c, e, ei] of window.__saved) { if (c) mat.color.copy(c); if (e) mat.emissive.copy(e); if (ei !== undefined) mat.emissiveIntensity = ei; }
        await window.__raf(2);
        return { canopy: window.__wpCanopy?.stats ? (({ photo, seasons, ...x }) => ({ ...x, photo }))(window.__wpCanopy.stats) : null, bridges: window.__wpBridges?.stats ? (({ heights, ...x }) => x)(window.__wpBridges.stats) : null };
      });
      const m = await metrics(fa, fb, fm);
      const row = { shot: key, arm, settled, settleMs: Date.now() - t0, trees: nTrees, ...m, info };
      report.push(row);
      console.log(key, arm, JSON.stringify({ settled, trees: nTrees, ...m, sigma: info.canopy?.sigma, near: info.canopy?.near, far: info.canopy?.far, cut: info.canopy?.cut, farthest: info.canopy?.farthestM, edge: info.canopy?.edgeM, passMsMax: info.canopy?.passMsMax, sliceMsMax: info.canopy?.sliceMsMax }));
    }
  } catch (e) { console.error('FATAL', e.message); }
  finally {
    fs.writeFileSync(path.join(out, `look-${arm}-${Date.now()}.json`), JSON.stringify({ report, errors }, null, 1));
    await browser.close(); release(); console.log('DONE errors', errors.length, errors.slice(0, 3));
  }
})();

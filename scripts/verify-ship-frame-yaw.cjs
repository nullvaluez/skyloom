/**
 * SHIP PASS FRAME (FR-8) — the scripted 360° yaw at Manhattan, 900 m.
 *
 *   FLY_URL=http://localhost:3131 [FLY_TILE_FIXTURE=1] node scripts/verify-ship-frame-yaw.cjs \
 *     [--device=desktop|phone] [--deg-per-frame=0.5] [--flags=SHADER_READY,PACE_ADAPT] [--strict]
 *
 * The aircraft is pinned at the DIAG_BENCH start (the Battery, 40.7033 N
 * 74.017 W — Manhattan is in the offline world fixture), 900 m, and the
 * heading is spun 360° from requestAnimationFrame at a fixed arc per frame
 * (verify-terra-live's PIN_YAW: per FRAME, not per second, so a slow venue
 * sweeps the same arc instead of teleporting). It records the longest
 * interval during the turn, the frame-stats `lastStall.phases`, the app's
 * stall census by phase (lib/fly/stall-census.js), the programs first used
 * during the turn (lib/fly/program-census.js — the chunk-material variants
 * the prewarm missed) and the peak draws.
 *
 * ACCEPTANCE (FLY_SHIP_PASS.md section 2, FR-8): longest interval < 50 ms on
 * desktop and < 67 ms in phone emulation. That is the OWNER's run: an RTX
 * 5080, a production build, `--deg-per-frame=0.5` (30°/s at 60 fps),
 * FLY_FINALIZE_BUDGET_K=1, no fixture, `--strict` (fails over the bar). In
 * the cloud venue (fixture + SwiftShader, 1–3 fps) the run is FUNCTIONAL
 * only: it proves the turn, the instruments and phone emulation work, prints
 * the longest interval as information and never claims the bar.
 */
const { chromium, devices } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { bootFly, BOOT_URL } = require('./_boot');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const DEVICE = args.device === 'phone' ? 'phone' : 'desktop';
const DEG = Number(args['deg-per-frame'] || 0.5);
const FLAGS = typeof args.flags === 'string' ? args.flags : 'SHADER_READY,PACE_ADAPT';
const STRICT = !!args.strict;
const BAR_MS = DEVICE === 'phone' ? 67 : 50;
const POSE = { lat: 40.7033, lon: -74.017, altM: 900 };
const OUT = path.resolve('.graphics-review/ship-pass/frame');
mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const ctxOpts = DEVICE === 'phone' ? { ...devices['iPhone 13'] } : { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  const q = new URLSearchParams({ diag: '1' });
  if (FLAGS) q.set('flags', FLAGS);
  const url = `${BOOT_URL.replace(/\/$/, '')}/?${q}`;
  const t0 = Date.now();
  let revealed = true;
  try {
    await bootFly(page, { style: 'satellite', url, timeoutMs: 1200000, settleMs: 5000, geo: { lat: POSE.lat, lon: POSE.lon, altM: POSE.altM, headingRad: 0 } });
  } catch (e) {
    revealed = false;
    console.log(`boot did not reveal (${String(e.message).slice(0, 120)}); falling back to the runtime`);
    await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, { timeout: 600000, polling: 1000 });
  }
  const bootS = Math.round((Date.now() - t0) / 1000);
  console.log(`booted (${revealed ? 'revealed' : 'runtime only'}) in ${bootS} s; device ${DEVICE}; flags ${FLAGS || '(none)'}`);
  // Settle at the pose, then a clean ledger.
  await page.evaluate(({ lat, lon, altM }) => window.__fly.warpToGeo(lat, lon, { altM, name: null }), POSE);
  await page.waitForTimeout(15000);
  const before = await page.evaluate(() => ({ programs: window.__flyStats?.census?.programs?.total ?? null, afterReveal: window.__flyStats?.census?.programs?.afterRevealCount ?? 0, keys: (window.__flyStats?.census?.programs?.afterReveal ?? []).map((e) => e.key) }));
  await page.evaluate(() => {
    window.__flyStats?.frame?.reset?.();
    const l = window.__flyStats?.census?.layers;
    if (l) l.peakCalls = l.peakTriangles = 0;
  });
  // The spin (verify-terra-live PIN_YAW).
  await page.evaluate((deg) => {
    const f = window.__fly.flight;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    window.__fxYaw = { frames: 0, deg: 0, done: false, t0: performance.now(), t1: 0 };
    const step = () => {
      if (window.__fxYaw.deg >= 360) {
        window.__fxYaw.done = true;
        window.__fxYaw.t1 = performance.now();
        return;
      }
      window.__fxYawRaf = requestAnimationFrame(step);
      window.__fxYaw.frames++;
      window.__fxYaw.deg += deg;
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = (window.__fxYaw.deg * Math.PI) / 180;
      f.pitch = -0.12;
      f.bank = 0;
      f.speed = 0;
    };
    step();
  }, DEG);
  const frames = Math.ceil(360 / DEG);
  await page.waitForFunction(() => window.__fxYaw?.done === true, undefined, { timeout: Math.max(600000, frames * 2000), polling: 1000 });
  const r = await page.evaluate((keysBefore) => {
    const st = window.__flyStats ?? {};
    const f = st.frame?.sample?.() ?? null;
    const ring = st.frame?.ring?.() ?? [];
    const c = st.census ?? {};
    const after = (c.programs?.afterReveal ?? []).filter((e) => !keysBefore.includes(e.key));
    return {
      yaw: window.__fxYaw,
      longestMs: ring.length ? Math.max(...ring) : null,
      frames: ring.length,
      over100: ring.filter((d) => d > 100).length,
      p95: f?.p95 ?? null,
      lastStall: f?.lastStall ?? null,
      stalls: c.stalls?.summary?.() ?? null,
      programsDuringYaw: after,
      peakDraws: c.layers?.peakCalls ?? st.diag?.callsPeak ?? null,
      peakTriangles: c.layers?.peakTriangles ?? null,
      tier: window.__flyStore?.getState?.().qualityTier,
      dpr: window.devicePixelRatio,
      gov: window.__flyGov?.state?.() ?? null,
      renderer: (() => {
        try {
          const gl = document.querySelector('canvas')?.getContext('webgl2');
          const e = gl?.getExtension('WEBGL_debug_renderer_info');
          return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null;
        } catch {
          return null;
        }
      })(),
    };
  }, before.keys);
  await page.screenshot({ path: path.join(OUT, `yaw-${DEVICE}.png`) }).catch(() => {});
  await browser.close();
  const software = /swiftshader|llvmpipe|software/i.test(r.renderer ?? '');
  const report = {
    at: new Date().toISOString(),
    venue: software ? 'FUNCTIONAL ONLY: offline world fixture + SwiftShader; the intervals below are not device numbers (FLY_SHIP_PASS.md 3.8)' : `device: ${r.renderer}`,
    device: DEVICE,
    flags: FLAGS,
    pose: POSE,
    degPerFrame: DEG,
    revealed,
    bootS,
    barMs: BAR_MS,
    errors,
    ...r,
  };
  const file = path.join(OUT, `yaw-${DEVICE}${software ? '-venue' : ''}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`yaw ${Math.round(r.yaw.deg)}° over ${r.yaw.frames} frames; longest interval ${r.longestMs?.toFixed(1)} ms (bar ${BAR_MS} ms${software ? ', information only here' : ''}); >100 ms: ${r.over100}; lastStall phases ${JSON.stringify(r.lastStall?.phases ?? [])}`);
  console.log(`stall census: ${JSON.stringify(r.stalls?.byPhase ?? null)}; programs first used during the turn: ${r.programsDuringYaw.length} ${r.programsDuringYaw.slice(0, 6).map((e) => e.key).join(', ')}`);
  console.log(`peak draws ${r.peakDraws}, tier ${r.tier}, dpr ${r.dpr}; page errors ${errors.length}; wrote ${path.relative(process.cwd(), file)}`);
  let ok = errors.length === 0 && r.yaw.done && r.frames > 0;
  if (STRICT && !software) ok = ok && r.longestMs < BAR_MS;
  console.log(ok ? 'YAW: PASS (functional)' : 'YAW: FAIL');
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

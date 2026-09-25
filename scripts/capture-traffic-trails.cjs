/**
 * Traffic-trail visibility capture (satellite + Enhanced, the shipped default).
 *
 * Boots the app in satellite with the Visuals pin LIFTED (so the Enhanced sky
 * composite runs, as it does for every player), parks the player at a chosen
 * altitude/time of day, injects a ring of synthetic cruising traffic at known
 * distances, and screenshots the frame. It prints the tracer counters and a
 * per-target on-screen luma probe so a before/after pair is comparable.
 *
 * Run (container / no hardware GPU):
 *   FLY_TILE_FIXTURE=1 node scripts/capture-traffic-trails.cjs [tag]
 * Env: FLY_URL (default :3000), TRAILS_ALT_M (default 9100),
 *      TRAILS_HOURS (comma list of sun-frac overrides, default "noon,night").
 * Screenshots: scripts/trails-<tag>-<leg>.png (a fixture run redirects them to
 *   scripts/r24-out/fixture-trails-<tag>-<leg>.png)
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const TAG = process.argv[2] || 'run';
const ALT = Number(process.env.TRAILS_ALT_M || 9100);

(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  // Shipped visuals: lift the fleet's Classic pin so Enhanced resolves.
  await page.addInitScript(unpinPins, ['__flyVisualsOverride']);
  await bootFly(page, { style: 'satellite', timeoutMs: 600000 });
  const renderer = await page.evaluate(() => {
    const c = document.querySelector('.fixed.inset-0 canvas');
    const gl = c?.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('renderer', renderer);

  // Park the player: altitude, level, heading north, slow enough to hold pose.
  await page.evaluate((alt) => {
    const f = window.__fly.flight;
    f.pos.y = alt;
  }, ALT);

  // Synthetic cruising traffic at known ranges ahead/left/right of the player.
  await page.evaluate(() => {
    const fly = window.__fly;
    const f = fly.flight;
    const liveT = Math.max(0, ...[...fly.traffic.tracks.values()].map((t) => t.fix1?.t ?? 0));
    const fwd = { x: 0, z: -1 };
    const mk = (hex, dist, side, alt, vE, vN) => {
      const x = f.pos.x + side * dist * 0.35;
      const z = f.pos.z + fwd.z * dist;
      const track = {
        hex, meta: { flight: hex.toUpperCase(), t: 'B738', iconType: 'airliner' }, archetype: 0, flags: 0,
        fix0: null,
        fix1: { x, y: alt, z, vE, vN, vUp: 0, latRad: (f.latDeg * Math.PI) / 180, t: liveT },
        groundElev: 0, yaw: 0, bank: 0, rx: x, ry: alt, rz: z, distM: dist, opacity: 1, scaleK: 1,
        stale: 0, blendFix1: null, blendFix0: null, blendStart: 0, altBlendFrom: 0, altBlendStart: null,
        snapDipUntil: null, lastPollServer: liveT,
      };
      fly.traffic.tracks.set(hex, track);
      fly.traffic.items.push(track);
    };
    const ranges = [4000, 9000, 16000, 26000, 40000];
    ranges.forEach((d, i) => {
      mk(`ab00${i}1`, d, -1, 10500 - i * 300, 220, 40);
      mk(`ab00${i}2`, d, 1, 7000 + i * 400, -200, -60);
    });
  });

  const legs = (process.env.TRAILS_HOURS || 'noon,night').split(',');
  for (const leg of legs) {
    // __flySunOverride is an epoch-ms pin; pick the hour of TODAY whose sun
    // (FlyScene's own __flySunModel at the player's geo) best matches the leg.
    await page.evaluate((l) => {
      const want = l === 'night' ? 0 : l === 'dusk' ? 0.12 : 1;
      const g = window.__fly?.geo ?? window.__fly?.runtime?.geo ?? { x: -83, y: 40 };
      const day0 = Date.UTC(2026, 5, 21);
      let best = day0, err = Infinity;
      for (let m = 0; m < 24 * 60; m += 10) {
        const t = day0 + m * 60000;
        const f = window.__flySunModel ? window.__flySunModel(g.x, g.y, t) : 1;
        if (Math.abs(f - want) < err) { err = Math.abs(f - want); best = t; }
      }
      window.__flySunOverride = best;
    }, leg);
    // runtime.sun recomputes on SKY.dayCycle.refreshSec (60 s): wait on the
    // published VALUE, not the clock, then let the damped gains settle.
    await page
      .waitForFunction(
        (l) => {
          const f = window.__fly?.sun?.frac;
          return l === 'night' ? f < 0.02 : l === 'dusk' ? f > 0.05 && f < 0.25 : f > 0.9;
        },
        leg,
        { timeout: 180000, polling: 1000 }
      )
      .catch(() => console.log(leg, 'sun pin did not publish in 180 s'));
    await page.waitForTimeout(Number(process.env.TRAILS_WAIT_MS || 15000));
    const stats = await page.evaluate(() => ({
      tracers: window.__flyStats?.tracers,
      sunGain: window.__flyStats?.tracerSunGain,
      wake: window.__flyStats?.trafficWake,
      items: window.__fly?.traffic?.items?.length,
      sunFrac: window.__fly?.sun?.frac ?? window.__fly?.runtime?.sun?.frac,
    }));
    console.log(leg, JSON.stringify(stats));
    await page.screenshot({ path: path.join(__dirname, `trails-${TAG}-${leg}.png`) });
  }
  console.log('pageerrors', errs.length, errs.slice(0, 3).join(' | '));
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

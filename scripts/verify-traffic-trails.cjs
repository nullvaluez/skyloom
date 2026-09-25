/**
 * TRAFFIC-TRAIL VISIBILITY GATE — the instrument that was missing.
 *
 * Every tracer assertion before this file was a COUNT (__flyStats.tracers,
 * tracerBackfills). Counts stayed green while two changes made trails
 * invisible in the shipped default (satellite + Enhanced): a 0.18 × 0.25
 * brightness/width squeeze (be711f2) and the cloud composite's daytime sky
 * replacement erasing every depth-less mark against the sky (f0cd81e). This
 * gate measures PIXELS instead.
 *
 * Method (per leg: noon / dusk / night):
 *  - satellite boot with the Visuals, aerial and depth pins LIFTED, so the
 *    post chain is the one players get;
 *  - the player pose is pinned (speed 0), the player, traffic hulls and
 *    billboards are parked, clouds frozen — the only thing toggled is the
 *    trail root `window.__flyTracers`;
 *  - synthetic cruising traffic at 4/9/16/26/40 km, above the eye (sky-backed)
 *    and below it (terrain-backed), flying broadside;
 *  - each head (and a point one third down its trail) is projected to screen
 *    through the SAME air-bend drop the GPU applies (__flyAirDrop), and the
 *    max luma difference in a small window is read for trails SHOWN vs HIDDEN,
 *    plus a no-toggle SHOWN vs SHOWN pair as the noise floor.
 *
 * A target is VISIBLE when its signal exceeds max(MIN_DELTA, 2 × its noise).
 *
 * Run (container / no hardware GPU; uses the offline fixture):
 *   FLY_TILE_FIXTURE=1 node scripts/verify-traffic-trails.cjs
 * Env: FLY_URL (default :3000), TRAILS_LEGS (default "noon,dusk,night"),
 *      TRAILS_ALT_M (default 3000 — low enough that cruise traffic is above).
 * Screenshots: scripts/r24-out/fixture-trails-gate-<leg>-{on,off}.png under
 * the fixture (the fixture redirects artifact writes out of scripts/).
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly, unpinPins } = require('./_boot');
const { makeCanvasShot } = require('./_canvasshot');

const ALT = Number(process.env.TRAILS_ALT_M || 3000);
const LEGS = (process.env.TRAILS_LEGS || 'noon,dusk,night').split(',');
const MIN_DELTA = 10; // luma 0..255
const RANGES_KM = [4, 9, 16, 26, 40];

(async () => {
  const browser = await chromium.launch({ args: ['--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const fails = [];
  let gates = 0;
  const gate = (name, ok, detail = '') => {
    gates += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  await page.addInitScript(unpinPins, ['__flyVisualsOverride', '__flyAerialOverride', '__flyDepthPin']);
  await bootFly(page, { style: 'satellite', timeoutMs: 900000 });
  const cap = makeCanvasShot(page);

  // Pin the pose (heading north, nose slightly up so sky AND ground are in
  // frame), park every other mover, inject the synthetic fleet.
  await page.evaluate((alt) => {
    const fly = window.__fly;
    const f = fly.flight;
    f.pos.y = alt;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    if (window.__trailPin) clearInterval(window.__trailPin);
    window.__trailPin = setInterval(() => {
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = 0;
      f.pitch = 0.04;
      f.bank = 0;
      f.speed = 0;
    }, 8);
    window.__flyCloudFreeze = true;
    for (const o of [window.__flyPlayer, window.__flyTraffic]) if (o) o.visible = false;
  }, ALT);

  const targets = await page.evaluate((ranges) => {
    const fly = window.__fly;
    const f = fly.flight;
    const liveT = Math.max(0, ...[...fly.traffic.tracks.values()].map((t) => t.fix1?.t ?? 0));
    const out = [];
    ranges.forEach((km, i) => {
      for (const side of [-1, 1]) {
        const above = side < 0; // left = above the eye (always sky-backed), right = below
        const d = km * 1000;
        // ~7° above the eye / ~10° below it: inside the 58° frame at every range.
        const alt = above ? f.pos.y + Math.max(500, 0.12 * d) : Math.max(700, f.pos.y - Math.max(900, 0.18 * d));
        const x = f.pos.x + side * d * 0.3;
        const z = f.pos.z - d;
        // Broadside and fast enough to arm the tracer gate (speedOnMps 18);
        // the engine is frozen below, so nothing moves between the A/B shots.
        const vE = side * 60;
        const hex = `ee${i}${side < 0 ? 'a' : 'b'}00`;
        const track = {
          hex, meta: { flight: hex.toUpperCase(), t: 'A320', iconType: 'airliner' }, archetype: 0, flags: 0,
          fix0: null,
          fix1: { x, y: alt, z, vE, vN: 0, vUp: 0, latRad: (f.latDeg * Math.PI) / 180, t: liveT },
          groundElev: 0, yaw: 0, bank: 0, rx: x, ry: alt, rz: z, distM: d, opacity: 1, scaleK: 1,
          stale: 0, blendFix1: null, blendFix0: null, blendStart: 0, altBlendFrom: 0, altBlendStart: null,
          snapDipUntil: null, lastPollServer: liveT,
        };
        fly.traffic.tracks.set(hex, track);
        fly.traffic.items.push(track);
        out.push({ hex, km, sky: above });
      }
    });
    // The fixture's own (static) traffic stays: its fix clock is what keeps
    // the synthetic fleet off the stale ladder, and each probe window is a
    // few pixels around a projected synthetic head.
    return out;
  }, RANGES_KM);

  // Let the engine project the fleet and the tracers backfill, then FREEZE
  // the engine: update() keeps returning the last items, so neither the heads
  // nor the trails move between the shots of an A/B (at this venue's ~1 fps a
  // 60 m/s target moved ~100 px between two captures — noise == signal).
  await page.waitForTimeout(8000);
  await page.evaluate(() => {
    const tr = window.__fly.traffic;
    tr.__update ??= tr.update;
    tr.update = function frozen() {
      return this.items;
    };
  });

  // Screen positions of each head and of a point 1/3 down its trail.
  const project = () =>
    page.evaluate((ts) => {
      const fly = window.__fly;
      const cam = fly.camera;
      const f = fly.flight;
      const ax = fly.origin?.anchor?.x ?? 0;
      const az = fly.origin?.anchor?.z ?? 0;
      cam.updateMatrixWorld();
      const V = cam.matrixWorldInverse.elements;
      const P = cam.projectionMatrix.elements;
      const mul = (m, v) => [
        m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
        m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
        m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
        m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
      ];
      const toScreen = (x, y, z) => {
        const d = Math.hypot(x - f.pos.x, z - f.pos.z);
        const drop = window.__flyAirDrop ? window.__flyAirDrop(d, y) : 0;
        const c = mul(P, mul(V, [x - ax, y - drop, z - az, 1]));
        if (c[3] <= 0) return null;
        return { x: (c[0] / c[3] * 0.5 + 0.5) * innerWidth, y: (1 - (c[1] / c[3] * 0.5 + 0.5)) * innerHeight };
      };
      return ts.map((t) => {
        const tr = fly.traffic.tracks.get(t.hex);
        if (!tr) return { ...t, head: null, body: null };
        const back = 1200; // metres behind the head
        const s = Math.sign(tr.fix1.vE) || 1;
        return {
          ...t,
          head: toScreen(tr.rx, tr.ryd ?? tr.ry, tr.rz),
          body: toScreen(tr.rx - s * back * (1 / Math.cos(tr.fix1.latRad || 0)), tr.ryd ?? tr.ry, tr.rz),
        };
      });
    }, targets);

  const setTrails = (v) =>
    page.evaluate((on) => {
      if (window.__flyTracers) window.__flyTracers.visible = on;
    }, v);
  // Two presented frames after a toggle before a capture.
  const frames = (n = 2) =>
    page.evaluate(
      (k) =>
        new Promise((res) => {
          let i = 0;
          const tick = () => (++i >= k ? res() : requestAnimationFrame(tick));
          requestAnimationFrame(tick);
        }),
      n
    );

  // Max |Δluma| in a (2r+1)² window around each point, across three shots.
  const measure = (a, b, c, pts, r = 5) =>
    page.evaluate(
      async ([sa, sb, sc, ps, rad]) => {
        const load = (s) =>
          new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = rej;
            i.src = 'data:image/png;base64,' + s;
          });
        const imgs = await Promise.all([sa, sb, sc].map(load));
        const data = imgs.map((img) => {
          const cv = document.createElement('canvas');
          cv.width = img.width;
          cv.height = img.height;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0);
          return { w: img.width, h: img.height, d: ctx.getImageData(0, 0, img.width, img.height).data };
        });
        const sx = data[0].w / innerWidth;
        const sy = data[0].h / innerHeight;
        const luma = (im, x, y) => {
          const o = (y * im.w + x) * 4;
          return 0.2126 * im.d[o] + 0.7152 * im.d[o + 1] + 0.0722 * im.d[o + 2];
        };
        const probe = (pt) => {
          if (!pt) return null;
          const cx = Math.round(pt.x * sx);
          const cy = Math.round(pt.y * sy);
          let sig = 0;
          let noise = 0;
          let n = 0;
          for (let y = cy - rad; y <= cy + rad; y++)
            for (let x = cx - rad; x <= cx + rad; x++) {
              if (x < 0 || y < 0 || x >= data[0].w || y >= data[0].h) continue;
              n += 1;
              const on = luma(data[0], x, y);
              sig = Math.max(sig, Math.abs(on - luma(data[1], x, y)));
              noise = Math.max(noise, Math.abs(on - luma(data[2], x, y)));
            }
          return n ? { sig: Math.round(sig), noise: Math.round(noise) } : null;
        };
        return ps.map((p) => ({ hex: p.hex, head: probe(p.head), body: probe(p.body) }));
      },
      [a, b, c, pts, r]
    );

  const sunFor = (leg) =>
    page.evaluate((l) => {
      const want = l === 'night' ? 0 : l === 'dusk' ? 0.12 : 1;
      const g = window.__fly?.geo ?? { x: -74, y: 40.7 };
      const day0 = Date.UTC(2026, 5, 21);
      let best = day0;
      let err = Infinity;
      for (let m = 0; m < 24 * 60; m += 5) {
        const t = day0 + m * 60000;
        const f = window.__flySunModel ? window.__flySunModel(g.x, g.y, t) : 1;
        if (Math.abs(f - want) < err) {
          err = Math.abs(f - want);
          best = t;
        }
      }
      window.__flySunOverride = best;
    }, leg);

  const outDir = fs.existsSync(path.join(__dirname, 'r24-out')) ? path.join(__dirname, 'r24-out') : __dirname;
  const summary = {};
  for (const leg of LEGS) {
    await sunFor(leg);
    await page
      .waitForFunction(
        (l) => {
          const f = window.__fly?.sun?.frac;
          return l === 'night' ? f < 0.02 : l === 'dusk' ? f > 0.05 && f < 0.25 : f > 0.9;
        },
        leg,
        { timeout: 240000, polling: 1000 }
      )
      .catch(() => console.log(`  (${leg}) sun pin did not publish in 240 s`));
    // Damped gains (tracer sun gain, bloom, sky) settle; trails backfill.
    await page.waitForTimeout(Number(process.env.TRAILS_SETTLE_MS || 20000));
    await setTrails(true);
    await frames();
    const pts = await project();
    const on1 = await cap.shot64();
    await setTrails(false);
    await frames();
    const off = await cap.shot64();
    await setTrails(true);
    await frames();
    const on2 = await cap.shot64();
    fs.writeFileSync(path.join(outDir, `fixture-trails-gate-${leg}-on.png`), Buffer.from(on1, 'base64'));
    fs.writeFileSync(path.join(outDir, `fixture-trails-gate-${leg}-off.png`), Buffer.from(off, 'base64'));
    const res = await measure(on1, off, on2, pts);
    const stats = await page.evaluate(() => ({
      tracers: window.__flyStats?.tracers,
      sunGain: window.__flyStats?.tracerSunGain,
      overlays: window.__flyStats?.skyOverlays,
      sunFrac: window.__fly?.sun?.frac,
    }));
    console.log(`\n[${leg}] ${JSON.stringify(stats)}`);
    const vis = (p) => !!p && p.sig >= Math.max(MIN_DELTA, 2 * p.noise);
    const rows = [];
    for (const t of targets) {
      const r = res.find((x) => x.hex === t.hex);
      const pt = pts.find((x) => x.hex === t.hex);
      const onScreen = !!pt?.head && pt.head.x > 0 && pt.head.x < 1280 && pt.head.y > 0 && pt.head.y < 720;
      rows.push({ ...t, onScreen, head: r?.head, body: r?.body, headVis: onScreen && vis(r?.head), bodyVis: vis(r?.body) });
      console.log(
        `  ${t.km.toString().padStart(2)} km ${t.sky ? 'above' : 'below'} head ${JSON.stringify(r?.head)} body ${JSON.stringify(r?.body)}${onScreen ? '' : ' (off-screen)'}`
      );
    }
    summary[leg] = rows;
    const sky = rows.filter((r) => r.sky);
    const low = rows.filter((r) => !r.sky);
    gate(`${leg}: tracers drawing`, (stats.tracers ?? 0) > 0, `${stats.tracers}`);
    gate(`${leg}: every target projects on screen`, rows.every((r) => r.onScreen), rows.filter((r) => !r.onScreen).map((r) => r.hex).join(' '));
    gate(
      `${leg}: sky-backed heads visible (≥4 of 5, incl. 26 and 40 km)`,
      sky.filter((r) => r.headVis).length >= 4 && sky.filter((r) => r.km >= 26).every((r) => r.headVis),
      sky.map((r) => `${r.km}:${r.headVis ? 'Y' : 'n'}`).join(' ')
    );
    gate(
      `${leg}: below-eye heads visible (≥4 of 5)`,
      low.filter((r) => r.headVis).length >= 4,
      low.map((r) => `${r.km}:${r.headVis ? 'Y' : 'n'}`).join(' ')
    );
    gate(
      `${leg}: trail bodies visible out to 16 km`,
      rows.filter((r) => r.km <= 16).every((r) => r.bodyVis),
      rows.filter((r) => r.km <= 16).map((r) => `${r.km}${r.sky ? 's' : 't'}:${r.bodyVis ? 'Y' : 'n'}`).join(' ')
    );
  }
  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(`\n${gates} gates. ${fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS'}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

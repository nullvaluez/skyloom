/**
 * ROUND 23 (B "CITY-LIGHT") — the night A/B capture rig.
 *
 * ONE boot, ONE pinned pose, N legs. Every knob this round moves is a live
 * uniform (window.__flyNightCity), so a leg is a page.evaluate and lands on the
 * next frame: the paired shots see the SAME streamed chunks, the SAME DEM, the
 * SAME traffic-free frame. That is deliberately not the same instrument as two
 * boots differenced — "a probe green on a quiet boot is not a probe green under
 * load" (R21 §5) cuts both ways, and a re-boot A/B differences two worlds.
 *
 * The ARM (`__flyNightCityArm = 1`) is set before mount because it selects the
 * shader SOURCE; the knobs then move inside that one armed program. The
 * control leg is `__flyNightCity.swept()` — the R16/R19 values READ BACK from
 * the blocks that own them (lib/fly/night-city.js NIGHT_CITY_SWEPT), which is
 * what makes this a measured A/B against the swept baseline and not against a
 * remembered one.
 *
 * Determinism (plan §3): weather pinned baseline + governor pinned by _boot;
 * player rig and traffic instances HIDDEN for every shot (R17 §7.1 — a pixel
 * probe must not contain actors it does not control); sun pinned deep night.
 *
 * Metrics per leg (the night read, in numbers):
 *   litFrac   fraction of GROUND-BAND pixels over the lit threshold
 *   p5/p50/p95 luma percentiles over the band ("rich blacks" is measurable)
 *   warmFrac  share of lit pixels that are warm (R−B > 12) — sodium/window light
 *   coolFrac  share that is cool (B−R > 12) — halide arteries, fluorescent panes
 *   whiteBlob largest contiguous high-luma LOW-SATURATION area (the S2 detector)
 *   draws/tris scene totals off __flyStats
 *
 * Usage:
 *   FLY_URL=http://localhost:3022 node scripts/r23-b-night-ab.js MAN
 *   ... POW | OWE | MEL | MAN-DUSK | MAN-MED   (MED = tier medium leg set)
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

/* Poses: [lat, lon, altM, heading, pitch] — Manhattan/Owens are the frozen
 * fleet poses (verify-sat-night / verify-clutter), Powell is verify-groundlife's
 * POWELL, Melton is the R20 parcel-homes scene. */
const POSES = {
  MAN: { name: 'P-MAN Manhattan', p: [40.7075, -74.0113, 792, 2.6, -0.12], sun: Date.UTC(2026, 6, 18, 4, 0, 0) },
  POW: { name: 'P-POW Powell OH', p: [40.1584, -83.0752, 600, 1.9, -0.32], sun: Date.UTC(2026, 6, 18, 4, 30, 0) },
  OWE: { name: 'P-OWE Owens Valley', p: [36.601, -118.06, 500, 1.9, -0.3], sun: Date.UTC(2026, 6, 18, 7, 30, 0) },
  MEL: { name: 'P-MEL Melton AU', p: [-37.683, 144.582, 600, 1.9, -0.32], sun: Date.UTC(2026, 6, 17, 15, 0, 0) },
};

const ARG = (process.argv[2] || 'MAN').toUpperCase();
const DUSK = ARG.endsWith('-DUSK');
const MEDIUM = ARG.endsWith('-MED');
const KEY = ARG.replace(/-(DUSK|MED)$/, '');
const POSE = POSES[KEY];
if (!POSE) {
  console.error(`unknown pose ${KEY} — one of ${Object.keys(POSES).join(', ')}`);
  process.exit(2);
}
/* The R19 dusk ladder leg: true elevation ≈ −6° at this longitude/date. */
const SUN_MS = DUSK ? Date.UTC(2026, 6, 18, 1, 5, 0) : POSE.sun;
const TIER = MEDIUM ? 'medium' : 'high';
const TAG = `r23-b-${KEY.toLowerCase()}${DUSK ? '-dusk' : ''}${MEDIUM ? '-medium' : ''}`;

const pinScene = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading;
  f.pitch = pitch;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/* R17 §7.1 — the hero bobs and the traffic breathes; neither is part of any
 * claim here. Hidden for the whole capture, not per leg. */
const setForeground = (vis) => {
  if (window.__flyPlayer) window.__flyPlayer.visible = vis;
  let scene = window.__flyPlayer ?? window.__satRoads?.object ?? null;
  while (scene && scene.parent) scene = scene.parent;
  scene?.traverse((o) => {
    if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
      o.visible = vis;
  });
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  // THE ARM, before mount: it picks the shader source (see lib/fly/night-city.js).
  await page.addInitScript(() => {
    window.__flyNightCityArm = 1;
  });
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate((t) => window.__flyStore.getState().setQualityTier(t), TIER);
  await page.mouse.move(800, 450);
  await page.evaluate((t) => {
    window.__flySunOverride = t;
  }, SUN_MS);
  await page.evaluate(pinScene, POSE.p);
  await page.waitForTimeout(30000); // vector + DEM + imagery stream, HDRI swap
  await page.evaluate(setForeground, false);
  await page.waitForTimeout(600);

  const canvas = () => page.locator('.fixed.inset-0 canvas').first();
  const shot64 = async () => (await canvas().screenshot()).toString('base64');

  /* All metrics from ONE screenshot, computed page-side over the GROUND BAND
   * (below the horizon) so sky/HUD cannot vote. */
  const metrics = (b64) =>
    page.evaluate(
      async ([s, y0f, y1f]) => {
        const img = await new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = 'data:image/png;base64,' + s;
        });
        const w = img.width;
        const y0 = Math.floor(img.height * y0f);
        const bh = Math.max(1, Math.floor(img.height * y1f) - y0);
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = bh;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, -y0);
        const d = ctx.getImageData(0, 0, w, bh).data;
        const LIT = 42; // luma above which a night pixel is "lit"
        const hist = new Float64Array(256);
        let lit = 0;
        let warm = 0;
        let cool = 0;
        let sum = 0;
        const n = w * bh;
        const white = new Uint8Array(n); // high-luma, low-saturation mask (S2)
        for (let i = 0, p = 0; i < d.length; i += 4, p++) {
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          hist[Math.min(255, Math.round(y))] += 1;
          sum += y;
          if (y > LIT) {
            lit += 1;
            if (r - b > 12) warm += 1;
            else if (b - r > 12) cool += 1;
          }
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const sat = mx === 0 ? 0 : (mx - mn) / mx;
          if (y > 150 && sat < 0.12) white[p] = 1;
        }
        const pct = (q) => {
          let acc = 0;
          const target = n * q;
          for (let v = 0; v < 256; v++) {
            acc += hist[v];
            if (acc >= target) return v;
          }
          return 255;
        };
        // Largest contiguous white-glow blob (4-connected flood fill, iterative).
        let blob = 0;
        const stack = [];
        for (let p = 0; p < n; p++) {
          if (!white[p]) continue;
          let area = 0;
          stack.push(p);
          white[p] = 0;
          while (stack.length) {
            const q = stack.pop();
            area += 1;
            const x = q % w;
            const y2 = (q / w) | 0;
            if (x > 0 && white[q - 1]) { white[q - 1] = 0; stack.push(q - 1); }
            if (x < w - 1 && white[q + 1]) { white[q + 1] = 0; stack.push(q + 1); }
            if (y2 > 0 && white[q - w]) { white[q - w] = 0; stack.push(q - w); }
            if (y2 < bh - 1 && white[q + w]) { white[q + w] = 0; stack.push(q + w); }
          }
          if (area > blob) blob = area;
        }
        return {
          px: n,
          litFrac: lit / n,
          warmShare: lit ? warm / lit : 0,
          coolShare: lit ? cool / lit : 0,
          mean: sum / n,
          p5: pct(0.05),
          p50: pct(0.5),
          p95: pct(0.95),
          whiteBlobPx: blob,
        };
      },
      [b64, 0.55, 0.98]
    );

  const sceneStats = () =>
    page.evaluate(() => ({
      draws: window.__flyStats?.drawCalls ?? -1,
      tris: window.__flyStats?.triangles ?? -1,
      tier: window.__flyStore?.getState?.().qualityTier ?? null,
      roadMix: window.__flyStats?.satRoadMix ?? null,
      roads: window.__flyStats?.satRoads?.ready ?? -1,
      buildings: window.__flyStats?.satBuildings?.ready ?? -1,
      nightGate: window.__flyStats?.satNightGate ?? null,
      uniforms: window.__flyNightCity?.read?.() ?? null,
      sunEl: window.__flyStats?.sunElevationDeg ?? window.__flyStats?.sunFactor ?? null,
    }));

  const leg = async (name, apply) => {
    if (apply) await page.evaluate(apply);
    await page.waitForTimeout(1400); // let the frame settle (the dash trains move)
    const b64 = await shot64();
    const m = await metrics(b64);
    await page.waitForTimeout(2200); // __flyStats.drawCalls republishes ~1/s
    const s = await sceneStats();
    const file = path.join(__dirname, `${TAG}-${name}.png`);
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    const row = { leg: name, ...m, ...s, file: path.basename(file) };
    console.log(
      `${name.padEnd(12)} litFrac ${(m.litFrac * 100).toFixed(3)}%  mean ${m.mean.toFixed(2)}  p5/p50/p95 ${m.p5}/${m.p50}/${m.p95}  warm ${(m.warmShare * 100).toFixed(1)}%  cool ${(m.coolShare * 100).toFixed(1)}%  whiteBlob ${m.whiteBlobPx}  draws ${s.draws}  tris ${s.tris}`
    );
    return row;
  };

  const rows = [];
  /* 1 — the SWEPT baseline (R16/R19 values, restored from the owning blocks). */
  rows.push(await leg('swept', () => window.__flyNightCity.swept()));
  /* 2 — the same leg again, NO change: the shot-noise floor for this scene. */
  rows.push(await leg('swept-noise', null));
  /* 3 — R23 roads only (windows still at identity). */
  rows.push(
    await leg('roads', () => {
      window.__flyNightCity.swept();
      window.__flyNightCity.set({ roads: {} }); // {} = the shipped R23 road values
    })
  );
  /* 4 — R23 windows only (roads back at the swept baseline). */
  rows.push(
    await leg('windows', () => {
      window.__flyNightCity.swept();
      window.__flyNightCity.set({ windows: {} });
    })
  );
  /* 5 — everything armed, as shipped. */
  rows.push(await leg('r23', () => window.__flyNightCity.r23()));
  /* 6 — the traffic term alone, off the full R23 leg (its own attribution). */
  rows.push(
    await leg('r23-notraffic', () =>
      window.__flyNightCity.set({ roads: { traffic: { boost: 0 } } })
    )
  );

  await page.evaluate(setForeground, true);
  const out = {
    pose: POSE.name,
    poseArgs: POSE.p,
    tier: TIER,
    dusk: DUSK,
    sunMs: SUN_MS,
    rows,
    errs,
  };
  const json = path.join(__dirname, `${TAG}.json`);
  fs.writeFileSync(json, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${path.basename(json)} · pageerrors ${errs.length}`);
  if (errs.length) console.log(errs.slice(0, 5).join('\n'));
  await browser.close();
})();

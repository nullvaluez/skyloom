#!/usr/bin/env node
/**
 * R24 (E CERT) — DIAGNOSTIC, not a gate. Settles the sat-night eviction red.
 *
 * The question D and Fable need answered is not the MEAN, it is WHERE. The
 * verify-sat-night A/B works in base64 and persists nothing, so the two frames
 * of the failing pair cannot be recovered after the fact. This reproduces the
 * pair at the same pose and writes:
 *
 *   - the two frames,
 *   - an AMPLIFIED delta image (x8, clipped) — a spatial pattern following the
 *     fixture's per-(z,x,y) tile stamps says "the crossfade blended terrain
 *     between the captures"; a pattern on the building footprints says the
 *     eviction really did become visible and it is D's one-line revert,
 *   - a coarse grid of mean |delta| so the pattern is a NUMBER as well as a
 *     picture,
 *   - terra.fades.active / faded READ AT EACH CAPTURE, which is the reading
 *     that converts the inference into evidence.
 *
 * It also takes a same-state (A/A) pair with the same instrumentation, because
 * the whole argument turns on the noise control having risen MORE than the
 * signal.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly } = require('./_boot');
const { makeCanvasShot } = require('./_canvasshot');

const OUT = process.env.EVICT_OUT || 'scripts/r24-out/w6';
const POSE = [40.7075, -74.0113, 3100, 2.6, -0.3];

const pinScene = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading;
  f.pitch = pitch;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x; f.pos.y = p.y; f.pos.z = p.z;
    f.heading = heading; f.pitch = pitch; f.bank = 0; f.speed = 0;
  }, 8);
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await bootFly(page, { style: 'satellite', url: process.env.FLY_URL, timeoutMs: 600000, settleMs: 8000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  const cap = makeCanvasShot(page);

  // Sun to night, same as the leg.
  await page.evaluate(() => { window.__flySunOverride = Date.UTC(2026, 6, 28, 3, 0); });
  await page.evaluate(pinScene, POSE);
  await page.waitForTimeout(60000);

  const park = (vis) =>
    page.evaluate((v) => {
      if (window.__flyPlayer) window.__flyPlayer.visible = v;
      let root = window.__fly?.engine?.object ?? null;
      while (root?.parent) root = root.parent;
      root?.traverse((o) => {
        if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined)) o.visible = v;
      });
    }, vis);
  const setBuildings = (v) =>
    page.evaluate((vis) => {
      window.__satBuildings?.object.traverse((o) => { if (o.isMesh) o.visible = vis; });
    }, v);
  // READ AT THE ADDRESS THE OWNER PUBLISHES. The first run of this diagnostic
  // read `window.__flyTerra.fades()` — which nothing writes — and duly printed
  // `null` at all four captures, in the very instrument written to settle a
  // question about a counter. D publishes the live object at
  // `window.__flyStats.terra.fades` (verify-lod-fade reads it there), and the
  // in-flight download count comes from the engine or the map, the way A's
  // converged settle reads it.
  const fades = () =>
    page.evaluate(() => {
      const f = window.__flyStats?.terra?.fades;
      const eng = window.__flyTerra?.engine?.();
      const map = eng?.map ?? window.__flyTerra?.get?.();
      return {
        active: f?.active ?? null,
        faded: f?.faded ?? null,
        skip: f?.skip ?? null,
        downloading: typeof eng?.downloading === 'number' ? eng.downloading : (map?.downloading ?? null),
        draws: window.__flyStats?.drawCalls ?? null,
      };
    });

  await park(false);
  await page.waitForTimeout(3000);

  const shots = {};
  const meta = {};
  const grab = async (name) => {
    meta[name] = await fades();
    await cap.shot(path.join(OUT, `evict-${name}.png`));
    shots[name] = await cap.shot64();
    return shots[name];
  };

  // A/A noise pair, then the A/B eviction pair — same order the leg uses.
  await grab('n1');
  await grab('n2');
  await setBuildings(false);
  await page.waitForTimeout(500);
  await grab('off');
  await setBuildings(true);
  await page.waitForTimeout(500);
  await grab('on');

  console.log('FADES AT EACH CAPTURE:', JSON.stringify(meta, null, 1));

  // The delta is computed IN THE PAGE, the way the gate's own bandDelta does:
  // pngjs is not installed here, and adding a dependency to answer a diagnostic
  // question would be its own kind of mistake.
  const diff = async (aN, bN, outName) => {
    const r = await page.evaluate(
      async ([sa, sb]) => {
        const load = (s) =>
          new Promise((res) => {
            const i = new Image();
            i.onload = () => res(i);
            i.src = 'data:image/png;base64,' + s;
          });
        const [ia, ib] = [await load(sa), await load(sb)];
        const w = ia.width, h = ia.height;
        const cv = (im) => {
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(im, 0, 0);
          return c.getContext('2d').getImageData(0, 0, w, h).data;
        };
        const A = cv(ia), B = cv(ib);
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        const octx = out.getContext('2d');
        const img = octx.createImageData(w, h);
        const y0 = Math.round(h * 0.55), y1 = Math.round(h * 0.98);
        const GX = 16, GY = 8;
        const grid = Array.from({ length: GY }, () => new Array(GX).fill(0));
        const cnt = Array.from({ length: GY }, () => new Array(GX).fill(0));
        let sum = 0, n = 0;
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const d =
              (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2])) / 3;
            const v = Math.min(255, d * 8);
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
            img.data[i + 3] = 255;
            if (y >= y0 && y < y1) {
              sum += d; n++;
              const gy = Math.min(GY - 1, Math.floor(((y - y0) / (y1 - y0)) * GY));
              const gx = Math.min(GX - 1, Math.floor((x / w) * GX));
              grid[gy][gx] += d; cnt[gy][gx]++;
            }
          }
        octx.putImageData(img, 0, 0);
        return {
          mean: sum / Math.max(1, n),
          grid: grid.map((row, r2) => row.map((v, c) => +(v / Math.max(1, cnt[r2][c])).toFixed(2))),
          png: out.toDataURL('image/png').split(',')[1],
        };
      },
      [shots[aN], shots[bN]]
    );
    fs.writeFileSync(path.join(OUT, outName), Buffer.from(r.png, 'base64'));
    const flat = r.grid.flat();
    const mn = Math.min(...flat), mx = Math.max(...flat);
    console.log(`\n${outName}: band mean |Δ| ${r.mean.toFixed(3)}/255`);
    console.log('  grid 16x8 of mean |Δ| (band only):');
    for (const row of r.grid) console.log('   ' + row.map((v) => String(v).padStart(6)).join(''));
    console.log(
      `  spatial spread: min ${mn.toFixed(2)} max ${mx.toFixed(2)} ratio ${(mx / Math.max(0.01, mn)).toFixed(1)} — ` +
        'a delta CONFINED to a few cells is geometry (footprints); a delta spread across the whole band ' +
        'is the terrain surface'
    );
  };
  await diff('n1', 'n2', 'evict-delta-noise.png');
  await diff('off', 'on', 'evict-delta-ab.png');
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

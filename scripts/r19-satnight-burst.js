/**
 * R19 — the (E) 3100 m BURST hunt. With the v3 park PLUS POI letters, the
 * skyline mass and the city glow all parked, the no-toggle band delta is
 * 0.006-0.08 for a minute and then jumps to ~1.5 for one pair. That transient
 * is what breaches the (E) ceiling. This samples the crop delta every ~700 ms
 * for a long window and prints, next to each sample, WHICH published stat
 * changed since the previous sample — so the burst names its own cause.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const NOON_MS = Date.UTC(2026, 6, 17, 17, 0, 0);
const SAMPLES = 60;

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

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  const canvas = () => page.locator('.fixed.inset-0 canvas').first();
  const shot64 = async () => (await canvas().screenshot()).toString('base64');
  const bandDelta = (a, b) =>
    page.evaluate(
      async ([sa, sb]) => {
        const load = (s) =>
          new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = rej;
            i.src = 'data:image/png;base64,' + s;
          });
        const [ia, ib] = await Promise.all([load(sa), load(sb)]);
        const w = Math.min(ia.width, ib.width);
        const h = Math.min(ia.height, ib.height);
        const y0 = Math.floor(h * 0.55);
        const y1 = Math.floor(h * 0.98);
        const bh = Math.max(1, y1 - y0);
        const grab = (img) => {
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = bh;
          const ctx = cv.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, -y0);
          return ctx.getImageData(0, 0, w, bh).data;
        };
        const da = grab(ia);
        const db = grab(ib);
        let sum = 0;
        let sparks = 0;
        let px = 0;
        let signed = 0; // net brightening/darkening — a global grade shows here
        for (let i = 0; i < da.length; i += 4) {
          const d =
            Math.abs(da[i] - db[i]) +
            Math.abs(da[i + 1] - db[i + 1]) +
            Math.abs(da[i + 2] - db[i + 2]);
          signed += db[i] - da[i] + (db[i + 1] - da[i + 1]) + (db[i + 2] - da[i + 2]);
          sum += d;
          if (d > 75) sparks += 1;
          px += 1;
        }
        return {
          mean: sum / Math.max(1, px * 3),
          signed: signed / Math.max(1, px * 3),
          sparks,
        };
      },
      [a, b]
    );

  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate((t) => {
    window.__flySunOverride = t;
  }, NOON_MS);
  await page.mouse.move(800, 450);
  await page.evaluate(pinScene, [40.7075, -74.0113, 2000, 2.6, -0.3]);
  await page.waitForTimeout(24000);
  await page.evaluate(pinScene, [40.7075, -74.0113, 2700, 2.6, -0.3]);
  await page.waitForTimeout(9000);
  await page.evaluate(pinScene, [40.7075, -74.0113, 3100, 2.6, -0.3]);
  await page.waitForTimeout(9000);

  // EVERYTHING parkable, parked.
  console.log(
    'PARK:',
    JSON.stringify(
      await page.evaluate(() => {
        const out = {};
        const hide = (o) => {
          if (!o) return false;
          o.visible = false;
          if (o.material) o.material.visible = false;
          return true;
        };
        const cl = window.__flyClouds;
        hide(cl);
        hide(window.__flyCirrus);
        let n = 0;
        cl?.parent?.children?.forEach((o) => {
          if (o === cl || !o.isInstancedMesh) return;
          hide(o);
          n += 1;
        });
        out.siblings = n;
        out.traffic = hide(window.__flyTraffic);
        out.tracers = hide(window.__flyTracers);
        out.beacons = hide(window.__satBeacons);
        out.skyline = hide(window.__satSkyline?.object);
        out.glow = hide(window.__satCityGlow?.dome) && hide(window.__satCityGlow?.core);
        if (window.__flyPlayer) window.__flyPlayer.visible = false;
        let scene = window.__satRoads?.object ?? null;
        while (scene && scene.parent) scene = scene.parent;
        scene?.traverse((o) => {
          if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
            o.visible = false;
        });
        let letters = 0;
        scene?.children?.forEach((g) => {
          if (!g.isGroup || !('popT' in (g.userData ?? {}))) return;
          g.children.forEach((ch) => {
            if (ch.material) {
              ch.material.visible = false;
              letters += 1;
            }
          });
        });
        out.letters = letters;
        return out;
      })
    )
  );

  const snapStats = () =>
    page.evaluate(() => {
      const s = window.__flyStats ?? {};
      const flat = {};
      for (const [k, v] of Object.entries(s)) {
        if (v === null || typeof v !== 'object') flat[k] = v;
        else flat[k] = JSON.stringify(v);
      }
      // three-tile's own load state, if the map object is reachable
      flat.__docTiles = document.querySelectorAll('canvas').length;
      return flat;
    });

  let prev = await snapStats();
  for (let i = 0; i < SAMPLES; i++) {
    const a = await shot64();
    const b = await shot64();
    const d = await bandDelta(a, b);
    const now = await snapStats();
    const changed = [];
    for (const k of Object.keys(now))
      if (String(prev[k]) !== String(now[k])) changed.push(k);
    prev = now;
    const hot = d.mean > 0.3;
    console.log(
      `${String(i).padStart(3)} ${hot ? 'BURST' : '     '} mean=${d.mean.toFixed(3)} signed=${d.signed.toFixed(3)} sparks=${String(d.sparks).padStart(6)} changed=[${changed.join(',')}]`
    );
    if (hot) console.log(`      stats: ${JSON.stringify(now).slice(0, 700)}`);
    await page.waitForTimeout(500);
  }

  await browser.close();
})();

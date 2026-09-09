/**
 * R22.1 (C "CLOUDS") — SCRATCH PROBE 2: name the actor on the pale frame.
 *
 * Probe 1 reproduced the defect (L 162.6 -> 226.4 -> 162.6, exactly one frame)
 * but the cloud census on that frame showed NO near billboard. So instead of
 * inferring, this probe performs a POST-MORTEM RE-RENDER BISECTION: the moment
 * the scanline reads pale, the scene state is still EXACTLY the pale frame's
 * state, so we can re-render it repeatedly with subsets hidden and read the
 * scanline back each time. That names the object, and then the puff, that
 * painted the frame white.
 *
 *   node scripts/r22p1-c-probe2.js
 *   env: FLY_URL, SECONDS, POSE=powell|nyc, WEATHER=baseline|live, DSF
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SECONDS = +(process.env.SECONDS ?? 150);
const OUT = process.env.OUT || path.join(__dirname, '../.probe-c-bisect');
const POSES = {
  powell: { lat: 40.1748, lon: -83.1079, altM: 515, name: 'Powell OH' },
  nyc: null,
};
const POSE = POSES[process.env.POSE ?? 'nyc'];

const INSTALL = () => {
  const comp = window.__flyComposer;
  const gl = window.__flyGl ?? comp?.getRenderer?.();
  if (!comp || !gl) return { ok: false };
  const camOf = () =>
    window.__fly?.camera ?? comp.passes?.find((p) => p.camera?.isCamera)?.camera ?? null;
  const S = (window.__cFrames = []);
  window.__cHits = [];
  let row = null;
  let busy = false;
  let n = 0;
  const cr = comp.render.bind(comp);

  /** mean luma + pale fraction of the mid scanline of the DEFAULT buffer */
  const scan = () => {
    const c = gl.getContext();
    const W = c.drawingBufferWidth;
    const H = c.drawingBufferHeight;
    if (!row || row.length < W * 4) row = new Uint8Array(W * 4);
    c.bindFramebuffer(c.FRAMEBUFFER, null);
    c.readPixels(0, (H / 2) | 0, W, 1, c.RGBA, c.UNSIGNED_BYTE, row);
    let s = 0;
    let run = 0;
    for (let x = 0; x < W; x++) {
      const L = (row[x * 4] * 299 + row[x * 4 + 1] * 587 + row[x * 4 + 2] * 114) / 1000;
      s += L;
      if (L > 200) run++;
    }
    return { L: +(s / W).toFixed(1), pr: +(run / W).toFixed(3) };
  };

  /** full framebuffer -> data URL (flipped) */
  const grab = () => {
    const c = gl.getContext();
    const W = c.drawingBufferWidth;
    const H = c.drawingBufferHeight;
    const buf = new Uint8Array(W * H * 4);
    c.bindFramebuffer(c.FRAMEBUFFER, null);
    c.readPixels(0, 0, W, H, c.RGBA, c.UNSIGNED_BYTE, buf);
    const cv = new OffscreenCanvas(W, H);
    const ctx = cv.getContext('2d');
    const id = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      id.data.set(buf.subarray(src, src + W * 4), y * W * 4);
    }
    ctx.putImageData(id, 0, 0);
    return cv.convertToBlob({ type: 'image/png' }).then(
      (b) =>
        new Promise((res) => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.readAsDataURL(b);
        })
    );
  };
  window.__cGrab = grab;

  comp.render = (dt) => {
    const r = cr(dt);
    if (!window.__cOn || busy) return r;
    const s = scan();
    S.push({ n, t: +performance.now().toFixed(1), L: s.L, pr: s.pr, reb: window.__flyStats?.rebases ?? 0 });
    if (s.pr > 0.5 && window.__cHits.length < (window.__cMaxHits ?? 6)) {
      busy = true;
      try {
        const hit = { n, ...s, when: +performance.now().toFixed(1) };
        // ---- the actors we can park, each re-rendered from the SAME state ---
        const root = window.__flyClouds;
        const cir = window.__flyCirrus;
        const cam = camOf();
        const cw = cam.matrixWorld.elements;
        hit.cam = [+cw[12].toFixed(1), +cw[13].toFixed(1), +cw[14].toFixed(1)];
        hit.control = scan(); // re-scan without re-rendering (sanity)
        // control re-render: same state, no parking. Must reproduce the pale.
        cr(0);
        hit.rerender = scan();
        const park = (o, f) => {
          if (!o) return null;
          const v = o.visible;
          o.visible = false;
          cr(0);
          const out = scan();
          o.visible = v;
          return out;
        };
        hit.noClouds = park(root);
        hit.noCirrus = park(cir);
        const im = root?.children.find((c) => c.isInstancedMesh);
        hit.noInstances = park(im);
        hit.count = im?.count ?? -1;
        // ---- which INSTANCE? binary search over im.count ------------------
        if (im && hit.noInstances && hit.noInstances.pr < 0.5) {
          const full = im.count;
          let lo = 0;
          let hi = full;
          // find the smallest prefix count that still paints pale
          while (hi - lo > 1) {
            const mid = ((lo + hi) / 2) | 0;
            im.count = mid;
            cr(0);
            const o = scan();
            if (o.pr > 0.5) hi = mid;
            else lo = mid;
          }
          im.count = full;
          hit.culpritIndex = hi - 1; // the instance whose inclusion turns it pale
          const a = im.instanceMatrix.array;
          const o = (hi - 1) * 16;
          const px = a[o + 12];
          const py = a[o + 13];
          const pz = a[o + 14];
          hit.culprit = {
            p: [+px.toFixed(1), +py.toFixed(1), +pz.toFixed(1)],
            half: +(0.5 * Math.hypot(a[o], a[o + 1], a[o + 2])).toFixed(1),
            halfY: +(0.5 * Math.hypot(a[o + 4], a[o + 5], a[o + 6])).toFixed(1),
            d: +Math.hypot(px - cw[12], py - cw[13], pz - cw[14]).toFixed(1),
            op: +(im.geometry.attributes.cloudOpacity?.array[hi - 1] ?? -1).toFixed(3),
          };
          hit.culprit.cover = +(hit.culprit.half / Math.max(1e-3, hit.culprit.d)).toFixed(3);
          // how many instances are individually screen-filling from here?
          let near = 0;
          for (let i = 0; i < full; i++) {
            const q = i * 16;
            const dd = Math.hypot(a[q + 12] - cw[12], a[q + 13] - cw[13], a[q + 14] - cw[14]);
            const hh = 0.5 * Math.hypot(a[q], a[q + 1], a[q + 2]);
            if (hh / Math.max(1e-3, dd) > 0.7) near++;
          }
          hit.nNear = near;
        }
        // restore a clean frame
        cr(0);
        window.__cHits.push(hit);
      } finally {
        busy = false;
      }
    }
    n++;
    return r;
  };
  return { ok: true };
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: process.env.HEADED !== '1',
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 660 },
    deviceScaleFactor: +(process.env.DSF ?? 1.5),
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  if (process.env.WEATHER === 'live') {
    await page.addInitScript(() => {
      Object.defineProperty(window, '__flyWeatherOverride', {
        configurable: true,
        get: () => window.__wxUnpinned,
        set: (v) => {
          window.__wxPinAttempt = v;
        },
      });
    });
  }
  await page.addInitScript(unpinPins, ['__flySettlePin']);
  const { ms } = await bootFly(page, { ...BOOT_OPTS, style: 'satellite' });
  console.log(`[c2] boot ${ms} ms weather=${process.env.WEATHER ?? 'baseline'}`);
  console.log('[c2] install', JSON.stringify(await page.evaluate(INSTALL)));
  if (POSE) {
    await page.evaluate(
      ([la, lo, al, nm]) => window.__fly.warpToGeo(la, lo, { altM: al, name: nm }),
      [POSE.lat, POSE.lon, POSE.altM, POSE.name]
    );
    await page.waitForTimeout(9000);
  }
  await page.evaluate(() => {
    window.__cFrames.length = 0;
    window.__cHits.length = 0;
    window.__cOn = true;
  });
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) {
    await page.waitForTimeout(2000);
    const nh = await page.evaluate(() => window.__cHits.length);
    if (nh >= 4) break;
  }
  await page.evaluate(() => {
    window.__cOn = false;
  });
  const frames = await page.evaluate(() => window.__cFrames);
  const hits = await page.evaluate(() => window.__cHits);
  console.log(`[c2] composed ${frames.length} · PALE ${hits.length}`);
  for (const h of hits) {
    console.log(`  PALE n=${h.n} L=${h.L} pr=${h.pr} cam=${JSON.stringify(h.cam)}`);
    console.log(
      `     re-render ${JSON.stringify(h.rerender)} · noClouds ${JSON.stringify(h.noClouds)} · ` +
        `noCirrus ${JSON.stringify(h.noCirrus)} · noInstances ${JSON.stringify(h.noInstances)}`
    );
    if (h.culprit)
      console.log(
        `     CULPRIT instance ${h.culpritIndex}/${h.count} d=${h.culprit.d} half=${h.culprit.half} ` +
          `halfY=${h.culprit.halfY} cover=${h.culprit.cover} op=${h.culprit.op} p=${JSON.stringify(h.culprit.p)} nNear=${h.nNear}`
      );
  }
  fs.writeFileSync(path.join(OUT, 'bisect.json'), JSON.stringify({ frames: frames.slice(0, 40000), hits }, null, 1));
  console.log('[c2] pageerrors', errs.length, errs.slice(0, 3).join(' | '));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

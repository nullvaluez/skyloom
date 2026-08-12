/**
 * R22.1 (C "FLASH") — PROBE 10: LOOK at it.
 *
 * The measurements collide. The HDR scene buffer says the pale is real
 * geometry (lumMean 0.21 -> 0.85, and hiding the culprit restores it), but a
 * BLACK material and BOTH lights off leave the frame at L=226.7. A black unlit
 * surface cannot paint an 0.85-mean luminance field. One of those readings is
 * lying, and pixels will say which.
 *
 * Saves three PNGs per event — full pale frame, culprit isolated, culprit
 * hidden — plus the mean HDR RGB of the pale region (not just its luminance),
 * which identifies the paint: fog colour cec7bd, sky, or lit white surface.
 *
 *   node scripts/r22p1-c-probe10.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SECONDS = +(process.env.SECONDS ?? 300);
const OUT = process.env.OUT || path.join(__dirname, '../.probe-c-look');
const POSES = { powell: { lat: 40.1748, lon: -83.1079, altM: 515, name: 'Powell OH' }, nyc: null };
const POSE = POSES[process.env.POSE ?? 'nyc'];

const INSTALL = () => {
  const comp = window.__flyComposer;
  const gl = window.__flyGl ?? comp?.getRenderer?.();
  const rp = comp?.passes?.find((p) => p.scene);
  const scene = rp?.scene;
  if (!comp || !gl || !scene) return { ok: false };
  window.__cHits = []; window.__cShots = []; window.__cFrames = 0;
  let row = null, busy = false, n = 0;
  const cr = comp.render.bind(comp);

  const scan = () => {
    const c = gl.getContext();
    const W = c.drawingBufferWidth, H = c.drawingBufferHeight;
    if (!row || row.length < W * 4) row = new Uint8Array(W * 4);
    c.bindFramebuffer(c.FRAMEBUFFER, null);
    c.readPixels(0, (H / 2) | 0, W, 1, c.RGBA, c.UNSIGNED_BYTE, row);
    let s = 0, run = 0;
    for (let x = 0; x < W; x++) {
      const L = (row[x * 4] * 299 + row[x * 4 + 1] * 587 + row[x * 4 + 2] * 114) / 1000;
      s += L; if (L > 200) run++;
    }
    return { L: +(s / W).toFixed(1), pr: +(run / W).toFixed(3) };
  };
  const grab = () => {
    const c = gl.getContext();
    const W = c.drawingBufferWidth, H = c.drawingBufferHeight;
    const buf = new Uint8Array(W * H * 4);
    c.bindFramebuffer(c.FRAMEBUFFER, null);
    c.readPixels(0, 0, W, H, c.RGBA, c.UNSIGNED_BYTE, buf);
    window.__cShots.push({ W, H, buf });
    return window.__cShots.length - 1;
  };
  window.__cToPng = async (i) => {
    const g = window.__cShots[i]; if (!g) return null;
    const { W, H, buf } = g;
    const cv = new OffscreenCanvas(W, H), ctx = cv.getContext('2d');
    const id = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) { const s = (H - 1 - y) * W * 4; id.data.set(buf.subarray(s, s + W * 4), y * W * 4); }
    ctx.putImageData(id, 0, 0);
    const b = await cv.convertToBlob({ type: 'image/png' });
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
  };
  /** mean HDR rgb of pixels above a luminance cut, from the composer input */
  const hdrMeanOfBright = (rt, cut) => {
    try {
      const c = gl.getContext();
      const fb = gl.properties.get(rt)?.__webglFramebuffer; if (!fb) return null;
      const W = rt.width, H = rt.height;
      c.bindFramebuffer(c.FRAMEBUFFER, fb);
      const buf = new Float32Array(W * 4);
      let r = 0, g = 0, b = 0, k = 0, dr = 0, dg = 0, db = 0, dk = 0;
      for (let q = 1; q <= 15; q++) {
        const y = ((H * q) / 16) | 0;
        c.readPixels(0, y, W, 1, c.RGBA, c.FLOAT, buf);
        for (let x = 0; x < W; x++) {
          const R = buf[x * 4], G = buf[x * 4 + 1], B = buf[x * 4 + 2];
          const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
          if (L > cut) { r += R; g += G; b += B; k++; } else { dr += R; dg += G; db += B; dk++; }
        }
      }
      c.bindFramebuffer(c.FRAMEBUFFER, null);
      return {
        brightN: k, bright: k ? [+(r / k).toFixed(3), +(g / k).toFixed(3), +(b / k).toFixed(3)] : null,
        darkN: dk, dark: dk ? [+(dr / dk).toFixed(3), +(dg / dk).toFixed(3), +(db / dk).toFixed(3)] : null,
      };
    } catch (e) { return { err: String(e).slice(0, 80) }; }
  };

  comp.render = (dt) => {
    const r = cr(dt);
    if (!window.__cOn || busy) return r;
    window.__cFrames++;
    const s = scan();
    if (s.pr > 0.6 && window.__cHits.length < 1) {
      busy = true;
      try {
        const hit = { n, ...s };
        const inBuf = comp.inputBuffer;
        hit.hdrPale = hdrMeanOfBright(inBuf, 0.45);
        hit.full = grab();
        const g = window.__satBuildings?.object;
        let culprit = null;
        for (const o of [...(g?.children ?? [])]) {
          if (!o.visible) continue;
          o.visible = false; cr(0); const out = scan(); o.visible = true;
          if (out.pr < 0.5) { culprit = o; break; }
        }
        cr(0);
        if (culprit) {
          hit.uuid = culprit.uuid.slice(0, 8);
          const geo = culprit.geometry;
          hit.verts = geo.attributes.position?.count ?? -1;
          hit.matType = culprit.material?.type;
          hit.matName = culprit.material?.name || null;
          hit.renderOrder = culprit.renderOrder;
          hit.geoGroups = geo.groups?.length ?? 0;
          const e = culprit.matrixWorld.elements;
          hit.mw = [+e[12].toFixed(1), +e[13].toFixed(1), +e[14].toFixed(1)];
          if (!geo.boundingBox) geo.computeBoundingBox();
          hit.bbox = [[+geo.boundingBox.min.x.toFixed(1), +geo.boundingBox.min.y.toFixed(1), +geo.boundingBox.min.z.toFixed(1)],
                      [+geo.boundingBox.max.x.toFixed(1), +geo.boundingBox.max.y.toFixed(1), +geo.boundingBox.max.z.toFixed(1)]];
          /* culprit hidden */
          culprit.visible = false; cr(0); hit.hidden = grab(); hit.hiddenScan = scan(); culprit.visible = true; cr(0);
          /* culprit isolated (keep lights + background so it is comparable) */
          const saved = [];
          scene.traverse((o) => { if (o !== scene) saved.push([o, o.visible]); });
          const keep = new Set(); for (let p = culprit; p; p = p.parent) keep.add(p);
          for (const [o] of saved) if (!keep.has(o) && !o.isLight) o.visible = false;
          const bg = scene.background; scene.background = null;
          cr(0); hit.iso = grab(); hit.isoScan = scan();
          scene.background = bg; for (const [o, v] of saved) o.visible = v; cr(0);
        }
        window.__cHits.push(hit);
      } finally { busy = false; }
    }
    n++;
    return r;
  };
  return { ok: true };
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED !== '1', args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 660 }, deviceScaleFactor: +(process.env.DSF ?? 1.5) });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(unpinPins, ['__flySettlePin']);
  console.log(`[c10] boot ${(await bootFly(page, { ...BOOT_OPTS, style: 'satellite' })).ms} ms`);
  console.log('[c10] install', JSON.stringify(await page.evaluate(INSTALL)));
  if (POSE) {
    await page.evaluate(([la, lo, al, nm]) => window.__fly.warpToGeo(la, lo, { altM: al, name: nm }), [POSE.lat, POSE.lon, POSE.altM, POSE.name]);
    await page.waitForTimeout(9000);
  }
  await page.evaluate(() => { window.__cHits.length = 0; window.__cFrames = 0; window.__cOn = true; });
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) {
    await page.waitForTimeout(3000);
    if ((await page.evaluate(() => window.__cHits.length)) >= 1) break;
  }
  const frames = await page.evaluate(() => { window.__cOn = false; return window.__cFrames; });
  const hits = await page.evaluate(() => window.__cHits);
  console.log(`[c10] frames ${frames} hits ${hits.length}`);
  for (const h of hits) {
    console.log(`\nPALE n=${h.n} L=${h.L} pr=${h.pr} uuid=${h.uuid} verts=${h.verts} mat=${h.matType}/${h.matName} renderOrder=${h.renderOrder} groups=${h.geoGroups}`);
    console.log(`  mw=${JSON.stringify(h.mw)} bbox=${JSON.stringify(h.bbox)}`);
    console.log(`  HDR bright-region mean rgb: ${JSON.stringify(h.hdrPale)}`);
    console.log(`  hiddenScan=${JSON.stringify(h.hiddenScan)} isoScan=${JSON.stringify(h.isoScan)}`);
    for (const [k, tag] of [[h.full, 'full'], [h.hidden, 'hidden'], [h.iso, 'iso']]) {
      if (k == null) continue;
      const url = await page.evaluate((i) => window.__cToPng(i), k);
      if (url) { fs.writeFileSync(path.join(OUT, `${tag}-${h.n}.png`), Buffer.from(url.split(',')[1], 'base64')); console.log(`  wrote ${tag}-${h.n}.png`); }
    }
  }
  fs.writeFileSync(path.join(OUT, 'look.json'), JSON.stringify(hits.map(({ full, hidden, iso, ...r }) => r), null, 1));
  console.log('[c10] pageerrors', errs.length);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

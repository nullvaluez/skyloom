/**
 * R22.1 (C "FLASH") — PROBE 11: name the TRIANGLE.
 *
 * Probe 10: the culprit chunk rendered ALONE fills the whole frame with a flat
 * pale field (iso-180.png) — while a float64 CPU replication of the very same
 * bend puts that geometry 2.6 km away, occupying the lower-left only (ndcX
 * -4.4..-0.12). The GPU and the CPU disagree about where this mesh is. A flat
 * featureless fill is the signature of ONE enormous degenerate triangle, not
 * of a city block.
 *
 * So: binary-search the index draw range for the smallest prefix that still
 * paints the frame pale. That names the exact triangle, and its three
 * vertices' position / aBendAnchor / color values say why. The bend is then
 * recomputed for those vertices in float64 AND in Math.fround-simulated
 * float32, because the shader runs in float32 and overflow or cancellation
 * there is the leading explanation for the disagreement.
 *
 *   node scripts/r22p1-c-probe11.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SECONDS = +(process.env.SECONDS ?? 300);
const OUT = process.env.OUT || path.join(__dirname, '../.probe-c-tri');
const POSES = { powell: { lat: 40.1748, lon: -83.1079, altM: 515, name: 'Powell OH' }, nyc: null };
const POSE = POSES[process.env.POSE ?? 'nyc'];

const INSTALL = () => {
  const comp = window.__flyComposer;
  const gl = window.__flyGl ?? comp?.getRenderer?.();
  const rp = comp?.passes?.find((p) => p.scene);
  const scene = rp?.scene;
  if (!comp || !gl || !scene) return { ok: false };
  window.__cHits = []; window.__cFrames = 0;
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

  comp.render = (dt) => {
    const r = cr(dt);
    if (!window.__cOn || busy) return r;
    window.__cFrames++;
    const s = scan();
    if (s.pr > 0.6 && window.__cHits.length < 1) {
      busy = true;
      try {
        const hit = { n, ...s };
        const g = window.__satBuildings?.object;
        let culprit = null;
        for (const o of [...(g?.children ?? [])]) {
          if (!o.visible) continue;
          o.visible = false; cr(0); const out = scan(); o.visible = true;
          if (out.pr < 0.5) { culprit = o; break; }
        }
        cr(0);
        if (!culprit) { window.__cHits.push(hit); busy = false; return r; }
        hit.uuid = culprit.uuid.slice(0, 8);
        const geo = culprit.geometry;
        const idx = geo.index;
        const P = geo.attributes.position, A = geo.attributes.aBendAnchor, C = geo.attributes.color;
        const total = idx ? idx.count : P.count;
        hit.indexCount = total;
        const saveStart = geo.drawRange.start, saveCount = geo.drawRange.count;

        /* isolate the culprit so only its pixels matter */
        const saved = [];
        scene.traverse((o) => { if (o !== scene) saved.push([o, o.visible]); });
        const keep = new Set(); for (let p = culprit; p; p = p.parent) keep.add(p);
        for (const [o] of saved) if (!keep.has(o) && !o.isLight) o.visible = false;
        const bg = scene.background; scene.background = null;
        cr(0);
        hit.isoBase = scan();

        /* binary search the smallest prefix that still paints pale */
        let lo = 0, hi = total;
        const paleAt = (cnt) => { geo.setDrawRange(0, cnt); cr(0); return scan().pr > 0.5; };
        if (paleAt(total)) {
          while (hi - lo > 3) {
            const mid = Math.floor((lo + hi) / 6) * 3;
            if (mid <= lo || mid >= hi) break;
            if (paleAt(mid)) hi = mid; else lo = mid;
          }
          hit.prefix = hi;
          /* also: does that ONE triangle alone do it? */
          geo.setDrawRange(Math.max(0, hi - 3), 3); cr(0); hit.loneTri = scan();
          /* and the whole mesh WITHOUT it */
          geo.setDrawRange(0, Math.max(0, hi - 3)); cr(0); hit.beforeTri = scan();
        } else hit.prefix = -1;
        geo.setDrawRange(saveStart, saveCount);
        scene.background = bg; for (const [o, v] of saved) o.visible = v; cr(0);

        /* dump the named triangle */
        const U = gl.properties.get(culprit.material)?.uniforms ?? {};
        const bc = U.uBendCenter ? [U.uBendCenter.value.x, U.uBendCenter.value.y] : [0, 0];
        const bk = U.uBendK ? U.uBendK.value : 0;
        hit.bend = { center: bc, k: bk };
        const m = culprit.matrixWorld.elements;
        const F = Math.fround;
        const xf = (x, y, z) => [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
        const xf32 = (x, y, z) => [F(F(F(m[0] * x) + F(m[4] * y)) + F(F(m[8] * z) + m[12])), F(F(F(m[1] * x) + F(m[5] * y)) + F(F(m[9] * z) + m[13])), F(F(F(m[2] * x) + F(m[6] * y)) + F(F(m[10] * z) + m[14]))];
        const dumpVert = (vi) => {
          const px = P.getX(vi), py = P.getY(vi), pz = P.getZ(vi);
          const ax = A ? A.getX(vi) : null, ay = A ? A.getY(vi) : null;
          const w = xf(px, py, pz);
          const wa = ax != null ? xf(ax, 0, ay) : [0, 0, 0];
          const d64 = Math.hypot(wa[0] - bc[0], wa[2] - bc[1]);
          const wa32 = ax != null ? xf32(ax, 0, ay) : [0, 0, 0];
          const dx32 = F(wa32[0] - F(bc[0])), dz32 = F(wa32[2] - F(bc[1]));
          const d32 = F(Math.sqrt(F(F(dx32 * dx32) + F(dz32 * dz32))));
          return {
            i: vi, pos: [px, py, pz], anchor: [ax, ay],
            color: C ? [+C.getX(vi).toFixed(3), +C.getY(vi).toFixed(3), +C.getZ(vi).toFixed(3)] : null,
            world: [+w[0].toFixed(1), +w[1].toFixed(1), +w[2].toFixed(1)],
            bendD64: +d64.toFixed(2), drop64: +(d64 * d64 * bk).toFixed(2),
            bendD32: d32, drop32: F(F(d32 * d32) * F(bk)),
            finite: Number.isFinite(px) && Number.isFinite(py) && Number.isFinite(pz) && (ax == null || (Number.isFinite(ax) && Number.isFinite(ay))),
          };
        };
        if (hit.prefix > 0) {
          const base = hit.prefix - 3;
          hit.tri = [0, 1, 2].map((k) => dumpVert(idx ? idx.getX(base + k) : base + k));
        }
        /* global attribute sanity across the whole mesh */
        let nfP = 0, nfA = 0, maxA = 0, maxP = 0;
        for (let i = 0; i < P.count; i++) {
          const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) nfP++;
          const mp = Math.max(Math.abs(x), Math.abs(y), Math.abs(z)); if (mp > maxP) maxP = mp;
          if (A) { const ax = A.getX(i), ay = A.getY(i); if (!Number.isFinite(ax) || !Number.isFinite(ay)) nfA++; const ma = Math.max(Math.abs(ax), Math.abs(ay)); if (ma > maxA) maxA = ma; }
        }
        hit.attrSanity = { nonFinitePos: nfP, nonFiniteAnchor: nfA, maxAbsPos: +maxP.toFixed(1), maxAbsAnchor: +maxA.toFixed(1), verts: P.count };
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
  console.log(`[c11] boot ${(await bootFly(page, { ...BOOT_OPTS, style: 'satellite' })).ms} ms`);
  console.log('[c11] install', JSON.stringify(await page.evaluate(INSTALL)));
  if (POSE) {
    await page.evaluate(([la, lo, al, nm]) => window.__fly.warpToGeo(la, lo, { altM: al, name: nm }), [POSE.lat, POSE.lon, POSE.altM, POSE.name]);
    await page.waitForTimeout(9000);
  }
  await page.evaluate(() => { window.__cHits.length = 0; window.__cFrames = 0; window.__cOn = true; });
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) { await page.waitForTimeout(3000); if ((await page.evaluate(() => window.__cHits.length)) >= 1) break; }
  const frames = await page.evaluate(() => { window.__cOn = false; return window.__cFrames; });
  const hits = await page.evaluate(() => window.__cHits);
  console.log(`[c11] frames ${frames} hits ${hits.length}`);
  for (const h of hits) {
    console.log(`\nPALE n=${h.n} pr=${h.pr} uuid=${h.uuid} indexCount=${h.indexCount}`);
    console.log(`  isoBase=${JSON.stringify(h.isoBase)} prefix=${h.prefix} loneTri=${JSON.stringify(h.loneTri)} beforeTri=${JSON.stringify(h.beforeTri)}`);
    console.log(`  bend=${JSON.stringify(h.bend)}`);
    console.log(`  attrSanity=${JSON.stringify(h.attrSanity)}`);
    for (const v of h.tri ?? []) console.log(`   vert ${JSON.stringify(v)}`);
  }
  fs.writeFileSync(path.join(OUT, 'tri.json'), JSON.stringify(hits, null, 1));
  console.log('[c11] pageerrors', errs.length);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

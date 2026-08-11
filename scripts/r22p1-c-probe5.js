/**
 * R22.1 (C "CLOUDS") — SCRATCH PROBE 5: WHY the sat-building chunk goes white.
 *
 * Probe 4 named the actor: ONE chunk Mesh inside `__satBuildings.object`
 * (MeshLambertMaterial, vertexColors, DoubleSide, anchor-bent). This probe
 * isolates it on the pale frame — renders it alone against a null background
 * and grabs the pixels — and dumps the CPU-side geometry next to the LIVE
 * world-bend uniforms, with a per-frame ring buffer so the pale frame can be
 * diffed against the four frames before it.
 *
 *   node scripts/r22p1-c-probe5.js
 *   env: FLY_URL, SECONDS, POSE, WEATHER, DSF
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SECONDS = +(process.env.SECONDS ?? 200);
const OUT = process.env.OUT || path.join(__dirname, '../.probe-c-why');
const POSES = {
  powell: { lat: 40.1748, lon: -83.1079, altM: 515, name: 'Powell OH' },
  nyc: null,
};
const POSE = POSES[process.env.POSE ?? 'nyc'];

const INSTALL = () => {
  const comp = window.__flyComposer;
  const gl = window.__flyGl ?? comp?.getRenderer?.();
  const rp = comp?.passes?.find((p) => p.scene);
  const scene = rp?.scene;
  if (!comp || !gl || !scene) return { ok: false };
  window.__cHits = [];
  window.__cShots = [];
  let row = null;
  let busy = false;
  let n = 0;
  const cr = comp.render.bind(comp);
  const ring = [];

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
  const grabRaw = () => {
    const c = gl.getContext();
    const W = c.drawingBufferWidth;
    const H = c.drawingBufferHeight;
    const buf = new Uint8Array(W * H * 4);
    c.bindFramebuffer(c.FRAMEBUFFER, null);
    c.readPixels(0, 0, W, H, c.RGBA, c.UNSIGNED_BYTE, buf);
    window.__cShots.push({ W, H, buf });
    return window.__cShots.length - 1;
  };
  window.__cToPng = async (idx) => {
    const g = window.__cShots[idx];
    if (!g) return null;
    const { W, H, buf } = g;
    const cv = new OffscreenCanvas(W, H);
    const ctx = cv.getContext('2d');
    const id = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      id.data.set(buf.subarray(src, src + W * 4), y * W * 4);
    }
    ctx.putImageData(id, 0, 0);
    const b = await cv.convertToBlob({ type: 'image/png' });
    return await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result);
      fr.readAsDataURL(b);
    });
  };

  /** live uniform values for a bend-patched material, via renderer.properties */
  const bendU = (mat) => {
    try {
      const p = gl.properties.get(mat);
      const u = p?.uniforms;
      if (!u) return null;
      const o = {};
      for (const k of Object.keys(u)) {
        if (!k.startsWith('uBend') && !k.startsWith('uEdge') && !k.startsWith('uHaze') && !k.startsWith('uAnchor')) continue;
        const v = u[k].value;
        o[k] = v && typeof v === 'object' ? [v.x, v.y, v.z].filter((q) => q !== undefined) : v;
      }
      return o;
    } catch {
      return null;
    }
  };
  window.__cBendU = bendU;

  const engMat = () => window.__satBuildings?.material ?? null;

  comp.render = (dt) => {
    const r = cr(dt);
    if (!window.__cOn || busy) return r;
    const s = scan();
    const cam = window.__fly?.camera ?? rp.camera;
    const chunks = window.__satBuildings?.object?.children?.length ?? -1;
    const frameRow = {
      n,
      L: s.L,
      pr: s.pr,
      chunks,
      u: bendU(engMat()),
      cam: [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)],
      reb: window.__flyStats?.rebases ?? 0,
    };
    ring.push(frameRow);
    if (ring.length > 8) ring.shift();
    if (s.pr > 0.5 && window.__cHits.length < 2) {
      busy = true;
      try {
        const hit = { n, ...s, ring: JSON.parse(JSON.stringify(ring)) };
        hit.full = grabRaw();
        // --- find the culprit chunk mesh again -----------------------------
        const grp = window.__satBuildings?.object;
        let culprit = null;
        for (const o of [...(grp?.children ?? [])]) {
          if (!o.visible) continue;
          o.visible = false;
          cr(0);
          const out = scan();
          o.visible = true;
          if (out.pr < 0.5) {
            culprit = o;
            break;
          }
        }
        if (culprit) {
          const g = culprit.geometry;
          const pos = g.attributes.position;
          let mnx = 1e30, mny = 1e30, mnz = 1e30, mxx = -1e30, mxy = -1e30, mxz = -1e30;
          let bad = 0;
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const z = pos.getZ(i);
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { bad++; continue; }
            if (x < mnx) mnx = x; if (x > mxx) mxx = x;
            if (y < mny) mny = y; if (y > mxy) mxy = y;
            if (z < mnz) mnz = z; if (z > mxz) mxz = z;
          }
          const an = g.attributes.aBendAnchor;
          let amn = 1e30, amx = -1e30, abad = 0;
          if (an) {
            for (let i = 0; i < an.count; i++) {
              const x = an.getX(i);
              const y = an.getY(i);
              if (!Number.isFinite(x) || !Number.isFinite(y)) { abad++; continue; }
              const d = Math.hypot(x, y);
              if (d < amn) amn = d;
              if (d > amx) amx = d;
            }
          }
          const e = culprit.matrixWorld.elements;
          hit.culprit = {
            uuid: culprit.uuid.slice(0, 8),
            pos: [+e[12].toFixed(1), +e[13].toFixed(1), +e[14].toFixed(1)],
            local: [culprit.position.x, culprit.position.y, culprit.position.z],
            verts: pos.count,
            bad,
            bbox: [
              [+mnx.toFixed(1), +mny.toFixed(1), +mnz.toFixed(1)],
              [+mxx.toFixed(1), +mxy.toFixed(1), +mxz.toFixed(1)],
            ],
            anchorCount: an?.count ?? -1,
            anchorAbs: an ? [+amn.toFixed(1), +amx.toFixed(1)] : null,
            anchorBad: abad,
            colorCount: g.attributes.color?.count ?? -1,
            uvCount: g.attributes.uv?.count ?? -1,
            idx: g.index?.count ?? -1,
            bs: g.boundingSphere
              ? { c: [+g.boundingSphere.center.x.toFixed(1), +g.boundingSphere.center.y.toFixed(1), +g.boundingSphere.center.z.toFixed(1)], r: +g.boundingSphere.radius.toFixed(1) }
              : null,
            bendMargin: culprit.userData?.bendMarginM ?? null,
            matUuid: culprit.material.uuid.slice(0, 8),
            matIsShared: culprit.material === window.__satBuildings?.material,
            u: bendU(culprit.material),
          };
          // --- ISOLATION RENDER: only this mesh, no background --------------
          const saved = [];
          scene.traverse((o) => {
            if (o === scene) return;
            saved.push([o, o.visible]);
          });
          const keep = new Set();
          for (let p = culprit; p; p = p.parent) keep.add(p);
          for (const [o] of saved) if (!keep.has(o) && !o.isLight) o.visible = false;
          const bg = scene.background;
          scene.background = null;
          cr(0);
          hit.isolated = scan();
          hit.isoShot = grabRaw();
          scene.background = bg;
          for (const [o, v] of saved) o.visible = v;
          cr(0);
        }
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
  console.log(`[c5] boot ${(await bootFly(page, { ...BOOT_OPTS, style: 'satellite' })).ms} ms`);
  console.log('[c5] install', JSON.stringify(await page.evaluate(INSTALL)));
  if (POSE) {
    await page.evaluate(
      ([la, lo, al, nm]) => window.__fly.warpToGeo(la, lo, { altM: al, name: nm }),
      [POSE.lat, POSE.lon, POSE.altM, POSE.name]
    );
    await page.waitForTimeout(9000);
  }
  await page.evaluate(() => {
    window.__cHits.length = 0;
    window.__cOn = true;
  });
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) {
    await page.waitForTimeout(2000);
    if ((await page.evaluate(() => window.__cHits.length)) >= 1) break;
  }
  await page.evaluate(() => {
    window.__cOn = false;
  });
  const hits = await page.evaluate(() => window.__cHits);
  for (const h of hits) {
    console.log(`\nPALE n=${h.n} L=${h.L} pr=${h.pr}`);
    console.log('  ring (last frames):');
    for (const r of h.ring)
      console.log(`    n=${r.n} L=${r.L} pr=${r.pr} chunks=${r.chunks} reb=${r.reb} cam=${JSON.stringify(r.cam)} u=${JSON.stringify(r.u)}`);
    console.log(`  CULPRIT ${JSON.stringify(h.culprit, null, 1)}`);
    console.log(`  isolated scan ${JSON.stringify(h.isolated)}`);
  }
  for (const h of hits) {
    for (const [k, tag] of [[h.full, 'full'], [h.isoShot, 'iso']]) {
      if (k == null) continue;
      const url = await page.evaluate((i) => window.__cToPng(i), k);
      if (url) fs.writeFileSync(path.join(OUT, `${tag}-${h.n}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
  }
  fs.writeFileSync(path.join(OUT, 'why.json'), JSON.stringify(hits, null, 1));
  console.log('[c5] pageerrors', errs.length, errs.slice(0, 3).join(' | '));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

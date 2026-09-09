/**
 * R22.1 (C "FLASH") — PROBE 8: which CHANNEL, and where does the bend put it?
 *
 * Probe 7 narrowed the cause to the bend (uBendK=0 and uBendCenter=camera both
 * collapse the pale; fade / haze / both lights / fog / env are inert) and threw
 * up a reframing result: material.color=black left the frame at L=226.9.
 *
 * That colour trial is re-run here PROPERLY — setting material.color without
 * material.needsUpdate may never re-upload the `diffuse` uniform, so the
 * original trial could have been a no-op. This probe does not trust it.
 *
 * On the frozen pale frame it runs:
 *   CPU BEND   — replicates satBldgAnchorProject in double precision over the
 *                culprit's own vertices and reports where the BENT geometry
 *                actually lands: view-space Z range, how many vertices fall in
 *                front of the near plane, and the NDC bounds. This says
 *                whether the geometry is really over the lens.
 *   CHANNEL    — depthWrite=false / colorWrite=false / colour=black (with
 *                needsUpdate) / a raw renderer.render that bypasses the
 *                composer entirely.
 *   PASS SWEEP — disable each composer pass, then each effect inside every
 *                EffectPass, re-rendering and re-scanning after each.
 *
 *   node scripts/r22p1-c-probe8.js
 *   env: FLY_URL, SECONDS, POSE, WEATHER, DSF, MAXHITS
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SECONDS = +(process.env.SECONDS ?? 300);
const OUT = process.env.OUT || path.join(__dirname, '../.probe-c-chan');
const MAXHITS = +(process.env.MAXHITS ?? 2);
const POSES = { powell: { lat: 40.1748, lon: -83.1079, altM: 515, name: 'Powell OH' }, nyc: null };
const POSE = POSES[process.env.POSE ?? 'nyc'];

const INSTALL = (maxHits) => {
  const comp = window.__flyComposer;
  const gl = window.__flyGl ?? comp?.getRenderer?.();
  const rp = comp?.passes?.find((p) => p.scene);
  const scene = rp?.scene;
  if (!comp || !gl || !scene) return { ok: false };
  window.__cHits = [];
  window.__cFrames = 0;
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
  const grp = () => window.__satBuildings?.object ?? null;

  /** replicate satBldgAnchorProject on the CPU, in float64 */
  const cpuBend = (mesh, cam, bc, bk) => {
    const g = mesh.geometry;
    const P = g.attributes.position, A = g.attributes.aBendAnchor;
    if (!P || !A) return { err: 'no attrs' };
    const m = mesh.matrixWorld.elements;
    const vi = cam.matrixWorldInverse.elements;
    const pj = cam.projectionMatrix.elements;
    const N = P.count;
    const stride = Math.max(1, Math.floor(N / 20000));
    let minZ = 1e30, maxZ = -1e30, inFront = 0, behind = 0, tested = 0;
    let ndcMinX = 1e30, ndcMaxX = -1e30, ndcMinY = 1e30, ndcMaxY = -1e30;
    let minDropY = 1e30, maxDropY = -1e30, minBendD = 1e30, maxBendD = -1e30;
    let nearest = 1e30, nearestP = null;
    const xf = (x, y, z) => [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
    ];
    for (let i = 0; i < N; i += stride) {
      const w = xf(P.getX(i), P.getY(i), P.getZ(i));
      const wa = xf(A.getX(i), 0, A.getY(i));
      const dx = wa[0] - bc[0], dz = wa[2] - bc[1];
      const bendD = Math.hypot(dx, dz);
      const drop = bendD * bendD * bk;
      const wy = w[1] - drop;
      if (bendD < minBendD) minBendD = bendD; if (bendD > maxBendD) maxBendD = bendD;
      if (drop < minDropY) minDropY = drop; if (drop > maxDropY) maxDropY = drop;
      /* view space */
      const vx = vi[0] * w[0] + vi[4] * wy + vi[8] * w[2] + vi[12];
      const vy = vi[1] * w[0] + vi[5] * wy + vi[9] * w[2] + vi[13];
      const vz = vi[2] * w[0] + vi[6] * wy + vi[10] * w[2] + vi[14];
      const depth = -vz;
      if (depth < minZ) minZ = depth; if (depth > maxZ) maxZ = depth;
      if (depth > 0) inFront++; else behind++;
      const d = Math.hypot(vx, vy, vz);
      if (d < nearest) { nearest = d; nearestP = [+w[0].toFixed(1), +wy.toFixed(1), +w[2].toFixed(1), +depth.toFixed(1)]; }
      /* clip -> ndc (only meaningful in front) */
      const cw = pj[3] * vx + pj[7] * vy + pj[11] * vz + pj[15];
      if (cw > 1e-6) {
        const cx = (pj[0] * vx + pj[4] * vy + pj[8] * vz + pj[12]) / cw;
        const cy = (pj[1] * vx + pj[5] * vy + pj[9] * vz + pj[13]) / cw;
        if (cx < ndcMinX) ndcMinX = cx; if (cx > ndcMaxX) ndcMaxX = cx;
        if (cy < ndcMinY) ndcMinY = cy; if (cy > ndcMaxY) ndcMaxY = cy;
      }
      tested++;
    }
    return {
      tested, inFront, behind,
      depthRange: [+minZ.toFixed(1), +maxZ.toFixed(1)],
      near: cam.near, far: cam.far,
      inFrontOfNear: minZ < cam.near,
      ndcX: [+ndcMinX.toFixed(2), +ndcMaxX.toFixed(2)],
      ndcY: [+ndcMinY.toFixed(2), +ndcMaxY.toFixed(2)],
      bendD: [+minBendD.toFixed(1), +maxBendD.toFixed(1)],
      dropM: [+minDropY.toFixed(1), +maxDropY.toFixed(1)],
      nearestVert: nearestP,
    };
  };

  comp.render = (dt) => {
    const r = cr(dt);
    if (!window.__cOn || busy) return r;
    window.__cFrames++;
    const s = scan();
    if (s.pr > 0.5 && window.__cHits.length < maxHits) {
      busy = true;
      try {
        const hit = { n, ...s };
        const cam = window.__fly?.camera ?? rp.camera;
        const g = grp();
        let culprit = null;
        if (g && g.visible) {
          for (const o of [...g.children]) {
            if (!o.visible) continue;
            o.visible = false; cr(0); const out = scan(); o.visible = true;
            if (out.pr < 0.5) { culprit = o; break; }
          }
          cr(0);
        }
        if (!culprit) { hit.culprit = null; window.__cHits.push(hit); busy = false; return r; }
        hit.culpritUuid = culprit.uuid.slice(0, 8);
        const mm = culprit.material;
        const U = gl.properties.get(mm)?.uniforms ?? {};
        const bc = U.uBendCenter ? [U.uBendCenter.value.x, U.uBendCenter.value.y] : [0, 0];
        const bk = U.uBendK ? U.uBendK.value : 0;
        hit.bendUniforms = { center: bc, k: bk };

        /* ---- A. where does the BENT geometry actually land? -------------- */
        hit.cpuBent = cpuBend(culprit, cam, bc, bk);
        hit.cpuUnbent = cpuBend(culprit, cam, bc, 0);

        const trials = {};
        const run1 = (label, apply, undo) => {
          try { apply(); cr(0); trials[label] = scan(); undo(); cr(0); }
          catch (e) { trials[label] = { err: String(e).slice(0, 90) }; }
        };

        /* ---- B. CHANNEL -------------------------------------------------- */
        run1('depthWrite=false', () => { mm.__dw = mm.depthWrite; mm.depthWrite = false; }, () => { mm.depthWrite = mm.__dw; });
        run1('colorWrite=false', () => { mm.__cw = mm.colorWrite; mm.colorWrite = false; }, () => { mm.colorWrite = mm.__cw; });
        run1('depthTest=false', () => { mm.__dt = mm.depthTest; mm.depthTest = false; }, () => { mm.depthTest = mm.__dt; });
        /* colour, this time forcing the uniform re-upload */
        run1('black+needsUpdate', () => { mm.__c = mm.color.getHex(); mm.color.setHex(0x000000); mm.needsUpdate = true; },
          () => { mm.color.setHex(mm.__c); mm.needsUpdate = true; });
        /* raw scene render, bypassing the composer entirely */
        try {
          gl.setRenderTarget(null); gl.render(scene, cam);
          trials['rawSceneRender'] = scan(); cr(0);
        } catch (e) { trials['rawSceneRender'] = { err: String(e).slice(0, 90) }; }

        /* ---- C. PASS / EFFECT SWEEP -------------------------------------- */
        const passes = [];
        (comp.passes ?? []).forEach((p, i) => {
          const nm = p.name ?? p.constructor?.name ?? `pass${i}`;
          const eff = (p.effects ?? []).map((e) => e.name ?? e.constructor?.name ?? '?');
          passes.push({ i, nm, enabled: p.enabled, eff });
        });
        hit.passes = passes;
        (comp.passes ?? []).forEach((p, i) => {
          if (!p.enabled) return;
          const nm = p.name ?? p.constructor?.name ?? `pass${i}`;
          if (p === rp) return; // the render pass itself: skipping it draws nothing
          run1(`pass:${i}:${nm}`, () => { p.enabled = false; }, () => { p.enabled = true; });
        });
        (comp.passes ?? []).forEach((p, i) => {
          (p.effects ?? []).forEach((e, j) => {
            const nm = e.name ?? e.constructor?.name ?? `eff${j}`;
            const bm = e.blendMode;
            if (!bm) return;
            run1(`eff:${i}.${j}:${nm}`, () => { e.__bf = bm.blendFunction; bm.blendFunction = 0; },
              () => { bm.blendFunction = e.__bf; });
          });
        });
        hit.trials = trials;
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
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  if (process.env.WEATHER === 'live') {
    await page.addInitScript(() => { Object.defineProperty(window, '__flyWeatherOverride', { configurable: true, get: () => window.__wxUnpinned, set: (v) => { window.__wxPinAttempt = v; } }); });
  }
  await page.addInitScript(unpinPins, ['__flySettlePin']);
  console.log(`[c8] boot ${(await bootFly(page, { ...BOOT_OPTS, style: 'satellite' })).ms} ms`);
  console.log('[c8] install', JSON.stringify(await page.evaluate(INSTALL, MAXHITS)));
  if (POSE) {
    await page.evaluate(([la, lo, al, nm]) => window.__fly.warpToGeo(la, lo, { altM: al, name: nm }), [POSE.lat, POSE.lon, POSE.altM, POSE.name]);
    await page.waitForTimeout(9000);
  }
  await page.evaluate(() => { window.__cHits.length = 0; window.__cFrames = 0; window.__cOn = true; });
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) {
    await page.waitForTimeout(3000);
    if ((await page.evaluate(() => window.__cHits.length)) >= MAXHITS) break;
  }
  const frames = await page.evaluate(() => { window.__cOn = false; return window.__cFrames; });
  const hits = await page.evaluate(() => window.__cHits);
  console.log(`\n[c8] composed frames ${frames} · pale events ${hits.length}`);
  for (const h of hits) {
    console.log(`\n=== PALE n=${h.n} L=${h.L} pr=${h.pr} culprit=${h.culpritUuid}`);
    console.log(`  bend uniforms: ${JSON.stringify(h.bendUniforms)}`);
    console.log(`  CPU BENT   : ${JSON.stringify(h.cpuBent)}`);
    console.log(`  CPU UNBENT : ${JSON.stringify(h.cpuUnbent)}`);
    console.log(`  passes: ${JSON.stringify(h.passes)}`);
    console.log('  --- TRIALS (pr<0.5 => that removes the pale) ---');
    for (const [k, v] of Object.entries(h.trials ?? {})) console.log(`    ${k.padEnd(28)} -> ${JSON.stringify(v)}`);
  }
  fs.writeFileSync(path.join(OUT, `chan-${process.env.POSE ?? 'nyc'}.json`), JSON.stringify({ frames, hits }, null, 1));
  console.log('[c8] pageerrors', errs.length, errs.slice(0, 3).join(' | '));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

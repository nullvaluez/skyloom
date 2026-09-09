/**
 * R22.1 (C "FLASH") — PROBE 9: read the HDR buffer the post chain is fed.
 *
 * Probe 8: the raw scene render is NOT pale, disabling EffectPass #1 removes
 * the pale, and a CPU replication of the bend puts the culprit chunk in the
 * LOWER-LEFT only (ndcX -4.4..-0.12) — yet the whole frame is pale. So the
 * chunk is not covering the screen; its pixels are doing something to the post
 * chain. `rawSceneRender` was misleading: the composer's RenderPass writes an
 * HDR HalfFloat target with NO tone mapping, while a direct renderer.render()
 * writes the LDR default framebuffer WITH tone mapping — the second clamps
 * exactly the values the first passes on.
 *
 * This probe reads the composer's own input buffer as FLOAT and reports the
 * real HDR range, plus where the maximum sits. Then it drives the two effects
 * that could spread a local spike over the whole frame by their own
 * parameters (not by blendFunction, which probe 8 showed is unreliable —
 * HueSaturation at blendFunction 0 blacked the entire frame).
 *
 *   node scripts/r22p1-c-probe9.js
 *   env: FLY_URL, SECONDS, POSE, WEATHER, DSF, MAXHITS
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SECONDS = +(process.env.SECONDS ?? 300);
const OUT = process.env.OUT || path.join(__dirname, '../.probe-c-hdr');
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

  /** read an HDR render target as float; returns luminance stats over a grid */
  const hdrStats = (rt) => {
    try {
      const c = gl.getContext();
      const props = gl.properties.get(rt.texture ? rt : rt);
      const fb = props?.__webglFramebuffer;
      if (!fb) return { err: 'no fb' };
      const W = rt.width, H = rt.height;
      c.bindFramebuffer(c.FRAMEBUFFER, fb);
      // sample 15 scanlines across the target
      let mx = -1e30, mn = 1e30, sum = 0, cnt = 0, mxAt = null, over1 = 0, over8 = 0;
      const buf = new Float32Array(W * 4);
      for (let k = 1; k <= 15; k++) {
        const y = ((H * k) / 16) | 0;
        c.readPixels(0, y, W, 1, c.RGBA, c.FLOAT, buf);
        for (let x = 0; x < W; x++) {
          const r = buf[x * 4], g = buf[x * 4 + 1], b = buf[x * 4 + 2];
          if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) { over8++; continue; }
          const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (L > mx) { mx = L; mxAt = [x, y, +r.toFixed(2), +g.toFixed(2), +b.toFixed(2)]; }
          if (L < mn) mn = L;
          if (L > 1) over1++;
          if (L > 8) over8++;
          sum += L; cnt++;
        }
      }
      c.bindFramebuffer(c.FRAMEBUFFER, null);
      return {
        W, H, samples: cnt,
        lumMin: +mn.toFixed(4), lumMax: +mx.toFixed(2), lumMean: +(sum / Math.max(1, cnt)).toFixed(3),
        fracOver1: +(over1 / Math.max(1, cnt)).toFixed(3), fracOver8: +(over8 / Math.max(1, cnt)).toFixed(3),
        maxAt: mxAt,
      };
    } catch (e) { return { err: String(e).slice(0, 100) }; }
  };

  const grp = () => window.__satBuildings?.object ?? null;
  let lastNormalHdr = null;

  comp.render = (dt) => {
    const r = cr(dt);
    if (!window.__cOn || busy) return r;
    window.__cFrames++;
    const s = scan();
    const inBuf = comp.inputBuffer ?? comp.renderTarget1 ?? null;
    if (s.pr <= 0.5 && inBuf && window.__cFrames % 60 === 0) lastNormalHdr = hdrStats(inBuf);

    if (s.pr > 0.5 && window.__cHits.length < maxHits) {
      busy = true;
      try {
        const hit = { n, ...s, normalHdr: lastNormalHdr };
        hit.paleHdr = inBuf ? hdrStats(inBuf) : { err: 'no inputBuffer' };
        hit.bufNames = { input: comp.inputBuffer?.uuid?.slice(0, 6) ?? null, out: comp.outputBuffer?.uuid?.slice(0, 6) ?? null };

        /* find culprit */
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
        hit.culpritUuid = culprit?.uuid.slice(0, 8) ?? null;
        /* HDR with the culprit hidden — isolates its own contribution */
        if (culprit) {
          culprit.visible = false; cr(0);
          hit.hdrCulpritHidden = hdrStats(inBuf);
          culprit.visible = true; cr(0);
        }

        const trials = {};
        const run1 = (label, apply, undo) => {
          try { apply(); cr(0); trials[label] = scan(); undo(); cr(0); }
          catch (e) { trials[label] = { err: String(e).slice(0, 90) }; }
        };

        /* drive the spreading effects by their OWN parameters */
        const ep = (comp.passes ?? []).find((p) => (p.effects ?? []).length > 1);
        const byName = {};
        for (const e of ep?.effects ?? []) byName[e.name ?? e.constructor?.name] = e;
        hit.effectNames = Object.keys(byName);

        const bloom = byName.BloomEffect;
        if (bloom) {
          run1('bloom.intensity=0', () => { bloom.__i = bloom.intensity; bloom.intensity = 0; }, () => { bloom.intensity = bloom.__i; });
          try {
            const lm = bloom.luminanceMaterial ?? bloom.luminancePass?.fullscreenMaterial;
            if (lm) {
              hit.bloomLum = { threshold: lm.threshold ?? lm.uniforms?.threshold?.value ?? null, smoothing: lm.smoothing ?? null };
              run1('bloom.threshold=99', () => { lm.__t = lm.threshold; lm.threshold = 99; }, () => { lm.threshold = lm.__t; });
            }
            hit.bloomInfo = { intensity: bloom.intensity, radius: bloom.mipmapBlurPass?.radius ?? null, levels: bloom.mipmapBlurPass?.levels ?? null };
          } catch (e) { hit.bloomErr = String(e).slice(0, 80); }
        }
        const aerial = byName.AerialPerspectiveEffect;
        if (aerial) {
          const u = aerial.uniforms ? Object.fromEntries([...aerial.uniforms.entries()].map(([k, v]) => [k, typeof v.value === 'object' ? '(obj)' : v.value])) : null;
          hit.aerialU = u;
          for (const key of ['intensity', 'strength', 'density', 'amount']) {
            if (aerial.uniforms?.has?.(key)) {
              run1(`aerial.${key}=0`, () => { aerial.__s = aerial.uniforms.get(key).value; aerial.uniforms.get(key).value = 0; },
                () => { aerial.uniforms.get(key).value = aerial.__s; });
            }
          }
        }
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
  console.log(`[c9] boot ${(await bootFly(page, { ...BOOT_OPTS, style: 'satellite' })).ms} ms`);
  console.log('[c9] install', JSON.stringify(await page.evaluate(INSTALL, MAXHITS)));
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
  console.log(`\n[c9] composed frames ${frames} · pale events ${hits.length}`);
  for (const h of hits) {
    console.log(`\n=== PALE n=${h.n} L=${h.L} pr=${h.pr} culprit=${h.culpritUuid}`);
    console.log(`  HDR normal frame : ${JSON.stringify(h.normalHdr)}`);
    console.log(`  HDR PALE frame   : ${JSON.stringify(h.paleHdr)}`);
    console.log(`  HDR culprit hidden: ${JSON.stringify(h.hdrCulpritHidden)}`);
    console.log(`  effects: ${JSON.stringify(h.effectNames)}`);
    console.log(`  bloom: ${JSON.stringify(h.bloomInfo)} lum=${JSON.stringify(h.bloomLum)}`);
    console.log(`  aerialU: ${JSON.stringify(h.aerialU)}`);
    console.log('  --- TRIALS ---');
    for (const [k, v] of Object.entries(h.trials ?? {})) console.log(`    ${k.padEnd(24)} -> ${JSON.stringify(v)}`);
  }
  fs.writeFileSync(path.join(OUT, `hdr-${process.env.POSE ?? 'nyc'}.json`), JSON.stringify({ frames, hits }, null, 1));
  console.log('[c9] pageerrors', errs.length, errs.slice(0, 3).join(' | '));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

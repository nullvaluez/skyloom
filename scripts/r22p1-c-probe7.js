/**
 * R22.1 (C "FLASH") — PROBE 7: which UNIFORM turns the chunk white?
 *
 * Probe 6 proved, 6/6, that (a) clouds do not paint the pale, (b) the culprit
 * chunk is long-resident with a matrixWorld byte-identical to the previous
 * frame, (c) its attributes are all present, and (d) re-rendering it with a
 * material clone that drops the bend patch removes the pale entirely.
 *
 * But that clone drops THREE things at once — the vertex bend, the Bayer
 * screen-door discard and the content-haze fragment mix. This probe separates
 * them: on the frozen pale frame it dumps every uniform of the shared material
 * for the last 6 frames (so a spiking value is visible as a diff against the
 * normal frames that precede it) and then neutralises ONE input at a time,
 * re-rendering and re-scanning after each.
 *
 *   node scripts/r22p1-c-probe7.js
 *   env: FLY_URL, SECONDS, POSE, WEATHER, DSF, MAXHITS
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SECONDS = +(process.env.SECONDS ?? 300);
const OUT = process.env.OUT || path.join(__dirname, '../.probe-c-uni');
const MAXHITS = +(process.env.MAXHITS ?? 4);
const POSES = {
  powell: { lat: 40.1748, lon: -83.1079, altM: 515, name: 'Powell OH' },
  nyc: null,
};
const POSE = POSES[process.env.POSE ?? 'nyc'];

const INSTALL = (maxHits) => {
  const comp = window.__flyComposer;
  const gl = window.__flyGl ?? comp?.getRenderer?.();
  const rp = comp?.passes?.find((p) => p.scene);
  const scene = rp?.scene;
  if (!comp || !gl || !scene) return { ok: false };
  window.__cHits = [];
  window.__cFrames = 0;
  let row = null;
  let busy = false;
  let n = 0;
  const cr = comp.render.bind(comp);

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

  /** vertical coverage: pale ratio over 9 evenly spaced scanlines */
  const scanV = () => {
    const c = gl.getContext();
    const W = c.drawingBufferWidth;
    const H = c.drawingBufferHeight;
    if (!row || row.length < W * 4) row = new Uint8Array(W * 4);
    c.bindFramebuffer(c.FRAMEBUFFER, null);
    const out = [];
    for (let k = 1; k <= 9; k++) {
      const y = ((H * k) / 10) | 0;
      c.readPixels(0, y, W, 1, c.RGBA, c.UNSIGNED_BYTE, row);
      let run = 0;
      for (let x = 0; x < W; x++) {
        const L = (row[x * 4] * 299 + row[x * 4 + 1] * 587 + row[x * 4 + 2] * 114) / 1000;
        if (L > 200) run++;
      }
      out.push(+(run / W).toFixed(2));
    }
    return out;
  };

  const flat = (v) => {
    if (v == null) return v;
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v === 'object') {
      if ('x' in v) return [v.x, v.y, v.z, v.w].filter((q) => q !== undefined);
      if ('r' in v) return [v.r, v.g, v.b];
      if (Array.isArray(v)) return v.length <= 4 ? v : `arr${v.length}`;
      if (v.isTexture) return 'tex';
      if (v.elements) return `mat${v.elements.length}`;
    }
    return String(v).slice(0, 24);
  };
  /** dump every uniform three has bound for this material */
  const dumpU = (mat) => {
    try {
      const u = gl.properties.get(mat)?.uniforms;
      if (!u) return null;
      const o = {};
      for (const k of Object.keys(u)) o[k] = flat(u[k].value);
      return o;
    } catch {
      return null;
    }
  };
  const lightsOf = () => {
    const o = [];
    scene.traverse((x) => {
      if (x.isLight) o.push({ t: x.type, i: +(x.intensity ?? -1).toFixed(3), c: x.color?.getHexString?.() ?? null, gc: x.groundColor?.getHexString?.() ?? null, vis: x.visible });
    });
    return o;
  };

  const grp = () => window.__satBuildings?.object ?? null;
  const ring = [];

  comp.render = (dt) => {
    const r = cr(dt);
    if (!window.__cOn || busy) return r;
    window.__cFrames++;
    const s = scan();
    const mat = window.__satBuildings?.material ?? null;
    ring.push({ n, L: s.L, pr: s.pr, u: dumpU(mat), chunks: grp()?.children.length ?? -1 });
    if (ring.length > 6) ring.shift();

    if (s.pr > 0.5 && window.__cHits.length < maxHits) {
      busy = true;
      try {
        const hit = { n, ...s, ring: JSON.parse(JSON.stringify(ring)), lights: lightsOf() };
        hit.vert = scanV();
        hit.fog = scene.fog ? { type: scene.fog.type ?? 'Fog', color: scene.fog.color?.getHexString?.(), near: scene.fog.near, far: scene.fog.far, density: scene.fog.density } : null;

        /* find the culprit chunk */
        const g = grp();
        let culprit = null;
        if (g && g.visible) {
          for (const o of [...g.children]) {
            if (!o.visible) continue;
            o.visible = false;
            cr(0);
            const out = scan();
            o.visible = true;
            if (out.pr < 0.5) { culprit = o; break; }
          }
          cr(0);
        }
        if (!culprit) { hit.culprit = null; window.__cHits.push(hit); busy = false; return r; }
        hit.culpritUuid = culprit.uuid.slice(0, 8);

        const mm = culprit.material;
        const U = gl.properties.get(mm)?.uniforms ?? {};
        const setV = (k, fn) => { const t = U[k]?.value; if (t == null) return null; const before = flat(t); fn(U[k]); return before; };

        const trials = {};
        const run1 = (label, apply, undo) => {
          try { apply(); cr(0); trials[label] = scan(); undo(); cr(0); } catch (e) { trials[label] = { err: String(e).slice(0, 80) }; }
        };

        /* ---- ONE INPUT AT A TIME ---------------------------------------- */
        if (U.uBendK) {
          const b = U.uBendK.value;
          run1('bendK=0', () => { U.uBendK.value = 0; }, () => { U.uBendK.value = b; });
        }
        if (U.uSatBldgFade) {
          const b = U.uSatBldgFade.value;
          run1('fade=1', () => { U.uSatBldgFade.value = 1; }, () => { U.uSatBldgFade.value = b; });
        }
        if (U.uSatHazeMax) {
          const b = U.uSatHazeMax.value;
          run1('hazeMax=0', () => { U.uSatHazeMax.value = 0; }, () => { U.uSatHazeMax.value = b; });
        }
        if (U.uBendCenter) {
          const c0 = U.uBendCenter.value;
          const bx = c0.x, bz = c0.y;
          run1('bendCenter=cam', () => {
            const cam = window.__fly?.camera ?? rp.camera;
            c0.x = cam.position.x; c0.y = cam.position.z;
          }, () => { c0.x = bx; c0.y = bz; });
        }
        /* lights */
        const hemi = []; const dir = [];
        scene.traverse((x) => { if (x.isHemisphereLight) hemi.push(x); if (x.isDirectionalLight) dir.push(x); });
        run1('hemi=0', () => hemi.forEach((h) => { h.__i = h.intensity; h.intensity = 0; }), () => hemi.forEach((h) => { h.intensity = h.__i; }));
        run1('dir=0', () => dir.forEach((h) => { h.__i = h.intensity; h.intensity = 0; }), () => dir.forEach((h) => { h.intensity = h.__i; }));
        /* scene fog */
        if (scene.fog) {
          const f = scene.fog;
          run1('fog=null', () => { scene.fog = null; mm.needsUpdate = true; }, () => { scene.fog = f; mm.needsUpdate = true; });
        }
        /* env / background intensity */
        run1('envInt=0', () => { scene.__ei = scene.environmentIntensity; scene.environmentIntensity = 0; }, () => { scene.environmentIntensity = scene.__ei; });
        /* material colour to mid grey - proves it is the SHADING not the geometry */
        run1('matBlack', () => { mm.__c = mm.color.getHex(); mm.color.setHex(0x000000); }, () => { mm.color.setHex(mm.__c); });

        hit.trials = trials;
        hit.matU = dumpU(mm);
        hit.matInfo = {
          vertexColors: mm.vertexColors, side: mm.side, emissive: mm.emissive?.getHexString?.() ?? null,
          emissiveIntensity: mm.emissiveIntensity ?? null, color: mm.color?.getHexString?.() ?? null,
          fog: mm.fog, toneMapped: mm.toneMapped, transparent: mm.transparent, opacity: mm.opacity,
          envMap: !!mm.envMap, envMapIntensity: mm.envMapIntensity ?? null, lightMap: !!mm.lightMap,
        };
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
  const browser = await chromium.launch({ channel: 'chrome', headless: process.env.HEADED !== '1', args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 660 }, deviceScaleFactor: +(process.env.DSF ?? 1.5) });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  if (process.env.WEATHER === 'live') {
    await page.addInitScript(() => {
      Object.defineProperty(window, '__flyWeatherOverride', { configurable: true, get: () => window.__wxUnpinned, set: (v) => { window.__wxPinAttempt = v; } });
    });
  }
  await page.addInitScript(unpinPins, ['__flySettlePin']);
  console.log(`[c7] boot ${(await bootFly(page, { ...BOOT_OPTS, style: 'satellite' })).ms} ms`);
  console.log('[c7] install', JSON.stringify(await page.evaluate(INSTALL, MAXHITS)));
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
  console.log(`\n[c7] composed frames ${frames} · pale events ${hits.length}`);
  for (const h of hits) {
    console.log(`\n=== PALE n=${h.n} L=${h.L} pr=${h.pr} culprit=${h.culpritUuid}`);
    console.log(`  vertical pale by scanline: ${JSON.stringify(h.vert)}`);
    console.log(`  scene.fog: ${JSON.stringify(h.fog)}`);
    console.log(`  lights: ${JSON.stringify(h.lights)}`);
    console.log(`  matInfo: ${JSON.stringify(h.matInfo)}`);
    console.log('  --- uniform ring (pale frame is last) ---');
    for (const r of h.ring) {
      const u = r.u ?? {};
      const pick = {};
      for (const k of ['uBendCenter', 'uBendK', 'uSatBldgFade', 'uSatHazeMax', 'uSatHaze', 'diffuse', 'emissive', 'opacity']) if (k in u) pick[k] = u[k];
      console.log(`    n=${r.n} L=${r.L} pr=${r.pr} chunks=${r.chunks} ${JSON.stringify(pick)}`);
    }
    console.log('  --- SINGLE-INPUT TRIALS (pr<0.5 => that input is the cause) ---');
    for (const [k, v] of Object.entries(h.trials ?? {})) console.log(`    ${k.padEnd(16)} -> ${JSON.stringify(v)}`);
  }
  fs.writeFileSync(path.join(OUT, `uni-${process.env.POSE ?? 'nyc'}.json`), JSON.stringify({ frames, hits }, null, 1));
  console.log('[c7] pageerrors', errs.length, errs.slice(0, 3).join(' | '));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });

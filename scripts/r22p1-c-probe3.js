/**
 * R22.1 (C "CLOUDS") — SCRATCH PROBE 3: WHO paints the pale frame?
 *
 * Probe 2 showed the pale frame re-renders pale with the cumulus deck, the
 * cirrus deck and the instanced mesh all parked — so the cloud billboards are
 * not the thing on screen. This probe widens the post-mortem bisection to
 * EVERY top-level scene child, then to the scene itself and its background,
 * and dumps the full renderer/scene/post state on the pale frame next to a
 * normal one. It also grabs the actual pixels.
 *
 *   node scripts/r22p1-c-probe3.js
 *   env: FLY_URL, SECONDS, POSE=powell|nyc, WEATHER, DSF
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SECONDS = +(process.env.SECONDS ?? 150);
const OUT = process.env.OUT || path.join(__dirname, '../.probe-c-who');
const POSES = {
  powell: { lat: 40.1748, lon: -83.1079, altM: 515, name: 'Powell OH' },
  nyc: null,
};
const POSE = POSES[process.env.POSE ?? 'nyc'];

const INSTALL = () => {
  const comp = window.__flyComposer;
  const gl = window.__flyGl ?? comp?.getRenderer?.();
  if (!comp || !gl) return { ok: false };
  const rp = comp.passes?.find((p) => p.scene);
  const scene = rp?.scene ?? null;
  const camOf = () => window.__fly?.camera ?? rp?.camera ?? null;
  const S = (window.__cFrames = []);
  window.__cHits = [];
  window.__cShots = [];
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
  /** raw downsampled RGB grab kept in-page (converted to PNG after the run) */
  const grabRaw = () => {
    const c = gl.getContext();
    const W = c.drawingBufferWidth;
    const H = c.drawingBufferHeight;
    const buf = new Uint8Array(W * H * 4);
    c.bindFramebuffer(c.FRAMEBUFFER, null);
    c.readPixels(0, 0, W, H, c.RGBA, c.UNSIGNED_BYTE, buf);
    return { W, H, buf };
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

  /** everything that could turn a frame white, as plain numbers */
  const stateDump = () => {
    const cam = camOf();
    const bg = scene?.background;
    const lights = [];
    scene?.traverse?.((o) => {
      if (o.isLight && lights.length < 12)
        lights.push({
          t: o.type,
          i: +(o.intensity ?? 0).toFixed(4),
          c: o.color?.getHexString?.() ?? null,
          v: o.visible,
        });
    });
    const passes = (comp.passes ?? []).map((p) => ({
      n: p.name,
      e: p.enabled,
      s: p.renderToScreen,
      fx: (p.effects ?? []).map((f) => f.name),
    }));
    return {
      exposure: +gl.toneMappingExposure.toFixed(4),
      toneMapping: gl.toneMapping,
      bg: bg
        ? {
            isTex: !!bg.isTexture,
            isCol: !!bg.isColor,
            hex: bg.isColor ? bg.getHexString() : null,
            uuid: bg.uuid?.slice(0, 8) ?? null,
            mapping: bg.mapping ?? null,
            w: bg.image?.width ?? null,
            h: bg.image?.height ?? null,
          }
        : null,
      bgI: +(scene?.backgroundIntensity ?? -1).toFixed(4),
      envI: +(scene?.environmentIntensity ?? -1).toFixed(4),
      envU: scene?.environment?.uuid?.slice(0, 8) ?? null,
      fog: scene?.fog
        ? { c: scene.fog.color.getHexString(), d: +(scene.fog.density ?? -1).toFixed(8) }
        : null,
      camP: cam ? [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)] : null,
      camQ: cam ? [+cam.quaternion.x.toFixed(4), +cam.quaternion.y.toFixed(4), +cam.quaternion.z.toFixed(4), +cam.quaternion.w.toFixed(4)] : null,
      fov: cam?.fov ?? null,
      near: cam?.near ?? null,
      far: cam?.far ?? null,
      lights,
      passes,
      sceneVisible: scene?.visible,
      nKids: scene?.children?.length ?? -1,
    };
  };
  window.__cState = stateDump;

  comp.render = (dt) => {
    const r = cr(dt);
    if (!window.__cOn || busy) return r;
    const s = scan();
    S.push({ n, t: +performance.now().toFixed(1), L: s.L, pr: s.pr });
    if (s.pr > 0.5 && window.__cHits.length < (window.__cMaxHits ?? 3)) {
      busy = true;
      try {
        const hit = { n, ...s, state: stateDump(), kids: [] };
        window.__cShots.push(grabRaw());
        hit.shot = window.__cShots.length - 1;
        cr(0);
        hit.rerender = scan();
        // --- park every top-level scene child, one at a time ---------------
        for (const o of [...(scene?.children ?? [])]) {
          if (!o.visible) continue;
          o.visible = false;
          cr(0);
          const out = scan();
          o.visible = true;
          hit.kids.push({
            name: o.name || o.type,
            t: o.type,
            n: o.children?.length ?? 0,
            L: out.L,
            pr: out.pr,
            cleared: out.pr < 0.5,
          });
        }
        // --- the scene itself, then its background ------------------------
        const sv = scene.visible;
        scene.visible = false;
        cr(0);
        hit.noScene = scan();
        scene.visible = sv;
        const bg = scene.background;
        scene.background = null;
        cr(0);
        hit.noBg = scan();
        scene.background = bg;
        // --- scene hidden AND background null (post chain over nothing) ----
        scene.visible = false;
        scene.background = null;
        cr(0);
        hit.bare = scan();
        scene.visible = sv;
        scene.background = bg;
        cr(0);
        window.__cHits.push(hit);
      } finally {
        busy = false;
      }
    }
    n++;
    return r;
  };
  return { ok: true, hasScene: !!scene };
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
  console.log(`[c3] boot ${ms} ms`);
  console.log('[c3] install', JSON.stringify(await page.evaluate(INSTALL)));
  if (POSE) {
    await page.evaluate(
      ([la, lo, al, nm]) => window.__fly.warpToGeo(la, lo, { altM: al, name: nm }),
      [POSE.lat, POSE.lon, POSE.altM, POSE.name]
    );
    await page.waitForTimeout(9000);
  }
  const normal = await page.evaluate(() => window.__cState());
  await page.evaluate(() => {
    window.__cFrames.length = 0;
    window.__cHits.length = 0;
    window.__cOn = true;
  });
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) {
    await page.waitForTimeout(2000);
    if ((await page.evaluate(() => window.__cHits.length)) >= 2) break;
  }
  await page.evaluate(() => {
    window.__cOn = false;
  });
  const hits = await page.evaluate(() => window.__cHits);
  const frames = await page.evaluate(() => window.__cFrames);
  console.log(`[c3] composed ${frames.length} · PALE ${hits.length}`);
  for (const h of hits) {
    console.log(`  PALE n=${h.n} L=${h.L} pr=${h.pr} · re-render ${JSON.stringify(h.rerender)}`);
    console.log(`     noScene ${JSON.stringify(h.noScene)} · noBg ${JSON.stringify(h.noBg)} · bare ${JSON.stringify(h.bare)}`);
    const cleared = h.kids.filter((k) => k.cleared);
    console.log(`     children tried ${h.kids.length} · CLEARED BY: ${cleared.map((k) => `${k.name}(${k.t}) -> L${k.L}`).join(', ') || 'NONE'}`);
    // diff the state against the normal one
    const diffs = [];
    const walk = (a, b, p) => {
      for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
        const x = a?.[k];
        const y = b?.[k];
        if (typeof x === 'object' && x && typeof y === 'object' && y) walk(x, y, p + k + '.');
        else if (JSON.stringify(x) !== JSON.stringify(y)) diffs.push(`${p}${k}: ${JSON.stringify(x)} -> ${JSON.stringify(y)}`);
      }
    };
    walk(normal, h.state, '');
    console.log(`     STATE DIFF vs normal: ${diffs.length ? diffs.join(' | ') : 'none'}`);
  }
  // write the pale frames out
  for (let i = 0; i < hits.length; i++) {
    const url = await page.evaluate((k) => window.__cToPng(k), hits[i].shot);
    if (url) {
      fs.writeFileSync(path.join(OUT, `pale-${hits[i].n}.png`), Buffer.from(url.split(',')[1], 'base64'));
      console.log(`[c3] wrote pale-${hits[i].n}.png`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'who.json'), JSON.stringify({ normal, hits, frames: frames.slice(0, 40000) }, null, 1));
  console.log('[c3] pageerrors', errs.length, errs.slice(0, 3).join(' | '));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

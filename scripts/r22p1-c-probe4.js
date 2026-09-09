/**
 * R22.1 (C "CLOUDS") — SCRATCH PROBE 4: name the MESH.
 *
 * Probe 3 proved the pale frame is drawn GEOMETRY (background null -> still
 * pale; scene hidden -> not pale), lit by the HemisphereLight, inside one
 * top-level Group. This probe recurses that Group on the pale frame and
 * reports the minimal object whose parking clears it, with its material,
 * geometry, world transform and identity against the known dev handles.
 *
 *   node scripts/r22p1-c-probe4.js
 *   env: FLY_URL, SECONDS, POSE, WEATHER, DSF
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SECONDS = +(process.env.SECONDS ?? 180);
const OUT = process.env.OUT || path.join(__dirname, '../.probe-c-mesh');
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
  const handles = () => {
    const m = new Map();
    for (const k of Object.keys(window)) {
      if (!k.startsWith('__fly') && !k.startsWith('__sat')) continue;
      const v = window[k];
      if (v && v.isObject3D) m.set(v.uuid, k);
      if (v && v.object && v.object.isObject3D) m.set(v.object.uuid, k + '.object');
      if (v && v.mesh && v.mesh.isObject3D) m.set(v.mesh.uuid, k + '.mesh');
    }
    return m;
  };
  const describe = (o, hm) => {
    const e = o.matrixWorld.elements;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    return {
      name: o.name || '',
      type: o.type,
      uuid: o.uuid.slice(0, 8),
      handle: hm.get(o.uuid) ?? null,
      kids: o.children?.length ?? 0,
      count: o.count ?? null,
      mat: mat ? mat.type : null,
      matColor: mat?.color?.getHexString?.() ?? null,
      matOpacity: mat?.opacity ?? null,
      transparent: mat?.transparent ?? null,
      geo: o.geometry?.type ?? null,
      pos: [+e[12].toFixed(1), +e[13].toFixed(1), +e[14].toFixed(1)],
      scale: +Math.hypot(e[0], e[1], e[2]).toFixed(3),
      frustumCulled: o.frustumCulled,
      renderOrder: o.renderOrder,
    };
  };
  comp.render = (dt) => {
    const r = cr(dt);
    if (!window.__cOn || busy) return r;
    const s = scan();
    if (s.pr > 0.5 && window.__cHits.length < 2) {
      busy = true;
      try {
        const hm = handles();
        const hit = { n, ...s, chain: [], siblings: [] };
        { const _c = window.__fly?.camera ?? rp.camera; const _e=_c.matrixWorld.elements; hit.cam=[+_e[12].toFixed(1),+_e[13].toFixed(1),+_e[14].toFixed(1)]; }
        // walk down: at each level, park each visible child, keep the one
        // whose parking clears the pale, recurse into it.
        let node = scene;
        for (let depth = 0; depth < 8; depth++) {
          let found = null;
          const level = [];
          for (const o of [...(node.children ?? [])]) {
            if (!o.visible) continue;
            o.visible = false;
            cr(0);
            const out = scan();
            o.visible = true;
            level.push({ ...describe(o, hm), L: out.L, pr: out.pr, cleared: out.pr < 0.5 });
            // a LIGHT can clear a lit surface without being the surface — keep
            // descending through the object that actually draws the pixels.
            if (out.pr < 0.5 && !o.isLight && !found) found = o;
          }
          hit.chain.push({ depth, parent: describe(node, hm), cleared: level.filter((x) => x.cleared) });
          if (depth === 0) hit.siblings = level;
          if (!found) break;
          node = found;
          if (!node.children?.length) break;
        }
        hit.leaf = describe(node, hm);
        // full instance census IF the leaf is an instanced mesh
        if (node.isInstancedMesh) {
          const cam = window.__fly?.camera ?? rp.camera;
          const cw = cam.matrixWorld.elements;
          const a = node.instanceMatrix.array;
          const op = node.geometry.attributes.cloudOpacity?.array;
          const list = [];
          for (let i = 0; i < node.count; i++) {
            const o = i * 16;
            const d = Math.hypot(a[o + 12] - cw[12], a[o + 13] - cw[13], a[o + 14] - cw[14]);
            const half = 0.5 * Math.hypot(a[o], a[o + 1], a[o + 2]);
            list.push({
              i,
              d: +d.toFixed(1),
              half: +half.toFixed(1),
              cover: +(half / Math.max(1e-3, d)).toFixed(3),
              op: op ? +op[i].toFixed(3) : -1,
              p: [+a[o + 12].toFixed(1), +a[o + 13].toFixed(1), +a[o + 14].toFixed(1)],
            });
          }
          list.sort((x, y) => y.cover - x.cover);
          hit.top = list.slice(0, 10);
          hit.cam = [+cw[12].toFixed(1), +cw[13].toFixed(1), +cw[14].toFixed(1)];
          // binary search the prefix that still paints pale
          const full = node.count;
          let lo = 0;
          let hi = full;
          while (hi - lo > 1) {
            const mid = ((lo + hi) / 2) | 0;
            node.count = mid;
            cr(0);
            if (scan().pr > 0.5) hi = mid;
            else lo = mid;
          }
          node.count = full;
          hit.prefix = hi;
          const q = (hi - 1) * 16;
          hit.prefixInst = {
            i: hi - 1,
            d: +Math.hypot(a[q + 12] - cw[12], a[q + 13] - cw[13], a[q + 14] - cw[14]).toFixed(1),
            half: +(0.5 * Math.hypot(a[q], a[q + 1], a[q + 2])).toFixed(1),
            op: op ? +op[hi - 1].toFixed(3) : -1,
            p: [+a[q + 12].toFixed(1), +a[q + 13].toFixed(1), +a[q + 14].toFixed(1)],
          };
        }
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
  console.log(`[c4] boot ${(await bootFly(page, { ...BOOT_OPTS, style: 'satellite' })).ms} ms`);
  console.log('[c4] install', JSON.stringify(await page.evaluate(INSTALL)));
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
    console.log(`\nPALE n=${h.n} L=${h.L} pr=${h.pr} cam=${JSON.stringify(h.cam)}`);
    for (const c of h.chain) {
      console.log(`  depth ${c.depth} under ${c.parent.type}/${c.parent.handle ?? c.parent.name ?? ''} (${c.parent.uuid}):`);
      for (const k of c.cleared)
        console.log(`     CLEARS: ${k.type} ${k.handle ?? k.name ?? ''} uuid=${k.uuid} mat=${k.mat} color=${k.matColor} count=${k.count} kids=${k.kids} pos=${JSON.stringify(k.pos)} scale=${k.scale} -> L${k.L}`);
    }
    console.log(`  LEAF: ${JSON.stringify(h.leaf)}`);
    if (h.top) {
      console.log(`  prefix that still paints pale: ${h.prefix}/${h.leaf.count} · instance ${JSON.stringify(h.prefixInst)}`);
      for (const t of h.top.slice(0, 6)) console.log(`     inst ${t.i} d=${t.d} half=${t.half} cover=${t.cover} op=${t.op} p=${JSON.stringify(t.p)}`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'mesh.json'), JSON.stringify(hits, null, 1));
  console.log('[c4] pageerrors', errs.length, errs.slice(0, 3).join(' | '));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

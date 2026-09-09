/**
 * R22.1 (C "FLASH") — PROBE 6: ADJUDICATE H1/H2/H3/H4 on every pale event.
 *
 * Probe 4 named ONE actor on ONE event. This probe collects MANY events and,
 * for each, answers the four hypotheses with same-frame measurements taken
 * INSIDE the intercepted composer.render, before any matrix is recomputed:
 *
 *   ACTOR   — scene-level hide-bisection over every top-level child. Records
 *             which children clear the pale. `__flyClouds` is in that list, so
 *             this arm adjudicates H4 (clouds) against the buildings on the
 *             SAME frame rather than across runs.
 *   AGE     — a per-frame census of the sat-buildings group's child uuids lets
 *             us say whether the culprit chunk was ADDED THIS FRAME (H1's
 *             same-frame-add prediction) or has been resident for many frames.
 *   XFORM   — culprit matrixWorld this frame vs the previous frame, plus the
 *             parent origin-offset group's, plus a CPU projection of the
 *             geometry bounding sphere through the live camera. If the CPU
 *             projection says "small and off to the side" while the frame is
 *             pale, the displacement is NOT in the transform (kills H1) and
 *             must be in the vertex shader (H2).
 *   SHADER  — swap the culprit to a stock unbent MeshBasicMaterial and
 *             re-render. Pale persists => geometry/transform really is over
 *             the lens. Pale vanishes => the bend shader is displacing it.
 *             This is the H1-vs-H2 discriminator.
 *   COLOR   — vertexColors / attribute presence at the torn frame (H3).
 *
 *   node scripts/r22p1-c-probe6.js
 *   env: FLY_URL, SECONDS, POSE (nyc|powell), WEATHER (baseline|live), DSF,
 *        MAXHITS, HEADED
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SECONDS = +(process.env.SECONDS ?? 240);
const OUT = process.env.OUT || path.join(__dirname, '../.probe-c-adj');
const MAXHITS = +(process.env.MAXHITS ?? 8);
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
  const THREE = window.__flyTHREE ?? null;

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

  const grp = () => window.__satBuildings?.object ?? null;

  /* per-frame census of the sat-buildings children: uuid -> {first seen, mw} */
  const seen = new Map();
  const censusPrev = new Map(); // uuid -> matrixWorld translation last frame
  const census = () => {
    const g = grp();
    const now = new Map();
    if (g) {
      for (const o of g.children) {
        const e = o.matrixWorld.elements;
        now.set(o.uuid, [e[12], e[13], e[14]]);
        if (!seen.has(o.uuid)) seen.set(o.uuid, n);
      }
    }
    return now;
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

  const desc = (o, hm) => {
    const e = o.matrixWorld.elements;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    return {
      type: o.type,
      uuid: o.uuid.slice(0, 8),
      handle: hm.get(o.uuid) ?? null,
      name: o.name || '',
      kids: o.children?.length ?? 0,
      mat: mat ? mat.type : null,
      col: mat?.color?.getHexString?.() ?? null,
      pos: [+e[12].toFixed(1), +e[13].toFixed(1), +e[14].toFixed(1)],
    };
  };

  /** project a world-space sphere through the camera; return NDC coverage */
  const project = (cam, cx, cy, cz, r) => {
    try {
      const v = new (cam.position.constructor)(cx, cy, cz);
      const local = v.clone().applyMatrix4(cam.matrixWorldInverse); // view space
      const depth = -local.z;
      const proj = cam.projectionMatrix.elements;
      // perspective: x_ndc = proj[0]*x/depth ; half-angle coverage of radius r
      const halfNdcX = depth > 1e-3 ? (proj[0] * r) / depth : 999;
      const cNdc = v.clone().project(cam);
      return {
        depth: +depth.toFixed(1),
        halfNdcX: +halfNdcX.toFixed(3),
        centerNdc: [+cNdc.x.toFixed(3), +cNdc.y.toFixed(3)],
        // fraction of the [-1,1] NDC width the sphere spans, clipped
        coverX: +Math.min(1, Math.max(0, (Math.min(1, cNdc.x + halfNdcX) - Math.max(-1, cNdc.x - halfNdcX)) / 2)).toFixed(3),
        behind: depth <= 0,
      };
    } catch (e) {
      return { err: String(e).slice(0, 80) };
    }
  };

  comp.render = (dt) => {
    const r = cr(dt);
    if (!window.__cOn || busy) return r;
    window.__cFrames++;
    const s = scan();
    const nowCensus = census();
    if (s.pr > 0.5 && window.__cHits.length < maxHits) {
      busy = true;
      try {
        const hm = handles();
        const cam = window.__fly?.camera ?? rp.camera;
        const hit = { n, ...s, chunks: grp()?.children.length ?? -1 };
        const ce = cam.matrixWorld.elements;
        hit.cam = [+ce[12].toFixed(1), +ce[13].toFixed(1), +ce[14].toFixed(1)];

        /* ---- ACTOR: scene-level bisection, clouds included ---------------- */
        const top = [];
        for (const o of [...scene.children]) {
          if (!o.visible) continue;
          o.visible = false;
          cr(0);
          const out = scan();
          o.visible = true;
          top.push({ ...desc(o, hm), L: out.L, pr: out.pr, clears: out.pr < 0.5 });
        }
        cr(0);
        hit.top = top.filter((x) => x.clears);
        hit.cloudRow = top.find((x) => x.handle === '__flyClouds') ?? null;
        hit.nTop = top.length;

        /* ---- descend into the sat-buildings group ------------------------- */
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

        if (culprit) {
          const e = culprit.matrixWorld.elements;
          const pe = culprit.parent.matrixWorld.elements;
          const geo = culprit.geometry;
          if (!geo.boundingSphere) geo.computeBoundingSphere();
          const bs = geo.boundingSphere;
          const prev = censusPrev.get(culprit.uuid) ?? null;
          const firstSeen = seen.get(culprit.uuid);
          const mat = culprit.material;

          /* world-space centre of the bounding sphere via the live matrix */
          const bc = bs.center.clone().applyMatrix4(culprit.matrixWorld);

          hit.culprit = {
            uuid: culprit.uuid.slice(0, 8),
            /* --- AGE (H1) --- */
            firstSeenFrame: firstSeen,
            ageFrames: firstSeen == null ? -1 : n - firstSeen,
            addedThisFrame: firstSeen === n,
            /* --- XFORM (H1) --- */
            mw: [+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)],
            mwPrev: prev ? [+prev[0].toFixed(2), +prev[1].toFixed(2), +prev[2].toFixed(2)] : null,
            mwDelta: prev
              ? +Math.hypot(e[12] - prev[0], e[13] - prev[1], e[14] - prev[2]).toFixed(3)
              : null,
            parentMw: [+pe[12].toFixed(1), +pe[13].toFixed(1), +pe[14].toFixed(1)],
            localPos: [culprit.position.x, culprit.position.y, culprit.position.z],
            matrixAutoUpdate: culprit.matrixAutoUpdate,
            matrixWorldNeedsUpdate: culprit.matrixWorldNeedsUpdate,
            visible: culprit.visible,
            frustumCulled: culprit.frustumCulled,
            renderOrder: culprit.renderOrder,
            /* --- geometry / projection --- */
            verts: geo.attributes.position?.count ?? -1,
            bsLocal: { c: [+bs.center.x.toFixed(1), +bs.center.y.toFixed(1), +bs.center.z.toFixed(1)], r: +bs.radius.toFixed(1) },
            bsWorld: [+bc.x.toFixed(1), +bc.y.toFixed(1), +bc.z.toFixed(1)],
            distToCam: +bc.distanceTo(cam.position).toFixed(1),
            proj: project(cam, bc.x, bc.y, bc.z, bs.radius),
            /* --- COLOR (H3) --- */
            hasColor: !!geo.attributes.color,
            colorCount: geo.attributes.color?.count ?? -1,
            hasAnchor: !!(geo.attributes.aBendAnchor ?? geo.attributes.aAnchor),
            anchorCount: (geo.attributes.aBendAnchor ?? geo.attributes.aAnchor)?.count ?? -1,
            matVertexColors: mat?.vertexColors ?? null,
            matUuid: mat?.uuid.slice(0, 8) ?? null,
            matShared: mat === window.__satBuildings?.material,
            matNeedsUpdate: mat?.needsUpdate ?? null,
            matVersion: mat?.version ?? null,
            matSide: mat?.side ?? null,
            matProgramReady: (() => {
              try { return !!gl.properties.get(mat)?.currentProgram; } catch { return null; }
            })(),
          };

          /* ---- SHADER TEST (H1 vs H2): draw it with a stock unbent mat ---- */
          try {
            const Basic = mat?.constructor && THREE ? null : null;
            // build an unbent clone WITHOUT the onBeforeCompile bend injection
            const plain = mat.clone();
            plain.onBeforeCompile = () => {};
            plain.customProgramCacheKey = () => 'r22p1-c-probe6-unbent';
            plain.needsUpdate = true;
            const savedMat = culprit.material;
            culprit.material = plain;
            cr(0);
            hit.unbent = scan();
            culprit.material = savedMat;
            cr(0);
            plain.dispose();
          } catch (err) {
            hit.unbent = { err: String(err).slice(0, 120) };
          }

          /* ---- CONTROL: hide the culprit AND everything else -> must be dark */
          try {
            const saved = [];
            scene.traverse((o) => { if (o !== scene) saved.push([o, o.visible]); });
            const keep = new Set();
            for (let p = culprit; p; p = p.parent) keep.add(p);
            for (const [o] of saved) if (!keep.has(o) && !o.isLight) o.visible = false;
            const bg = scene.background;
            scene.background = null;
            cr(0);
            hit.isoCulpritOnly = scan();
            culprit.visible = false;
            cr(0);
            hit.isoCulpritHidden = scan(); // CONTROL: must NOT be pale
            culprit.visible = true;
            scene.background = bg;
            for (const [o, v] of saved) o.visible = v;
            cr(0);
          } catch (err) {
            hit.isoErr = String(err).slice(0, 120);
          }
        } else {
          hit.culprit = null;
        }
        window.__cHits.push(hit);
      } finally {
        busy = false;
      }
    }
    censusPrev.clear();
    for (const [k, v] of nowCensus) censusPrev.set(k, v);
    n++;
    return r;
  };
  return { ok: true, hasTHREE: !!window.__flyTHREE };
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
        set: (v) => { window.__wxPinAttempt = v; },
      });
    });
  }
  await page.addInitScript(unpinPins, ['__flySettlePin']);
  console.log(`[c6] boot ${(await bootFly(page, { ...BOOT_OPTS, style: 'satellite' })).ms} ms`);
  console.log('[c6] install', JSON.stringify(await page.evaluate(INSTALL, MAXHITS)));
  if (POSE) {
    await page.evaluate(
      ([la, lo, al, nm]) => window.__fly.warpToGeo(la, lo, { altM: al, name: nm }),
      [POSE.lat, POSE.lon, POSE.altM, POSE.name]
    );
    await page.waitForTimeout(9000);
  }
  await page.evaluate(() => { window.__cHits.length = 0; window.__cFrames = 0; window.__cOn = true; });
  const t0 = Date.now();
  while (Date.now() - t0 < SECONDS * 1000) {
    await page.waitForTimeout(3000);
    const k = await page.evaluate(() => window.__cHits.length);
    if (k >= MAXHITS) break;
  }
  const frames = await page.evaluate(() => { window.__cOn = false; return window.__cFrames; });
  const hits = await page.evaluate(() => window.__cHits);
  console.log(`\n[c6] composed frames ${frames} · pale events ${hits.length}`);
  for (const h of hits) {
    console.log(`\n=== PALE n=${h.n} L=${h.L} pr=${h.pr} chunks=${h.chunks} cam=${JSON.stringify(h.cam)}`);
    console.log(`  CLEARS (${h.top.length}/${h.nTop}): ${h.top.map((t) => `${t.type}/${t.handle ?? t.name ?? '-'}`).join(', ')}`);
    console.log(`  clouds row: ${h.cloudRow ? `clears=${h.cloudRow.clears} pr=${h.cloudRow.pr}` : 'ABSENT'}`);
    if (h.culprit) {
      const c = h.culprit;
      console.log(`  CULPRIT ${c.uuid} age=${c.ageFrames}f addedThisFrame=${c.addedThisFrame}`);
      console.log(`    mw=${JSON.stringify(c.mw)} prev=${JSON.stringify(c.mwPrev)} delta=${c.mwDelta}`);
      console.log(`    bsWorld=${JSON.stringify(c.bsWorld)} r=${c.bsLocal.r} dist=${c.distToCam}`);
      console.log(`    proj=${JSON.stringify(c.proj)}   <-- CPU-predicted screen coverage`);
      console.log(`    color=${c.hasColor}/${c.colorCount} anchor=${c.hasAnchor}/${c.anchorCount} vertexColors=${c.matVertexColors} matShared=${c.matShared} progReady=${c.matProgramReady}`);
      console.log(`    UNBENT re-render: ${JSON.stringify(h.unbent)}   <-- H1 vs H2 discriminator`);
      console.log(`    iso culpritOnly=${JSON.stringify(h.isoCulpritOnly)} culpritHidden=${JSON.stringify(h.isoCulpritHidden)}`);
    } else {
      console.log('  CULPRIT: none inside sat-buildings');
    }
  }
  fs.writeFileSync(path.join(OUT, `adj-${process.env.POSE ?? 'nyc'}-${process.env.WEATHER ?? 'baseline'}.json`), JSON.stringify({ frames, hits }, null, 1));
  console.log('[c6] pageerrors', errs.length, errs.slice(0, 3).join(' | '));
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

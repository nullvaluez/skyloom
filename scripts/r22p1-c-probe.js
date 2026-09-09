/**
 * R22.1 (C "CLOUDS") — SCRATCH PROBE for the one-frame white flash.
 *
 * NOT a gate. This is the measurement instrument that answers the questions
 * Agent A's ledger left open: WHERE the offending cloud billboards actually
 * are when the frame goes pale, how big they are, and how far from the camera.
 *
 * Instrument (A's, extended): hook `composer.render`, read ONE scanline out of
 * the DEFAULT framebuffer immediately after the final pass wrote it — the only
 * instrument that can see a single-frame event (CDP screencast is blind to it,
 * A measured 0/8 on injected blanks). On a pale frame, dump the cloud deck's
 * ACTUAL rendered geometry: every drei instance matrix (world position + the
 * billboard's world size + its per-instance cloudOpacity), the puff GROUP
 * transforms CloudField wrote this frame, the camera, and the floating-origin
 * anchor + rebase counter.
 *
 *   node scripts/r22p1-c-probe.js [mode]
 *     stochastic (default) — A's conditions: fly and watch
 *     hunt                 — warp INTO a puff (deterministic pass-through)
 *     lag                  — measure the drei-vs-CloudField frame lag directly
 *   env: FLY_URL, SECONDS, POSE=powell|nyc, WEATHER=baseline|live, HEADED=1,
 *        GUARD=off (pin CLOUD_GUARD off)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const MODE = process.argv[2] || 'stochastic';
const SECONDS = +(process.env.SECONDS ?? 120);
const OUT = process.env.OUT || path.join(__dirname, `../.probe-c-${MODE}`);

// The user's recorded pose (clip @ t=11.517 s): Powell OH suburbs, satellite,
// 515 m MSL / 233 m AGL.
const POSES = {
  powell: { lat: 40.1748, lon: -83.1079, altM: 515, name: 'Powell OH' },
  nyc: null, // the un-warped default spawn — A's reproduction pose
};
const POSE = POSES[process.env.POSE ?? 'powell'];

/**
 * THE CLOUD CENSUS. Installed after boot; runs INSIDE composer.render, i.e.
 * after drei's Clouds useFrame has written every instance matrix for this
 * frame and after CloudField's useFrame wrote the group transforms — so the
 * numbers are exactly what this frame drew.
 */
const INSTALL_CENSUS = () => {
  const comp = window.__flyComposer;
  const gl = window.__flyGl ?? comp?.getRenderer?.();
  if (!comp || !gl) return { ok: false, why: 'no composer/renderer' };

  // camera: prefer the runtime's (dev), else the RenderPass's
  const camOf = () =>
    window.__fly?.camera ?? comp.passes?.find((p) => p.camera?.isCamera)?.camera ?? null;

  const S = (window.__cFrames = []);
  window.__cPale = [];
  window.__cSample = []; // periodic full dumps regardless of paleness
  let row = null;
  let lastReb = -1;
  let n = 0;

  const dump = () => {
    const root = window.__flyClouds;
    const cam = camOf();
    if (!root || !cam) return null;
    const im = root.children.find((c) => c.isInstancedMesh);
    const cw = cam.matrixWorld.elements;
    const cx = cw[12];
    const cy = cw[13];
    const cz = cw[14];
    const inst = [];
    if (im) {
      const a = im.instanceMatrix.array;
      const op = im.geometry.attributes.cloudOpacity?.array;
      const cnt = im.count;
      const rm = im.matrixWorld.elements; // expected identity-ish; reported
      for (let i = 0; i < cnt; i++) {
        const o = i * 16;
        const px = a[o + 12] + rm[12];
        const py = a[o + 13] + rm[13];
        const pz = a[o + 14] + rm[14];
        const sx = Math.hypot(a[o], a[o + 1], a[o + 2]);
        const sy = Math.hypot(a[o + 4], a[o + 5], a[o + 6]);
        const dx = px - cx;
        const dy = py - cy;
        const dz = pz - cz;
        const d = Math.hypot(dx, dy, dz);
        // the billboard is a 1 x aspect plane; half-extent = 0.5 * scale.
        // `cover` = tan(half-angle it subtends) — >1 means it is wider than
        // a 90-degree field of view from here.
        const half = 0.5 * sx;
        inst.push({
          i,
          d: +d.toFixed(1),
          half: +half.toFixed(1),
          sy: +(0.5 * sy).toFixed(1),
          cover: +(half / Math.max(1e-3, d)).toFixed(3),
          op: op ? +op[i].toFixed(3) : -1,
          p: [+px.toFixed(1), +py.toFixed(1), +pz.toFixed(1)],
        });
      }
      inst.sort((x, y) => y.cover - x.cover);
    }
    // the puff GROUPS CloudField positioned this frame
    const groups = [];
    for (const g of root.children) {
      if (g.isInstancedMesh) continue;
      const e = g.matrixWorld.elements;
      const d = Math.hypot(e[12] - cx, e[13] - cy, e[14] - cz);
      groups.push({
        d: +d.toFixed(1),
        s: +Math.hypot(e[0], e[1], e[2]).toFixed(3),
        v: g.visible,
        p: [+e[12].toFixed(1), +e[13].toFixed(1), +e[14].toFixed(1)],
      });
    }
    groups.sort((x, y) => x.d - y.d);
    const o = window.__fly?.origin?.anchor;
    const fp = window.__fly?.flight?.pos;
    return {
      cam: [+cx.toFixed(1), +cy.toFixed(1), +cz.toFixed(1)],
      anchor: o ? [+o.x.toFixed(1), +o.z.toFixed(1)] : null,
      plane: fp ? [+fp.x.toFixed(1), +fp.y.toFixed(1), +fp.z.toFixed(1)] : null,
      imWorld: im ? [+im.matrixWorld.elements[12].toFixed(1), +im.matrixWorld.elements[14].toFixed(1)] : null,
      count: im?.count ?? -1,
      inst: inst.slice(0, 8),
      nInside: inst.filter((x) => x.d < x.half).length,
      nCover: inst.filter((x) => x.cover > 0.7).length,
      groups: groups.slice(0, 6),
      guard: window.__flyStats?.cloudGuard ?? null,
    };
  };
  window.__cDump = dump;

  const cr = comp.render.bind(comp);
  comp.render = (dt) => {
    const r = cr(dt);
    if (!window.__cOn) return r;
    const c = gl.getContext();
    const W = c.drawingBufferWidth;
    const H = c.drawingBufferHeight;
    let mean = -1;
    let pr = -1;
    try {
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
      mean = +(s / W).toFixed(1);
      pr = +(run / W).toFixed(3);
    } catch {
      /* context lost — row stays -1 */
    }
    const reb = window.__flyStats?.rebases ?? 0;
    const isReb = lastReb >= 0 && reb !== lastReb;
    lastReb = reb;
    const rec = { n, t: +performance.now().toFixed(1), L: mean, pr, reb: isReb ? 1 : 0 };
    S.push(rec);
    // PALE = A's calibrated read: >50% of the mid scanline above luma 200.
    if (pr > 0.5 && window.__cPale.length < 24) {
      const d = dump();
      window.__cPale.push(Object.assign({}, rec, d));
    }
    if (n % 600 === 0 && window.__cSample.length < 20) {
      window.__cSample.push(Object.assign({}, rec, dump()));
    }
    n++;
    return r;
  };
  return { ok: true, hasClouds: !!window.__flyClouds };
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
    // verify-weather's idiom: swallow the fleet pin so the real sky drives
    // coverage/opacity/wind (the user's arm — production has no pins).
    await page.addInitScript(() => {
      Object.defineProperty(window, '__flyWeatherOverride', {
        configurable: true,
        get: () => window.__wxUnpinned,
        set: (v) => {
          window.__wxPinAttempt = v;
        },
      });
    });
  } else if (process.env.WEATHER && process.env.WEATHER !== 'baseline') {
    await page.addInitScript((w) => {
      window.__wxForce = w;
    }, process.env.WEATHER);
  }
  if (process.env.GUARD === 'off') {
    await page.addInitScript(() => {
      window.__flyCloudGuardPin = 'off';
    });
  }
  await page.addInitScript(unpinPins, ['__flySettlePin']);

  const { ms } = await bootFly(page, { ...BOOT_OPTS, style: 'satellite' });
  console.log(`[c-probe] mode=${MODE} boot ${ms} ms weather=${process.env.WEATHER ?? 'baseline'} guard=${process.env.GUARD ?? 'on'}`);
  if (process.env.WEATHER === 'live') {
    console.log('[c-probe] weather un-pinned; attempt swallowed =', await page.evaluate(() => window.__wxPinAttempt));
  }

  console.log('[c-probe] census:', JSON.stringify(await page.evaluate(INSTALL_CENSUS)));

  if (POSE) {
    await page.evaluate(
      ([la, lo, al, nm]) => window.__fly.warpToGeo(la, lo, { altM: al, name: nm }),
      [POSE.lat, POSE.lon, POSE.altM, POSE.name]
    );
    await page.waitForTimeout(9000);
  }

  const env = await page.evaluate(() => ({
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    style: window.__flyStore?.getState?.().mapStyle ?? null,
    alt: window.__fly?.flight?.pos?.y ?? null,
    spd: window.__fly?.flight?.speed ?? null,
    wx: window.__flyStats?.weather ?? null,
    cloudOpacity: window.__flyStats?.cloudOpacity ?? null,
    cloudMinAgl: window.__flyStats?.cloudMinAgl ?? null,
    spreadF: window.__flyStats?.cloudSpreadF ?? null,
  }));
  console.log('[c-probe] env', JSON.stringify(env));

  if (MODE === 'lag') {
    // DIRECT LAG MEASUREMENT. Compare, inside composer.render, each drei
    // instance's world position against the puff GROUP position CloudField
    // wrote this frame. If drei's useFrame runs BEFORE CloudField's, the
    // instances are one frame stale and the residual jumps on a rebase.
    await page.evaluate(() => {
      window.__lag = [];
      const root = window.__flyClouds;
      const im = root.children.find((c) => c.isInstancedMesh);
      const comp = window.__flyComposer;
      const cr = comp.render.bind(comp);
      let lastReb = window.__flyStats?.rebases ?? 0;
      comp.render = (d) => {
        const r = cr(d);
        // nearest GROUP centre for each instance: the residual is the
        // distance from an instance to the closest group it could belong to.
        const gs = [];
        for (const g of root.children) {
          if (g.isInstancedMesh || !g.visible) continue;
          const e = g.matrixWorld.elements;
          gs.push([e[12], e[13], e[14]]);
        }
        const a = im.instanceMatrix.array;
        let worst = 0;
        for (let i = 0; i < im.count; i++) {
          const o = i * 16;
          const px = a[o + 12];
          const py = a[o + 13];
          const pz = a[o + 14];
          let best = Infinity;
          for (const g of gs) {
            const dd = Math.hypot(px - g[0], py - g[1], pz - g[2]);
            if (dd < best) best = dd;
          }
          if (best < 1e9 && best > worst) worst = best;
        }
        const reb = window.__flyStats?.rebases ?? 0;
        window.__lag.push({ w: +worst.toFixed(1), reb: reb !== lastReb ? 1 : 0 });
        lastReb = reb;
        return r;
      };
    });
    await page.evaluate(() => {
      window.__cOn = true;
    });
    await page.waitForTimeout(SECONDS * 1000);
    const lag = await page.evaluate(() => window.__lag);
    const rebs = lag.map((r, i) => ({ i, ...r })).filter((r) => r.reb);
    const ws = lag.map((r) => r.w).sort((a, b) => a - b);
    console.log(
      `[c-probe] LAG frames ${lag.length} · residual median ${ws[(ws.length / 2) | 0]} p99 ${ws[(ws.length * 0.99) | 0]} max ${ws[ws.length - 1]}`
    );
    for (const r of rebs)
      console.log(
        `   REBASE frame ${r.i}: residual before ${lag[r.i - 1]?.w} · ON ${r.w} · after ${lag[r.i + 1]?.w}`
      );
    fs.writeFileSync(path.join(OUT, 'lag.json'), JSON.stringify({ env, lag }, null, 1));
    await browser.close();
    return;
  }

  if (MODE === 'hunt') {
    // DETERMINISTIC PASS-THROUGH: warp the aircraft to the geo of a live
    // puff, at that puff's own altitude, and let it fly through.
    const target = await page.evaluate(() => {
      const root = window.__flyClouds;
      const eng = window.__fly.engine;
      const anc = window.__fly.origin.anchor;
      const cands = [];
      for (const g of root.children) {
        if (g.isInstancedMesh || !g.visible) continue;
        const e = g.matrixWorld.elements;
        const s = Math.hypot(e[0], e[1], e[2]);
        cands.push({ x: e[12] + anc.x, y: e[13], z: e[14] + anc.z, s });
      }
      cands.sort((a, b) => b.s - a.s);
      const c = cands[0];
      if (!c) return null;
      const geo = eng.worldToGeo({ x: c.x, y: 0, z: c.z });
      return { lat: geo.y, lon: geo.x, altM: c.y, s: c.s, n: cands.length };
    });
    console.log('[c-probe] hunt target', JSON.stringify(target));
    if (target) {
      await page.evaluate(
        ([la, lo, al]) => window.__fly.warpToGeo(la, lo, { altM: al, name: 'puff' }),
        [target.lat, target.lon, target.altM]
      );
      await page.waitForTimeout(9000);
    }
  }

  await page.evaluate(() => {
    window.__cFrames.length = 0;
    window.__cPale.length = 0;
    window.__cOn = true;
  });
  await page.waitForTimeout(SECONDS * 1000);
  await page.evaluate(() => {
    window.__cOn = false;
  });

  const frames = await page.evaluate(() => window.__cFrames);
  const pale = await page.evaluate(() => window.__cPale);
  const sample = await page.evaluate(() => window.__cSample);
  const rebs = frames.filter((f) => f.reb).length;
  const Ls = frames.map((f) => f.L).sort((a, b) => a - b);
  console.log(
    `[c-probe] composed ${frames.length} · median luma ${Ls[(Ls.length / 2) | 0]} · rebases ${rebs} · PALE ${pale.length}`
  );
  for (const p of pale) {
    console.log(
      `  PALE n=${p.n} L=${p.L} pr=${p.pr} rebaseFrame=${p.reb} count=${p.count} inside=${p.nInside} cover>0.7=${p.nCover}`
    );
    console.log(`     cam ${JSON.stringify(p.cam)} anchor ${JSON.stringify(p.anchor)} plane ${JSON.stringify(p.plane)}`);
    for (const q of (p.inst || []).slice(0, 4))
      console.log(`     inst d=${q.d} half=${q.half} cover=${q.cover} op=${q.op} p=${JSON.stringify(q.p)}`);
    for (const g of (p.groups || []).slice(0, 3))
      console.log(`     group d=${g.d} scale=${g.s} vis=${g.v}`);
  }
  if (sample[0]) {
    console.log('[c-probe] baseline sample (frame 0):');
    for (const q of sample[0].inst.slice(0, 3))
      console.log(`     inst d=${q.d} half=${q.half} cover=${q.cover} op=${q.op}`);
    console.log(`     nearest group d=${sample[0].groups[0]?.d} count=${sample[0].count}`);
  }
  fs.writeFileSync(
    path.join(OUT, 'census.json'),
    JSON.stringify({ env, frames: frames.slice(0, 40000), pale, sample }, null, 1)
  );
  console.log('[c-probe] pageerrors', errs.length, errs.slice(0, 3).join(' | '));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * ROUND 23 (B "CITY-LIGHT") — THE SHADER BENCH.
 *
 * WHY THIS EXISTS. In this session the egress policy denies CONNECT to
 * `server.arcgisonline.com` and `tiles.openfreemap.org` (403 at the proxy —
 * scripts/r23-b-egress-blocked-man-night.png is what the fleet's own Manhattan
 * night pose renders here: no imagery, no DEM, no vector tiles, road chunks
 * ready 0, building chunks ready 0). Every scene-level night A/B the plan asks
 * for is therefore unmeasurable HERE, and numbers invented off an empty world
 * would be worse than an honest gap.
 *
 * What CAN be measured without the network is what this round actually changed:
 * the two SHADERS. The app runs, the satellite layers mount, and their
 * materials are the REAL ones — patched by the real `applyBendRoadSat` /
 * `applyBendAnchorSat` under the real arm, carrying the real uniforms and the
 * real night atlas. So the bench builds SYNTHETIC geometry with exactly the
 * attribute layout the worker/engine produce, hangs it on those materials in
 * the live scene, and photographs it.
 *
 *   ROAD BENCH   two straight ribbons — cls 1 (motorway: the traffic term's
 *                class) and cls 6 (residential minor: the suburban envelope's
 *                class) — with arc in true metres and `aRoadSide` written by
 *                the same index-parity rule SatRoadEngine uses.
 *   WINDOW BENCH a row of N wall quads, each with its own `aBendAnchor` and uv
 *                in facade-metre/period units, plus one ROOF quad carrying the
 *                constant neutralUV (the R15 invariant, under test).
 *
 * THE MASK. Every statistic is taken over the pixels the actor actually
 * OCCUPIES, found by toggling it and differencing — never over a fixed crop.
 * A fixed crop dilutes the signal with whatever else is in frame and makes the
 * number a function of framing luck (the R17 §7.1 trap in its positive form).
 *
 * DETERMINISM. Both dash trains are frozen (speed 0) in EVERY leg, control and
 * test alike: the phase then depends only on arc, so two shots of the same leg
 * are identical and an A/B measures the knob rather than the clock.
 *
 * This is a shader instrument, not a scene instrument. It cannot tell you what
 * Manhattan looks like; it tells you exactly what the terms do — the half of
 * the claim that does not depend on a tile server.
 *
 * Usage: FLY_URL=http://localhost:3022 node scripts/r23-b-shaderbench.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const N_BUILDINGS = 12;
const FREEZE = { roads: { stream: { dashSpeed: 0 }, traffic: { speed: 0 } } };

/* ---------------------------------------------------------------- page side */

const PAGE_HELPERS = () => {
  window.__r23 = window.__r23 || {};
  window.__r23.baseClass = (obj, name) => {
    let c = obj?.constructor;
    while (c && c.name !== name) {
      const proto = Object.getPrototypeOf(c.prototype);
      c = proto ? proto.constructor : null;
    }
    return c;
  };
  window.__r23.classes = () => {
    let scene = window.__satRoads?.object ?? window.__flyPlayer ?? null;
    while (scene && scene.parent) scene = scene.parent;
    let Mesh = null;
    let Geo = null;
    let Attr = null;
    scene?.traverse((o) => {
      if (Mesh || !o.isMesh || o.isInstancedMesh) return;
      const pos = o.geometry?.attributes?.position;
      if (!pos || !pos.isBufferAttribute) return;
      Mesh = window.__r23.baseClass(o, 'Mesh');
      Geo = window.__r23.baseClass(o.geometry, 'BufferGeometry');
      Attr = window.__r23.baseClass(pos, 'BufferAttribute');
    });
    return { ok: !!(Mesh && Geo && Attr), Mesh, Geo, Attr };
  };
  window.__r23.show = (name, v) => {
    const m = window.__r23[name];
    if (m) m.visible = v;
  };
  /* SOLO. The first bench run masked its actor by toggling it and differencing
   * two shots 700 ms apart — and the mask came back at 11% of the frame with a
   * NON-MONOTONIC response to the knob, because a night scene animates
   * (breathing bloom, stars, POI letters, the monument in frame). That is the
   * R16 lesson exactly: an animated scene pollutes its own A/B. So the bench
   * hides every other LEAF in the scene (never a group — three inherits
   * visibility, and the bench meshes hang under the engines' groups) and
   * photographs the actor against the clear colour. Noise then measures ~0 and
   * every masked pixel is the actor's own. */
  window.__r23.solo = (keep) => {
    const mesh = window.__r23[keep];
    let scene = mesh ?? window.__flyPlayer ?? null;
    while (scene && scene.parent) scene = scene.parent;
    const hidden = [];
    scene?.traverse((o) => {
      if (o === mesh) return;
      if ((o.isMesh || o.isPoints || o.isSprite || o.isLine) && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });
    if (mesh) mesh.visible = true;
    window.__r23.hidden = hidden;
    return hidden.length;
  };
  window.__r23.unsolo = () => {
    for (const o of window.__r23.hidden || []) o.visible = true;
    window.__r23.hidden = [];
  };
};

/**
 * THE STAGE. The first two bench runs placed their actors at `flight.pos.z +
 * dz` and measured noise: at heading 0 the camera looks the OTHER way, so the
 * ribbon sat behind the lens and the "mask" was the scene breathing. Actors are
 * now placed off the CAMERA's own basis — forward/right/up read from the live
 * camera — and converted into the target group's local frame with
 * `worldToLocal`, so the floating-origin rebase cannot put them anywhere but in
 * front of the lens.
 */
const STAGE = ([groupName, dist]) => {
  let scene = window.__satRoads?.object ?? window.__flyPlayer ?? null;
  while (scene && scene.parent) scene = scene.parent;
  /* r3f keeps the camera in its own state, not necessarily in the scene graph —
   * a traverse for `isCamera` came back empty and silently built every actor
   * behind the lens. The scene's own runtime bus publishes it (FlyScene:
   * `runtime.camera = camera`), so read it there and only fall back to a walk. */
  let cam = window.__fly?.camera ?? null;
  if (!cam) scene?.traverse((o) => { if (!cam && o.isCamera) cam = o; });
  if (!cam) return { err: 'no camera' };
  const V3 = cam.position.constructor;
  const fwd = new V3();
  cam.getWorldDirection(fwd);
  const right = new V3().crossVectors(fwd, new V3(0, 1, 0)).normalize();
  const up = new V3().crossVectors(right, fwd).normalize();
  const centre = new V3().copy(cam.getWorldPosition(new V3())).addScaledVector(fwd, dist);
  const group =
    groupName === 'roads' ? window.__satRoads?.object : window.__satBuildings?.object;
  if (!group) return { err: 'no group' };
  group.updateWorldMatrix(true, false);
  const local = group.worldToLocal(centre.clone());
  window.__r23.stage = { V3, right, up, fwd, local, dist };
  return {
    ok: true,
    dist,
    centre: [centre.x, centre.y, centre.z].map((v) => +v.toFixed(1)),
    local: [local.x, local.y, local.z].map((v) => +v.toFixed(1)),
    right: [right.x, right.y, right.z].map((v) => +v.toFixed(3)),
  };
};

/**
 * ROAD BENCH — one ribbon on the stage basis: arc runs along `right` (so it
 * spans the frame), the ribbon WIDTH runs along `up` (so the two lanes are the
 * top and bottom halves and a lane split is visible as such). Vertex order is
 * the worker's `pushSatRoadQuads` order verbatim — (a+n, a-n, b+n, b-n) — and
 * `aRoadSide` is written by SatRoadEngine's own index-parity rule, because that
 * pairing IS the mechanism under test.
 */
const BUILD_ROAD = ([slot, cls, halfW, lenM, nSeg, rgb]) => {
  const { ok, Mesh, Geo, Attr } = window.__r23.classes();
  if (!ok) return { err: 'no base classes' };
  const eng = window.__satRoads;
  const st = window.__r23.stage;
  if (!eng || !st) return { err: 'no engine/stage' };
  const segM = lenM / nSeg;
  const P = (u, w) => [
    st.local.x + st.right.x * u + st.up.x * w,
    st.local.y + st.right.y * u + st.up.y * w,
    st.local.z + st.right.z * u + st.up.z * w,
  ];
  const pos = [];
  const col = [];
  const arc = [];
  const clsA = [];
  const side = [];
  const idx = [];
  let v = 0;
  for (let i = 0; i < nSeg; i++) {
    const a = -lenM / 2 + i * segM;
    const b = a + segM;
    pos.push(...P(a, halfW), ...P(a, -halfW), ...P(b, halfW), ...P(b, -halfW));
    for (let c = 0; c < 4; c++) col.push(rgb[0], rgb[1], rgb[2]);
    const a0 = i * segM;
    arc.push(a0, a0, a0 + segM, a0 + segM);
    clsA.push(cls, cls, cls, cls);
    for (let c = 0; c < 4; c++) side.push(c & 1 ? -1 : 1); // the engine's rule
    idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    v += 4;
  }
  const g = new Geo();
  g.setAttribute('position', new Attr(new Float32Array(pos), 3));
  g.setAttribute('color', new Attr(new Float32Array(col), 3));
  g.setAttribute('aRoadArc', new Attr(new Float32Array(arc), 1));
  g.setAttribute('aRoadCls', new Attr(new Float32Array(clsA), 1));
  g.setAttribute('aRoadSide', new Attr(new Float32Array(side), 1));
  g.setIndex(new Attr(new Uint32Array(idx), 1));
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += 8000;
  const m = new Mesh(g, eng.material);
  m.frustumCulled = false;
  m.renderOrder = 3;
  m.visible = false;
  eng.object.add(m);
  window.__r23[slot] = m;
  return { ok: true, verts: v };
};

/**
 * WINDOW BENCH — n wall quads across the stage, each with its own aBendAnchor
 * (the per-building identity the R23 term hashes) and uv in facade-metre/period
 * units (the worker's contract), plus a ROOF quad per building carrying the
 * constant neutralUV: the R15 "roofs never grow windows" invariant, under test.
 * Physical sizes stay honest — the uv period is in metres — so the stage
 * DISTANCE, not a fudged geometry, is what makes them fill the frame.
 */
const BUILD_WALLS = ([n, wM, hM, gapM, uPeriod, vPeriod, neutralUV]) => {
  const { ok, Mesh, Geo, Attr } = window.__r23.classes();
  if (!ok) return { err: 'no base classes' };
  const eng = window.__satBuildings;
  const st = window.__r23.stage;
  if (!eng || !st) return { err: 'no engine/stage' };
  const P = (u, w) => [
    st.local.x + st.right.x * u + st.up.x * w,
    st.local.y + st.right.y * u + st.up.y * w,
    st.local.z + st.right.z * u + st.up.z * w,
  ];
  const nrm = [-st.fwd.x, -st.fwd.y, -st.fwd.z];
  const mk = () => ({ pos: [], nor: [], col: [], uv: [], anc: [], idx: [], v: 0 });
  const walls = mk();
  const roof = mk();
  const total = n * wM + (n - 1) * gapM;
  for (let i = 0; i < n; i++) {
    const u0 = -total / 2 + i * (wM + gapM);
    const u1 = u0 + wM;
    // The ANCHOR is this building's own centroid in the same local frame the
    // real chunk meshes use. No two buildings share one — which is exactly what
    // makes the fragment hash per-building rather than per-chunk.
    const cx = st.local.x + st.right.x * ((u0 + u1) / 2);
    const cz = st.local.z + st.right.z * ((u0 + u1) / 2);
    const parts = [
      [walls, -hM / 2, hM / 2, 'wall'],
      [roof, hM / 2, hM / 2 + wM * 0.35, 'neutral'],
    ];
    for (const [a, wLo, wHi, kind] of parts) {
      a.pos.push(...P(u0, wLo), ...P(u1, wLo), ...P(u1, wHi), ...P(u0, wHi));
      for (let c = 0; c < 4; c++) a.nor.push(nrm[0], nrm[1], nrm[2]);
      for (let c = 0; c < 4; c++) a.col.push(0.66, 0.64, 0.58); // a SAT_BUILDINGS wallTone
      if (kind === 'neutral') {
        for (let c = 0; c < 4; c++) a.uv.push(neutralUV, neutralUV);
      } else {
        a.uv.push(0, 0, wM / uPeriod, 0, wM / uPeriod, hM / vPeriod, 0, hM / vPeriod);
      }
      for (let c = 0; c < 4; c++) a.anc.push(cx, cz);
      a.idx.push(a.v, a.v + 1, a.v + 2, a.v, a.v + 2, a.v + 3);
      a.v += 4;
    }
  }
  const build = (a, slot) => {
    const g = new Geo();
    g.setAttribute('position', new Attr(new Float32Array(a.pos), 3));
    g.setAttribute('normal', new Attr(new Float32Array(a.nor), 3));
    g.setAttribute('color', new Attr(new Float32Array(a.col), 3));
    g.setAttribute('uv', new Attr(new Float32Array(a.uv), 2));
    g.setAttribute('aBendAnchor', new Attr(new Float32Array(a.anc), 2));
    g.setIndex(new Attr(new Uint32Array(a.idx), 1));
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += 8000;
    const m = new Mesh(g, eng.material);
    m.frustumCulled = false;
    m.visible = false;
    eng.object.add(m);
    window.__r23[slot] = m;
  };
  build(walls, 'walls');
  build(roof, 'roofs');
  return {
    ok: true,
    emissiveIntensity: eng.material.emissiveIntensity,
    hasEmissiveMap: !!eng.material.emissiveMap,
    nightEnabled: eng.nightEnabled,
    key: eng.material.customProgramCacheKey?.() ?? null,
  };
};

/* ------------------------------------------------------------------ runner */

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.addInitScript(() => {
    window.__flyNightCityArm = 1;
  });
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);
  /* THE SUN, THEN THE WARP — in that order and both of them. The day-cycle
   * effect re-reads `__flySunOverride` on a warpEpoch bump (verify-sat-night's
   * note), so a bench that only sets the global and never warps runs at NOON
   * with `emissiveIntensity` 0 and measures a dark material forever. The first
   * bench run did exactly that; the precondition below is what turned it from a
   * silent null result into a loud one (R18: a probe's preconditions must imply
   * its assertions). */
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 18, 4, 0, 0); // ≈23:00 local NYC
    window.__fly.warpToGeo(40.7075, -74.0113, { altM: 792, name: null });
  });
  await page.waitForTimeout(6000);
  /* A fixed stage: level heading, nose down, 260 m over the (flat, un-streamed)
   * ground. The bench places its actors relative to the aircraft, so the pose
   * only has to be STABLE, not scenic. */
  await page.evaluate(() => {
    const f = window.__fly.flight;
    const gy = f.groundElev ?? 0;
    f.pos.y = gy + 260;
    const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
    if (window.__pin) clearInterval(window.__pin);
    window.__pin = setInterval(() => {
      f.pos.x = p.x;
      f.pos.y = p.y;
      f.pos.z = p.z;
      f.heading = 0;
      f.pitch = -0.3;
      f.bank = 0;
      f.speed = 0;
    }, 8);
  });
  await page.waitForTimeout(14000); // HDRI night swap + the settle birth fades
  const night = await page.evaluate(() => ({
    roadMix: window.__flyStats?.satRoadMix ?? null,
    emissive: window.__satBuildings?.material?.emissiveIntensity ?? -1,
    nightEnabled: window.__satBuildings?.nightEnabled ?? null,
  }));
  console.log('night precondition:', JSON.stringify(night));
  if (!((night.roadMix?.night ?? 0) > 0.9 && night.emissive > 0)) {
    console.log('ABORT — the bench is not at night; every measurement below would be a null result');
    await browser.close();
    process.exit(2);
  }
  await page.evaluate(() => {
    if (window.__flyPlayer) window.__flyPlayer.visible = false; // R17 §7.1
    let s = window.__flyPlayer ?? window.__satRoads?.object ?? null;
    while (s && s.parent) s = s.parent;
    s?.traverse((o) => {
      if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
        o.visible = false;
    });
  });

  await page.evaluate(PAGE_HELPERS);
  /* WAIT FOR THE LENS TO STOP. The stage is built off the camera's basis, and
   * the chase camera DAMPS toward a pinned pose — staging while it is still
   * slewing puts the actors off-axis, which is why consecutive runs produced
   * masks between 2% and 24% of the frame for identical geometry. Poll the
   * camera's own world position + direction until two consecutive reads agree
   * to a millimetre. */
  await page.waitForFunction(
    () => {
      const cam = window.__fly?.camera;
      if (!cam) return false;
      const p = cam.getWorldPosition(cam.position.clone());
      const d = cam.getWorldDirection(cam.position.clone());
      const cur = [p.x, p.y, p.z, d.x * 1000, d.y * 1000, d.z * 1000];
      const w = (window.__r23Cam ??= { last: null, n: 0 });
      /* An EPSILON, not equality: the hero rig breathes and the chase camera
       * never lands on a repeating float. 5 cm of camera motion moves a 200 m
       * actor by well under a pixel, which is the tolerance that matters. The
       * bound is 2 m / 0.002 rad because the hero rig BOBS continuously (R17:
       * ±0.47 m at ~2 Hz) — the camera never stops, so the gate can only wait
       * out the post-warp SLEW, which is the part that actually mis-frames. */
      const still = w.last && cur.every((v, i) => Math.abs(v - w.last[i]) < 2.0);
      w.n = still ? w.n + 1 : 0;
      w.last = cur;
      return w.n >= 3;
    },
    undefined,
    { timeout: 60000, polling: 300 }
  );
  /* THE BIRTH PIN. SatRoadLayer drives the shared road material's `opacity` off
   * the R22 settle birth, and the birth keys on `engine.stats.ready` — which is
   * 0 forever in a session where no tile can be fetched. An ADDITIVE material at
   * opacity k contributes k× its colour, so the bench would be photographing the
   * birth fade rather than the night terms. Pinned to 1 on the same 8 ms cadence
   * the pose pin uses, because the layer rewrites it every frame. */
  await page.evaluate(() => {
    if (window.__r23Op) clearInterval(window.__r23Op);
    window.__r23Op = setInterval(() => {
      const m = window.__satRoads?.material;
      if (m && m.opacity !== 1) m.opacity = 1;
    }, 8);
  });
  console.log('base classes:', JSON.stringify(await page.evaluate(() => {
    const c = window.__r23.classes();
    return { ok: c.ok, mesh: c.Mesh?.name, geo: c.Geo?.name, attr: c.Attr?.name };
  })));
  // cls 1 artery hue '#dfe9ff', cls 6 street hue '#ffb066' (SAT_ROADS.colors)
  console.log('stage(roads):', JSON.stringify(await page.evaluate(STAGE, ['roads', 400])));
  console.log('artery:', JSON.stringify(await page.evaluate(BUILD_ROAD,
    ['artery', 1, 55, 800, 20, [0.874, 0.914, 1.0]])));
  console.log('minor :', JSON.stringify(await page.evaluate(BUILD_ROAD,
    ['minor', 6, 55, 800, 20, [1.0, 0.69, 0.4]])));
  console.log('stage(bldg):', JSON.stringify(await page.evaluate(STAGE, ['buildings', 210])));
  const walls = await page.evaluate(BUILD_WALLS, [N_BUILDINGS, 40, 95, 8, 26.4, 27.2, 0.25]);
  console.log('walls :', JSON.stringify(walls));
  /* A build that silently failed leaves `show()` a no-op and every "mask" below
   * becomes pure scene noise wearing an actor's name — which is exactly what the
   * previous run reported. Preconditions imply assertions, or the run stops. */
  if (!walls.ok) {
    console.log('ABORT — the bench actors did not build');
    await browser.close();
    process.exit(2);
  }
  await page.waitForTimeout(1200);

  /* page.screenshot(clip) rather than locator.screenshot(): the locator path
   * waits for the element to be "stable", and a live GL canvas under an
   * animating HUD is never stable — the first bench run died on a 21 s
   * stability timeout mid-sweep. */
  const box = await page.locator('.fixed.inset-0 canvas').first().boundingBox();
  const CLIP = { x: box.x, y: box.y, width: box.width, height: box.height };
  const shot = async (name) => {
    const buf = await page.screenshot({ clip: CLIP, animations: 'allow' });
    if (name) fs.writeFileSync(path.join(__dirname, name), buf);
    return buf.toString('base64');
  };
  const show = (slot, v) => page.evaluate(([s, x]) => window.__r23.show(s, x), [slot, v]);

  /**
   * THE MASK: pixels the actor occupies, from an on/off pair. Returned as a
   * base64 PNG-free flat array kept page-side under a name, so the per-leg
   * stats never re-difference (the mask is measured once, on the swept leg).
   */
  const buildMask = (onB64, offB64, name) =>
    page.evaluate(
      async ([a, b, key]) => {
        const load = (s) =>
          new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = rej;
            i.src = 'data:image/png;base64,' + s;
          });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        const w = ia.width;
        const h = ia.height;
        const grab = (img) => {
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const c = cv.getContext('2d', { willReadFrequently: true });
          c.drawImage(img, 0, 0);
          return c.getImageData(0, 0, w, h).data;
        };
        const da = grab(ia);
        const db = grab(ib);
        const m = new Uint8Array(w * h);
        let n = 0;
        let x0 = w;
        let x1 = 0;
        for (let i = 0, p = 0; i < da.length; i += 4, p++) {
          const d =
            Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
          if (d > 8) {
            m[p] = 1;
            n += 1;
            const x = p % w;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
          }
        }
        (window.__r23.masks ??= {})[key] = { m, w, h, n, x0, x1 };
        return { n, w, h, x0, x1, frac: n / (w * h) };
      },
      [onB64, offB64, name]
    );

  /** Per-leg statistics over a stored mask, plus a per-column split. */
  const maskStats = (b64, name, nCols) =>
    page.evaluate(
      async ([s, key, cols]) => {
        const mk = window.__r23.masks[key];
        const img = await new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = 'data:image/png;base64,' + s;
        });
        const cv = document.createElement('canvas');
        cv.width = mk.w;
        cv.height = mk.h;
        const c = cv.getContext('2d', { willReadFrequently: true });
        c.drawImage(img, 0, 0);
        const d = c.getImageData(0, 0, mk.w, mk.h).data;
        const span = Math.max(1, mk.x1 - mk.x0 + 1);
        const colSum = new Float64Array(cols);
        const colN = new Float64Array(cols);
        let sum = 0;
        let n = 0;
        let warm = 0;
        let red = 0;
        let clip = 0;
        let sumR = 0;
        let sumG = 0;
        let sumB = 0;
        for (let p = 0; p < mk.m.length; p++) {
          if (!mk.m[p]) continue;
          const i = p * 4;
          const r = d[i];
          const g = d[i + 1];
          const b = d[i + 2];
          const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sum += L;
          sumR += r;
          sumG += g;
          sumB += b;
          n += 1;
          if (L > 250) clip += 1;
          if (r - b > 20) warm += 1;
          if (r - g > 40 && r - b > 40) red += 1;
          const ci = Math.min(cols - 1, Math.floor((((p % mk.w) - mk.x0) / span) * cols));
          if (ci >= 0) {
            colSum[ci] += L;
            colN[ci] += 1;
          }
        }
        return {
          maskPx: n,
          mean: sum / Math.max(1, n),
          rgb: [sumR / Math.max(1, n), sumG / Math.max(1, n), sumB / Math.max(1, n)],
          clipFrac: clip / Math.max(1, n),
          warmFrac: warm / Math.max(1, n),
          redFrac: red / Math.max(1, n),
          col: Array.from(colSum).map((v, i) => v / Math.max(1, colN[i])),
        };
      },
      [b64, name, nCols]
    );

  const spread = (a) => {
    const m = a.reduce((s, v) => s + v, 0) / a.length;
    const sd = Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
    return {
      mean: +m.toFixed(2),
      sd: +sd.toFixed(2),
      cv: +(sd / Math.max(1e-6, m)).toFixed(4),
      min: +Math.min(...a).toFixed(2),
      max: +Math.max(...a).toFixed(2),
    };
  };

  const out = {
    note: 'synthetic bench — arcgisonline + openfreemap CONNECT 403 in this session',
    wallBench: walls,
    road: {},
    windows: {},
  };

  /* ============================ ROAD ==================================== */
  for (const slot of ['artery', 'minor']) {
    const nHidden = await page.evaluate((k) => window.__r23.solo(k), slot);
    await page.evaluate((p) => window.__flyNightCity.swept(p), FREEZE);
    await page.waitForTimeout(900);
    const on = await shot(`r23-b-bench-${slot}-swept.png`);
    await show(slot, false);
    await page.waitForTimeout(700);
    const off = await shot(null);
    await show(slot, true);
    await page.waitForTimeout(700);
    const mask = await buildMask(on, off, slot);
    console.log(`${slot}: soloed (${nHidden} leaves hidden) · mask ${mask.n} px (${(mask.frac * 100).toFixed(2)}%)`);
    const legs = {};
    for (const [name, patch] of [
      ['swept', null],
      ['swept-repeat', null],
      ['r23-notraffic', { roads: { traffic: { boost: 0 } } }],
      ['r23', {}],
      /* A DELIBERATELY ABSURD leg. If a ×25 network glow and a ×15 traffic term
       * still do not move the masked mean, the bench is not photographing the
       * ribbon at all and every road number above is noise wearing an actor's
       * name — which is a fact about the instrument, and has to be reported as
       * one rather than smoothed into a result. */
      ['diag-x25', { roads: { intensity: 60, traffic: { boost: 20 } } }],
    ]) {
      if (patch === null) await page.evaluate((p) => window.__flyNightCity.swept(p), FREEZE);
      else
        await page.evaluate(
          (p) => window.__flyNightCity.r23(p),
          { roads: { ...FREEZE.roads, ...(patch.roads || {}), traffic: { ...FREEZE.roads.traffic, ...(patch.roads?.traffic || {}) } } }
        );
      await page.waitForTimeout(700);
      const b64 = await shot(`r23-b-bench-${slot}-${name}.png`);
      const m = await maskStats(b64, slot, 8);
      m.live = await page.evaluate(() => ({
        opacity: window.__satRoads?.material?.opacity,
        mix: window.__flyStats?.satRoadMix?.night,
        glow: window.__flyStats?.nightCityRoads?.glow,
        street6: window.__flyStats?.nightCityRoads?.street6,
        boost: window.__flyStats?.nightCityRoads?.traffic?.boost,
      }));
      legs[name] = m;
      console.log(
        `${(slot + '/' + name).padEnd(24)} mean ${m.mean.toFixed(2)}  rgb ${m.rgb.map((v) => v.toFixed(0)).join('/')}  clip ${(m.clipFrac * 100).toFixed(1)}%  warm ${(m.warmFrac * 100).toFixed(1)}%  red ${(m.redFrac * 100).toFixed(2)}%  [op ${m.live.opacity} night ${m.live.mix} glow ${m.live.glow} c6 ${m.live.street6} traf ${m.live.boost}]`
      );
    }
    out.road[slot] = { mask, legs };
    await show(slot, false);
    await page.evaluate(() => window.__r23.unsolo());
  }

  /* =========================== WINDOWS ================================== */
  for (const slot of ['walls', 'roofs']) {
    const nHidden = await page.evaluate((k) => window.__r23.solo(k), slot);
    await page.evaluate((p) => window.__flyNightCity.swept(p), FREEZE);
    await page.waitForTimeout(900);
    const on = await shot(`r23-b-bench-${slot}-swept.png`);
    await show(slot, false);
    await page.waitForTimeout(700);
    const off = await shot(null);
    await show(slot, true);
    await page.waitForTimeout(700);
    const mask = await buildMask(on, off, slot);
    console.log(`${slot}: soloed (${nHidden} leaves hidden) · mask ${mask.n} px (${(mask.frac * 100).toFixed(2)}%)`);
    const legs = {};
    for (const [name, patch] of [
      ['swept', null],
      ['swept-repeat', null],
      ['phase-only', { windows: { phase: 1 } }],
      ['gain-only', { windows: { gain: { min: 0.45, max: 1.55 } } }],
      ['dark-only', { windows: { darkFrac: 0.22, darkGain: 0.08 } }],
      ['tint-only', { windows: { tintJitter: 0.18 } }],
      ['r23', 'r23'],
    ]) {
      if (patch === null) await page.evaluate((p) => window.__flyNightCity.swept(p), FREEZE);
      else if (patch === 'r23') await page.evaluate((p) => window.__flyNightCity.r23(p), FREEZE);
      else
        await page.evaluate(
          (p) => window.__flyNightCity.swept(p),
          { ...FREEZE, windows: patch.windows }
        );
      await page.waitForTimeout(700);
      const b64 = await shot(`r23-b-bench-${slot}-${name}.png`);
      const m = await maskStats(b64, slot, N_BUILDINGS);
      legs[name] = { ...m, perBuilding: spread(m.col) };
      console.log(
        `${(slot + '/' + name).padEnd(24)} mean ${m.mean.toFixed(2)}  per-building sd ${legs[name].perBuilding.sd} (cv ${legs[name].perBuilding.cv})  min ${legs[name].perBuilding.min}  max ${legs[name].perBuilding.max}`
      );
    }
    out.windows[slot] = { mask, legs };
    await show(slot, false);
    await page.evaluate(() => window.__r23.unsolo());
  }

  out.uniforms = await page.evaluate(() => window.__flyNightCity?.read?.() ?? null);
  out.nightGate = await page.evaluate(() => window.__flyStats?.satNightGate ?? null);
  out.errs = errs;
  fs.writeFileSync(path.join(__dirname, 'r23-b-shaderbench.json'), JSON.stringify(out, null, 2));
  console.log(`\nwrote r23-b-shaderbench.json · pageerrors ${errs.length}`);
  if (errs.length) console.log([...new Set(errs)].slice(0, 5).join('\n'));
  await browser.close();
})();

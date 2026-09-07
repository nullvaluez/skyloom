#!/usr/bin/env node
/**
 * R24 (E CERT) — DIAGNOSTIC, not a gate. Three readings the certification row
 * could not give, taken live at the Owens ON pose.
 *
 *   (1) the governor TIER, and whether it or the imagery source moved;
 *   (2) a DRAW DECOMPOSITION — terrain drawn per three's live frustum cull vs
 *       A's `_inFrustum` stamp, and the non-terrain remainder BY CLASS;
 *   (3) whether the stranded in-flight tiles are the SAME SET across walks,
 *       which is what separates "still streaming" from A's version-dirty tile
 *       that can never clear its own flag.
 *
 * `_needVersionUpdate` is read from the vendored getter's own definition
 * (index.js:200): `_loadedEpoch < _root._epoch && _loadState !== 'empty'`.
 * Reading the state by the owner's rule rather than by a guessed field name is
 * the whole R24 §6 lesson.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const OWENS = [36.6, -118.09, 3000, 2.6, -0.3];
const pinScene = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading; f.pitch = pitch; f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x; f.pos.y = p.y; f.pos.z = p.z;
    f.heading = heading; f.pitch = pitch; f.bank = 0; f.speed = 0;
  }, 8);
};

const CENSUS = () => {
  const eng = window.__flyTerra?.engine?.();
  const map = eng?.map ?? window.__flyTerra?.get?.();

  // THE CAMERA THE RENDERER ACTUALLY USES, via the composer's render pass, with
  // a scene-graph fallback. No THREE namespace is published, so the frustum is
  // extracted from the combined matrix by hand (Gribb-Hartmann) rather than by
  // importing a class that is not there — six planes from projection ×
  // viewMatrix, normalised, then a sphere test.
  const cam =
    window.__flyComposer?.passes?.map((p) => p.camera).find((c) => c && c.isCamera) ??
    (() => {
      let r = window.__fly?.engine?.object ?? null;
      while (r?.parent) r = r.parent;
      let found = null;
      r?.traverse((o) => { if (!found && o.isCamera) found = o; });
      return found;
    })();

  let planes = null;
  if (cam) {
    cam.updateMatrixWorld();
    const p = cam.projectionMatrix.elements;
    const v = cam.matrixWorldInverse.elements;
    // m = projection * view, column-major (three's convention).
    const m = new Array(16).fill(0);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += p[k * 4 + r] * v[c * 4 + k];
        m[c * 4 + r] = sum;
      }
    const el = (r, c) => m[c * 4 + r];
    const mk = (a, b, c, d) => {
      const len = Math.hypot(a, b, c) || 1;
      return [a / len, b / len, c / len, d / len];
    };
    planes = [
      mk(el(3,0)+el(0,0), el(3,1)+el(0,1), el(3,2)+el(0,2), el(3,3)+el(0,3)),
      mk(el(3,0)-el(0,0), el(3,1)-el(0,1), el(3,2)-el(0,2), el(3,3)-el(0,3)),
      mk(el(3,0)+el(1,0), el(3,1)+el(1,1), el(3,2)+el(1,2), el(3,3)+el(1,3)),
      mk(el(3,0)-el(1,0), el(3,1)-el(1,1), el(3,2)-el(1,2), el(3,3)-el(1,3)),
      mk(el(3,0)+el(2,0), el(3,1)+el(2,1), el(3,2)+el(2,2), el(3,3)+el(2,3)),
      mk(el(3,0)-el(2,0), el(3,1)-el(2,1), el(3,2)-el(2,2), el(3,3)-el(2,3)),
    ];
  }

  const drawable = (o) => {
    if (!o.visible) return false;
    for (let a = o.parent; a; a = a.parent) if (!a.visible) return false;
    return true;
  };
  const inView = (o) => {
    if (!planes || !o.geometry) return null;
    if (!o.geometry.boundingSphere) { try { o.geometry.computeBoundingSphere(); } catch (e) { return null; } }
    const bs = o.geometry.boundingSphere;
    if (!bs) return null;
    const e = o.matrixWorld.elements;
    const cx = bs.center.x, cy = bs.center.y, cz = bs.center.z;
    const wx = e[0]*cx + e[4]*cy + e[8]*cz + e[12];
    const wy = e[1]*cx + e[5]*cy + e[9]*cz + e[13];
    const wz = e[2]*cx + e[6]*cy + e[10]*cz + e[14];
    const sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    const r = bs.radius * Math.max(sx, sy, sz);
    for (const [a, b, c, d] of planes) if (a*wx + b*wy + c*wz + d < -r) return false;
    return true;
  };

  let tileStamp = 0, tileDrawable = 0, tileMeshesInView = 0, resident = 0, withModel = 0, parked = 0;
  const stranded = [];
  const stack = map ? [map] : [];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    if (n.isTile) {
      resident++;
      if (n.model) { withModel++; if (n.model.visible === false) parked++; }
      if (n._inFrustum) tileStamp++;
      if (n.model && drawable(n.model)) {
        tileDrawable++;
        n.model.traverse((m) => { if (m.isMesh && inView(m) === true) tileMeshesInView++; });
      }
      // The vendored getter's OWN rule (index.js:200), not a guessed field.
      if (n._loadedEpoch < (n._root?._epoch ?? 0) && n._loadState !== 'empty')
        stranded.push(`dirty ${n.z}/${n.x}/${n.y} ${n._loadState} ep${n._loadedEpoch}<${n._root?._epoch}`);
      else if (n._loadState === 'loading') stranded.push(`loading ${n.z}/${n.x}/${n.y}`);
    }
    const k = n.children;
    if (k) for (let i = 0; i < k.length; i++) stack.push(k[i]);
  }

  const owners = {
    satBuilding: window.__satBuildings?.object ?? null,
    skyline: window.__satSkyline?.object ?? null,
    roads: window.__satRoads?.object ?? null,
    glow: window.__satCityGlow?.object ?? null,
    monuments: window.__flyMonuments?.object ?? window.__flyMonuments ?? null,
    clouds: window.__flyClouds?.object ?? window.__flyClouds ?? null,
    cirrus: window.__flyCirrus ?? null,
    player: window.__flyPlayer ?? null,
  };
  const byClass = {};
  for (const [name, root] of Object.entries(owners)) {
    if (!root || typeof root.traverse !== 'function') { byClass[name] = null; continue; }
    let n = 0;
    root.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && drawable(o) && inView(o) !== false) n++; });
    byClass[name] = n;
  }

  const dl = typeof eng?.downloading === 'number' ? eng.downloading : (map?.downloading ?? null);
  const gov = window.__flyGov ?? null;
  return {
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    gov: gov ? { steps: gov.steps ?? gov.stepCount ?? null, latched: gov.latched ?? null, state: gov.state ?? null } : null,
    epoch: map?._epoch ?? null,
    dl,
    draws: window.__flyStats?.drawCalls ?? null,
    tris: window.__flyStats?.triangles ?? null,
    terrain: { resident, withModel, parked, stamp: tileStamp, drawableTiles: tileDrawable, meshesInView: tileMeshesInView },
    byClass,
    stranded: stranded.sort(),
    frustumOk: !!planes,
  };
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript(() => {
    window.__flyTerraPaceOverride = {
      enabled: true, timerFix: true, mergeHysteresis: true, keepResident: true, skirtFast: true,
    };
  });
  await bootFly(page, { style: 'satellite', url: process.env.FLY_URL, timeoutMs: 600000, settleMs: 8000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  const tierAtBoot = await page.evaluate(() => window.__flyStore?.getState?.().qualityTier ?? null);
  console.log(`tier after boot + explicit set: ${tierAtBoot}`);

  await page.evaluate(pinScene, OWENS);
  await page.waitForTimeout(Number(process.env.OWENS_DWELL_MS || 420000));

  const a = await page.evaluate(CENSUS);
  console.log('\nCENSUS 1:', JSON.stringify({ ...a, stranded: a.stranded.length }, null, 1));
  console.log('  stranded set (1):', JSON.stringify(a.stranded));
  await page.waitForTimeout(60000);
  const b = await page.evaluate(CENSUS);
  console.log('\nCENSUS 2 (60s later):', JSON.stringify({ ...b, stranded: b.stranded.length }, null, 1));
  console.log('  stranded set (2):', JSON.stringify(b.stranded));

  const sa = new Set(a.stranded), sb = new Set(b.stranded);
  const same = [...sa].filter((x) => sb.has(x));
  console.log(
    `\nSTRANDED SET STABILITY: ${same.length} of ${sa.size} -> ${sb.size} entries are THE SAME across ` +
      `60 s of walks. A constant set is A's version-dirty tile (it can never clear its own flag); a ` +
      'rotating set is ordinary streaming churn.'
  );
  console.log(`TIER: boot ${tierAtBoot} · census1 ${a.tier} · census2 ${b.tier} — a change here is a ` +
    'governor step, which rebuilds the imagery source (maxLevel: satMaxZoomFor(tier)) and is A\'s trigger.');
  console.log(`EPOCH: census1 ${a.epoch} · census2 ${b.epoch} — an epoch bump after tiles loaded is the ` +
    'stale-epoch condition itself.');
  await browser.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });

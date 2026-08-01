/**
 * R19 — WHO still moves in verify-sat-night's (E) block after the cloud deck
 * is parked? The residual-actor census behind the (E) determinism work.
 *
 * Reproduces the (E) 3100 m pose + the harness's cloud park + its
 * setForegroundVisible(false), then diffs every object's matrixWorld across a
 * ~0.75 s window and reports the movers, plus the instanced pools whose
 * instanceMatrix.version is still bumping (attribute churn never shows as a
 * matrix change).
 *
 * v2 — TWO CORRECTIONS to the first cut (both changed the diagnosis):
 *
 *   1. EFFECTIVE visibility. `Object3D.traverse` does not stop at an invisible
 *      parent, and the v1 census tested `o.visible` on the object ITSELF. The
 *      renderer stops at the first invisible ancestor (projectObject), so
 *      everything under a parked group was being reported as a live mover.
 *      v1's headline — "a live traffic GLB is STILL visible and moving
 *      (Group#Jet_Cube024 + its four meshes)" — was exactly that mistake:
 *      `Jet_Cube.024` is the node name inside **public/models/player-jet.glb**
 *      (three sanitizes the dot), i.e. it is the PLAYER's own model, sitting
 *      under `window.__flyPlayer`, which setForegroundVisible had already set
 *      visible=false. Same for the moving Points (PlayerLights' nav-light
 *      cloud, also under the player group). NEITHER reaches a pixel.
 *   2. OWNER ATTRIBUTION. Every mover is now walked up to a known dev handle
 *      (__flyClouds / __flyCirrus / __flyPlayer / __satRoads / __satBuildings /
 *      __satSkyline / __satVeg.mesh / .ambient.boatMesh / .ambient.plumeMesh /
 *      .houseMesh / __satCityGlow / __satBeacons / __flyTraffic), so a residual
 *      is named by the SYSTEM that owns it instead of by an anonymous
 *      `Scene > Group > Mesh` chain. Unowned objects print geometry/material
 *      detail so they can be identified in source.
 *
 * MEASURED on the R19 close tree — satellite, tier high, noon, Manhattan
 * 3100 m, harness park + foreground hide applied: see the run log in the
 * commit that lands the (E) park. The pools that survive the harness's
 * scene-root InstancedMesh sweep are the ones NESTED under groups
 * (SatVegLayer's canopy, SatAmbientLife's boats + plumes) plus TrafficLayer's
 * billboard pool, which carries neither _isModel nor _painted and therefore
 * walks straight through setForegroundVisible.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const NOON_MS = Date.UTC(2026, 6, 17, 17, 0, 0);

// page-side: the known dev-handle roots, newest first.
const HANDLE_SRC = `(() => {
  const r = [];
  const add = (o, label) => { if (o) r.push([o, label]); };
  add(window.__flyClouds, '__flyClouds');
  add(window.__flyCirrus, '__flyCirrus');
  add(window.__flyPlayer, '__flyPlayer');
  add(window.__flyTraffic, '__flyTraffic');
  add(window.__satRoads?.object, '__satRoads');
  add(window.__satBuildings?.object, '__satBuildings');
  add(window.__satSkyline?.object, '__satSkyline');
  add(window.__satVeg?.mesh, '__satVeg.mesh(canopy)');
  add(window.__satVeg?.ambient?.boatMesh, '__satVeg.ambient.boatMesh');
  add(window.__satVeg?.ambient?.plumeMesh, '__satVeg.ambient.plumeMesh');
  add(window.__satVeg?.houseMesh, '__satVeg.houseMesh');
  add(window.__satVeg?.tintMesh, '__satVeg.tintMesh');
  add(window.__satCityGlow?.dome, '__satCityGlow.dome');
  add(window.__satCityGlow?.core, '__satCityGlow.core');
  add(window.__satBeacons, '__satBeacons');
  return r;
})()`;

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate((t) => {
    window.__flySunOverride = t;
  }, NOON_MS);
  await page.evaluate(() => {
    window.__fly.warpToGeo(40.7075, -74.0113, { altM: 3100, name: null });
  });
  await page.waitForTimeout(26000);
  await page.evaluate(() => {
    window.__flyPinE = setInterval(() => {
      window.__fly.flight.pos.y = window.__fly.flight.groundElev + 3100;
    }, 200);
  });
  await page.waitForTimeout(6000);

  // the harness's park + foreground hide, verbatim in effect
  const parked = await page.evaluate(() => {
    let n = 0;
    const c = window.__flyClouds;
    if (c) {
      c.visible = false;
      if (window.__flyCirrus) window.__flyCirrus.visible = false;
      c.parent?.children?.forEach((o) => {
        if (o === c || !o.isInstancedMesh) return;
        o.visible = false;
        if (o.material) o.material.visible = false;
        n += 1;
      });
    }
    if (window.__flyPlayer) window.__flyPlayer.visible = false;
    let scene = window.__flyPlayer ?? null;
    while (scene && scene.parent) scene = scene.parent;
    scene?.traverse((o) => {
      if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
        o.visible = false;
    });
    return { clouds: !!c, siblings: n };
  });
  console.log(`PARK: __flyClouds=${parked.clouds} instanced siblings stilled=${parked.siblings}`);
  await page.waitForTimeout(3000);

  const report = await page.evaluate(async (handleSrc) => {
    let scene = window.__satRoads?.object ?? window.__flyPlayer ?? null;
    while (scene && scene.parent) scene = scene.parent;
    if (!scene) return { error: 'no scene' };
    // eslint-disable-next-line no-eval
    const roots = eval(handleSrc);
    const owner = (o) => {
      for (let p = o; p; p = p.parent)
        for (const [ro, lab] of roots) if (p === ro) return lab;
      return null;
    };
    // The renderer's own rule (projectObject): the first invisible ancestor
    // prunes the whole subtree; material.visible prunes the push.
    const drawn = (o) => {
      for (let p = o; p; p = p.parent) if (!p.visible) return false;
      return o.material ? o.material.visible !== false : true;
    };
    const chain = (o) => {
      const parts = [];
      for (let p = o; p; p = p.parent) parts.unshift(`${p.type}${p.name ? '#' + p.name : ''}`);
      return parts.join(' > ');
    };
    const describe = (o) =>
      `${o.type}${o.name ? '#' + o.name : ''}` +
      (o.isInstancedMesh ? ` count=${o.count}` : '') +
      (o.material ? ` mat=${o.material.type}` : '') +
      (o.geometry ? ` geo=${o.geometry.type}` : '') +
      (o.material?.map ? ' map' : '') +
      (o._painted !== undefined ? ' _painted' : '') +
      (o._isModel !== undefined ? ' _isModel' : '') +
      (o.userData && Object.keys(o.userData).length
        ? ` ud=[${Object.keys(o.userData).join(',')}]`
        : '') +
      (o.parent ? ` parentKids=${o.parent.children.length}` : '');
    const snap = () => {
      const m = new Map();
      scene.traverse((o) => {
        if (!drawn(o)) return;
        m.set(o, o.matrixWorld.elements.join(','));
      });
      return m;
    };
    const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
    const a = snap();
    for (let i = 0; i < 45; i++) await frame(); // ~0.75 s
    const b = snap();
    const buckets = new Map();
    for (const [o, v] of a) {
      if (!b.has(o) || b.get(o) === v) continue;
      const key = `${owner(o) ?? 'UNOWNED ' + chain(o)} [${describe(o)}]`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    // Instanced attribute churn does not show as a matrix change — sample the
    // instanceMatrix versions of every DRAWN instanced pool twice.
    const read = () => {
      const m = new Map();
      scene.traverse((o) => {
        if (o.isInstancedMesh && drawn(o) && o.instanceMatrix)
          m.set(o, [o.instanceMatrix.version, o.count, owner(o), chain(o)]);
      });
      return m;
    };
    const r1 = read();
    await new Promise((r) => setTimeout(r, 1500));
    const r2 = read();
    const pools = [];
    for (const [o, v] of r1) {
      const w = r2.get(o);
      if (!w) continue;
      pools.push({
        owner: v[2],
        chain: v[3],
        count: v[1],
        bumping: w[0] !== v[0],
        version: `${v[0]}->${w[0]}`,
        detail: describe(o),
      });
    }
    // GEOMETRY churn — a ribbon (tracer / contrail) rewrites its position
    // attribute every frame and NEVER moves its matrixWorld, so neither of the
    // two passes above can see it. Sample every drawn object's attribute
    // versions twice.
    const geoRead = () => {
      const m = new Map();
      scene.traverse((o) => {
        if (!o.geometry || !drawn(o)) return;
        const a = o.geometry.attributes;
        const v = Object.keys(a)
          .map((k) => `${k}:${a[k].version}`)
          .join(' ');
        m.set(o, v);
      });
      return m;
    };
    const g1 = geoRead();
    await new Promise((r) => setTimeout(r, 1200));
    const g2 = geoRead();
    const geoChurn = [];
    for (const [o, v] of g1)
      if (g2.has(o) && g2.get(o) !== v)
        geoChurn.push(`${owner(o) ?? 'UNOWNED ' + chain(o)} | ${describe(o)}`);

    // Full instanced-pool ledger — drawn AND parked, with the REASON a parked
    // pool is parked (which flag, which ancestor). This is what proves a park
    // actually covers the scene instead of covering a snapshot of it.
    const ledger = [];
    scene.traverse((o) => {
      if (!o.isInstancedMesh) return;
      let why = null;
      for (let p = o; p; p = p.parent)
        if (!p.visible) {
          why = p === o ? 'self.visible=false' : `ancestor ${p.type} visible=false`;
          break;
        }
      if (!why && o.material?.visible === false) why = 'material.visible=false';
      if (!why && o.count === 0) why = 'count=0';
      ledger.push({
        owner: owner(o),
        chain: chain(o),
        count: o.count,
        parked: why ?? 'DRAWN',
      });
    });
    return { movers: [...buckets.entries()].sort((x, y) => y[1] - x[1]), pools, ledger, geoChurn };
  }, HANDLE_SRC);

  if (report.error) {
    console.log('  ' + report.error);
  } else {
    console.log('\nMOVERS (matrixWorld changed over ~0.75 s, EFFECTIVELY DRAWN objects only):');
    if (!report.movers.length) console.log('  (none)');
    for (const [k, n] of report.movers) console.log(`  ${String(n).padStart(4)} x ${k}`);
    console.log('\nDRAWN INSTANCED POOLS (instanceMatrix.version over 1.5 s):');
    for (const p of report.pools)
      console.log(
        `  ${p.bumping ? 'ANIMATING' : '   static'} count=${String(p.count).padStart(5)} ${p.version.padEnd(16)} ${p.owner ?? 'UNOWNED ' + p.chain + ' | ' + p.detail}`
      );
    if (!report.pools.length) console.log('  (none)');
    console.log('\nGEOMETRY CHURN (drawn objects rewriting attributes — ribbons/tracers):');
    if (!report.geoChurn.length) console.log('  (none)');
    for (const g of report.geoChurn) console.log(`  ${g}`);
    console.log('\nALL INSTANCED POOLS (drawn + parked, with the reason):');
    for (const l of report.ledger)
      console.log(
        `  ${l.parked.padEnd(30)} count=${String(l.count).padStart(5)}  ${l.owner ?? 'UNOWNED ' + l.chain}`
      );
  }

  await browser.close();
})();

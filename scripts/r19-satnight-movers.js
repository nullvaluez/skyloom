/**
 * R19 — WHO still moves in verify-sat-night's (E) block after the cloud deck
 * is parked? The residual-actor census behind the OPEN determinism gap.
 *
 * Reproduces the (E) 3100 m pose + the harness's cloud park + its
 * setForegroundVisible(false), then diffs every object's matrixWorld across a
 * ~0.75 s window and reports the movers by ancestor chain, plus the instanced
 * pools whose instanceMatrix.version is still bumping (attribute churn never
 * shows as a matrix change).
 *
 * MEASURED on main 414a392 — satellite, tier high, noon, Manhattan 3100 m,
 * deck + its 14 scene-root instanced siblings + cirrus all parked:
 *   - a live traffic GLB is STILL visible and moving (Group#Jet_Cube024 plus
 *     its four meshes). setForegroundVisible hides only InstancedMeshes
 *     carrying _isModel/_painted, so GLB-backed traffic walks straight
 *     through the foreground hide.
 *   - three animated instanced pools NESTED under groups keep bumping
 *     instanceMatrix (counts 93 / 432 / 30) - the scene-root sweep cannot
 *     reach them.
 *   - one moving Points object.
 * That residue is why the (E) A/A noise still measures 0.15 - 3.16 run to run.
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const NOON_MS = Date.UTC(2026, 6, 17, 17, 0, 0);

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
  await page.evaluate(() => {
    const c = window.__flyClouds;
    if (c) {
      c.visible = false;
      c.parent?.children?.forEach((o) => {
        if (o === c || !o.isInstancedMesh) return;
        o.visible = false;
        if (o.material) o.material.visible = false;
      });
    }
    if (window.__flyPlayer) window.__flyPlayer.visible = false;
    let scene = window.__flyPlayer ?? null;
    while (scene && scene.parent) scene = scene.parent;
    scene?.traverse((o) => {
      if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined))
        o.visible = false;
    });
  });
  await page.waitForTimeout(3000);

  const movers = await page.evaluate(async () => {
    let scene = window.__satRoads?.object ?? window.__flyPlayer ?? null;
    while (scene && scene.parent) scene = scene.parent;
    if (!scene) return { error: 'no scene' };
    const chain = (o) => {
      const parts = [];
      let p = o;
      for (let i = 0; i < 5 && p; i++, p = p.parent)
        parts.unshift(`${p.type}${p.name ? '#' + p.name : ''}`);
      return parts.join(' > ');
    };
    const snap = () => {
      const m = new Map();
      scene.traverse((o) => {
        if (!o.visible) return;
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
      if (!b.has(o)) continue;
      if (b.get(o) === v) continue;
      const key = `${chain(o)} [${o.isInstancedMesh ? 'INSTANCED' : o.type}]`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    // Instanced attribute churn does not show as a matrix change - report the
    // instanced meshes whose instanceMatrix version bumped too.
    const attr = [];
    scene.traverse((o) => {
      if (o.isInstancedMesh && o.visible && o.instanceMatrix)
        attr.push(`${chain(o)} v=${o.instanceMatrix.version} n=${o.count}`);
    });
    return { buckets: [...buckets.entries()].sort((x, y) => y[1] - x[1]), attr };
  });

  console.log('MOVERS (matrixWorld changed over ~0.75 s, visible objects only):');
  if (movers.error) console.log('  ' + movers.error);
  else {
    for (const [k, n] of movers.buckets) console.log(`  ${String(n).padStart(4)} x ${k}`);
    console.log('\nVISIBLE INSTANCED MESHES (instanceMatrix.version snapshot):');
    for (const a of movers.attr) console.log(`  ${a}`);
  }

  // second pass: same census a second later, to see which instanceMatrix
  // versions are still incrementing (= animated instanced pools)
  const bump = await page.evaluate(async () => {
    let scene = window.__satRoads?.object ?? window.__flyPlayer ?? null;
    while (scene && scene.parent) scene = scene.parent;
    const chain = (o) => {
      const parts = [];
      let p = o;
      for (let i = 0; i < 5 && p; i++, p = p.parent)
        parts.unshift(`${p.type}${p.name ? '#' + p.name : ''}`);
      return parts.join(' > ');
    };
    const read = () => {
      const m = new Map();
      scene.traverse((o) => {
        if (o.isInstancedMesh && o.visible && o.instanceMatrix)
          m.set(o, [o.instanceMatrix.version, chain(o), o.count]);
      });
      return m;
    };
    const a = read();
    await new Promise((r) => setTimeout(r, 1500));
    const b = read();
    const out = [];
    for (const [o, v] of a) {
      const w = b.get(o);
      if (w && w[0] !== v[0]) out.push(`${v[1]} count=${v[2]} version ${v[0]} -> ${w[0]}`);
    }
    return out;
  });
  console.log('\nANIMATED INSTANCED POOLS (instanceMatrix.version still bumping):');
  for (const b of bump) console.log(`  ${b}`);
  if (!bump.length) console.log('  (none)');

  await browser.close();
})();

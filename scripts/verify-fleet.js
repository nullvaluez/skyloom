/**
 * Round 8 (P8): plane fleet + nav-light emissive bake (P6). Extends
 * verify-fly-models with hard gates:
 * (A) Node-side — every model GLB in the FLY_ASSETS manifest exists on disk
 *     and is ≤ 1MB (the round-7 traffic-jet outlier was 1.74MB); every
 *     TRAFFIC_MODELS / PLAYER_MODEL url resolves to a real file; CREDITS.md
 *     (regenerated from the manifest) contains every FLY_ASSETS source url —
 *     CC-BY attribution is a licensing hard rule.
 * (B) Browser-side — every mapped archetype swapped its GLB in (NO primitive
 *     fallbacks); every swapped geometry carries the baked aEmissive vec4
 *     with lit nav-light verts; the traffic materials are armed with the
 *     'world-bend-air-anchor-nav' program (the __worldBend/__navLights
 *     probe); the shared uNavT clock ADVANCES between two samples (captured
 *     via a one-shot probe recompile — the uniform object is module-scoped);
 *     player + close-up archetype screenshots for eyeballing; zero
 *     pageerrors. ALWAYS eyeball the screenshots — silhouettes are taste.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const MAX_GLB_BYTES = 1024 * 1024;

(async () => {
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  // --- A: manifest / disk / credits (no browser needed) ---------------------
  const assetsSrc = fs.readFileSync(path.join(ROOT, 'lib', 'fly', 'assets.js'), 'utf8');
  const credits = fs.readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');

  const manifestGlbs = [...assetsSrc.matchAll(/file:\s*'([^']+\.glb)'/g)].map((m) => m[1]);
  gate('manifest lists model GLBs', manifestGlbs.length >= 7, `${manifestGlbs.length} entries`);
  for (const rel of manifestGlbs) {
    const p = path.join(ROOT, rel);
    const exists = fs.existsSync(p);
    const size = exists ? fs.statSync(p).size : -1;
    gate(
      `GLB on disk ≤ 1MB: ${rel}`,
      exists && size <= MAX_GLB_BYTES,
      exists ? `${(size / 1024).toFixed(0)}KB` : 'MISSING'
    );
  }

  // Runtime mappings must point at real files too (a manifest entry can be
  // healthy while TRAFFIC_MODELS references a file that never landed).
  const runtimeUrls = [...new Set([...assetsSrc.matchAll(/url:\s*'(\/models\/[^']+)'/g)].map((m) => m[1]))];
  for (const u of runtimeUrls) {
    gate(`runtime model exists: ${u}`, fs.existsSync(path.join(ROOT, 'public', u)), '');
  }
  // Archetype slots that mapped a GLB (nulls keep primitives by design)
  const expectedModels = [...assetsSrc.matchAll(/\{\s*url:\s*'\/models\//g)].length - 1; // −1: PLAYER_MODEL
  console.log(`TRAFFIC_MODELS mapped slots: ${expectedModels} (+ player)`);

  const sourceUrls = [...assetsSrc.matchAll(/url:\s*'(https?:[^']+)'/g)].map((m) => m[1]);
  const missingCredit = sourceUrls.filter((u) => !credits.includes(u));
  gate(
    'CREDITS.md covers every FLY_ASSETS url (regen ran)',
    missingCredit.length === 0,
    missingCredit.join(', ') || `${sourceUrls.length} urls covered`
  );

  // --- B: live fleet ---------------------------------------------------------
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => {
    if (m.text().includes('fly-models')) console.log('loader:', m.text().slice(0, 200));
  });

  await bootFly(page); // R9-3: GLB loads are boot gate (b) — no fixed swap sleep
  await page.waitForTimeout(5000); // live traffic instances populate (not a boot wait)
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(__dirname, 'fleet-01-player.png') });

  // Archetype meshes: __navLights marks the traffic MODEL materials (the
  // far-LOD billboard shares the air-anchor bend but not the nav layer).
  const fleet = await page.evaluate(() => {
    let root = window.__fly.engine.object;
    while (root.parent) root = root.parent;
    const out = [];
    root.traverse((o) => {
      if (o.isInstancedMesh && o.material?.userData?.__navLights) {
        const em = o.geometry?.getAttribute?.('aEmissive');
        let lit = 0;
        if (em) {
          const a = em.array;
          for (let i = 0; i < a.length; i += 4) {
            if (a[i] > 0.01 || a[i + 1] > 0.01 || a[i + 2] > 0.01) lit += 1;
          }
        }
        out.push({
          isModel: o._isModel === true,
          hasEmissive: !!em && em.itemSize === 4,
          emissiveLitVerts: lit,
          key: o.material.customProgramCacheKey(),
          bend: o.material.userData.__worldBend,
          used: o.count,
        });
      }
    });
    return out;
  });
  console.log('fleet meshes:', JSON.stringify(fleet));
  const models = fleet.filter((m) => m.isModel);
  gate(
    `no primitive fallbacks (${expectedModels} mapped slots swapped)`,
    models.length === expectedModels,
    `models=${models.length}/${fleet.length} meshes`
  );
  gate(
    'every swapped geometry carries baked aEmissive (vec4)',
    models.length > 0 && models.every((m) => m.hasEmissive),
    models.map((m) => m.hasEmissive).join(',')
  );
  gate(
    'nav-light verts lit in the bake (rgb > 0 somewhere)',
    models.length > 0 && models.every((m) => m.emissiveLitVerts > 0),
    models.map((m) => m.emissiveLitVerts).join(',')
  );
  gate(
    "nav program armed ('world-bend-air-anchor-nav' on air-anchor bend)",
    fleet.length > 0 && fleet.every((m) => m.key === 'world-bend-air-anchor-nav' && m.bend === 'air-anchor'),
    [...new Set(fleet.map((m) => `${m.key}/${m.bend}`))].join(' ')
  );

  // uNavT clock: the uniform lives module-scoped in world-bend.js, so grab it
  // through a ONE-SHOT probe recompile — wrap onBeforeCompile (which chains
  // the real patches and captures the shader whose uniforms.uNavT IS the
  // shared object), re-key so three actually builds the program, then sample
  // the value twice. Restored afterwards; the extra program is dev-only cost.
  const navStart = await page.evaluate(() => {
    let root = window.__fly.engine.object;
    while (root.parent) root = root.parent;
    let mat = null;
    let best = -1;
    root.traverse((o) => {
      if (o.isInstancedMesh && o.material?.userData?.__navLights && o.count > best) {
        best = o.count; // prefer a mesh that is actually rendering instances
        mat = o.material;
      }
    });
    if (!mat) return false;
    const prevOBC = mat.onBeforeCompile;
    const prevKey = mat.customProgramCacheKey;
    window.__navProbe = { mat, prevOBC, prevKey, shader: null };
    mat.onBeforeCompile = (s, r) => {
      prevOBC?.(s, r);
      window.__navProbe.shader = s;
    };
    mat.customProgramCacheKey = () => 'world-bend-air-anchor-nav-probe';
    mat.needsUpdate = true;
    return true;
  });
  let navT0 = null;
  let navT1 = null;
  if (navStart) {
    await page.waitForTimeout(1500); // a rendered frame compiles the probe
    navT0 = await page.evaluate(() => window.__navProbe?.shader?.uniforms?.uNavT?.value ?? null);
    await page.waitForTimeout(1000);
    navT1 = await page.evaluate(() => window.__navProbe?.shader?.uniforms?.uNavT?.value ?? null);
    await page.evaluate(() => {
      const p = window.__navProbe;
      if (p) {
        p.mat.onBeforeCompile = p.prevOBC;
        p.mat.customProgramCacheKey = p.prevKey;
        p.mat.needsUpdate = true;
      }
      window.__navProbe = null;
    });
  }
  gate(
    'uNavT advances between two samples',
    navT0 !== null && navT1 !== null && navT1 > navT0,
    `t0=${navT0?.toFixed?.(2)} t1=${navT1?.toFixed?.(2)}`
  );

  // Close-up eyeball shots: warp to the two nearest distinct live archetypes
  // (verify-fly-models keeps the full rotation; this is the smoke pass).
  for (const tag of ['02', '03']) {
    const hex = await page.evaluate(() => {
      const fly = window.__fly;
      const items = [...fly.traffic.items]
        .filter((it) => it.stale === 0 && it.fix1 && Math.hypot(it.fix1.vE, it.fix1.vN) > 60)
        .sort((a, b) => a.distM - b.distM);
      const seen = window.__seenArch ?? (window.__seenArch = new Set());
      const pick = items.find((it) => !seen.has(it.archetype)) ?? items[0];
      if (!pick) return null;
      seen.add(pick.archetype);
      return fly.warpTo(pick.hex) ? pick.hex : null;
    });
    if (!hex) break;
    await page.waitForTimeout(4500);
    const info = await page.evaluate((h) => {
      const t = window.__fly.traffic.tracks.get(h);
      return t ? { arch: t.archetype, dist: Math.round(t.distM) } : null;
    }, hex);
    console.log(`warped to ${hex}:`, JSON.stringify(info));
    await page.screenshot({ path: path.join(__dirname, `fleet-${tag}-arch${info?.arch}.png`) });
  }

  gate('zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));
  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

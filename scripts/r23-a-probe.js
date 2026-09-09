/**
 * R23 A "NIGHT-TRUTH" — the night bisection probe (DIAGNOSTIC, not a gate).
 *
 * Plan §2/§3: every R22 feature family ships `enabled:` + a fleet pin, so the
 * bisection is cheap. Fixed deep-night pose, leg 0 = all pins set (the R21
 * world every legacy harness has been measuring), leg 1 = fully un-pinned (the
 * world the USER actually flies), then flip families one at a time. Each leg
 * records tier + dpr + draw census + per-layer census + night pixel metrics, so
 * a tier flap cannot masquerade as a shader bug (and vice versa).
 *
 * This is NOT verify-night-alive (C owns that gate). This writes JSON + PNGs
 * into scripts/ as `r23-a-*` and asserts nothing.
 *
 * Usage:
 *   FLY_URL=http://localhost:3021 node scripts/r23-a-probe.js \
 *     --poses=man,pow,owe --legs=L0,L1 --out=r23-a-bisect
 *
 * Leg names are defined in LEGS below. `--tier=high` pins the quality tier for
 * every leg (the verify-sat-night control); default is the RESOLVED LIVE tier,
 * which is the whole point of this round.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

// ---------------------------------------------------------------------------
// Poses. Deep night is pinned per pose: `sunUtc` is chosen so the TRUE solar
// elevation at that longitude is well below -12 deg (local ~01:00). Owens is
// 3 timezones west of Manhattan, so it needs its own clock.
// ---------------------------------------------------------------------------
const POSES = {
  // P-MAN Manhattan overview, ~800 m AGL, looking down the island.
  man: {
    name: 'P-MAN',
    geo: [40.758, -73.9855],
    altM: 800,
    heading: 200,
    pitch: -18,
    sunUtc: Date.UTC(2026, 6, 28, 5, 0),
  },
  // P-POW Powell OH suburban night (the R19/R20 suburb pose).
  pow: {
    name: 'P-POW',
    geo: [40.1573, -83.0752],
    altM: 600,
    heading: 150,
    pitch: -15,
    sunUtc: Date.UTC(2026, 6, 28, 5, 30),
  },
  // P-OWE Owens Valley — the DARK CONTROL. Must stay dark and <= 261 draws.
  owe: {
    name: 'P-OWE',
    geo: [36.606, -118.0629],
    altM: 800,
    heading: 180,
    pitch: -15,
    sunUtc: Date.UTC(2026, 6, 28, 8, 30),
  },
  // Dusk control at Manhattan (protects the R19 dusk ladder): ~ el -6.
  mandusk: {
    name: 'P-MAN-DUSK',
    geo: [40.758, -73.9855],
    altM: 800,
    heading: 200,
    pitch: -18,
    sunUtc: Date.UTC(2026, 6, 28, 1, 15),
  },
};

// ---------------------------------------------------------------------------
// Legs. `unpin` lists the fleet pins this leg RELEASES (undefined = not pinned,
// per the _boot.js unpinPins contract). `gov:true` also releases __flyGovPin so
// the R21 governor runs live.
// ---------------------------------------------------------------------------
const R22_PINS = ['__flyTerraPin', '__flySettlePin', '__flyClutterPin', '__flyDepthPin'];
const LEGS = {
  // The R21 world — what verify-sat-night has been certifying all along.
  L0: { label: 'all-pinned (R21 world)', unpin: [] },
  // The USER'S world — every R22 family armed, governor still held.
  L1: { label: 'un-pinned (R22 world)', unpin: R22_PINS },
  // One family at a time.
  L2: { label: 'TERRA only', unpin: ['__flyTerraPin'] },
  L3: { label: 'SETTLE only', unpin: ['__flySettlePin'] },
  L4: { label: 'CLUTTER only', unpin: ['__flyClutterPin'] },
  L5: { label: 'DEPTH only', unpin: ['__flyDepthPin'] },
  // The user's world WITH the governor live (H1's real condition).
  L6: { label: 'un-pinned + governor live', unpin: R22_PINS, gov: true },
};

const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : d;
};

// --- page-side helpers (single array arg — page.evaluate passes exactly one) --

// verify-sat-night's pinScene, verbatim (the warp also bumps warpEpoch, which
// is what makes the day-cycle effect re-read window.__flySunOverride).
const pinScene = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading;
  f.pitch = pitch;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

// R17 §7.1: a pixel probe must not contain actors it does not control.
const hideActors = () => {
  const hidden = [];
  if (window.__flyPlayer) {
    window.__flyPlayer.visible = false;
    hidden.push('player');
  }
  const t = window.__flyTraffic;
  for (const k of ['sprites', 'meshes', 'labels', 'group', 'root']) {
    const o = t?.[k];
    if (o && typeof o === 'object' && 'visible' in o) {
      o.visible = false;
      hidden.push('traffic.' + k);
    } else if (Array.isArray(o)) {
      for (const m of o) if (m && 'visible' in m) m.visible = false;
      hidden.push('traffic.' + k + '[]');
    }
  }
  if (window.__flyTracers?.mesh) {
    window.__flyTracers.mesh.visible = false;
    hidden.push('tracers');
  }
  return hidden;
};

/**
 * THE CENSUS. Everything a night verdict needs, in one page evaluate:
 * tier/dpr/governor (H1), per-layer mount+count (H6), emissive material state
 * (H3), birth/settle opacity (H4), grade/haze state (H5).
 */
const census = () => {
  const S = window.__flyStats ?? {};
  const store = window.__flyStore?.getState?.() ?? {};
  const gl = window.__flyGl;
  const bldg = window.__satBuildings;
  const roads = window.__satRoads;
  const mat = bldg?.material;

  // Every mesh in the scene carrying a non-zero emissive contribution, and
  // whether it actually holds a complete emissiveMap (H3: emissive-without-map
  // renders as flat white-ish glow).
  const emissive = [];
  // No dev handle publishes the scene, so find it by walking `.parent` up from
  // whichever Object3D handle this build happens to expose.
  let scene = null;
  for (const cand of [
    window.__flyPlayer,
    bldg?.group,
    bldg?.root,
    roads?.group,
    window.__satCityGlow,
    window.__satVeg?.mesh,
    window.__flyMonuments?.mesh,
    window.__flyClouds,
  ]) {
    let o = cand;
    let guard = 0;
    while (o && o.parent && guard++ < 64) o = o.parent;
    if (o && o.isScene) {
      scene = o;
      break;
    }
    if (o && o.type === 'Scene') {
      scene = o;
      break;
    }
  }
  const walk = (o) => {
    if (!o) return;
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) {
      const ei = m.emissiveIntensity;
      const ec = m.emissive;
      const lum = ec ? ec.r * 0.299 + ec.g * 0.587 + ec.b * 0.114 : 0;
      if ((ei ?? 0) > 0.001 && lum > 0.001) {
        emissive.push({
          name: o.name || o.type,
          visible: o.visible,
          ei,
          emissive: ec ? [+ec.r.toFixed(3), +ec.g.toFixed(3), +ec.b.toFixed(3)] : null,
          hasMap: !!m.emissiveMap,
          mapImage: m.emissiveMap?.image
            ? `${m.emissiveMap.image.width}x${m.emissiveMap.image.height}`
            : null,
        });
      }
    }
    for (const c of o.children || []) walk(c);
  };
  if (scene) walk(scene);

  return {
    // --- H1: the tier / governor / dpr chain ---
    tier: store.qualityTier ?? null,
    dpr: gl?.getPixelRatio?.() ?? null,
    gov: window.__flyGov?.state?.() ?? null,
    govPin: window.__flyGovPin ?? null,
    pinAttempt: window.__r22PinAttempt ?? null,
    unpinned: window.__r22Unpinned ?? null,
    // --- the sun (every night ramp keys off this) ---
    sunFrac: S.sunFactor ?? null,
    sunEl: window.__fly?.runtime?.sun?.el ?? null,
    trueEl: S.trueEl ?? null,
    hdriBucket: S.hdriBucket ?? null,
    // --- scene cost ---
    draws: S.drawCalls ?? null,
    tris: S.triangles ?? null,
    // --- H6/H3: the night layers ---
    bldg: bldg
      ? {
          chunks: bldg.chunks?.size ?? null,
          ready: [...(bldg.chunks?.values?.() ?? [])].filter((c) => c.mesh).length,
          nightEnabled: bldg.nightEnabled ?? null,
          facadeEnabled: bldg.facadeEnabled ?? null,
          emissiveIntensity: mat?.emissiveIntensity ?? null,
          emissive: mat?.emissive
            ? [+mat.emissive.r.toFixed(3), +mat.emissive.g.toFixed(3), +mat.emissive.b.toFixed(3)]
            : null,
          hasEmissiveMap: !!mat?.emissiveMap,
          hasMap: !!mat?.map,
          toneMapped: mat?.toneMapped ?? null,
        }
      : null,
    roads: roads
      ? {
          chunks: roads.chunks?.size ?? null,
          ready: [...(roads.chunks?.values?.() ?? [])].filter((c) => c.mesh).length,
        }
      : null,
    satRoadsStats: S.satRoads ?? null,
    satBeacons: S.satBeacons ?? null,
    cityGlow: S.cityGlow ?? S.satCityGlow ?? null,
    houseLights: S.houseLights ?? null,
    satSkyline: S.satSkyline ?? null,
    satVeg: S.satVeg ?? null,
    clutter: S.clutter ?? null,
    // --- H5: grade / haze ---
    satTint: S.satTint ?? null,
    aerial: window.__flyAerial?.state?.() ?? S.aerial ?? null,
    quilt: S.quilt ?? null,
    // --- H4: settle / birth ---
    terra: S.terra ?? null,
    settle: S.settle ?? null,
    // --- the emissive census (H3) ---
    emissiveCount: emissive.length,
    emissive: emissive.slice(0, 40),
  };
};

/**
 * Night pixel metrics, computed page-side from a base64 PNG (the verify-sat-
 * night decode idiom). The sky band is excluded by default: the claim under
 * test is about the GROUND light field.
 */
const nightMetrics = ([b64, y0f, y1f]) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const y0 = Math.floor(h * y0f);
      const bh = Math.max(1, Math.floor(h * y1f) - y0);
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = bh;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, -y0);
      const d = ctx.getImageData(0, 0, w, bh).data;
      const lumas = [];
      let lit = 0;
      let warm = 0;
      let whiteGlow = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const L = 0.299 * r + 0.587 * g + 0.114 * b;
        lumas.push(L);
        n += 1;
        if (L > 40) {
          lit += 1;
          // warm = the sodium/window share (red channel clearly over blue)
          if (r - b > 12) warm += 1;
        }
        // white glow = bright AND desaturated
        if (L > 150) {
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          if (mx - mn < 30) whiteGlow += 1;
        }
      }
      lumas.sort((a, b2) => a - b2);
      const q = (p) => lumas[Math.min(lumas.length - 1, Math.floor(lumas.length * p))];
      resolve({
        w,
        bh,
        px: n,
        litFrac: +(lit / n).toFixed(6),
        warmFrac: +(warm / n).toFixed(6),
        warmShare: lit ? +(warm / lit).toFixed(4) : 0,
        whiteGlowFrac: +(whiteGlow / n).toFixed(6),
        p5: +q(0.05).toFixed(2),
        p50: +q(0.5).toFixed(2),
        p95: +q(0.95).toFixed(2),
        p99: +q(0.99).toFixed(2),
        mean: +(lumas.reduce((a, b2) => a + b2, 0) / n).toFixed(2),
      });
    };
    img.src = 'data:image/png;base64,' + b64;
  });

async function runLeg(browser, legKey, poseKey, opts) {
  const leg = LEGS[legKey];
  const pose = POSES[poseKey];
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

  const toUnpin = [...leg.unpin, ...(leg.gov ? ['__flyGovPin'] : [])];
  if (toUnpin.length) await page.addInitScript(unpinPins, toUnpin);

  const boot = await bootFly(page, { style: 'satellite', settleMs: 3000 });

  if (opts.tier) {
    await page.evaluate((t) => window.__flyStore.getState().setQualityTier(t), opts.tier);
    await page.waitForTimeout(1500);
  }

  // Pin the clock BEFORE the warp: the warp bumps warpEpoch, which is what makes
  // the day-cycle effect re-read __flySunOverride (verify-sat-night's note).
  await page.evaluate((t) => {
    window.__flySunOverride = t;
  }, pose.sunUtc);
  await page.evaluate(pinScene, [pose.geo[0], pose.geo[1], pose.altM, pose.heading, pose.pitch]);
  await page.waitForTimeout(opts.dwellMs);
  const hidden = await page.evaluate(hideActors);
  await page.waitForTimeout(600);

  const c = await page.evaluate(census);
  const canvas = page.locator('.fixed.inset-0 canvas').first();
  const shotName = `r23-a-${poseKey}-${legKey}${opts.tier ? '-t' + opts.tier : ''}.png`;
  const buf = await canvas.screenshot({ path: path.join(__dirname, shotName) });
  const m = await page.evaluate(nightMetrics, [buf.toString('base64'), 0.5, 1.0]);
  const mFull = await page.evaluate(nightMetrics, [buf.toString('base64'), 0.0, 1.0]);

  await ctx.close();
  return {
    leg: legKey,
    legLabel: leg.label,
    pose: pose.name,
    poseKey,
    tierPin: opts.tier || null,
    bootMs: boot.ms,
    hidden,
    errors,
    shot: shotName,
    census: c,
    ground: m,
    frame: mFull,
  };
}

(async () => {
  const poses = arg('poses', 'man').split(',').filter(Boolean);
  const legs = arg('legs', 'L0,L1').split(',').filter(Boolean);
  const tier = arg('tier', '');
  const dwellMs = +arg('dwell', '22000');
  const out = arg('out', 'r23-a-probe');
  const browser = await chromium.launch();
  const rows = [];
  for (const p of poses) {
    for (const l of legs) {
      process.stdout.write(`\n=== ${POSES[p].name} / ${l} ${LEGS[l].label}${tier ? ' tier=' + tier : ''}\n`);
      let row;
      try {
        row = await runLeg(browser, l, p, { tier, dwellMs });
      } catch (e) {
        row = { leg: l, poseKey: p, fatal: String(e).slice(0, 400) };
      }
      rows.push(row);
      const g = row.ground ?? {};
      const c = row.census ?? {};
      process.stdout.write(
        `    tier=${c.tier} dpr=${c.dpr} draws=${c.draws} tris=${c.tris} sunFrac=${c.sunFrac}\n` +
          `    bldg ready=${c.bldg?.ready} nightEnabled=${c.bldg?.nightEnabled} ei=${c.bldg?.emissiveIntensity} map=${c.bldg?.hasEmissiveMap}\n` +
          `    roads ready=${c.roads?.ready} houseLights=${JSON.stringify(c.houseLights)} cityGlow=${JSON.stringify(c.cityGlow)}\n` +
          `    GROUND litFrac=${g.litFrac} warmShare=${g.warmShare} whiteGlow=${g.whiteGlowFrac} p50=${g.p50} p95=${g.p95} mean=${g.mean}\n` +
          `    errors=${(row.errors || []).length}${row.fatal ? ' FATAL ' + row.fatal : ''}\n`
      );
    }
  }
  const dest = path.join(__dirname, out + '.json');
  fs.writeFileSync(dest, JSON.stringify({ generatedAt: new Date().toISOString(), tier, dwellMs, rows }, null, 2));
  process.stdout.write(`\nwrote ${dest}\n`);
  await browser.close();
})();

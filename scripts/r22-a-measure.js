/**
 * R22 A TERRA — measurement rig (evidence, NOT a gate; E CERT owns verify-terra).
 *
 * Every number in A's report comes out of here. It boots ONE page per mode and
 * writes scripts/r22-a-<mode>.json + PNGs.
 *
 *   node scripts/r22-a-measure.js owens      # draw sweep at the sat-depth pose
 *   node scripts/r22-a-measure.js lewis      # P-LEWIS sharpness/tris/texture bytes
 *   node scripts/r22-a-measure.js dublin     # P-DUBLIN warp descent (cold + warm)
 *   node scripts/r22-a-measure.js quilt      # SAT_QUILT arrival A/B PNGs
 *
 * FLAGS: `TERRA=sharp,pipe,cache` arms families through the dev-only
 * `__flyTerraForce` handle (see terrain-engine.terraForced) — the constants
 * blocks stay enabled:false on disk. `TERRA=` (empty) is the control.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

const MODE = process.argv[2] || 'owens';
const FAMILIES = (process.env.TERRA ?? '').split(',').filter(Boolean);
const TAG = process.env.TAG || (FAMILIES.length ? FAMILIES.join('+') : 'control');
const OUT = (n) => path.join(__dirname, n);

const POSES = {
  OWENS: { lat: 36.601, lon: -118.06, altM: 500 }, // verify-sat-depth's low-AGL pose
  LEWIS: { lat: 40.2083, lon: -83.0701, altM: null }, // ~120 m AGL, resolved live
  DUBLIN: { lat: 40.0992, lon: -83.1141, altM: 9144 }, // FL300
  FAR: { lat: 35.6812, lon: 139.7671, altM: 9144 }, // Tokyo — the >100 km origin
};

const sample = () =>
  ({
    // Direct read of the resident leaf zoom under the aircraft — available in
    // BOTH legs (the engine method is legacy), so the control has a camTileZ
    // even though it publishes no terraStats.
    probeZ: (() => {
      try {
        const g = window.__fly?.geo;
        const s = g && window.__fly.engine.getGroundAt(g.x, g.y);
        return s ? s.tileZ : null;
      } catch {
        return null;
      }
    })(),
    // The two instruments that separate "the pipeline is slow" from "the tile
    // under the aeroplane is simply not on screen": maxLeafZ is the deepest
    // resident leaf ANYWHERE in the tree, viewZ is the leaf where the camera's
    // forward ray meets the ground — i.e. the ground the player is looking at.
    maxLeafZ: (() => {
      try {
        let mx = 0;
        window.__fly.engine.object.traverse((o) => {
          if (o.isTile && o.children.length <= 1 && o.z > mx) mx = o.z;
        });
        return mx;
      } catch {
        return null;
      }
    })(),
    // SHARPNESS PROFILE — the leaf zoom on the ground at fixed distances
    // AHEAD of the aeroplane along its heading. This is the instrument the eye
    // actually judges at cruise: the tile under the aircraft is below the
    // camera and outside the frustum, so it can never refine, while the ground
    // the player is looking at lives 5–50 km out.
    profile: (() => {
      try {
        const g = window.__fly.geo;
        const hdg = window.__fly.flight.heading;
        const eng = window.__fly.engine;
        const out = {};
        for (const km of [2, 5, 10, 20, 50]) {
          const dLat = (km * 1000 * Math.cos(hdg)) / 111320;
          const dLon =
            (km * 1000 * Math.sin(hdg)) /
            (111320 * Math.max(0.2, Math.cos((g.y * Math.PI) / 180)));
          const s = eng.getGroundAt(g.x + dLon, g.y + dLat);
          out[km] = s ? s.tileZ : null;
        }
        return out;
      } catch {
        return null;
      }
    })(),
    viewZ: (() => {
      try {
        const cam = window.__fly.camera;
        const eng = window.__fly.engine;
        const e = cam.matrixWorld.elements;
        // Camera world position + forward (-Z column of matrixWorld).
        const px = e[12];
        const py = e[13];
        const pz = e[14];
        const L = Math.hypot(e[8], e[9], e[10]) || 1;
        const fx = -e[8] / L;
        const fy = -e[9] / L;
        const fz = -e[10] / L;
        if (fy >= -0.02) return null; // looking at/above the horizon
        const groundY = window.__fly.flight?.groundElev ?? 0;
        const t = Math.min(120000, (py - groundY) / -fy);
        // Reuse a real Vector3 (flight.pos) so no THREE import is needed here.
        const v = window.__fly.flight.pos.clone();
        v.set(px + fx * t, py + fy * t, pz + fz * t).add(window.__fly.origin.anchor);
        const gg = eng.worldToGeo(v);
        const s = eng.getGroundAt(gg.x, gg.y);
        return s ? { z: s.tileZ, distKm: Math.round(t / 100) / 10 } : null;
      } catch (er) {
        return { err: String(er.message || er) };
      }
    })(),
    draws: window.__flyStats?.drawCalls,
    tris: window.__flyStats?.triangles,
    terra: window.__flyStats?.terra ? { ...window.__flyStats.terra } : null,
    rtTerra: window.__fly?.terraStats ? { ...window.__fly.terraStats } : null,
    warp: window.__flyStats?.terraWarp ? { ...window.__flyStats.terraWarp } : null,
    cache: window.__flyRasterCache ? window.__flyRasterCache.stats() : null,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
  });

const texAccount = () => {
  let bytes = 0;
  let count = 0;
  let maxAniso = 0;
  const seen = new Set();
  window.__fly.engine.object.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      const t = m?.map;
      if (!t || seen.has(t.uuid)) continue;
      seen.add(t.uuid);
      if (t.anisotropy > maxAniso) maxAniso = t.anisotropy;
      const w = t.image?.width ?? 0;
      const h = t.image?.height ?? 0;
      bytes += w * h * 4 * 1.34; // RGBA + mip chain
      count++;
    }
  });
  return { mb: Math.round(bytes / 1048576), count, maxAniso };
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const zoomSeen = {};
  page.on('response', (r) => {
    const m = /World_Imagery\/MapServer\/tile\/(\d+)\//.exec(r.url());
    if (m) zoomSeen[`img${m[1]}`] = (zoomSeen[`img${m[1]}`] || 0) + 1;
    const d = /Terrain3D\/ImageServer\/tile\/(\d+)\//.exec(r.url());
    if (d) zoomSeen[`dem${d[1]}`] = (zoomSeen[`dem${d[1]}`] || 0) + 1;
  });

  await page.addInitScript(
    (arg) => {
      if (arg.fams.length) {
        window.__flyTerraForce = {
          sharp: arg.fams.includes('sharp'),
          pipe: arg.fams.includes('pipe'),
          cache: arg.fams.includes('cache'),
          ...arg.extra,
        };
      }
    },
    {
      fams: FAMILIES,
      extra: {
        ...(process.env.DEM_MAX ? { demMaxZoom: Number(process.env.DEM_MAX) } : {}),
        ...(process.env.IMG_MAX ? { maxZoomHigh: Number(process.env.IMG_MAX) } : {}),
        ...(process.env.ERRTABLE === '0' ? { errTable: false } : {}),
        ...(process.env.ERRTABLE_JSON ? { errTableValues: JSON.parse(process.env.ERRTABLE_JSON) } : {}),
      },
    }
  );

  const t0 = Date.now();
  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);
  const cfg = await page.evaluate(() => window.__flyTerra?.get() ?? null);
  const out = { mode: MODE, tag: TAG, families: FAMILIES, bootMs: Date.now() - t0, cfg, runs: [] };
  const shot = (n) =>
    page
      .locator('.fixed.inset-0 canvas')
      .first()
      .screenshot({ path: OUT(`r22-a-${n}.png`) });

  const warpTo = async (p, waitMs) => {
    await page.evaluate(
      (q) => window.__fly.warpToGeo(q.lat, q.lon, { altM: q.altM, name: null }),
      p
    );
    await page.waitForTimeout(waitMs);
  };

  if (MODE === 'owens') {
    // Threshold sweep at the frozen verify-sat-depth pose (POSE/ALT env swap it
    // for the cruise leg). The override pins the live LOD threshold so the
    // whole curve can be swept in one boot.
    if (process.env.POSE === 'dublin') POSES.OWENS = { ...POSES.DUBLIN };
    if (process.env.ALT) POSES.OWENS.altM = Number(process.env.ALT);
    await warpTo(POSES.OWENS, 24000);
    const sweep = FAMILIES.includes('sharp')
      ? (process.env.SWEEP || '1.0,0.92,0.86,0.82,0.78').split(',').map(Number)
      : [null];
    // The aircraft never stops flying, so a multi-minute sweep sampled in place
    // would compare five DIFFERENT patches of ground. Every row re-warps to the
    // identical pose first — the same discipline verify-sat-depth uses.
    for (const t of sweep) {
      await page.evaluate((v) => {
        window.__flyTerraLodOverride = v;
      }, t);
      await warpTo(POSES.OWENS, 1000);
      // Settle, then confirm the draw count has stopped moving before it is
      // recorded — an un-settled sample is a coin, not a measurement.
      let s = null;
      let prev = -1;
      for (let i = 0; i < 14; i++) {
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(2000);
        // eslint-disable-next-line no-await-in-loop
        s = await page.evaluate(sample);
        if (i >= 3 && s.draws === prev && (s.terra?.downloading ?? 0) <= 1) break;
        prev = s.draws;
      }
      await page.mouse.move(800, 450);
      out.runs.push({ threshold: t, ...s });
      console.log(
        `owens thr=${t ?? 'baseline'} draws=${s.draws} tris=${s.tris} camZ=${s.terra?.camTileZ} targetZ=${s.terra?.targetZ}`
      );
      await shot(`owens-${TAG}-${t ?? 'base'}`);
    }
    out.tex = await page.evaluate(texAccount);
  }

  if (MODE === 'lewis') {
    // P-LEWIS: place the aircraft ~120 m over the ground. The warp altitude is
    // MSL, and Lewis Center OH sits at ~275 m, so 395 m MSL ≈ 120 m AGL.
    // POSE=manhattan|sierra swaps the pose for the worst-case tris legs.
    const alt = Number(process.env.ALT || 395);
    const pose =
      process.env.POSE === 'manhattan'
        ? { lat: 40.758, lon: -73.9855 }
        : process.env.POSE === 'sierra'
          ? { lat: 36.578, lon: -118.29 }
          : POSES.LEWIS;
    await page.evaluate(
      (q) => window.__fly.warpToGeo(q.q.lat, q.q.lon, { altM: q.alt, name: null }),
      { q: pose, alt }
    );
    for (const s of [2000, 4000, 6000, 8000, 10000, 15000, 25000]) {
      await page.waitForTimeout(s === 2000 ? 2000 : 2000);
      const r = await page.evaluate(sample);
      out.runs.push({ tMs: s, ...r });
      console.log(
        `lewis t=${s}ms draws=${r.draws} tris=${r.tris} camZ=${r.terra?.camTileZ} agl=${r.terra?.aglM} dl=${r.terra?.downloading} sharp=${r.terra?.sharp}`
      );
    }
    out.tex = await page.evaluate(texAccount);
    await shot(`lewis-${TAG}`);
    console.log(`lewis textures ≈${out.tex.mb} MB / ${out.tex.count} · aniso ${out.tex.maxAniso}`);
  }

  if (MODE === 'dublin') {
    // POSE=lewis + ALT swaps the destination for the LOW-AGL arrival, which is
    // where a warp descent is real work: at cruise the leaf under the aircraft
    // is frustum-capped and the loader goes idle, so the pipeline patches have
    // nothing to bite on.
    if (process.env.POSE === 'lewis') {
      POSES.DUBLIN = { ...POSES.LEWIS, altM: Number(process.env.ALT || 395) };
    } else if (process.env.ALT) {
      POSES.DUBLIN.altM = Number(process.env.ALT);
    }
    // Cold: a >100 km warp from Tokyo to Dublin OH at FL300, sampled every
    // 500 ms until camTileZ reaches targetZ-1 (or 45 s).
    if (process.env.LODOV) {
      await page.evaluate((v) => {
        window.__flyTerraLodOverride = v;
      }, Number(process.env.LODOV));
    }
    await warpTo(POSES.FAR, 12000);
    // A fixed-length trace, identical in every leg (the control publishes no
    // terraStats, so the comparable quantity is `probeZ` — the resident leaf
    // zoom under the aircraft, read through the engine method both legs have).
    // Reach-times for several zoom targets are computed from the trace after
    // the fact so no leg gets a different stopping rule.
    const TRACE_MS = Number(process.env.TRACE_MS || 40000);
    const descend = async (label) => {
      // Esri REQUESTS ISSUED during this leg — the cache instrument. A Cache
      // API hit never reaches the network, so a second visit's request count is
      // a deterministic, frustum-immune measure of what the cache saved (unlike
      // a wall-clock descent time, which the LOD/frustum geometry dominates).
      const reqBefore = Object.values(zoomSeen).reduce((a, b) => a + b, 0);
      const start = Date.now();
      await page.evaluate(
        (q) => window.__fly.warpToGeo(q.lat, q.lon, { altM: q.altM, name: null }),
        POSES.DUBLIN
      );
      const trace = [];
      while (Date.now() - start < TRACE_MS) {
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(500);
        // eslint-disable-next-line no-await-in-loop
        const s = await page.evaluate(sample);
        trace.push({
          ms: Date.now() - start,
          z: s.probeZ,
          maxLeafZ: s.maxLeafZ,
          viewZ: s.viewZ,
          profile: s.profile,
          camTileZ: s.terra?.camTileZ ?? null,
          targetZ: s.terra?.targetZ ?? null,
          dl: s.terra?.downloading ?? null,
          draws: s.draws,
        });
      }
      const reach = {};
      for (const target of [10, 11, 12, 13, 14]) {
        const hit = trace.find((r) => (r.z ?? 0) >= target);
        reach[`z${target}`] = hit ? hit.ms : null;
      }
      const s = await page.evaluate(sample);
      const reqs = Object.values(zoomSeen).reduce((a, b) => a + b, 0) - reqBefore;
      // The settled sharpness profile = the median leaf zoom per distance over
      // the second half of the trace (the first half is still descending).
      const half = trace.slice(Math.floor(trace.length / 2));
      const settledProfile = {};
      for (const km of [2, 5, 10, 20, 50]) {
        const vals = half.map((r) => r.profile?.[km]).filter((v) => v != null).sort((a, b) => a - b);
        settledProfile[km] = vals.length ? vals[Math.floor(vals.length / 2)] : null;
      }
      out.runs.push({ label, reach, reqs, settledProfile, trace, ...s });
      console.log(
        `${label}: reqs=${reqs} profile(km→z)=${JSON.stringify(settledProfile)} maxLeafZ=${s.maxLeafZ} reach=${JSON.stringify(reach)} cache=${JSON.stringify(s.cache)} warp=${JSON.stringify(s.warp)}`
      );
      await shot(`dublin-${TAG}-${label}`);
      return reach;
    };
    const cold = await descend('cold');
    await warpTo(POSES.FAR, 14000); // leave, so the return is a real second visit
    const warm = await descend('warm');
    out.cold = cold;
    out.warm = warm;
    out.warmRatio = {};
    for (const k of Object.keys(cold)) {
      out.warmRatio[k] =
        cold[k] && warm[k] ? Math.round((warm[k] / cold[k]) * 100) / 100 : null;
    }
    console.log(`DESCENT ratios warm/cold: ${JSON.stringify(out.warmRatio)}`);
  }

  if (MODE === 'quilt') {
    // SAT_QUILT arrival A/B (plan §5.7 / checkpoint #6). The fleet pins
    // __flyAerialOverride = 0, which is exactly the quilt-OFF control; 1 is the
    // shipped strength. Same pose, same frame, one uniform apart.
    await warpTo(POSES.DUBLIN, 24000);
    const readGrade = () => page.evaluate(() => window.__flyAerial.quilt());
    await page.evaluate(() => {
      window.__flyAerialOverride = 0;
    });
    await page.waitForTimeout(1200);
    await shot(`quilt-off`);
    out.gradeOff = await readGrade();
    await page.evaluate(() => {
      window.__flyAerialOverride = 1;
    });
    await page.waitForTimeout(1200);
    await shot(`quilt-on`);
    out.gradeOn = await readGrade();
    // Ground-crop colorimetry: mean saturation (max-min over 255) and luma
    // std-dev — the two quantities SAT_QUILT actually moves.
    const sharp = require('sharp');
    const crop = { left: 200, top: 470, width: 1200, height: 380 };
    const stat = async (f) => {
      const { data, info } = await sharp(OUT(`r22-a-${f}.png`))
        .extract(crop)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const n = info.width * info.height;
      let sat = 0;
      let sum = 0;
      let sum2 = 0;
      for (let i = 0; i < n; i++) {
        const r = data[i * info.channels];
        const g = data[i * info.channels + 1];
        const b = data[i * info.channels + 2];
        sat += (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sum += l;
        sum2 += l * l;
      }
      const mean = sum / n;
      return {
        sat: Math.round((sat / n) * 1000) / 1000,
        luma: Math.round(mean * 10) / 10,
        lumaStd: Math.round(Math.sqrt(Math.max(0, sum2 / n - mean * mean)) * 10) / 10,
      };
    };
    out.quiltOff = await stat('quilt-off');
    out.quiltOn = await stat('quilt-on');
    // The gate multiplier is a proportional stand-in for a smaller desatMax /
    // a later outAglM (both scale the same uniform), so this sweep measures the
    // real colour response instead of assuming it is linear.
    out.sweep = [];
    for (const k of [0.3, 0.5, 0.7]) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate((v) => {
        window.__flyAerialOverride = v;
      }, k);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(1200);
      // eslint-disable-next-line no-await-in-loop
      await shot(`quilt-k${k}`);
      // eslint-disable-next-line no-await-in-loop
      const g = await readGrade();
      // eslint-disable-next-line no-await-in-loop
      const s = await stat(`quilt-k${k}`);
      out.sweep.push({ k, grade: g, ...s });
      console.log(`k=${k} desat=${g.desat.toFixed(3)} sat=${s.sat} luma=${s.luma}`);
    }
    console.log('grade off', JSON.stringify(out.gradeOff), 'on', JSON.stringify(out.gradeOn));
    console.log('crop OFF', JSON.stringify(out.quiltOff), ' ON', JSON.stringify(out.quiltOn));
  }

  out.zoomSeen = zoomSeen;
  out.pageerrors = errs;
  fs.writeFileSync(OUT(`r22-a-${MODE}-${TAG}.json`), JSON.stringify(out, null, 2));
  console.log(`zoom requests: ${JSON.stringify(zoomSeen)}`);
  console.log(`pageerrors: ${errs.length}${errs.length ? ' — ' + errs.slice(0, 3).join(' | ') : ''}`);
  console.log(`wrote scripts/r22-a-${MODE}-${TAG}.json`);
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

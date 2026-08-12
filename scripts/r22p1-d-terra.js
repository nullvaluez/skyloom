/**
 * R22.1 (D "CERT") — ADJUDICATION PROBE for verify-terra gate (2).
 *
 * THE OPEN RED. verify-terra (2) asserts `camTileZ >= 17` within 10 s of a
 * settle at P-LEWIS (Lewis Center OH, 40.2083 / -83.0701, 400 m MSL ≈ 120 m
 * AGL). R22's E CERT read 18/18 green on d5fdb1a; one day later Agent B read
 * camTileZ = 13, deterministically, minutes apart, and PROVED it is not R22.1
 * by flipping FRAME_PACE off (identical 13 in both arms). Meanwhile B's own
 * Powell pose reads camTileZ 17–18 at 236 m AGL on the same tree, so deep
 * refinement is working in general.
 *
 * This probe is NOT a gate. It exists to name WHICH of three things is true:
 *   (a) INSTRUMENT — the gate reads a dead handle / a stale statistic.
 *       Tested by reading the same value four independent ways in the same
 *       tick: `engine.getGroundAt` (what the gate calls), `terraStats.camTileZ`
 *       (what the engine publishes), a TREE census of the tiles that actually
 *       contain the aircraft's lon/lat, and `window.__flyTerra` (the handle B
 *       showed is bound to a StrictMode-discarded engine).
 *   (b) PRODUCT — the LOD curve genuinely stopped refining. Tested by running
 *       the IDENTICAL program at three poses in ONE session: P-LEWIS, B's
 *       Powell pose, and the Owens control. A curve fault is pose-independent.
 *   (c) UPSTREAM — Esri stopped serving the tiles P-LEWIS needs. Tested by
 *       recording every Terrain3D / World_Imagery response's STATUS and BYTE
 *       LENGTH per zoom per leg: a 4xx, or a 67-byte degenerate LERC, is the
 *       library correctly refusing to refine on data that is not there.
 *
 * Run: FLY_URL=http://localhost:3021 node scripts/r22p1-d-terra.js
 * Env: TERRA_SETTLE_MS (default 20000), TERRA_POSES (csv of lewis,powell,owens)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SETTLE_MS = +(process.env.TERRA_SETTLE_MS ?? 20000);
const WANT = (process.env.TERRA_POSES ?? 'lewis,powell,lewis2,owens').split(',');

/** Verbatim from verify-terra: same poses, same altitudes, same units (MSL). */
const POSES = {
  lewis: { name: 'P-LEWIS', lat: 40.2083, lon: -83.0701, altM: 400 },
  // B STUTTER's pose — the one that reads 17–18 on this tree. ~6 km SSW.
  powell: { name: 'POWELL (B)', lat: 40.1748, lon: -83.1079, altM: 515 },
  // A second visit to P-LEWIS in the SAME session: separates "cold arrival"
  // from "this place never refines".
  lewis2: { name: 'P-LEWIS (2nd visit)', lat: 40.2083, lon: -83.0701, altM: 400 },
  owens: { name: 'OWENS', lat: 36.601, lon: -118.06, altM: 500 },
};

const isImagery = (u) => /World_Imagery\/MapServer\/tile\/(\d+)\//.test(u);
const isDem = (u) => /Terrain3D\/ImageServer\/tile\/(\d+)\//.test(u);
const zOf = (u) => {
  const m = u.match(/\/tile\/(\d+)\//);
  return m ? +m[1] : null;
};

/** Slippy tile coords for a lon/lat at zoom z (Web Mercator, XYZ scheme). */
const tileOf = (lon, lat, z) => {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return { x, y };
};

const FREEZE = () => {
  const f = window.__fly.flight;
  if (!f.__frozen) {
    f.__frozen = true;
    f.step = () => {};
  }
};
const UNFREEZE = () => {
  const f = window.__fly.flight;
  delete f.step;
  delete f.__frozen;
};

/**
 * FOUR independent reads of "how deep is the tree under the aeroplane",
 * taken in ONE tick so they cannot disagree because of time.
 */
const PROBE = (want) => {
  const rt = window.__fly;
  const eng = rt?.engine;
  const f = rt?.flight;
  if (!eng || !f) return { err: 'no-runtime' };
  const g = eng.worldToGeo(f.pos);
  const lon = +g.x;
  const lat = +g.y;

  // (1) what verify-terra (2) reads
  const ga = eng.getGroundAt(lon, lat);

  // (2) what the engine publishes
  const ts = rt.terraStats ?? eng.terraStats ?? null;

  // (3) the TREE — every tile whose (z,x,y) contains this lon/lat, plus the
  // deepest leaf anywhere, plus the per-z resident population.
  let maxLeafZ = 0;
  const byZ = {};
  const chain = [];
  const wantKeys = new Set(want.map((t) => `${t.z}/${t.x}/${t.y}`));
  try {
    eng.object.traverse((o) => {
      if (!o.isTile) return;
      const leaf = o.children.filter((c) => c.isTile).length === 0;
      byZ[o.z] = (byZ[o.z] ?? 0) + 1;
      if (leaf && o.z > maxLeafZ) maxLeafZ = o.z;
      const k = `${o.z}/${o.x}/${o.y}`;
      if (wantKeys.has(k)) {
        chain.push({
          k,
          leaf,
          kids: o.children.filter((c) => c.isTile).length,
          vis: !!o.visible,
          showing: o.showing ?? null,
          loaded: o.loaded ?? null,
          inFrustum: o.inFrustum ?? null,
          geom: !!(o.geometry && o.geometry.attributes && o.geometry.attributes.position),
          verts: o.geometry?.attributes?.position?.count ?? 0,
          mat: Array.isArray(o.material) ? o.material.length : o.material ? 1 : 0,
        });
      }
    });
  } catch (e) {
    chain.push({ err: String(e) });
  }
  chain.sort((a, b) => (+a.k.split('/')[0] || 0) - (+b.k.split('/')[0] || 0));

  // (4) the StrictMode-suspect dev handle
  let handle = null;
  try {
    const h = window.__flyTerra?.get?.();
    handle = h ? { sizeZ0: h.sizeZ0 ?? null, same: window.__flyTerra?.engine === eng } : null;
  } catch {
    handle = { err: 'threw' };
  }

  return {
    lon: +lon.toFixed(5),
    lat: +lat.toFixed(5),
    altM: Math.round(f.pos.y),
    groundElev: Math.round(f.groundElev),
    aglM: Math.round(f.pos.y - f.groundElev),
    camTileZ: ga ? ga.tileZ : null,
    camElev: ga ? Math.round(ga.elev) : null,
    statsCamTileZ: ts ? ts.camTileZ : null,
    statsLod: ts ? (ts.lodThreshold ?? null) : null,
    maxLeafZ,
    byZ,
    chain,
    handle,
    lodThreshold: eng.map?.LODThreshold ?? null,
    maxZ: eng.map?.maxLevel ?? eng.map?.maxZoom ?? null,
    downloading: eng.downloading ?? null,
    tier: window.__flyStore?.getState?.().qualityTier ?? null,
    // the forward profile — A's frustum-immune statistic
    profile: (() => {
      try {
        const hdg = f.heading;
        const out = {};
        for (const km of [1, 2, 5]) {
          const dLat = (km * 1000 * Math.cos(hdg)) / 111320;
          const dLon =
            (km * 1000 * Math.sin(hdg)) / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
          const s = eng.getGroundAt(lon + dLon, lat + dLat);
          out[km] = s ? s.tileZ : null;
        }
        return out;
      } catch {
        return null;
      }
    })(),
  };
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(() => {
    // verify-terra's own arming: A TERRA's per-family override, not the fleet pin.
    window.__flyTerraForce = { sharp: true, pipe: true, cache: true };
  });

  /** Per-leg response census: status + byte length, by class and zoom. */
  let leg = 'boot';
  const wire = { boot: {} };
  const bump = (cls, z, status, len) => {
    const L = (wire[leg] ??= {});
    const k = `${cls}${z}`;
    const e = (L[k] ??= { n: 0, ok: 0, bad: 0, bytes: [], statuses: {} });
    e.n++;
    e.statuses[status] = (e.statuses[status] ?? 0) + 1;
    if (status >= 200 && status < 300) e.ok++;
    else e.bad++;
    if (e.bytes.length < 6) e.bytes.push(len);
  };
  page.on('response', async (r) => {
    const u = r.url();
    const cls = isImagery(u) ? 'img' : isDem(u) ? 'dem' : null;
    if (!cls) return;
    const z = zOf(u);
    let len = null;
    try {
      len = +(r.headers()['content-length'] ?? 0) || null;
    } catch {
      /* header read is best-effort */
    }
    bump(cls, z, r.status(), len);
  });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 19, 30);
  });

  const out = { legs: [], wire: null, errs: null };

  for (const key of WANT) {
    const P = POSES[key];
    if (!P) continue;
    leg = key;
    wire[leg] = {};
    await page.evaluate(UNFREEZE).catch(() => {});
    await page.evaluate(
      ([la, lo, al]) => window.__fly.warpToGeo(la, lo, { altM: al, name: null }),
      [P.lat, P.lon, P.altM]
    );
    await page.waitForTimeout(2500);
    await page.evaluate(FREEZE);

    const want = [];
    for (let z = 10; z <= 18; z++) want.push({ z, ...tileOf(P.lon, P.lat, z) });

    const trace = [];
    const t0 = Date.now();
    while (Date.now() - t0 < SETTLE_MS) {
      trace.push(await page.evaluate(PROBE, want));
      await page.waitForTimeout(1000);
    }
    const last = trace[trace.length - 1];
    console.log(
      `\n=== ${P.name} (${P.lat}, ${P.lon}, ${P.altM} m MSL) ==================`
    );
    console.log(
      `  camTileZ trace: ${trace.map((r) => r.camTileZ).join(',')}  ` +
        `| maxLeafZ: ${trace.map((r) => r.maxLeafZ).join(',')}`
    );
    console.log(
      `  settled: camTileZ=${last.camTileZ} statsCamTileZ=${last.statsCamTileZ} maxLeafZ=${last.maxLeafZ} ` +
        `AGL=${last.aglM} m (ground ${last.groundElev} m) lodThreshold=${last.lodThreshold} downloading=${last.downloading} tier=${last.tier}`
    );
    console.log(`  forward profile (km→leafZ): ${JSON.stringify(last.profile)}`);
    console.log(`  resident tiles per z: ${JSON.stringify(last.byZ)}`);
    console.log(`  containing-tile chain:`);
    for (const c of last.chain)
      console.log(
        `    ${c.k}  leaf=${c.leaf} kids=${c.kids} vis=${c.vis} showing=${c.showing} loaded=${c.loaded} verts=${c.verts} mats=${c.mat}`
      );
    console.log(`  __flyTerra handle: ${JSON.stringify(last.handle)}`);
    console.log(`  ESRI responses this leg: ${JSON.stringify(wire[leg])}`);
    out.legs.push({ pose: P, trace, wire: wire[leg] });
  }

  out.wire = wire;
  out.errs = errs;
  const dir = path.join(__dirname, '.probe-d-terra');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'terra.json'), JSON.stringify(out, null, 1));
  console.log(`\npageerrors: ${errs.length}`);
  console.log(`written ${path.join(dir, 'terra.json')}`);
  await browser.close();
})();

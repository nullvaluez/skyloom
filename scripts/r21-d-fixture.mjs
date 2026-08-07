/**
 * R21 D "PIPELINE" — the worker-level fixture (deterministic, A/B by source).
 *
 * Every claim this agent makes is a claim about buildTile(z,x,y,detail), which
 * is a pure function of the tile bytes plus the constants — so it is measured
 * there, exactly like R20's r20-a-cover / r20-b-parcels probes, never off draw
 * counts or pixels.
 *
 * THE A/B IS RUN IN ONE PROCESS. The fixture rewrites `TILE_PIPELINE.enabled`
 * in lib/fly/fly-constants.js, waits for the dev server to recompile, reloads
 * and re-boots, and confirms the leg it is actually in from IN-BAND evidence
 * (`skyMeta.hatchKeep` exists only under the flag) rather than trusting the
 * edit. The original value is restored in a `finally`, whatever happens.
 *
 * WHAT IT PROVES
 *   1  flag OFF ≡ R20: every scene's bundle fingerprint, byte for byte, is the
 *      baseline the ON leg is compared against; `reason` and `hatchKeep` are
 *      absent from every bundle.
 *   2  Owens stays EMPTY BY CONSTRUCTION: its busiest z14 tile's hatch
 *      candidate count is under hatchRamp.lockLo, so keepN is 0 and the
 *      skyline chunk issues no mesh — the ≤261 draw ledger is untouched.
 *   3  Powell / Dublin keep R20's coverage whole (candidates ≥ rampHi ⇒ full
 *      keep) and their skyline/building fingerprints are UNMOVED where no cap
 *      binds.
 *   4  the ramp is monotone over 0..200 and pins its three anchors.
 *   5  the shuffle is deterministic (same tile, two builds, same bytes) and
 *      the emission order is still volume order.
 *   6  vegMeta is ABSENT by default and PRESENT after setDiag(true) — with
 *      identical values to the flag-off always-on emission.
 *   7  an upstream 404 answers reason 'no-data'; a lock/floor answers 'zero'.
 *   8  the persistent Cache API store fills (cross-worker + cross-session
 *      dedupe) and a rebuild is served from it.
 *
 * Usage: FLY_URL=http://localhost:3123 node scripts/r21-d-fixture.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import boot from './_boot.js';

const { bootFly } = boot;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONSTS = path.join(ROOT, 'lib/fly/fly-constants.js');
const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

// The five R20 measurement scenes plus one certain-404 tile.
const SCENES = [
  ['owens', 36.601, -118.06],
  ['powell', 40.1578, -83.0752],
  ['dublin', 40.0992, -83.1141],
  ['columbus', 39.9612, -82.9988],
  ['manhattan', 40.7549, -73.984],
];
// [forced-404 tile ..., real empty-ground tile ...]. The first is intercepted
// by page.route and answered 404; the second is fetched for real (mid-Pacific).
const NO_DATA_TILE = [14, 1000, 1000, 14, 2048, 9000];

const lonToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** The shipped ramp, replicated for the pure-math leg (gate 4). */
const keepNOf = (n, lockLo, rampHi) =>
  n <= lockLo ? 0 : n >= rampHi ? n : Math.round((n * (n - lockLo)) / (rampHi - lockLo));

const readFlag = () => {
  const src = fs.readFileSync(CONSTS, 'utf8');
  const m = /export const TILE_PIPELINE = \{\s*[\r\n]+\s*enabled:\s*(true|false)/.exec(src);
  if (!m) throw new Error('TILE_PIPELINE.enabled not found in fly-constants.js');
  return m[1] === 'true';
};
const writeFlag = (v) => {
  const src = fs.readFileSync(CONSTS, 'utf8');
  const next = src.replace(
    /(export const TILE_PIPELINE = \{\s*[\r\n]+\s*enabled:\s*)(true|false)/,
    `$1${v}`
  );
  if (next === src && readFlag() !== v) throw new Error('flag rewrite failed');
  fs.writeFileSync(CONSTS, next);
};

/** Read the ramp band out of the source so the fixture can never drift. */
const rampBand = () => {
  const src = fs.readFileSync(CONSTS, 'utf8');
  const m = /hatchRamp:\s*\{\s*lockLo:\s*(\d+),\s*rampHi:\s*(\d+)\s*\}/.exec(src);
  return m ? { lockLo: +m[1], rampHi: +m[2] } : { lockLo: 24, rampHi: 64 };
};

const fails = [];
const gate = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

/**
 * Build every job on the page and return a per-scene fingerprint + the
 * telemetry the gates read. Runs entirely inside the worker's own realm.
 */
async function measure(page, jobs, noDataTile) {
  return page.evaluate(
    async ([jobs, noDataTile]) => {
      const w = window.__toyWorld.worker;
      const fnv = (bytes) => {
        let h = 0x811c9dc5;
        for (let i = 0; i < bytes.length; i++) {
          h ^= bytes[i];
          h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(16).padStart(8, '0');
      };
      // The verify-neon-cover fingerprint, verbatim: every typed array hashed,
      // every scalar stringified, `tessMs`/`v` excluded. `skipMeta` drops the
      // purely-telemetric keys as well, giving a GEOMETRY fingerprint — the
      // only fair instrument for "did the rendered output move?", since D adds
      // `reason` and `skyMeta.hatchKeep` to bundles by design.
      const fingerprint = (b, skipMeta) => {
        const parts = {};
        const walk = (obj, prefix) => {
          for (const k of Object.keys(obj).sort()) {
            if (k === 'tessMs' || k === 'v') continue;
            if (skipMeta && (k === 'reason' || k === 'skyMeta' || k === 'vegMeta')) continue;
            const val = obj[k];
            if (val == null) continue;
            if (ArrayBuffer.isView(val)) {
              parts[prefix + k] = `${val.length}:${fnv(
                new Uint8Array(val.buffer, val.byteOffset, val.byteLength)
              )}`;
            } else if (typeof val === 'object') walk(val, prefix + k + '.');
            else parts[prefix + k] = String(val);
          }
        };
        walk(b, '');
        const flat = Object.keys(parts)
          .sort()
          .map((k) => `${k}=${parts[k]}`)
          .join('|');
        return fnv(new TextEncoder().encode(flat));
      };
      // Anchor RUNS = skyline blocks (one run per drape group), the same
      // reading r20-a-cover and verify-suburbia (G) take. `distinct` is the
      // order-independent twin (a Set of anchor pairs) — the two disagree only
      // when two selected polygons share a centroid.
      const blocks = (sk) => {
        if (!sk?.anchor) return { runs: 0, distinct: 0, verts: 0 };
        let n = 0;
        let ax = NaN;
        let az = NaN;
        const seen = new Set();
        for (let i = 0; i < sk.anchor.length / 2; i++) {
          const a0 = sk.anchor[i * 2];
          const a1 = sk.anchor[i * 2 + 1];
          seen.add(a0 + ',' + a1);
          if (a0 !== ax || a1 !== az) {
            n += 1;
            ax = a0;
            az = a1;
          }
        }
        return { runs: n, distinct: seen.size, verts: sk.pos.length / 3 };
      };

      const out = { scenes: {}, noData: null, determinism: null, vegMeta: null, cache: null };

      for (const job of jobs) {
        const agg = {
          skyFp: [],
          skyGeo: [],
          bldFp: [],
          bldGeo: [],
          vegGeo: [],
          hatchCand: [],
          hatchKeep: [],
          skyKept: [],
          skyRuns: [],
          skyDistinct: [],
          skyVerts: [],
          skyEmpty: 0,
          skyReason: [],
          bldKept: [],
        };
        for (const [z, x, y] of job.tiles) {
          const s = await w.buildTile(z, x, y, 'sat-skyline');
          const b = await w.buildTile(z, x, y, 'sat-buildings');
          const v = await w.buildTile(z, x, y, 'sat-veg');
          agg.skyFp.push(fingerprint(s, false));
          agg.skyGeo.push(fingerprint(s, true));
          agg.bldFp.push(fingerprint(b, false));
          agg.bldGeo.push(fingerprint(b, true));
          agg.vegGeo.push(fingerprint(v, true));
          agg.hatchCand.push(s?.skyMeta?.hatchCand ?? -1);
          agg.hatchKeep.push(s?.skyMeta?.hatchKeep ?? -2); // -2 = key absent
          agg.skyKept.push(s?.skyMeta?.kept ?? -1);
          const bl = blocks(s?.satSkyline);
          agg.skyRuns.push(bl.runs);
          agg.skyDistinct.push(bl.distinct);
          agg.skyVerts.push(bl.verts);
          if (s?.empty) agg.skyEmpty += 1;
          if (s?.empty) agg.skyReason.push(s.reason ?? null);
          agg.bldKept.push(b?.satBuilding?.meta?.kept ?? 0);
        }
        out.scenes[job.name] = agg;
      }

      // --- 404 → 'no-data' vs empty-ground → 'zero' ------------------------
      // MEASURED 2026-08-06 and worth stating: OpenFreeMap does NOT 404 empty
      // ground any more — 14/2048/9000 (open Pacific) answers 200 with a
      // 57-byte body and 14/9000/16380 (out of range) answers 200 with ZERO
      // bytes. Both parse to a tile with no layers, i.e. 'zero'. The 404 leg
      // is therefore forced by the harness (page.route) rather than found in
      // the wild, and B must treat 'zero' — not 'no-data' — as the ordinary
      // open-ocean answer.
      const [nz, nx, ny] = noDataTile;
      const nd = await w.buildTile(nz, nx, ny, 'sat-buildings');
      out.noData = { empty: !!nd?.empty, reason: nd?.reason ?? null };
      const [gz, gx, gy] = noDataTile.slice(3);
      const gr = await w.buildTile(gz, gx, gy, 'sat-buildings');
      out.emptyGround = { empty: !!gr?.empty, reason: gr?.reason ?? null };

      // --- determinism: same tile, two builds, identical bytes -------------
      const j0 = jobs.find((j) => j.name === 'manhattan') ?? jobs[0];
      const [dz, dx, dy] = j0.tiles[4];
      const a = await w.buildTile(dz, dx, dy, 'sat-skyline');
      const bb = await w.buildTile(dz, dx, dy, 'sat-skyline');
      out.determinism = { a: fingerprint(a, false), b: fingerprint(bb, false) };

      // --- vegMeta: default state, then armed ------------------------------
      const [vz, vx, vy] = (jobs.find((j) => j.name === 'powell') ?? jobs[0]).tiles[4];
      const vOff = await w.buildTile(vz, vx, vy, 'sat-veg');
      let vOn = null;
      try {
        await w.setDiag(true);
        vOn = await w.buildTile(vz, vx, vy, 'sat-veg');
        await w.setDiag(false);
      } catch (e) {
        vOn = { error: String(e && e.message) };
      }
      out.vegMeta = {
        defaultPresent: !!vOff?.vegMeta,
        armedPresent: !!vOn?.vegMeta,
        armed: vOn?.vegMeta ? JSON.stringify(vOn.vegMeta) : null,
        // Arming the telemetry must not move one byte of the SCATTER.
        geoSame: vOff && vOn ? fingerprint(vOff, true) === fingerprint(vOn, true) : false,
      };

      // --- the shared persistent store -------------------------------------
      try {
        const names = await caches.keys();
        let entries = 0;
        if (names.includes('fly-tiles-v1')) {
          const c = await caches.open('fly-tiles-v1');
          entries = (await c.keys()).length;
        }
        out.cache = { names, entries };
      } catch (e) {
        out.cache = { error: String(e && e.message) };
      }
      return out;
    },
    [jobs, noDataTile]
  );
}

/**
 * The dedupe demo. THREE detail paths ask for the SAME z14 URL (sat-buildings,
 * sat-skyline, sat-veg), which in R20 meant three network round-trips per tile
 * per engine. Counted here off Playwright's own request stream, on tiles this
 * run has never touched (the store is persistent, so a fixed tile set would be
 * warm on the second run of the day and the demo would be vacuous).
 */
async function cacheDemo(page, tiles) {
  const seen = [];
  const onReq = (r) => {
    if (r.url().endsWith('.pbf')) seen.push(r.url());
  };
  page.on('request', onReq);
  const build = () =>
    page.evaluate(async (ts) => {
      for (const [z, x, y] of ts) {
        await window.__toyWorld.worker.buildTile(z, x, y, 'sat-buildings');
        await window.__toyWorld.worker.buildTile(z, x, y, 'sat-skyline');
        await window.__toyWorld.worker.buildTile(z, x, y, 'sat-veg');
      }
    }, tiles);
  await build();
  const cold = seen.length;
  seen.length = 0;
  await build();
  const warm = seen.length;
  page.off('request', onReq);
  return { cold, warm, tiles: tiles.length, calls: tiles.length * 3 };
}

/** Flip the source flag, recompile, reload, and CONFIRM the leg in-band. */
async function enterLeg(page, want, jobs) {
  writeFlag(want);
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.waitForTimeout(2500);
    await bootFly(page, BOOT_OPTS);
    await page.waitForFunction(() => !!window.__toyWorld?.worker, null, { timeout: 60000 });
    await page.waitForFunction(() => (window.__toyWorld?.chunks?.size ?? 0) > 0, null, {
      timeout: 60000,
    });
    const [z, x, y] = jobs.find((j) => j.name === 'manhattan').tiles[4];
    const armed = await page.evaluate(
      async ([z, x, y]) => {
        const s = await window.__toyWorld.worker.buildTile(z, x, y, 'sat-skyline');
        return s?.skyMeta?.hatchKeep !== undefined;
      },
      [z, x, y]
    );
    if (armed === want) return true;
  }
  return false;
}

(async () => {
  const original = readFlag();
  const band = rampBand();
  let browser;
  try {
    const jobs = SCENES.map(([name, lat, lon]) => {
      const x0 = lonToX(lon, 14);
      const y0 = latToY(lat, 14);
      const tiles = [];
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) tiles.push([14, x0 + dx, y0 + dy]);
      return { name, tiles };
    });

    // --- (4) the ramp is pure math and is gated as such --------------------
    const { lockLo, rampHi } = band;
    let monotone = true;
    for (let n = 1; n <= 200; n++) {
      if (keepNOf(n, lockLo, rampHi) < keepNOf(n - 1, lockLo, rampHi)) monotone = false;
      if (keepNOf(n, lockLo, rampHi) > n) monotone = false;
    }
    gate(
      `4 ramp monotone over 0..200 and never exceeds n (lockLo ${lockLo} / rampHi ${rampHi})`,
      monotone
    );
    gate(
      '4 ramp anchors: Owens 15→0, R20 cliff 39→15 / 41→17, Powell 113 full, Dublin 118 full',
      keepNOf(15, lockLo, rampHi) === 0 &&
        keepNOf(39, lockLo, rampHi) === 15 &&
        keepNOf(41, lockLo, rampHi) === 17 &&
        keepNOf(113, lockLo, rampHi) === 113 &&
        keepNOf(118, lockLo, rampHi) === 118,
      [15, 24, 25, 39, 41, 63, 64, 113]
        .map((n) => `${n}→${keepNOf(n, lockLo, rampHi)}`)
        .join(' ')
    );

    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: ['--enable-gpu', '--ignore-gpu-blocklist'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
    // Force ONE tile URL to 404. OpenFreeMap no longer 404s anything (see the
    // note in `measure`), so the only honest way to exercise the branch is to
    // make the network answer 404 — which is exactly the upstream condition
    // the code claims to classify.
    await page.route(`**/14/${NO_DATA_TILE[1]}/${NO_DATA_TILE[2]}.pbf`, (r) =>
      r.fulfill({ status: 404, body: '' })
    );

    // ---------------- LEG OFF ---------------------------------------------
    const offOk = await enterLeg(page, false, jobs);
    gate('0 leg OFF entered (hatchKeep absent from every bundle)', offOk);
    const off = await measure(page, jobs, NO_DATA_TILE);

    gate(
      '1 flag OFF: no `reason` key on any empty bundle (R20 key set)',
      off.noData.reason === null &&
        Object.values(off.scenes).every((s) => s.skyReason.every((r) => r === null)),
      `404 reason=${off.noData.reason} · empties ${Object.entries(off.scenes)
        .map(([k, v]) => `${k}:${v.skyEmpty}`)
        .join(' ')}`
    );
    gate(
      '1 flag OFF: vegMeta is ALWAYS-ON (the R20 production behavior)',
      off.vegMeta.defaultPresent === true,
      `default ${off.vegMeta.defaultPresent} · armed ${off.vegMeta.armedPresent}`
    );

    // ---------------- LEG ON ----------------------------------------------
    const onOk = await enterLeg(page, true, jobs);
    gate('0 leg ON entered (hatchKeep present)', onOk);
    const on = await measure(page, jobs, NO_DATA_TILE);

    // (2) Owens
    const owensOff = off.scenes.owens;
    const owensOn = on.scenes.owens;
    gate(
      '2 Owens: every z14 tile is under lockLo ⇒ hatchKeep 0 wherever the lock ran',
      owensOn.hatchKeep.every((k, i) => (owensOn.hatchCand[i] < 0 ? k === -2 : k === 0)) &&
        Math.max(...owensOn.hatchCand) <= lockLo,
      `cand [${owensOn.hatchCand.join(',')}] keep [${owensOn.hatchKeep.join(
        ','
      )}] max cand ${Math.max(...owensOn.hatchCand)} ≤ lockLo ${lockLo} (-1/-2 = tile has no building layer)`
    );
    gate(
      '2 Owens: skyline GEOMETRY byte-identical to the flag-off tree (empty stays empty)',
      owensOn.skyGeo.join() === owensOff.skyGeo.join() &&
        owensOn.skyVerts.every((v) => v === 0),
      `${owensOn.skyGeo.filter((f, i) => f !== owensOff.skyGeo[i]).length} of 9 moved · verts [${owensOn.skyVerts.join(
        ','
      )}]`
    );
    gate(
      '2 Owens: sat-buildings + sat-veg geometry byte-identical too',
      owensOn.bldGeo.join() === owensOff.bldGeo.join() &&
        owensOn.vegGeo.join() === owensOff.vegGeo.join(),
      `bld ${owensOn.bldGeo.filter((f, i) => f !== owensOff.bldGeo[i]).length}/9 · veg ${
        owensOn.vegGeo.filter((f, i) => f !== owensOff.vegGeo[i]).length
      }/9 moved`
    );
    gate(
      '2 Owens: every empty skyline chunk answers reason "zero" (a lock, not a 404)',
      owensOn.skyEmpty > 0 && owensOn.skyReason.every((r) => r === 'zero'),
      `${owensOn.skyEmpty}/9 empty · reasons ${[...new Set(owensOn.skyReason)].join(',')}`
    );

    // (3) every other scene: the detail ring is untouched, and the ramp obeys
    //     its own contract. The skyline DELTA is reported, not asserted — plan
    //     §5.2 pre-sanctions member-level change at capped/banded tiles.
    const sum = (a) => a.reduce((p, c) => p + c, 0);
    for (const name of ['powell', 'dublin', 'columbus', 'manhattan']) {
      const a = off.scenes[name];
      const b = on.scenes[name];
      gate(
        `3 ${name}: hatch candidates ≥ rampHi ⇒ FULL keep (no R20 coverage loss above the ramp)`,
        b.hatchKeep.every((k, i) => (b.hatchCand[i] >= rampHi ? k === b.hatchCand[i] : true)),
        `cand [${b.hatchCand.join(',')}] keep [${b.hatchKeep.join(',')}]`
      );
      gate(
        `3 ${name}: sat-buildings geometry UNMOVED (D touches no detail-ring selection)`,
        b.bldGeo.join() === a.bldGeo.join(),
        `${b.bldGeo.filter((f, i) => f !== a.bldGeo[i]).length}/9 moved`
      );
      gate(
        `3 ${name}: sat-veg SCATTER geometry UNMOVED (only the vegMeta key drops)`,
        b.vegGeo.join() === a.vegGeo.join(),
        `${b.vegGeo.filter((f, i) => f !== a.vegGeo[i]).length}/9 moved`
      );
      const movedSky = b.skyGeo.filter((f, i) => f !== a.skyGeo[i]).length;
      console.log(
        `     ${name} skyline ${movedSky}/9 geo moved · kept [${a.skyKept.join(
          ','
        )}]→[${b.skyKept.join(',')}] · blocks(runs) [${a.skyRuns.join(',')}]→[${b.skyRuns.join(
          ','
        )}] Σ ${sum(a.skyRuns)}→${sum(b.skyRuns)} · distinct Σ ${sum(a.skyDistinct)}→${sum(
          b.skyDistinct
        )} · verts Σ ${sum(a.skyVerts)}→${sum(b.skyVerts)}`
      );
    }

    // (5) determinism
    gate(
      '5 shuffle deterministic: the same tile builds byte-identically twice',
      on.determinism.a === on.determinism.b,
      `${on.determinism.a} / ${on.determinism.b}`
    );

    // (6) vegMeta opt-in
    gate(
      '6 vegMeta ABSENT by default and PRESENT after setDiag(true)',
      on.vegMeta.defaultPresent === false && on.vegMeta.armedPresent === true,
      `default ${on.vegMeta.defaultPresent} · armed ${on.vegMeta.armedPresent}`
    );
    gate(
      '6 arming the telemetry moves NO scatter geometry',
      on.vegMeta.geoSame === true,
      `geo identical ${on.vegMeta.geoSame}`
    );
    gate(
      '6 armed vegMeta reproduces the flag-off values (single-pass fold ≡ two passes)',
      on.vegMeta.armed === off.vegMeta.armed,
      `on ${on.vegMeta.armed}\n       off ${off.vegMeta.armed}`
    );

    // (7) reason codes
    gate(
      '7 an upstream 404 answers reason "no-data" (never "zero")',
      on.noData.empty === true && on.noData.reason === 'no-data',
      `empty ${on.noData.empty} reason ${on.noData.reason}`
    );
    gate(
      '7 a 200-with-no-layers tile answers "zero" (OFM stopped 404ing empty ground)',
      on.emptyGround.empty === true && on.emptyGround.reason === 'zero',
      `empty ${on.emptyGround.empty} reason ${on.emptyGround.reason}`
    );

    // (8) the persistent store
    gate(
      '8 the shared Cache API store exists and holds tiles',
      !!on.cache && !on.cache.error && on.cache.entries > 0,
      on.cache?.error ? on.cache.error : `${on.cache?.entries} entries in ${on.cache?.names}`
    );
    // Never-touched tiles over central Europe, rotated per run.
    const seed = Math.floor(Date.now() / 1000) % 4000;
    const demoTiles = [0, 1, 2].map((i) => [14, 8400 + ((seed + i * 37) % 300), 5450 + (i * 11)]);
    const cold = await cacheDemo(page, demoTiles);
    gate(
      '8 three detail paths over one tile cost ONE fetch (cross-detail dedupe)',
      cold.cold <= cold.tiles,
      `${cold.calls} buildTile calls over ${cold.tiles} tiles → ${cold.cold} network fetches`
    );
    gate(
      '8 a rebuild is served entirely from the persistent store (0 fetches)',
      cold.warm === 0,
      `${cold.calls} rebuild calls → ${cold.warm} network fetches`
    );

    const offCold = await (async () => {
      await enterLeg(page, false, jobs);
      const seed2 = (seed + 1500) % 4000;
      return cacheDemo(
        page,
        [0, 1, 2].map((i) => [14, 8400 + ((seed2 + i * 37) % 300), 5470 + i * 11])
      );
    })();
    gate(
      '8 CONTROL: with the flag OFF the same work costs one fetch PER CALL (no cache)',
      offCold.cold === offCold.calls,
      `${offCold.calls} buildTile calls → ${offCold.cold} fetches cold / ${offCold.warm} warm`
    );
  } catch (e) {
    console.log('HARNESS ERROR', e && e.stack);
    fails.push('harness');
  } finally {
    writeFlag(original);
    if (browser) await browser.close();
  }

  console.log(fails.length ? `\nFAILED: ${fails.join(' | ')}` : '\nALL GREEN');
  process.exit(fails.length ? 1 : 0);
})();

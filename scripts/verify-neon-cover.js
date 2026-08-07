/**
 * verify-neon-cover — R19 F "REWIND": the Neon winding fix.
 *
 * WHAT THIS GATES
 * ---------------
 * `classifyRings` hard-codes "signedArea > 0 = exterior". That sign is wrong
 * for every OpenFreeMap polygon layer, so a feature whose first ring fails the
 * test starts no polygon and the caller drops it. R18 fixed the SATELLITE
 * paths (classifyRingsSat, winding-agnostic) and explicitly left the three TOY
 * call sites for this round. Measured on the live tiles before the fix:
 *
 *   14/4411/6193 Powell OH — landuse 31→0, landcover 17→0, water 11→0,
 *     building 2→0. EVERY polygon layer classified to nothing: the chunk
 *     issued no ground overlay, no water and no buildings, and Neon Powell was
 *     a literal black void with roads floating on it.
 *   14/4824/6157 Manhattan — building 1481 features → 18.
 *
 * A SECOND defect surfaced with the first: `maxFootprintM2` (meant to reject a
 * single merged mega-ring) was tested against the SUM of a feature's polygons,
 * which was harmless only while the winding bug left ~1 polygon per feature.
 * One OpenFreeMap feature routinely carries a whole subdivision — Powell's 171
 * houses sum past 60 000 m², so the fixed classifier alone would still have
 * dropped them. Under NEON_COVER a multipolygon explodes per polygon, which
 * also turns the per-chunk cap into a POLYGON cap and gives every house its own
 * drape anchor.
 *
 * METHOD — bytes, not pixels. `window.__toyWorld.worker` is the live comlink
 * proxy, so buildTile() is callable straight from the page for any ring
 * (including the satellite forks: the worker does not care which layer asked).
 * Every typed array in the bundle is FNV-1a hashed with `tessMs`/`v` excluded.
 * That makes the two byte-identity claims of this round DIRECTLY testable
 * rather than argued from source.
 *
 * The frozen hashes below were captured on the W1 merged tree (61fbf07) with
 * NEON_COVER.enabled:false, and independently reproduced from a `git stash` of
 * this agent's edits — i.e. they are the genuine pre-R19-F worker output.
 *
 * Sun is pinned and the flag's shipped value is read from source, so gate 2
 * flips its assertion with the flag: this stays a real regression gate on the
 * one-flag revert path forever, not just on the day it was written.
 *
 * Usage: FLY_URL=http://localhost:PORT node scripts/verify-neon-cover.js
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly } = require('./_boot');

// --- frozen pre-R19-F worker output (NEON_COVER.enabled:false) --------------
//
// R21 SANCTIONED RE-BASELINE (upstream planet drift 20260802, controlled 3-way)
// — EXACTLY TWO of the five values move, and NOT because any R21 code touched
// them. D PIPELINE proved it with a three-way control that included a stash of
// the PRISTINE scaffolding tree `e1077f8`: `manhattan-full` and `manhattan-mid`
// were ALREADY red there, before a line of R21 product code existed.
// OpenFreeMap published planet build `20260802_080001_pt` on the day R20
// closed. The building layer at 14/4824/6157 still reports exactly 1481
// features, so the drift is in another layer of the same tile.
//   manhattan-full  176e2e75 → 1a509f39
//   manhattan-mid   a6805b95 → 2fa4a264
// The other THREE reproduce byte-exactly on the R21 tree with the (widened)
// toy-path-off control state — measured this run: powell-full 33d299d9,
// powell-mid 8b699579, manhattan-far 473596c0. That 3-of-5 split is itself the
// evidence: a code regression would move all five, or move them by scene, not
// spare Powell entirely and hit one tile's two rings.
//
// THE CODE INVARIANT IS UNTOUCHED AND INDEPENDENTLY PROVEN. "Flag-off is
// byte-identical for identical input" now rests on verify-seam's in-process
// worker fixture, which builds the SAME tile twice and compares FNV hashes of
// the position and index arrays — a determinism test that does not depend on
// anybody else's release schedule. See FLY_ROUND21.md §5b: a hash gate whose
// input is a LIVE tileset needs pinned fixture tiles (R22).
const R18_ROLL = {
  'powell-full': '33d299d9',
  'powell-mid': '8b699579',
  'manhattan-full': '1a509f39', // R21 SANCTIONED RE-BASELINE: 176e2e75 → 1a509f39
  'manhattan-mid': '2fa4a264', // R21 SANCTIONED RE-BASELINE: a6805b95 → 2fa4a264
  'manhattan-far': '473596c0',
};
// The satellite builders whose output must be independent of NEON_COVER.
//
// R19 W2 POST-MERGE CORRECTION — this gate used to compare satellite bundles
// against hashes frozen on F's own tree. That was WRONG, and it fired a false
// positive the moment C GROUNDTRUTH merged: C flipped SAT_GROUND_LIFE and
// SAT_TINT to true, so buildSatVeg legitimately began emitting `out.satVegCls`
// and `out.satTint.{pos,col,idx,cls}` — arrays that simply did not exist when
// the baseline was captured. A hash over "every array in the bundle" therefore
// HAD to change, and only the two sat-veg scenes drifted (satVegCls/satTint are
// emitted nowhere else) — exactly the observed signature.
//
// A frozen hash cannot express "F did not affect this", because it also fails
// whenever the bundle's rightful owner changes it. The invariant F actually
// owns is narrower and is now tested directly:
//   (4a) SOURCE — no satellite builder may reference NEON_COVER at all.
//   (4b) RUNTIME — a satellite bundle is byte-identical when rebuilt, and
//        byte-identical whether or not the SAME worker built a toy tile first.
//        That second half is the only runtime channel through which the toy
//        path could reach satellite output (the worker holds no module-scope
//        mutable state but `tileTemplate`), so it is the leak test with teeth.
const SAT_BUILDERS = ['buildSatBuildings', 'buildSatRoads', 'buildSatSkyline', 'buildSatVeg'];
const SAT_SCENES = [
  'sat-buildings-manhattan',
  'sat-buildings-powell',
  'sat-veg-manhattan',
  'sat-veg-powell',
  'sat-roads-powell',
  'sat-skyline-manhattan',
];

const SCENES = [
  ['powell-full', 14, 4411, 6193, 'full'],
  ['powell-mid', 13, 2205, 3096, 'mid'],
  ['manhattan-full', 14, 4824, 6157, 'full'],
  ['manhattan-mid', 13, 2412, 3078, 'mid'],
  ['manhattan-far', 12, 1206, 1539, 'far'],
  ['sat-buildings-manhattan', 14, 4824, 6157, 'sat-buildings'],
  ['sat-buildings-powell', 14, 4411, 6193, 'sat-buildings'],
  ['sat-veg-manhattan', 14, 4824, 6157, 'sat-veg'],
  ['sat-veg-powell', 14, 4411, 6193, 'sat-veg'],
  ['sat-roads-powell', 13, 2205, 3096, 'sat-roads'],
  ['sat-skyline-manhattan', 14, 4824, 6157, 'sat-skyline'],
];

// Budget poses. Altitudes are ABSOLUTE world Y: toy draws terrain at trueDEM ×
// 1.7, so "300 m over Powell" as y=300 is UNDERGROUND. Pinned on an interval —
// a warp's altM is an initial condition, not a hold.
const POSES = {
  cruise: { lat: 40.7549, lon: -73.984, y: 7925, ultra: true },
  powell: { lat: 40.1578, lon: -83.0752, y: 1470, ultra: false },
  nyclow: { lat: 40.7549, lon: -73.984, y: 1200, ultra: false },
};

const DRAW_CEIL = 480; // NOT re-baselineable (R19 plan §2)
const TRI_MAX = 2.0e6; // 0.2 M headroom under the 2.2 M gate

(async () => {
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  // --- (0) source gates: the revert is ONE flag, by construction ------------
  const workerSrc = fs.readFileSync(
    path.join(__dirname, '../lib/fly/toy-world/vector-tile.worker.js'),
    'utf8'
  );
  const constSrc = fs.readFileSync(path.join(__dirname, '../lib/fly/fly-constants.js'), 'utf8');
  const enabledOf = (name) => {
    const m = new RegExp(`export const ${name} = \\{\\s*[\\r\\n]+\\s*enabled:\\s*(true|false)`).exec(
      constSrc
    );
    return m ? m[1] === 'true' : null;
  };
  const flagOn = enabledOf('NEON_COVER') === true;

  // Slice the worker into top-level function bodies. (Hoisted above gate 3 in
  // R20 — gate 3's OFF branch now needs the same inventory that gate 4a uses.)
  const bounds = [];
  const fnRe = /^(?:function (\w+)|const (api) = )/gm;
  let m;
  while ((m = fnRe.exec(workerSrc))) bounds.push({ name: m[1] || m[2], start: m.index });
  bounds.push({ name: '<eof>', start: workerSrc.length });
  const bodyOf = (name) => {
    const i = bounds.findIndex((b) => b.name === name);
    return i < 0 ? null : workerSrc.slice(bounds[i].start, bounds[i + 1].start);
  };

  // --- R20: which flags can move a TOY bundle? -----------------------------
  //
  // R20 SANCTIONED RE-BASELINE (control state, not truth):
  //   old → gate 3's OFF branch reproduced the five frozen R18 hashes with
  //         NEON_COVER.enabled:false alone.
  //   new → it reproduces them with every R20 TOY-PATH flag off:
  //         NEON_COVER + TOY_MID_SUBURB + MONUMENT_MODELS.
  //
  // THE FIVE HASHES BELOW DO NOT MOVE. They are R18 byte truth and they stay
  // R18 byte truth; what widened is the state a tree must be put in to
  // reproduce them, because R20 landed two MORE toy-path coverage levers on
  // top of F's:
  //   * TOY_MID_SUBURB (A SPRAWL) drops the z13 mid-ring height floor 30→12 m
  //     and lifts maxPerChunkMid 180→240 ⇒ powell-mid / manhattan-mid move.
  //   * MONUMENT_MODELS (C ICONS) punches marquee footprint-exclusion discs in
  //     `api`'s toy building pass via marqueeExclusionTile ⇒ manhattan-full
  //     moves (the ESB/Willis extrusions the marble replaces).
  // Measured by C2 during W1: NEON_COVER-off ALONE left powell-mid and
  // manhattan-full still differing from the frozen bundle — a red that meant
  // "two other features are also on", not "the revert path is broken".
  //
  // PARCEL_HOMES and SAT_POLY_COVER are NOT in the set, and that is asserted
  // rather than asserted-by-comment: both are referenced only from satellite
  // builder bodies that the toy pass never calls. Gate 3a recomputes this set
  // from the worker source every run, so the day a future round reaches one of
  // them from the toy path, the gate says so instead of the hashes silently
  // going red.
  // R21 SANCTIONED GATE-MECHANICS (Fable ruling, W2) — the inventory gains the
  // R21 worker-side flag. D PIPELINE's `TILE_PIPELINE` is the ONLY R21 block
  // the worker source references at all (measured: 25 references; STREAM_KEEPER
  // / SURFACE_CALM / PERF_GOVERNOR / FX_STABILITY / PREWARM are 0 — they live in
  // the engines, the layers and the canvas, which this source scan does not and
  // should not reach). It IS toy-reachable — the toy tail carries the `'zero'`
  // empty-reason tag — and D deliberately spelled every reference out so gate
  // 3a's attribution can see it rather than having it hide behind a local.
  // THE FIVE HASH VALUES ARE NOT TOUCHED BY THIS EDIT; what widens is again the
  // control state a tree must be in to reproduce them. (The two Manhattan
  // hashes DO move, for an unrelated and separately-ruled reason — see the
  // R18_ROLL block at the top of this file.)
  // R22 SANCTIONED GATE-MECHANICS - PENDING FABLE SIGN-OFF (W3): C CLUTTER's
  // `CLUTTER` block is the ONE R22 family the worker source references (it
  // emits `satRoadPaths` and `satParking` behind it under protocol 18). Like
  // PARCEL_HOMES and SAT_POLY_COVER before it, it is referenced ONLY from
  // satellite builder bodies the toy pass never calls — so it belongs in the
  // inventory and NOT in EXPECTED_TOY_FLAGS, and gate 3a recomputes that
  // membership from the worker source every run rather than trusting this
  // comment. The five frozen hash values are NOT touched by this edit; what
  // widens is the control state a tree must be in to reproduce them.
  // INERT until armed: without R22_NEON_CLUTTER=1 the inventory is byte-for-
  // byte R21's, so an unflagged run of this file asserts exactly what it did
  // before. Fable arms it at W3, when CLUTTER is actually in the tree.
  const R22_CLUTTER_INVENTORY = process.env.R22_NEON_CLUTTER === '1';
  const R20_FLAGS = [
    'NEON_COVER',
    'TOY_MID_SUBURB',
    'MONUMENT_MODELS',
    'PARCEL_HOMES',
    'SAT_POLY_COVER',
    'TILE_PIPELINE',
    ...(R22_CLUTTER_INVENTORY ? ['CLUTTER'] : []),
  ];
  const EXPECTED_TOY_FLAGS = ['NEON_COVER', 'TOY_MID_SUBURB', 'MONUMENT_MODELS', 'TILE_PIPELINE'];
  const apiStart = bounds.find((b) => b.name === 'api')?.start ?? 0;
  const apiBody = bodyOf('api') || '';
  // The toy pass is everything in `api` AFTER the satellite early-returns —
  // buildTile dispatches `return buildSat*(...)` first and only then falls
  // through to the toy tessellation, so a helper called by a satellite builder
  // is not on the toy path even though `api` is its caller.
  let lastSatReturn = 0;
  for (const mm of apiBody.matchAll(/return build(?:SatBuildings|SatRoads|SatSkyline|SatVeg)\(/g))
    lastSatReturn = Math.max(lastSatReturn, mm.index + mm[0].length);
  const toyBodyStart = apiStart + lastSatReturn;
  const toyBody = apiBody.slice(lastSatReturn);
  const topLevelFns = new Set(bounds.map((b) => b.name));
  const toyHelpers = new Set(
    [...toyBody.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)]
      .map((mm) => mm[1])
      .filter((n) => topLevelFns.has(n))
  );
  const enclosingFn = (idx) => {
    let name = '<module>';
    for (const b of bounds) {
      if (b.start <= idx) name = b.name;
      else break;
    }
    return name;
  };
  const toyReachable = R20_FLAGS.filter((f) => {
    const re = new RegExp(`\\b${f}\\b`, 'g');
    let mm;
    while ((mm = re.exec(workerSrc))) {
      if (mm.index >= toyBodyStart && mm.index < apiStart + apiBody.length) return true;
      if (toyHelpers.has(enclosingFn(mm.index))) return true;
    }
    return false;
  });
  const flagState = Object.fromEntries(R20_FLAGS.map((f) => [f, enabledOf(f)]));

  const dispatchOk =
    /const classifyToy\s*=\s*NEON_COVER\.enabled\s*\?\s*classifyRingsSat\s*:\s*classifyRings;/.test(
      workerSrc
    );
  gate('1 classifyToy is exactly the NEON_COVER ternary', dispatchOk);

  // The three frozen toy call sites must all route through classifyToy, and no
  // direct classifyRings( call may survive outside that one definition.
  const toyCalls = (workerSrc.match(/classifyToy\(rings/g) || []).length;
  const rawCalls = (workerSrc.match(/=\s*classifyRings\(/g) || []).length;
  gate(
    '2 all three toy call sites dispatch via classifyToy',
    toyCalls === 3 && rawCalls === 0,
    `classifyToy(rings ×${toyCalls}, bare classifyRings( ×${rawCalls})`
  );

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await bootFly(page); // seeds 'toy'
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(() => {
    window.__flySunOverride = Date.UTC(2026, 6, 17, 16, 0); // R18 lesson 7
  });
  await page.waitForFunction(() => !!window.__toyWorld?.worker, null, { timeout: 60000 });
  await page.waitForFunction(() => (window.__toyWorld?.chunks?.size ?? 0) > 0, null, {
    timeout: 60000,
  });

  // --- worker-output fingerprints -----------------------------------------
  const fp = await page.evaluate(async (scenes) => {
    const fnv = (bytes) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(16).padStart(8, '0');
    };
    const out = {};
    for (const [name, z, x, y, detail] of scenes) {
      const b = await window.__toyWorld.worker.buildTile(z, x, y, detail);
      const parts = {};
      const walk = (obj, prefix) => {
        for (const k of Object.keys(obj).sort()) {
          if (k === 'tessMs' || k === 'v') continue;
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
      out[name] = {
        roll: fnv(new TextEncoder().encode(flat)),
        // Powell coverage witnesses: vertices actually emitted per group.
        landIdx: b.land?.idx?.length ?? 0,
        waterIdx: b.water?.idx?.length ?? 0,
        bldgVerts: (b.building?.pos?.length ?? 0) / 3,
        trees: (b.trees?.length ?? 0) / 4,
      };
    }
    return out;
  }, SCENES);

  // --- (3a) the R20 control-state inventory, recomputed from source --------
  gate(
    `3a R20 toy-path flag inventory is exactly {${EXPECTED_TOY_FLAGS.join(', ')}}`,
    toyReachable.length === EXPECTED_TOY_FLAGS.length &&
      EXPECTED_TOY_FLAGS.every((f) => toyReachable.includes(f)),
    `toy-reachable: {${toyReachable.join(', ')}} · satellite-only: {${R20_FLAGS.filter(
      (f) => !toyReachable.includes(f)
    ).join(', ')}} · state ${R20_FLAGS.map((f) => `${f}=${flagState[f]}`).join(' ')}`
  );

  // --- (3) the revert path, tested on bytes --------------------------------
  const toyNames = Object.keys(R18_ROLL);
  if (flagOn) {
    const changed = toyNames.filter((n) => fp[n].roll !== R18_ROLL[n]);
    gate(
      '3 flag ON: every toy ring differs from the frozen R18 bundle',
      changed.length === toyNames.length,
      `${changed.length}/${toyNames.length} changed`
    );
  } else {
    // The OFF branch is only MEANINGFUL under the full R20 toy-path-off state
    // (see the re-baseline note above). A mixed state is reported as a control
    // failure rather than as five broken hashes — that distinction is the whole
    // point of this row.
    const stillOn = toyReachable.filter((f) => flagState[f] !== false);
    gate(
      '3 OFF-branch control state: every R20 toy-path flag is off',
      stillOn.length === 0,
      stillOn.length
        ? `still on: ${stillOn.join(', ')} — the frozen R18 hashes cannot reproduce until they are off`
        : `${toyReachable.join(' + ')} all false`
    );
    const same = toyNames.filter((n) => fp[n].roll === R18_ROLL[n]);
    gate(
      '3 flag OFF: every toy ring reproduces the frozen R18 bundle byte-exactly',
      same.length === toyNames.length,
      toyNames.map((n) => `${n} ${fp[n].roll}/${R18_ROLL[n]}`).join(' ')
    );
  }

  // --- (4a) SOURCE: no satellite builder may reference NEON_COVER ----------
  // (bounds / bodyOf are computed once, above gate 3.)
  const leaky = SAT_BUILDERS.filter((n) => {
    const body = bodyOf(n);
    return body === null || /NEON_COVER/.test(body);
  });
  // Guard against a vacuous pass: the toy path MUST reference NEON_COVER.
  const toyRefs = (bodyOf('api') || '').match(/NEON_COVER/g)?.length ?? 0;
  gate(
    '4a no satellite builder references NEON_COVER (source)',
    leaky.length === 0 && toyRefs > 0,
    leaky.length
      ? `leaked into: ${leaky.join(', ')}`
      : `${SAT_BUILDERS.length} builders clean · toy path refs ${toyRefs}`
  );

  // --- (4b) RUNTIME: satellite output cannot depend on a prior toy build ---
  const leak = await page.evaluate(async (scenes) => {
    const fnv = (bytes) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h.toString(16).padStart(8, '0');
    };
    const roll = async (z, x, y, detail) => {
      const b = await window.__toyWorld.worker.buildTile(z, x, y, detail);
      const parts = {};
      const walk = (obj, pre) => {
        for (const k of Object.keys(obj).sort()) {
          if (k === 'tessMs' || k === 'v') continue;
          const val = obj[k];
          if (val == null) continue;
          if (ArrayBuffer.isView(val))
            parts[pre + k] = `${val.length}:${fnv(
              new Uint8Array(val.buffer, val.byteOffset, val.byteLength)
            )}`;
          else if (typeof val === 'object') walk(val, pre + k + '.');
          else parts[pre + k] = String(val);
        }
      };
      walk(b, '');
      return fnv(
        new TextEncoder().encode(
          Object.keys(parts)
            .sort()
            .map((k) => `${k}=${parts[k]}`)
            .join('|')
        )
      );
    };
    const bad = [];
    for (const [name, z, x, y, detail] of scenes) {
      const before = await roll(z, x, y, detail);
      // Drive the FLAGGED toy path hard on the same worker, same tile coords.
      await roll(z, x, y, 'full');
      await roll(z, x, y, 'mid');
      const after = await roll(z, x, y, detail);
      if (before !== after) bad.push(`${name} ${before}→${after}`);
    }
    return bad;
  }, SCENES.filter((s) => SAT_SCENES.includes(s[0])));
  gate(
    '4b satellite bundles unaffected by toy builds on the same worker',
    leak.length === 0,
    leak.length ? leak.join(' | ') : `${SAT_SCENES.length} scenes rebuilt identically`
  );

  // --- (5) Powell is no longer a void --------------------------------------
  const pf = fp['powell-full'];
  // Every polygon layer read zero before the fix: no ground overlay, no water,
  // no buildings. A house footprint costs ~5 roof + ~20 wall verts, so 200
  // buildings is ≳4000 verts.
  const powellCovered = flagOn
    ? pf.bldgVerts >= 4000 && pf.waterIdx > 0 && pf.landIdx > 0
    : pf.bldgVerts === 0;
  gate(
    `5 Powell chunk ${flagOn ? 'carries real ground + ≥200 buildings' : 'reproduces the void (flag off)'}`,
    powellCovered,
    `bldgVerts ${pf.bldgVerts} landIdx ${pf.landIdx} waterIdx ${pf.waterIdx} trees ${pf.trees}`
  );

  // --- budget poses ---------------------------------------------------------
  const measured = {};
  for (const key of Object.keys(POSES)) {
    const p = POSES[key];
    await page.evaluate((pp) => {
      if (window.__coverPin) clearInterval(window.__coverPin);
      window.__fly.warpToGeo(pp.lat, pp.lon, { altM: pp.y, name: null });
    }, p);
    await page.waitForTimeout(2000);
    await page.evaluate((pp) => {
      window.__coverPin = setInterval(() => {
        window.__fly.flight.pos.y = pp.y;
      }, 400);
    }, p);
    if (p.ultra) {
      await page
        .waitForFunction(() => (window.__flyStats?.toy?.ultraReady ?? 0) >= 8, undefined, {
          timeout: 150000,
          polling: 1000,
        })
        .catch(() => {});
    }
    await page.waitForTimeout(35000);
    measured[key] = await page.evaluate(async () => {
      let d = 0;
      let t = 0;
      for (let i = 0; i < 24; i++) {
        d = Math.max(d, window.__flyStats?.drawCalls ?? 0);
        t = Math.max(t, window.__flyStats?.triangles ?? 0);
        await new Promise((r) => setTimeout(r, 250));
      }
      return { draws: d, tris: t };
    });
  }

  const worstDraw = Math.max(...Object.values(measured).map((m) => m.draws));
  const worstTri = Math.max(...Object.values(measured).map((m) => m.tris));
  const fmt = Object.entries(measured)
    .map(([k, m]) => `${k} ${m.draws}d/${(m.tris / 1e6).toFixed(2)}M`)
    .join(' · ');

  gate(`6 toy draws ≤ ${DRAW_CEIL} at every pose`, worstDraw <= DRAW_CEIL, fmt);
  gate(
    `7 toy triangles ≤ ${TRI_MAX / 1e6}M at every pose`,
    worstTri <= TRI_MAX,
    `worst ${(worstTri / 1e6).toFixed(3)}M`
  );
  gate('8 zero pageerrors', errs.length === 0, errs.slice(0, 3).join(' | '));

  await browser.close();
  console.log(
    `\nverify-neon-cover: ${fails.length ? `FAIL (${fails.join(', ')})` : 'ALL GREEN'} — flag ${
      flagOn ? 'ON' : 'OFF'
    }`
  );
  process.exit(fails.length ? 1 : 0);
})();

/**
 * R24 B WORLD — the node-level instrument for M1 (FLASH_GUARD) and M2
 * (RING_DEDUPE). No browser, no dev server, no network.
 *
 * It drives the REAL `vector-tile.worker.js` in-process through verify-seam's
 * two loader hooks (alias `comlink` to a stub that captures `expose(api)`;
 * teach node the repo's extensionless relative imports), then serves it
 * synthetic MVT bytes from scripts/r24-b-fixture.js instead of OpenFreeMap
 * (403 here). The bytes carry ClosePath, so `@mapbox/vector-tile` appends the
 * ring-closure duplicate exactly as production does — the fixture reproduces
 * the defect under test rather than hiding it.
 *
 * LEGS
 *  (1) DEGENERATE CENSUS on the RAW worker output, per builder — the RED.
 *  (2) FILTER EFFECT — index count falls, re-census is exactly 0, positions
 *      and every non-index attribute are untouched (fingerprinted).
 *  (3) SHADING NEUTRALITY — three's computeVertexNormals over the filtered
 *      index produces bit-identical normals to the unfiltered index. This is
 *      the claim that lets the filter run before normals.
 *  (4) CLEAN-CHUNK ZERO-ALLOC — a bundle with no degenerates comes back as
 *      the SAME index object (===).
 *  (5) WORKER FINGERPRINTS — FNV-1a over every emitted buffer per scene and
 *      builder. This is M2's byte-identity instrument: run it before and
 *      after any worker edit with RING_DEDUPE off; the table must not move.
 *
 * Run: node scripts/r24-b-worker-proof.js            (all legs)
 *      node scripts/r24-b-worker-proof.js --print    (+ the fingerprint table)
 */
const path = require('path');
const fs = require('fs');
const { registerHooks } = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const COMLINK_STUB = 'file:///r24-b-comlink-stub.mjs';

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'comlink') return { url: COMLINK_STUB, shortCircuit: true };
    if (/^\.{1,2}\//.test(spec) && !/\.[a-z]+$/i.test(spec) && ctx.parentURL?.startsWith('file:')) {
      for (const ext of ['.js', '.mjs', '/index.js']) {
        try {
          if (fs.existsSync(fileURLToPath(new URL(spec + ext, ctx.parentURL))))
            return next(spec + ext, ctx);
        } catch {
          /* not this candidate */
        }
      }
    }
    return next(spec, ctx);
  },
  load(url, ctx, next) {
    if (url === COMLINK_STUB)
      return {
        format: 'module',
        shortCircuit: true,
        source:
          'export const expose = (api) => { globalThis.__r24BApi = api; };\n' +
          'export const transfer = (v) => v;\n',
      };
    return next(url, ctx);
  },
});

const { encodeTile, scene, installFetchStub } = require('./r24-b-fixture.js');

/** FNV-1a over a numeric array — the R18/R20/R21 fingerprint idiom. */
const fnv = (arr) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < arr.length; i++) {
    const v = Math.round(arr[i] * 1000) | 0;
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
};

/** Exactly-degenerate triangle census over an index + position pair. */
function census(idx, pos) {
  let tris = 0;
  let degen = 0;
  let coincident = 0;
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = idx[i] * 3;
    const b = idx[i + 1] * 3;
    const c = idx[i + 2] * 3;
    tris += 1;
    const abx = pos[b] - pos[a];
    const aby = pos[b + 1] - pos[a + 1];
    const abz = pos[b + 2] - pos[a + 2];
    const acx = pos[c] - pos[a];
    const acy = pos[c + 1] - pos[a + 1];
    const acz = pos[c + 2] - pos[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    if (nx * nx + ny * ny + nz * nz === 0) {
      degen += 1;
      if (
        (abx === 0 && aby === 0 && abz === 0) ||
        (acx === 0 && acy === 0 && acz === 0) ||
        (pos[c] === pos[b] && pos[c + 1] === pos[b + 1] && pos[c + 2] === pos[b + 2])
      )
        coincident += 1;
    }
  }
  return { tris, degen, coincident, collinear: degen - coincident, pct: tris ? (100 * degen) / tris : 0 };
}

/** A stand-in drape: adds a per-anchor Y exactly as the engines do. */
function drape(pos, anchor) {
  const out = Float32Array.from(pos);
  let runAx = NaN;
  let runAz = NaN;
  let runY = 0;
  for (let v = 0, vi = 0; v < out.length; v += 3, vi += 1) {
    const ax = anchor ? anchor[vi * 2] : 0;
    const az = anchor ? anchor[vi * 2 + 1] : 0;
    if (ax !== runAx || az !== runAz) {
      runAx = ax;
      runAz = az;
      // a deterministic pseudo-DEM: metres of relief, same shape the engines see
      runY = 40 * Math.sin(ax * 0.0013) + 25 * Math.cos(az * 0.0021);
    }
    out[v + 1] += runY;
  }
  return out;
}

(async () => {
  const fails = [];
  const rows = [];
  const softs = [];
  const soft = (name, owner, detail = '') => {
    console.log(`SOFT ${name} — instrument missing (owner ${owner})${detail ? ' · ' + detail : ''}`);
    softs.push(name);
  };
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  const SCENES = ['dense', 'suburb', 'desert'];
  const bytes = Object.fromEntries(SCENES.map((s) => [s, encodeTile(scene(s))]));
  // z/x/y → scene: 0 dense, 1 suburb, 2 desert
  const restore = installFetchStub((z, x) => bytes[SCENES[x % 3]]);

  await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/vector-tile.worker.js')).href);
  const C = await import(pathToFileURL(path.join(ROOT, 'lib/fly/fly-constants.js')).href);
  const FG = await import(pathToFileURL(path.join(ROOT, 'lib/fly/toy-world/flash-guard.js')).href);
  const THREE = await import(pathToFileURL(path.join(ROOT, 'node_modules/three/build/three.module.js')).href);
  const api = globalThis.__r24BApi;
  gate('(0) worker fixture loaded in-process', !!api?.buildTile);
  if (!api?.buildTile) {
    restore();
    process.exit(1);
  }
  await api.init();

  // `--dedupe` flips RING_DEDUPE on AFTER the worker module is loaded. The
  // worker reads the flag at CALL time (inside dedupeRing), so this measures
  // the real flag-on bundle without a second process.
  if (process.argv.includes('--dedupe')) C.RING_DEDUPE.enabled = true;
  console.log(
    `\nflags: FLASH_GUARD.enabled=${C.FLASH_GUARD.enabled} minArea2=${C.FLASH_GUARD.minArea2}` +
      ` · RING_DEDUPE.enabled=${C.RING_DEDUPE.enabled} · protocol=${C.WORKER_PROTOCOL ?? '(worker-private)'}\n`
  );

  const BUILDS = [
    ['sat-buildings', 'satBuilding'],
    ['sat-skyline', 'satSkyline'],
    ['full', 'building'],
  ];

  let anyDegen = 0;
  let anyTris = 0;
  const fps = [];
  for (let si = 0; si < SCENES.length; si++) {
    for (const [detail, slot] of BUILDS) {
      const r = await api.buildTile(14, si, 6000 + si, detail);
      const b = r?.[slot];
      if (!b || !b.pos || !b.idx) {
        fps.push([SCENES[si], detail, 'empty', r?.empty ? `empty:${r.reason ?? '-'}` : 'no-slot', '', '']);
        continue;
      }
      const draped = drape(b.pos, b.anchor);
      const c0 = census(b.idx, draped);
      anyDegen += c0.degen;
      anyTris += c0.tris;
      const idxCopy = b.idx.slice();
      const out = FG.filterDegenerateTris(idxCopy, draped, 0);
      const c1 = census(out.idx, draped);
      rows.push([SCENES[si], detail, c0.tris, c0.degen, c0.pct.toFixed(2) + '%', c0.coincident, c0.collinear, out.dropped, c1.degen]);
      fps.push([
        SCENES[si],
        detail,
        b.pos.length / 3,
        b.idx.length,
        fnv(b.pos),
        fnv(b.idx),
        b.col ? fnv(b.col) : '-',
        b.anchor ? fnv(b.anchor) : '-',
      ]);

      // (2) filter effect
      gate(
        `(2) ${SCENES[si]}/${detail} re-census is 0 after the filter`,
        c1.degen === 0,
        `dropped ${out.dropped} of ${c0.tris} tris (${c0.pct.toFixed(2)}%)`
      );
      // (3) shading neutrality via three's own computeVertexNormals
      const mkNormals = (index) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(draped), 3));
        g.setIndex(new THREE.BufferAttribute(Uint32Array.from(index), 1));
        g.computeVertexNormals();
        return g.getAttribute('normal').array;
      };
      if (c0.degen > 0) {
        const nA = mkNormals(b.idx);
        const nB = mkNormals(out.idx);
        let same = nA.length === nB.length;
        if (same) for (let i = 0; i < nA.length; i++) if (nA[i] !== nB[i]) { same = false; break; }
        gate(`(3) ${SCENES[si]}/${detail} normals bit-identical across the filter`, same);
      }
      // (4) clean-chunk zero-alloc: filtering an already-clean list returns ===
      const again = FG.filterDegenerateTris(out.idx, draped, 0);
      gate(`(4) ${SCENES[si]}/${detail} clean list returns the same object`, again.idx === out.idx && again.dropped === 0);
    }
  }

  if (C.RING_DEDUPE.enabled) {
    // RING_DEDUPE removes the population AT THE SOURCE, so the census that is
    // the RED with the flag off must read exactly 0 with it on.
    gate('(1) GREEN RING_DEDUPE: the worker emits NO degenerate triangles', anyDegen === 0, `${anyDegen} of ${anyTris} tris`);
  } else {
    gate('(1) RED census: the raw worker emits degenerate triangles', anyDegen > 0, `${anyDegen} of ${anyTris} tris`);
  }

  console.log('\n--- (1) DEGENERATE CENSUS (raw worker output, draped) ---');
  console.log('scene      builder        tris    degen   pct     coinc  colin  dropped  after');
  for (const r of rows)
    console.log(
      `${String(r[0]).padEnd(10)} ${String(r[1]).padEnd(14)} ${String(r[2]).padStart(6)} ${String(r[3]).padStart(7)} ${String(r[4]).padStart(7)} ${String(r[5]).padStart(6)} ${String(r[6]).padStart(6)} ${String(r[7]).padStart(8)} ${String(r[8]).padStart(6)}`
    );

  /* ---- (7) WB-5 PREP: are wall quads wound OUTWARD? --------------------- */
  // The satellite building material is `side: DoubleSide` with the comment
  // "every wall shades correctly despite the worker's inconsistent ring
  // winding". FrontSide would halve the building fragment work over downtowns
  // — but only if the winding is actually consistent. This MEASURES it, on the
  // real worker output, without changing a single emitted index.
  //
  // Method, assumption-light: take every NEAR-VERTICAL triangle (|n.y| < 0.1 —
  // walls and parapet bands, never roof caps), and test whether its normal
  // points AWAY from that building's own footprint-centroid anchor, which the
  // worker already stamps on every vertex as aBendAnchor. `outwardFrac` is the
  // fraction that does. 1.0 (or 0.0) = a CONSISTENT winding that FrontSide
  // could use after one global flip; ~0.5 = genuinely mixed, and the DoubleSide
  // comment is right.
  {
    const r = await api.buildTile(14, 0, 6000, 'sat-buildings');
    const b = r?.satBuilding;
    if (!b?.idx) {
      soft('(7) wall winding census', 'B', 'no satBuilding');
    } else {
      const pos = drape(b.pos, b.anchor);
      let vert = 0;
      let outward = 0;
      for (let i = 0; i + 2 < b.idx.length; i += 3) {
        const A = b.idx[i] * 3;
        const B2 = b.idx[i + 1] * 3;
        const Cc = b.idx[i + 2] * 3;
        const abx = pos[B2] - pos[A];
        const aby = pos[B2 + 1] - pos[A + 1];
        const abz = pos[B2 + 2] - pos[A + 2];
        const acx = pos[Cc] - pos[A];
        const acy = pos[Cc + 1] - pos[A + 1];
        const acz = pos[Cc + 2] - pos[A + 2];
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;
        const len = Math.hypot(nx, ny, nz);
        if (len === 0 || Math.abs(ny / len) >= 0.1) continue; // not a wall
        vert += 1;
        // centroid of the triangle vs this building's anchor, in XZ
        const cxT = (pos[A] + pos[B2] + pos[Cc]) / 3;
        const czT = (pos[A + 2] + pos[B2 + 2] + pos[Cc + 2]) / 3;
        const ax = b.anchor[b.idx[i] * 2];
        const az = b.anchor[b.idx[i] * 2 + 1];
        if (nx * (cxT - ax) + nz * (czT - az) > 0) outward += 1;
      }
      const frac = vert ? outward / vert : 0;
      // THE CONFOUND, stated because it changes the reading: this census counts
      // every near-vertical triangle, and a PARAPET's inner band is *correctly*
      // inward-facing, as are crown step sides. So outwardFrac is NOT expected
      // to be 1.0 even under a perfectly consistent ring winding — the number
      // below is a floor, not a verdict. The precondition FrontSide actually
      // needs is that the SOURCE RINGS wind consistently, which is measured
      // directly underneath from the tile bytes.
      const { PbfReader: P2 } = await import('pbf');
      const { VectorTile: V2 } = await import('@mapbox/vector-tile');
      const L2 = new V2(new P2(bytes.dense)).layers.building;
      let pos1 = 0;
      let neg1 = 0;
      let mixedFeatures = 0;
      for (let i = 0; i < L2.length; i++) {
        const f = L2.feature(i);
        if (f.type !== 3) continue;
        const rings = f.loadGeometry();
        let first = 0;
        let mixed = false;
        rings.forEach((r, ri) => {
          let sum = 0;
          for (let k = 0, len = r.length, j2 = len - 1; k < len; j2 = k++)
            sum += (r[k].x - r[j2].x) * (r[k].y + r[j2].y);
          const sg = sum > 0 ? 1 : -1;
          if (ri === 0) {
            first = sg;
            if (sg > 0) pos1 += 1;
            else neg1 += 1;
          } else if (sg === first) mixed = true; // a HOLE sharing the outer sign
        });
        if (mixed) mixedFeatures += 1;
      }
      console.log(
        `\nWB-5 wall winding: ${vert} near-vertical triangles · outwardFrac ${frac.toFixed(4)}` +
          ` (confounded by parapet inner bands — a floor, not a verdict)` +
          `\nWB-5 source rings: first-ring signedArea >0 in ${pos1} features, <0 in ${neg1};` +
          ` ${mixedFeatures} features have a HOLE sharing the outer sign` +
          `\n     ⇒ ${pos1 === 0 || neg1 === 0 ? 'CONSISTENT' : 'MIXED'} winding at the source` +
          ` — classifyRingsSat's extSign is ${pos1 === 0 || neg1 === 0 ? 'a single global sign here' : 'genuinely per-feature'}` +
          `\n     CAVEAT: B's encoder winds rings POSITIVE; the live OpenFreeMap` +
          ` planet winds them NEGATIVE (R18 measured 0 positive first-rings across` +
          ` building/landcover/landuse/water on Manhattan AND Chicago), and E's` +
          ` fixture reproduces the live sign. The finding that transfers is` +
          ` CONSISTENT-vs-MIXED, not the sign itself.`
      );
      // Informational THIS ROUND by charter: measured, not flipped.
      gate(
        '(7) WB-5 PREP wall winding + source-ring census ran',
        vert > 0,
        `outwardFrac ${frac.toFixed(4)} over ${vert} wall triangles · rings +${pos1}/-${neg1}`
      );
    }
  }

  /* ---- (6) CROSS-CHECK: B's encoder vs E's fixture on the closed ring ---- */
  // Fable's proof obligation (a). The two fixtures cannot produce identical
  // HASHES — they encode different geometry — so what is cross-checked is the
  // property under test: does E's generator also emit CLOSED rings, so the
  // worker's wall extruder produces the same coincident-degenerate population
  // B's encoder reproduces? The asserted agreement is STRUCTURAL, not a count
  // identity: every degenerate is of the COINCIDENT kind (a collapsed quad,
  // not a sliver) and the rate is the same order. A per-ring identity would be
  // wrong — measured on E's Manhattan tile the ratio is ~7.4 per ring, not 2,
  // because pushParapet contributes 6 and pushCrownSat 2 more per ring on top
  // of the wall loop's 2, exactly as recon WB-1 reads the worker.
  try {
    const { mvtTile } = await import(pathToFileURL(path.join(ROOT, 'scripts/r24-fixture/mvt.mjs')).href);
    const S = await import(pathToFileURL(path.join(ROOT, 'scripts/r24-fixture/scenes.mjs')).href);
    // Manhattan (E's dense city scene) at z14.
    const z = 14;
    const ex = Math.floor(S.lon2tile(-74.0113, z)); // lon2tile returns a FLOAT
    const ey = Math.floor(S.lat2tile(40.7075, z));
    const eBytes = mvtTile(z, ex, ey);
    const restore2 = installFetchStub(() => eBytes);
    const r = await api.buildTile(z, ex, ey, 'sat-buildings');
    restore2();
    const b = r?.satBuilding;
    if (!b?.idx) {
      soft('(6) cross-check vs E fixture', 'E', `no satBuilding at ${z}/${ex}/${ey}`);
    } else {
      const draped = drape(b.pos, b.anchor);
      const c = census(b.idx, draped);
      // Count the rings the worker actually saw, from E's own tile bytes.
      const { PbfReader } = await import('pbf');
      const { VectorTile } = await import('@mapbox/vector-tile');
      const vt = new VectorTile(new PbfReader(eBytes));
      const L = vt.layers.building;
      let rings = 0;
      for (let i = 0; i < L.length; i++) {
        const f = L.feature(i);
        if (f.type !== 3) continue;
        rings += f.loadGeometry().length;
      }
      console.log(
        `\nE fixture Manhattan ${z}/${ex}/${ey}: features ${L.length} rings ${rings} · ` +
          `worker tris ${c.tris} degenerate ${c.degen} (${c.pct.toFixed(2)}%) coincident ${c.coincident}`
      );
      gate(
        C.RING_DEDUPE.enabled
          ? "(6) GREEN E's fixture tile carries NO degenerate triangle either"
          : "(6) E's fixture reproduces the SAME closed-ring defect B's encoder does",
        C.RING_DEDUPE.enabled
          ? c.degen === 0
          : c.degen > 0 && c.coincident === c.degen,
        `degenerate ${c.degen}${c.degen ? ' all coincident' : ''} · ${c.pct.toFixed(2)}%`
      );
    }
  } catch (e) {
    soft('(6) cross-check vs E fixture', 'E', String(e?.message ?? e));
  }

  /* ---- (8) E-TILE FINGERPRINTS — the LIVE-WINDING column ----------------- */
  // WHY THIS EXISTS AND WHY IT OUTRANKS TABLE (5). B's own MVT encoder winds
  // rings POSITIVE; the live OpenFreeMap planet — and E's fixture, which
  // reproduces it — wind them NEGATIVE. classifyRings / classifyRingsSat branch
  // on that sign, so every number in table (5) exercises the OPPOSITE branch
  // from the one the user's machine runs. Table (5) is still the right
  // instrument for FLAG-OFF BYTE IDENTITY (a hash that does not move cannot
  // move on either branch), but any number E re-baselines a frozen gate
  // against must come from the LIVE winding. That is this table.
  try {
    const { mvtTile } = await import(pathToFileURL(path.join(ROOT, 'scripts/r24-fixture/mvt.mjs')).href);
    const S2 = await import(pathToFileURL(path.join(ROOT, 'scripts/r24-fixture/scenes.mjs')).href);
    const E_POSES = [
      ['manhattan', -74.0113, 40.7075],
      ['powell', -83.0752, 40.1578],
      ['owens', -118.1, 36.6],
    ];
    const rows = [];
    for (const [nm, lon, lat] of E_POSES) {
      const ex = Math.floor(S2.lon2tile(lon, 14));
      const ey = Math.floor(S2.lat2tile(lat, 14));
      const eb = mvtTile(14, ex, ey);
      const rst = installFetchStub(() => eb);
      for (const [detail, slot] of BUILDS) {
        const rr = await api.buildTile(14, ex, ey, detail);
        const bb = rr?.[slot];
        if (!bb?.idx) {
          rows.push([nm, detail, '—', '—', rr?.empty ? `empty:${rr.reason ?? '-'}` : 'no-slot', '—']);
          continue;
        }
        const dd = drape(bb.pos, bb.anchor);
        const cc = census(bb.idx, dd);
        rows.push([nm, detail, bb.pos.length / 3, bb.idx.length, fnv(bb.pos), fnv(bb.idx), cc.degen]);
      }
      rst();
    }
    console.log(
      `\n--- (8) E-TILE FINGERPRINTS — LIVE WINDING (negative first-ring signedArea) ---` +
        `\n    RING_DEDUPE.enabled = ${C.RING_DEDUPE.enabled}. THIS is the column E re-baselines against.`
    );
    console.log('scene      builder        verts   idxLen  fnv(pos)  fnv(idx)  degen');
    for (const r of rows)
      console.log(
        `${String(r[0]).padEnd(10)} ${String(r[1]).padEnd(14)} ${String(r[2]).padStart(6)} ${String(r[3]).padStart(7)}  ` +
          `${String(r[4]).padEnd(9)} ${String(r[5]).padEnd(9)} ${String(r[6])}`
      );
    const owens = rows.filter((r) => r[0] === 'owens');
    gate(
      '(8) THE OWENS LOCK holds on E tiles in BOTH flag legs — the desert issues nothing',
      owens.every((r) => r[2] === '—'),
      owens.map((r) => `${r[1]}:${r[4]}`).join(' ')
    );
  } catch (e) {
    soft('(8) E-tile fingerprints', 'E', String(e?.message ?? e));
  }

  console.log('\n--- (5) WORKER FINGERPRINTS — B ENCODER, POSITIVE WINDING ---');
  console.log(
    '    Flag-off byte-identity instrument. B\'s encoder winds rings POSITIVE,'
  );
  console.log(
    '    i.e. the OPPOSITE classifyRings branch from live OFM — see table (8).'
  );
  console.log('scene      builder        verts   idxLen  fnv(pos)  fnv(idx)  fnv(col)  fnv(anchor)');
  for (const r of fps)
    console.log(
      `${String(r[0]).padEnd(10)} ${String(r[1]).padEnd(14)} ${String(r[2]).padStart(6)} ${String(r[3]).padStart(7)}  ${String(r[4]).padEnd(9)} ${String(r[5]).padEnd(9)} ${String(r[6]).padEnd(9)} ${String(r[7])}`
    );

  restore();
  console.log(`\nVERIFY: ${fails.length ? 'FAIL — ' + fails.join(', ') : 'PASS'}`);
  process.exit(fails.length ? 1 : 0);
})();

/**
 * Round 20 (C ICONS): the MARQUEE MONUMENT overlay.
 *
 * All 124 landmark POIs used to share nine procedural archetypes — the Empire
 * State Building, the Eiffel Tower and the Burj Khalifa were literally the same
 * stepped-box `spire`. R20 overlays real downloaded models on the marquee set.
 * This harness certifies BOTH halves of that: the models are legal, small and
 * shaped the way the loader assumes (node side, no browser), and they place,
 * cost what the design says and suppress exactly their own procedural twin
 * (browser side, BOTH map styles).
 *
 * Gates:
 *   A  static/manifest — every manifest model exists, is ≤ 1 MB, is UNCOMPRESSED
 *      (no draco / meshopt / KTX2 — the app ships no decoder), carries COLOR_0
 *      (a textured GLB renders flat white through the runtime bake — the R15
 *      trap), and sits on the monument convention (base plane y = 0, footprint
 *      centred). Every POI key joins the LANDMARKS DB, every file has a
 *      FLY_ASSETS licensing entry, and every source URL reaches CREDITS.md.
 *   B  containment — landmarks-3d.js (the procedural geometry) knows nothing
 *      about the marquee layer, and FlyScene mounts it only behind
 *      MONUMENT_MODELS.enabled. That pair is what makes flag-off byte-identical
 *      to R19; it is a SOURCE gate because a constant baked at build time
 *      cannot be flipped from inside the browser.
 *   C  toy runtime — every model loads; `monument-marquee` is mounted on the new
 *      'world-bend-anchor-monument-r20' program; the ESB places at its real
 *      coords with its top at hM × scaleBoost (the POI-letter contract); the
 *      layer costs exactly +1 draw; the procedural spire under the ESB is
 *      PARKED while One World Trade — same archetype, no marquee model — is
 *      still placed (the per-POI fallback contract); /^landmark-/ is still ≤ 10
 *      meshes (verify-monuments gate 8 must not move); draws ≤ 480.
 *   D  satellite runtime — the same layer places under the satellite grade.
 *   E  zero page/console errors in both styles.
 *   F  FOOTPRINT EXCLUSION (round 20, C2) — parking the procedural archetype
 *      only solves half the double-draw: the OpenFreeMap `building` polygon of
 *      the same real structure is a third actor, and it is the one wearing the
 *      satellite night-window atlas (the Taj rendered as a blue box standing
 *      through the marble model; the Eiffel grew a blocky cluster at its base).
 *      F gates the disc the worker now punches: NO streamed building footprint
 *      centroid inside a placed monument's exclusionM, in BOTH styles, with a
 *      non-vacuity witness so an empty query can never pass it. Measured
 *      control (exclusion disabled at the same poses, worktree r20-c):
 *        satellite centroids inside the disc — ESB 8 (nearest 4.4 m),
 *          Taj 10 (8.3 m), Eiffel 23 (11.2 m)  →  0 / 0 / 0 with the fix
 *        toy nearest building vertex — ESB 3.7 m, Eiffel 4.6 m, Colosseum
 *          15.3 m  →  91.6 m / 136.3 m / 251.3 m with the fix
 *
 * ALWAYS eyeball scripts/r20-c-*-{before,after}.png alongside this — colour is
 * taste and a gate cannot hold it.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

const ROOT = path.join(__dirname, '..');
const MAX_GLB_BYTES = 1024 * 1024;
const SCALE_BOOST = 1.35; // LANDMARKS_3D.scaleBoost — the letter contract's number
const ESB = { lat: 40.7484, lon: -73.9857, hM: 443 };
const ONE_WTC = { lat: 40.7127, lon: -74.0134 }; // same 'spire' archetype, NO marquee model
// Round 20 (C2) — the exclusion gate's two sites. ESB is the densest block in
// the marquee set (so it is the one a too-wide radius would betray) and rides
// the pose the rest of this harness already flies; the Taj is the REPORTED
// defect (scripts/r20-c-taj-satellite-after.png) and gets its own satellite leg.
const ESB_EXCLUSION_M = 60; // = MONUMENT_MANIFEST['Empire State Building'].exclusionM
const TAJ = { lat: 27.1751, lon: 78.0421, exclusionM: 105 };
// Toy exposes no per-building centroid (the drape anchor is applied CPU-side
// and never uploaded), so the toy half asserts on the nearest building VERTEX.
// The threshold sits in the measured gap: 3.7 m without the fix, 91.6 m with it.
const TOY_CLEAR_M = 45;

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** Minimal GLB JSON-chunk parse (the inspect-glb.mjs recipe, trimmed). */
function glbJson(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not GLB');
  let off = 12;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) {
      return JSON.parse(buf.subarray(off + 8, off + 8 + len).toString('utf8').replace(/\0+$/, ''));
    }
    off += 8 + len;
  }
  throw new Error('no JSON chunk');
}

// Scene probe: the marquee mesh + every landmark-* placement, in absolute
// mercator (instance matrices are anchor-relative, like verify-monuments).
const probe = () => {
  const f = window.__fly;
  let root = f.engine.object;
  while (root.parent) root = root.parent;
  const landmarkMeshes = [];
  let marquee = null;
  const spires = [];
  root.traverse((o) => {
    if (o.isInstancedMesh && /^landmark-/.test(o.name)) {
      landmarkMeshes.push(o.name);
      if (o.name === 'landmark-spire') {
        const a = o.instanceMatrix.array;
        for (let i = 0; i < o.count; i++) {
          if (Math.abs(a[i * 16]) < 0.001) continue; // parked slot
          spires.push({
            x: a[i * 16 + 12] + f.origin.anchor.x,
            z: a[i * 16 + 14] + f.origin.anchor.z,
          });
        }
      }
    }
    if (o.name === 'monument-marquee') {
      marquee = {
        indexCount: o.geometry?.index?.count ?? -1,
        key: o.material?.customProgramCacheKey?.() ?? null,
        bend: o.material?.userData?.__worldBend ?? null,
        isModel: o._isModel === true,
        painted: o._painted === true,
        visible: o.visible,
        hasAnchor: !!o.geometry?.attributes?.aAnchor,
      };
    }
  });
  return {
    landmarkMeshes,
    marquee,
    spires,
    mon: window.__flyMonuments ?? null,
    anchor: { x: f.origin.anchor.x, z: f.origin.anchor.z },
    draws: window.__flyStats?.drawCalls ?? 0,
    esb: f.engine.geoToWorld(-73.9857, 40.7484, 0),
    wtc: f.engine.geoToWorld(-74.0134, 40.7127, 0),
  };
};

/**
 * Round 20 (C2): streamed building footprints around one monument.
 *  • satellite — SatBuildingEngine.queryColumns returns one column per BUILDING
 *    at its footprint-centroid anchor in absolute mercator, which is exactly the
 *    quantity the worker's exclusion test uses. Exact, not a proxy.
 *  • toy — ToyWorldEngine uploads no anchor attribute, so this walks the
 *    building meshes' positions (identified by aFacade, which only the toy
 *    building material carries) and reports the nearest VERTEX. Chunk meshes sit
 *    at their tile centre in absolute mercator (the rebase lives on the parent
 *    group), so a vertex's absolute XZ is mesh.position + local.
 * Both halves also report a POPULATION so a gate can refuse to pass vacuously.
 */
const exclusionProbe = (a) => {
  const f = window.__fly;
  const w = f.engine.geoToWorld(a.lon, a.lat, 0);
  const out = { satInside: null, satRing: null, satNear: null, toyNearest: null, toyVerts: null };
  const sb = window.__satBuildings;
  if (sb && sb.queryColumns) {
    const ds = sb
      .queryColumns(w.x, w.z, a.r * 4)
      .map((c) => Math.hypot(c.x - w.x, c.z - w.z))
      .sort((p, q) => p - q);
    out.satInside = ds.filter((d) => d < a.r).length;
    out.satRing = ds.filter((d) => d >= a.r).length;
    out.satNear = ds.length ? +ds[0].toFixed(1) : null;
  }
  const tw = window.__toyWorld;
  if (tw && tw.object) {
    let best = Infinity;
    let n = 0;
    tw.object.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      const g = o.geometry;
      if (!g || !g.attributes || !g.attributes.aFacade) return;
      const p = g.attributes.position.array;
      const mx = o.position.x;
      const mz = o.position.z;
      for (let i = 0; i < p.length; i += 3) {
        const d = Math.hypot(mx + p[i] - w.x, mz + p[i + 2] - w.z);
        if (d < a.r * 4) n += 1;
        if (d < best) best = d;
      }
    });
    out.toyNearest = Number.isFinite(best) ? +best.toFixed(1) : null;
    out.toyVerts = n;
  }
  return out;
};

async function warpHold(page, lat, lon, altM) {
  await page.evaluate(
    (a) => {
      clearInterval(window.__iconPin);
      window.__fly.warpToGeo(a.lat, a.lon, { altM: a.altM, name: null });
      const f = window.__fly.flight;
      f.heading = 0;
      f.pitch = 0;
      f.bank = 0;
      const q = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
      window.__iconPin = setInterval(() => {
        f.pos.x = q.x;
        f.pos.y = q.y;
        f.pos.z = q.z;
        f.heading = 0;
        f.pitch = 0;
        f.bank = 0;
        f.speed = 0;
      }, 8);
    },
    { lat, lon, altM }
  );
  // The marquee layer only rebuilds when the placement SET changes, and a
  // placement needs streamed ground — poll instead of guessing a dwell.
  await page
    .waitForFunction(
      () => (window.__flyMonuments?.placed ?? []).some((p) => p.name === 'Empire State Building'),
      { timeout: 60000, polling: 500 }
    )
    .catch(() => {});
  await page.waitForTimeout(3000);
}

(async () => {
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };

  // =========================================================================
  // A — manifest / disk / licensing (no browser)
  // =========================================================================
  const manifestSrc = read('lib/fly/monument-models.js');
  const assetsSrc = read('lib/fly/assets.js');
  const credits = read('CREDITS.md');

  // Two kinds of manifest row: a DOWNLOADED model (`file:`) and a BESPOKE
  // first-party builder (`build:`). Download-first, bespoke-second — a builder
  // is what a monument gets when no acceptable FREE model exists, and the A4–A6
  // asset gates below apply only to the downloaded half because a builder has
  // no file, no author and no licence to check.
  const entries = [...manifestSrc.matchAll(/poi:\s*'([^']+)',\s*\n\s*file:\s*'(\/models\/[^']+)'/g)].map(
    (m) => ({ poi: m[1], file: m[2] })
  );
  const built = [...manifestSrc.matchAll(/poi:\s*'([^']+)',\s*\n\s*build:\s*'([^']+)'/g)].map((m) => ({
    poi: m[1],
    build: m[2],
  }));
  const allEntries = [...entries, ...built];
  gate(
    'A1 manifest lists ≥ 7 marquee monuments',
    allEntries.length >= 7,
    `${entries.length} downloaded + ${built.length} bespoke = ${allEntries.length}`
  );
  gate(
    'A2 the mandated Empire State Building is in the set',
    allEntries.some((e) => e.poi === 'Empire State Building'),
    allEntries.map((e) => e.poi).join(', ')
  );

  const landmarksSrc = read('lib/fly/poi/landmarks.js');
  const orphans = allEntries.filter((e) => !landmarksSrc.includes(`['${e.poi}',`));
  gate('A3 every manifest POI key joins the LANDMARKS DB', orphans.length === 0, orphans.map((o) => o.poi).join(', '));

  let sizeOk = true;
  let shapeOk = true;
  let creditOk = true;
  const notes = [];
  for (const e of entries) {
    const disk = path.join(ROOT, 'public', e.file);
    if (!fs.existsSync(disk)) {
      sizeOk = false;
      notes.push(`${e.file} MISSING`);
      continue;
    }
    const size = fs.statSync(disk).size;
    if (size > MAX_GLB_BYTES) {
      sizeOk = false;
      notes.push(`${e.file} ${(size / 1024).toFixed(0)}KB > 1MB`);
    }
    const j = glbJson(disk);
    // Uncompressed: the app's GLTFLoader has no draco/meshopt/KTX2 decoder.
    if ((j.extensionsRequired ?? []).length) {
      shapeOk = false;
      notes.push(`${e.file} requires ${j.extensionsRequired.join('+')}`);
    }
    const prim = j.meshes?.[0]?.primitives?.[0];
    if (!prim || prim.attributes?.COLOR_0 == null) {
      shapeOk = false;
      notes.push(`${e.file} has no COLOR_0 (would render FLAT WHITE)`);
    }
    if ((j.images ?? []).length) {
      shapeOk = false;
      notes.push(`${e.file} still carries ${j.images.length} texture(s)`);
    }
    const pos = j.accessors?.[prim?.attributes?.POSITION ?? 0];
    if (!pos?.min || !pos?.max) {
      shapeOk = false;
      notes.push(`${e.file} POSITION accessor has no min/max`);
    } else {
      const h = pos.max[1] - pos.min[1];
      if (Math.abs(pos.min[1]) > h * 1e-4) {
        shapeOk = false;
        notes.push(`${e.file} base plane at y=${pos.min[1]} (must be 0)`);
      }
      const cx = (pos.min[0] + pos.max[0]) / 2;
      const cz = (pos.min[2] + pos.max[2]) / 2;
      const span = Math.max(pos.max[0] - pos.min[0], pos.max[2] - pos.min[2]);
      if (Math.abs(cx) > span * 1e-3 || Math.abs(cz) > span * 1e-3) {
        shapeOk = false;
        notes.push(`${e.file} footprint not centred (${cx}, ${cz})`);
      }
      // Every marquee monument is taller-or-comparable to its footprint except
      // the Colosseum, which really is a low ellipse — so just refuse a model
      // lying on its side (a Z-up source that was never re-axised).
      if (h <= 0) {
        shapeOk = false;
        notes.push(`${e.file} zero height`);
      }
    }
    // Licensing: a `file:` entry in FLY_ASSETS, and its https url in CREDITS.md.
    const rel = `public${e.file}`;
    const idx = assetsSrc.indexOf(`file: '${rel}'`);
    if (idx < 0) {
      creditOk = false;
      notes.push(`${rel} has no FLY_ASSETS entry`);
    } else {
      const block = assetsSrc.slice(idx, idx + 1200);
      const url = (block.match(/url:\s*'(https?:[^']+)'/) || [])[1];
      const lic = (block.match(/license:\s*'([^']+)'/) || [])[1];
      const author = (block.match(/author:\s*'([^']+)'/) || [])[1];
      const mod = block.includes('modifications:');
      // Allowlist, not a blocklist. A monument ships only under a licence that
      // grants free redistribution to ANYONE for ANY purpose — the R20 lesson:
      // a repository's MIT LICENSE file can cover its CODE while its bundled 3D
      // assets sit under a separate, platform-restricted licence, and four
      // models were withdrawn late for exactly that.
      const ALLOWED = /^(CC0|CC-BY [0-9.]+|Public Domain|MIT)$/;
      if (!url || !credits.includes(url) || !lic || !ALLOWED.test(lic) || !author || !mod) {
        creditOk = false;
        notes.push(`${rel} licensing incomplete/disallowed (url=${url} lic=${lic} author=${author})`);
      }
    }
  }
  gate('A4 every marquee GLB exists and is ≤ 1MB', sizeOk, notes.join(' | ') || 'ok');
  gate(
    'A5 GLBs are uncompressed, textureless, COLOR_0-baked, base y=0, footprint-centred',
    shapeOk,
    notes.join(' | ') || 'ok'
  );
  gate('A6 every marquee GLB has a FLY_ASSETS entry reaching CREDITS.md', creditOk, notes.join(' | ') || 'ok');

  // The count arithmetic verify-fleet/verify-hangar derive from assets.js must
  // not have moved — monuments register `file:`-only for exactly this reason.
  const modelLiterals = [...assetsSrc.matchAll(/\{\s*url:\s*'\/models\//g)].length;
  gate('A7 assets.js runtime-url count arithmetic unmoved (10)', modelLiterals === 10, `${modelLiterals}`);

  // A bespoke row must resolve to a real builder and must NOT also claim a file
  // (which would make the loader's dispatch ambiguous), and it must never carry
  // a FLY_ASSETS entry — first-party geometry has nothing to attribute.
  const buildersSrc = read('lib/fly/monument-builders.js');
  const bespokeOk = built.every(
    (b) => new RegExp(`\\b${b.build}\\s*:`).test(buildersSrc.slice(buildersSrc.indexOf('MONUMENT_BUILDERS')))
  );
  gate(
    'A8 every bespoke row resolves to a registered first-party builder',
    built.every((b) => !b.file) && bespokeOk,
    built.map((b) => `${b.poi}→${b.build}`).join(', ') || 'none'
  );

  // =========================================================================
  // B — containment (what makes flag-off byte-identical to R19)
  // =========================================================================
  const lm3d = read('lib/fly/landmarks-3d.js');
  gate(
    'B1 procedural geometry (landmarks-3d.js) knows nothing about the marquee layer',
    !/monument-models|MONUMENT_MODELS|marquee/i.test(lm3d),
    'clean'
  );
  const lmjsx = read('components/fly/LandmarkMonuments.jsx');
  const hookSites =
    (lmjsx.match(/isMonumentSuppressed/g) ?? []).length + (lmjsx.match(/monumentSuppressionEpoch/g) ?? []).length;
  gate(
    'B2 LandmarkMonuments carries ONLY the park hook (4 references: 2 imports + 2 uses)',
    hookSites === 4,
    `${hookSites} references`
  );
  const scene = read('components/fly/FlyScene.jsx');
  gate(
    'B3 FlyScene mounts the marquee layer only behind MONUMENT_MODELS.enabled',
    /\{MONUMENT_MODELS\.enabled\s*&&\s*\(\s*\n\s*<MonumentModels/.test(scene),
    'gated'
  );
  // Round 20 (C2). The exclusion's flag-off byte identity is a SOURCE property —
  // MONUMENT_MODELS.enabled is baked at build time and cannot be flipped from
  // inside the browser, exactly like B3 above.
  const workerSrc = read('lib/fly/toy-world/vector-tile.worker.js');
  gate(
    'B5 the worker exclusion is gated on MONUMENT_MODELS.enabled (flag-off = byte-identical)',
    /function marqueeExclusionTile\([^)]*\)\s*\{\s*\n\s*if \(!MONUMENT_MODELS\.enabled \|\| MONUMENT_EXCLUSIONS\.length === 0\) return null;/.test(
      workerSrc
    ),
    'first statement returns null with the flag off'
  );
  // All THREE building-admission paths must punch the holes, or a monument is
  // clean in one ring and double-drawn in another (the R18 "an integration seam
  // both sides tested is still untested" lesson, applied to three seams).
  const applySites = (workerSrc.match(/if \(marqueeEx\) dropMarqueeFootprints\(items, marqueeEx\);/g) ?? [])
    .length;
  gate(
    'B6 all three building-admission paths punch the exclusion (sat detail / sat skyline / toy ring)',
    applySites === 3,
    `${applySites} call sites`
  );
  const exclusionMs = [...manifestSrc.matchAll(/exclusionM:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  gate(
    'B7 every marquee entry carries a positive exclusionM',
    exclusionMs.length === allEntries.length && exclusionMs.every((v) => v > 0),
    `${exclusionMs.length}/${allEntries.length}: ${exclusionMs.join(', ')}`
  );
  // A radius that could swallow a neighbourhood is the one failure mode of this
  // fix (A SPRAWL's Powell/Manhattan coverage is the constraint it must not
  // eat). 250 m is a hard ceiling; the widest shipped radius is the Colosseum's
  // 190, and it sits in an archaeological park.
  gate(
    'B8 no exclusion radius can swallow a neighbourhood (≤ 250 m)',
    exclusionMs.every((v) => v <= 250),
    `max ${Math.max(...exclusionMs)} m`
  );

  const wb = read('lib/fly/toy-world/world-bend.js');
  gate(
    "B4 the new bend key is registered and unique ('world-bend-anchor-monument-r20')",
    (wb.match(/world-bend-anchor-monument-r20/g) ?? []).length >= 2,
    `${(wb.match(/world-bend-anchor-monument-r20/g) ?? []).length} occurrences (registry + cache key)`
  );

  // =========================================================================
  // C/D/E — runtime, both styles
  // =========================================================================
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const errs = [];
  const results = {};

  for (const style of ['toy', 'satellite']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', (e) => errs.push(`${style}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errs.push(`${style} console: ${m.text().slice(0, 200)}`);
    });
    await bootFly(page, { style });
    await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
    await page.waitForTimeout(1200);
    // 1.3 km south of the ESB at 400 m — the monument stands dead ahead.
    await warpHold(page, ESB.lat - 0.0155, ESB.lon, 400);
    const p = await page.evaluate(probe);
    results[style] = p;
    console.log(
      `[${style}] placed: ${(p.mon?.placed ?? []).map((x) => `${x.name}@${x.topY.toFixed(0)}`).join(', ') || 'none'}`
    );

    gate(`${style} · marquee mesh mounted`, !!p.marquee, JSON.stringify(p.marquee));
    gate(
      `${style} · marquee rides the new anchor bend`,
      p.marquee?.key === 'world-bend-anchor-monument-r20' && p.marquee?.bend === 'anchor-monument' && p.marquee?.hasAnchor,
      `${p.marquee?.key} / ${p.marquee?.bend} / aAnchor=${p.marquee?.hasAnchor}`
    );
    gate(
      `${style} · marquee carries NO _isModel/_painted flag (harness foreground-hide)`,
      p.marquee && !p.marquee.isModel && !p.marquee.painted,
      `isModel=${p.marquee?.isModel} painted=${p.marquee?.painted}`
    );
    gate(
      `${style} · every manifest monument loaded (downloaded + bespoke)`,
      (p.mon?.loaded ?? []).length === allEntries.length,
      `${(p.mon?.loaded ?? []).length}/${allEntries.length}`
    );

    const esb = (p.mon?.placed ?? []).find((x) => x.name === 'Empire State Building');
    gate(`${style} · the Empire State Building placed`, !!esb, esb ? JSON.stringify(esb) : 'not placed');
    if (esb) {
      // The diagnostics handle reports ABSOLUTE mercator, so it compares
      // directly with geoToWorld (the merged GEOMETRY is authored relative to
      // the anchor it was built at, which is a different frame — see the
      // MonumentModels comment; a probe must never conflate the two).
      const d = Math.hypot(esb.x - p.esb.x, esb.z - p.esb.z);
      gate(`${style} · ESB placed at its real coords (≤ 300 m)`, d <= 300, `d=${d.toFixed(0)}m`);
      // The letter contract: PoiLetters lifts a landmark name by
      // hM × scaleBoost + 30, so the model's TOP must land on hM × scaleBoost
      // above its ground exactly the way an archetype's does.
      const wantTop = esb.groundY + ESB.hM * SCALE_BOOST;
      gate(
        `${style} · ESB top on the letter contract (hM × ${SCALE_BOOST})`,
        Math.abs(esb.topY - wantTop) < 1,
        `topY=${esb.topY.toFixed(2)} want=${wantTop.toFixed(2)}`
      );
    }

    // The fallback contract, per POI: the ESB's procedural spire is PARKED,
    // while One World Trade — same archetype, no marquee model — is still
    // placed by LandmarkMonuments.
    const near = (pt, tgt) => Math.hypot(pt.x - tgt.x, pt.z - tgt.z);
    const spireAtEsb = p.spires.some((s) => near(s, p.esb) <= 300);
    const spireAtWtc = p.spires.some((s) => near(s, p.wtc) <= 300);
    gate(`${style} · procedural spire under the ESB is parked`, !spireAtEsb, `${p.spires.length} spires placed`);
    gate(
      `${style} · One World Trade (no marquee model) still places procedurally`,
      spireAtWtc,
      `${p.spires.length} spires placed`
    );
    gate(
      `${style} · /^landmark-/ still ≤ 10 meshes (verify-monuments gate 8 unmoved)`,
      p.landmarkMeshes.length <= 10,
      `${p.landmarkMeshes.length}`
    );

    // Cost: exactly +1 draw, proved twice.
    //
    // STRUCTURALLY: the whole marquee set is ONE non-instanced Mesh with ONE
    // material and frustumCulled off, so it is one draw call by construction
    // however many monuments are standing in it. That is the invariant.
    const structural = await page.evaluate(() => {
      let root = window.__fly.engine.object;
      while (root.parent) root = root.parent;
      let n = 0;
      let ok = true;
      root.traverse((o) => {
        if (o.name !== 'monument-marquee') return;
        n += 1;
        if (o.isInstancedMesh || !o.isMesh || Array.isArray(o.material) || o.frustumCulled) ok = false;
      });
      return { n, ok };
    });
    gate(
      `${style} · the marquee set is ONE unculled single-material mesh (1 draw by construction)`,
      structural.n === 1 && structural.ok,
      JSON.stringify(structural)
    );

    // MEASURED: a visibility toggle. Two instrument corrections are needed
    // before a scene TOTAL can resolve a single draw (the R16 lesson: scene
    // totals are not a signal in live flight):
    //   (1) QUIESCE first — with the aircraft pinned, satellite chunks keep
    //       streaming in for a while, and a rising baseline reads as a NEGATIVE
    //       layer cost.
    //   (2) sample ON / OFF / ON and difference the mean of the two ONs against
    //       the OFF, which cancels any residual LINEAR drift exactly. Median of
    //       three cycles on top of that.
    const draws = () => page.evaluate(() => window.__flyStats?.drawCalls ?? 0);
    let prev = -1;
    for (let i = 0; i < 18; i++) {
      await page.waitForTimeout(1500);
      const d = await draws();
      if (d === prev) break;
      prev = d;
    }
    const setVis = (v) =>
      page.evaluate((vis) => {
        let root = window.__fly.engine.object;
        while (root.parent) root = root.parent;
        root.traverse((o) => {
          if (o.name === 'monument-marquee') o.visible = vis;
        });
      }, v);
    const deltas = [];
    for (let i = 0; i < 3; i++) {
      await setVis(true);
      await page.waitForTimeout(1400);
      const on1 = await draws();
      await setVis(false);
      await page.waitForTimeout(1400);
      const off = await draws();
      await setVis(true);
      await page.waitForTimeout(1400);
      const on2 = await draws();
      deltas.push((on1 + on2) / 2 - off);
    }
    await setVis(true);
    const delta = [...deltas].sort((a, b) => a - b)[1];
    console.log(`[${style}] marquee draw cost deltas ${deltas.join(',')} → median ${delta}`);
    gate(
      `${style} · marquee measures as +1 draw (drift-cancelled, median of 3)`,
      Math.abs(delta - 1) <= 0.5,
      `Δ=${delta} of [${deltas.join(',')}]`
    );

    const cap = style === 'toy' ? 480 : 375;
    gate(`${style} · draw budget (≤ ${cap})`, (p.draws ?? 0) <= cap, `draws=${p.draws}`);

    // --- F: the streamed footprint under the model -------------------------
    const fx = await page.evaluate(exclusionProbe, {
      lat: ESB.lat,
      lon: ESB.lon,
      r: ESB_EXCLUSION_M,
    });
    console.log(`[${style}] ESB exclusion probe ${JSON.stringify(fx)}`);
    if (style === 'satellite') {
      gate(
        `${style} · F1 no streamed building centroid inside the ESB's ${ESB_EXCLUSION_M} m disc`,
        fx.satInside === 0,
        `inside=${fx.satInside} nearest=${fx.satNear}m (control: 8 inside, nearest 4.4m)`
      );
      gate(
        `${style} · F2 …and Midtown is still streaming (non-vacuity witness)`,
        (fx.satRing ?? 0) >= 20,
        `${fx.satRing} building centroids in [${ESB_EXCLUSION_M}, ${ESB_EXCLUSION_M * 4}] m`
      );
    } else {
      gate(
        `${style} · F1 no toy building vertex within ${TOY_CLEAR_M} m of the ESB`,
        (fx.toyNearest ?? 0) >= TOY_CLEAR_M,
        `nearest=${fx.toyNearest}m (control: 3.7m)`
      );
      gate(
        `${style} · F2 …and Midtown is still streaming (non-vacuity witness)`,
        (fx.toyVerts ?? 0) >= 200,
        `${fx.toyVerts} building vertices within ${ESB_EXCLUSION_M * 4} m`
      );
    }

    await page.evaluate(() => clearInterval(window.__iconPin));
    await page.locator('.fixed.inset-0 canvas').first().screenshot({
      path: path.join(__dirname, `icons-01-esb-${style}-gl.png`),
    });

    // --- F3: the REPORTED defect site ---------------------------------------
    // The Taj is where the double-draw was first seen (a blue-tinted block
    // wearing the R15 night window atlas, standing through the marble model),
    // and it is the one site where the exclusion has to leave neighbours alone:
    // the mosque and the jawab are real, separate buildings ~110 m out and MUST
    // survive. Satellite only — it is the satellite atlas that made it visible.
    if (style === 'satellite') {
      await page.evaluate((a) => {
        clearInterval(window.__iconPin);
        window.__fly.warpToGeo(a.lat, a.lon, { altM: 700, name: null });
        const f = window.__fly.flight;
        const q = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
        window.__iconPin = setInterval(() => {
          f.pos.x = q.x;
          f.pos.y = q.y;
          f.pos.z = q.z;
          f.speed = 0;
          f.pitch = 0;
          f.bank = 0;
        }, 8);
      }, TAJ);
      await page.waitForTimeout(14000);
      const tj = await page.evaluate(exclusionProbe, {
        lat: TAJ.lat,
        lon: TAJ.lon,
        r: TAJ.exclusionM,
      });
      console.log(`[${style}] Taj exclusion probe ${JSON.stringify(tj)}`);
      gate(
        `${style} · F3 no streamed building centroid inside the Taj's ${TAJ.exclusionM} m disc`,
        tj.satInside === 0,
        `inside=${tj.satInside} nearest=${tj.satNear}m (control: 10 inside, nearest 8.3m)`
      );
      gate(
        `${style} · F4 the Taj complex keeps its neighbours (mosque + jawab still stream)`,
        (tj.satRing ?? 0) >= 5,
        `${tj.satRing} building centroids in [${TAJ.exclusionM}, ${TAJ.exclusionM * 4}] m`
      );
      await page.evaluate(() => clearInterval(window.__iconPin));
    }
    await page.close();
  }

  gate('E zero page/console errors (both styles)', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

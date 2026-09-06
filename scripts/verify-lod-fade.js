/**
 * R24 (E CERT) — verify-lod-fade: terrain LOD must not pop, and a tile must
 * not be replaced by a different tile at the same place.
 *
 * WHY THIS GATE EXISTS, IN THE USER'S WORDS. The reported symptom on the newer
 * builds is "terrain tiles swapping for other ones". Two mechanisms produce
 * that picture and they need different fixes:
 *
 *   (a) A HARD LOD SWAP (recon T4). The parent tile is removed and its four
 *       children appear on the SAME frame, with four texture + geometry
 *       uploads landing together. Geometry snaps, texel density jumps, and at
 *       a distance it reads as "that square of ground just changed".
 *   (b) A RE-STREAM CAUSED BY CULLING (recon T1/T3). The quadtree merges
 *       out-of-frustum tiles with zero hysteresis, so every yaw re-streams the
 *       near field; a tile leaves and comes back, and while it is away a
 *       coarser ancestor covers its ground. A's node harness measured 22
 *       merges / 17 replaced-on-screen / 178 parent refetches on a pure yaw
 *       sweep, against 0/0/0 with the residency trio on.
 *
 * THREE INSTRUMENTS
 *   (1) A's engine counters, `window.__flyTerra.lod()` →
 *       { refine, merge, refetchParent, replacedOnScreen } (SINGULAR — the
 *       names in tile-residency.js; reading them plural yields NaN, which
 *       compares false against every threshold) and `.mem()` →
 *       { residentTiles, residentBytes, residentMB }, which only moves when
 *       TERRA_PACE.keepResident is ON. Authoritative for (b).
 *   (2) A per-frame census of DISPLAYED tiles keyed by z/x/y. three-tile marks
 *       a tile `isTile` with `.x/.y/.z` and `isLeaf` (children.length <= 1),
 *       so "what ground is on screen" is directly readable. A parent→children
 *       swap inside ONE frame is the (a) signature; the crossfade window is
 *       the number of frames in which a parent and its own children are BOTH
 *       displayed.
 *   (3) The fixture's tile-identity stamp. Every imagery tile carries its own
 *       z/x/y at a fixed top-left position and a hash(z,x,y) background hue,
 *       so a WRONG tile at a position is visible in a screenshot; and
 *       `/__stats` counts refetches per URL, which is the second, independent
 *       reading of (b).
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3105 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-lod-fade.js
 *
 * Pair it with A's node leg, which needs no browser and no GPU:
 *   node scripts/verify-terra-residency.mjs
 */
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');
const { settleWorld } = require('./_settle');

const POWELL = [40.1578, -83.0752, 900, 1.9, -0.3];
const OWENS = [36.6, -118.1, 2600, 1.2, -0.18];
const SETTLE = Number(process.env.LOD_SETTLE_MS || 45000);
const YAW_SEC = Number(process.env.LOD_YAW_SEC || 40);

const PIN_POSE = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__lodPin) clearInterval(window.__lodPin);
  window.__lodPin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/**
 * ONE SLOW 720 deg YAW at a frozen position (the verify-stability orbit
 * idiom). Position frozen means the streaming rings do not move, so anything
 * that leaves and comes back left because of CULLING, not because of distance.
 */
const START_YAW = ([secs]) => {
  const f = window.__fly.flight;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  const h0 = f.heading;
  const t0 = performance.now();
  if (window.__lodPin) clearInterval(window.__lodPin);
  window.__lodPin = setInterval(() => {
    const u = Math.min(1, (performance.now() - t0) / (secs * 1000));
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = h0 + u * Math.PI * 4;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

/**
 * The per-frame displayed-tile census. Registered before the app's own rAF, so
 * each sample describes the frame that just presented.
 *
 * A tile is DISPLAYED when it is a leaf (three-tile: children.length <= 1, i.e.
 * only its model) and visible. Keyed z/x/y, so a parent and its children are
 * relatable by arithmetic rather than by object identity — which is what makes
 * "parent left and its own four children arrived in the same frame" a
 * countable event instead of an impression.
 */
const INSTALL_TILE_CENSUS = () => {
  const S = (window.__lodWatch = {
    frames: 0,
    hardSwaps: 0, // parent out + >=2 of its children in on ONE frame
    hardMerges: 0, // children out + their parent in on ONE frame
    appears: 0,
    disappears: 0,
    crossfadeFrames: 0, // frames where a parent AND >=1 of its children are both displayed
    maxOverlapRun: 0,
    reappears: 0, // a tile that left and came back (the culling signature)
    samples: [],
    seenEver: {},
  });
  let prev = new Set();
  let overlapRun = 0;
  const parentKey = (k) => {
    const [z, x, y] = k.split('-').map(Number);
    return z > 0 ? `${z - 1}-${x >> 1}-${y >> 1}` : null;
  };
  const tick = () => {
    const root = window.__fly?.engine?.object;
    if (!root) return requestAnimationFrame(tick);
    const cur = new Set();
    root.traverse((o) => {
      if (o.isTile && o.visible && o.isLeaf && o.z != null) cur.add(`${o.z}-${o.x}-${o.y}`);
    });
    S.frames++;
    let appeared = 0;
    let gone = 0;
    const inNow = [];
    const outNow = [];
    for (const k of cur)
      if (!prev.has(k)) {
        appeared++;
        inNow.push(k);
        if (S.seenEver[k]) S.reappears++;
        S.seenEver[k] = 1;
      }
    for (const k of prev) if (!cur.has(k)) { gone++; outNow.push(k); }
    S.appears += appeared;
    S.disappears += gone;

    // (a) hard refine: a parent left while >= 2 of its own children arrived.
    for (const p of outNow) {
      const kids = inNow.filter((k) => parentKey(k) === p);
      if (kids.length >= 2) S.hardSwaps++;
    }
    // and hard merge: children left while their parent arrived.
    for (const p of inNow) {
      const kids = outNow.filter((k) => parentKey(k) === p);
      if (kids.length >= 2) S.hardMerges++;
    }
    // crossfade window: a parent and one of its children displayed together.
    let overlap = 0;
    for (const k of cur) {
      const p = parentKey(k);
      if (p && cur.has(p)) overlap++;
    }
    if (overlap > 0) {
      S.crossfadeFrames++;
      overlapRun++;
      if (overlapRun > S.maxOverlapRun) S.maxOverlapRun = overlapRun;
    } else overlapRun = 0;

    if (appeared || gone)
      S.samples.push({ f: S.frames, in: inNow.slice(0, 6), out: outNow.slice(0, 6), overlap });
    if (S.samples.length > 300) S.samples.shift();
    prev = cur;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

/**
 * D's counters, read whole. `__flyStats.terra.fades` IS lod-crossfade.js's live
 * module singleton, so it is COPIED here and never written to: a harness does
 * not get to reset another owner's state, and `resetLodFades()` would not help
 * anyway — it clears only `active`, `retained` and `skip.*`, leaving
 * refines/merges/hardSwaps/faded/peakActive as session totals. Every number
 * below is therefore a DELTA across the sweep, except `peakActive`, which is a
 * session high-water mark and is read absolute (it includes boot).
 */
const SNAP_FADES = () => {
  const f = window.__flyStats?.terra?.fades;
  return f ? JSON.parse(JSON.stringify(f)) : null;
};

/**
 * Poll a page-side predicate until it holds, capped in RENDERED FRAMES.
 *
 * [D-C1] Every "wait N frames" in this file was fps-dependent in the WRONG
 * direction. The fade clock advances `min(delta, 0.05)` per rendered frame, so
 * ten frames is 500 ms of fade clock at this venue's 1-3 fps but only 167 ms at
 * 60 fps — a 250 ms blend is comfortably drained here and still running there.
 * A hard `active === 0` after a fixed frame count is therefore a FALSE RED on
 * a healthy machine, which is the worst kind of gate: it fails precisely where
 * the feature works. Poll instead, and report how long it took. (The
 * `waitFrames` helper this replaced is gone: there was no frame count that was
 * right on both machines, which is the whole finding.)
 */
async function waitUntil(pg, fnSrc, { capFrames = 90, label = '' } = {}) {
  const t0 = await pg.evaluate(
    () => window.__flyStats?.frame?.count ?? window.__lodWatch?.frames ?? 0
  );
  let frames = 0;
  let ok = false;
  for (;;) {
    ok = await pg.evaluate(fnSrc).catch(() => false);
    frames =
      (await pg.evaluate(() => window.__flyStats?.frame?.count ?? window.__lodWatch?.frames ?? 0)) - t0;
    if (ok || frames >= capFrames) break;
    await pg.waitForTimeout(250);
  }
  if (label) console.log(`  waitUntil(${label}): ${ok ? 'held' : 'CAPPED'} after ${frames} rendered frames`);
  return { ok, frames };
}

/**
 * Wait until a counter STOPS ADVANCING across two consecutive reads.
 *
 * [D-C2] The warp cut is 900 ms of fade clock — 18 rendered frames here, ~54
 * at 60 fps, ~130 at 144 Hz. There is no frame count that is right on every
 * machine, so the gate waits for the SYMPTOM to stop instead of guessing at
 * its duration.
 */
async function waitSettled(pg, readSrc, { capFrames = 240, label = '' } = {}) {
  const t0 = await pg.evaluate(
    () => window.__flyStats?.frame?.count ?? window.__lodWatch?.frames ?? 0
  );
  let prev = await pg.evaluate(readSrc).catch(() => null);
  let frames = 0;
  for (;;) {
    await pg.waitForTimeout(400);
    const now = await pg.evaluate(readSrc).catch(() => null);
    frames =
      (await pg.evaluate(() => window.__flyStats?.frame?.count ?? window.__lodWatch?.frames ?? 0)) - t0;
    if (now === prev || frames >= capFrames) {
      if (label)
        console.log(
          `  waitSettled(${label}): ${now === prev ? `steady at ${now}` : `CAPPED at ${now}`} after ` +
            `${frames} rendered frames`
        );
      return { value: now, frames, steady: now === prev };
    }
    prev = now;
  }
}

let pass = 0;
let fail = 0;
const red = [];
function gate(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
function soft(name, detail) {
  console.log(`INFO  ${name}  — ${detail}`);
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const fx = process.env.FLY_TILE_FIXTURE
    ? await require('./_fixture').attachFixture(context)
    : null;
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(INSTALL_TILE_CENSUS);

  await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
    timeout: 120000,
    polling: 250,
  });

  // --- Powell: the residency + swap legs
  await page.evaluate(PIN_POSE, POWELL);
  await page.waitForTimeout(SETTLE);
  // [D-C3] THE TWO ARMS MUST BE SETTLED THE SAME WAY. The ON arm waits for the
  // warp cut to stop suppressing fades before it snapshots; if the OFF arm did
  // not, the two `refines + merges` totals gate (14) compares would differ for
  // a reason that is load, not feature. Same call, same place, both legs.
  const offWarp = await waitSettled(page, () => window.__flyStats?.terra?.fades?.skip?.warp ?? 0, {
    label: 'OFF skip.warp',
  });
  // (1) is a PRECONDITION, so it must be readable in BOTH arms. A's `mem()`
  // cannot be: `residency.update()` is only wrapped into `map.update` when
  // TERRA_PACE.keepResident is ON (terrain-engine.js), so on the flag-off tree
  // `residentTiles` is 0 BY CONSTRUCTION and a precondition built on it would
  // fail for a reason that has nothing to do with the fixture. (Measured: the
  // first run of this gate reported `residentTiles=0 estMB=undefined` and I
  // read it as "the fixture is too small" — it was neither.) So the gate does
  // its own census over the tile tree, the same predicate residency uses
  // (`isTile && model`), and A's counters are printed as INFO beside it.
  const census = await page.evaluate(() => {
    const eng = window.__flyTerra?.engine?.();
    const map = eng?.map ?? window.__flyTerra?.get?.();
    if (!map) return null;
    let tiles = 0;
    let withModel = 0;
    const stack = [map];
    while (stack.length) {
      const n = stack.pop();
      if (!n) continue;
      if (n.isTile) {
        tiles++;
        if (n.model) withModel++;
      }
      const kids = n.children;
      if (kids) for (let i = 0; i < kids.length; i++) stack.push(kids[i]);
    }
    return { tiles, withModel, mem: window.__flyTerra?.mem?.() ?? null };
  });
  if (census) {
    gate(
      '(1) THE FIXTURE PRODUCES A REAL RESIDENT TILE FIELD at Powell',
      census.withModel > 40,
      `${census.withModel} tiles carry a model (of ${census.tiles} in the tree) — keepResident's ` +
        'byte LRU needs real residency to bound; a fixture that resolved to a handful of tiles ' +
        'would make that switch untestable'
    );
    console.log(
      `  INFO residency.stats(): ${
        census.mem
          ? `residentTiles=${census.mem.residentTiles} residentMB=${census.mem.residentMB}`
          : 'null'
      } — 0 here is EXPECTED with TERRA_PACE.keepResident off; the residency pass is not installed`
    );
  } else
    soft(
      '(1) resident tile field',
      'window.__flyTerra absent — merge r24/a to read it. Falling back to the displayed-tile ' +
        'census below, which counts DISPLAYED, not RESIDENT, tiles.'
    );

  if (fx) await fx.resetStats();
  // D's call-site counters bracket the OFF sweep as well: the identity
  // `refines + merges === hardSwaps + faded` has to hold in BOTH arms (it is
  // the ladder's own bookkeeping, not a property of the flag), and the OFF
  // leg's refines+merges is the denominator the ON leg's must stay flat
  // against.
  const g0 = await page.evaluate(SNAP_FADES);
  await page.evaluate(() => {
    const S = window.__lodWatch;
    S.frames = S.hardSwaps = S.hardMerges = S.appears = S.disappears = 0;
    S.crossfadeFrames = S.maxOverlapRun = S.reappears = 0;
    S.samples.length = 0;
    window.__lod0 = window.__flyTerra?.lod?.() ?? null;
  });

  await page.evaluate(START_YAW, [YAW_SEC]);
  await page.waitForTimeout(YAW_SEC * 1000 + 4000);

  const w = await page.evaluate(() => ({
    ...window.__lodWatch,
    seenEver: undefined,
    lod0: window.__lod0,
    lod1: window.__flyTerra?.lod?.() ?? null,
  }));
  const g1 = await page.evaluate(SNAP_FADES);
  const gd = (k) => (g1 && g0 ? (g1[k] ?? 0) - (g0[k] ?? 0) : NaN);
  if (g1)
    console.log(
      `  terra.fades OFF (delta): refines ${gd('refines')} · merges ${gd('merges')} · hardSwaps ` +
        `${gd('hardSwaps')} · faded ${gd('faded')} · skip.disabled ${
          g1.skip && g0.skip ? g1.skip.disabled - g0.skip.disabled : NaN
        }`
    );
  const stats = fx ? await fx.stats() : null;
  const refetched = stats
    ? Object.entries(stats.byUrl).filter(([u, n]) => n > 1 && (u.startsWith('/img/') || u.startsWith('/dem/')))
    : [];

  console.log(
    `\nYAW SWEEP (${YAW_SEC}s, position frozen): ${w.frames} frames · ` +
      `${w.appears} tile appearances / ${w.disappears} disappearances · ` +
      `${w.reappears} RE-appearances · ${w.hardSwaps} hard refines · ${w.hardMerges} hard merges · ` +
      `crossfade frames ${w.crossfadeFrames} (longest run ${w.maxOverlapRun})`
  );
  if (w.samples.length) console.log('  first events:', JSON.stringify(w.samples.slice(0, 4)));
  // A's counter FIELD NAMES are singular and one of them is not what the
  // header of this file guessed: tile-residency.js publishes
  // { refine, merge, refetchParent, replacedOnScreen }, not
  // { refines, merges, parentRefetches, ... }. The first run of this gate
  // printed three NaNs and passed anyway, which is the failure mode §2.10
  // exists to catch — so the delta is computed by name and a NaN is a LOUD
  // instrument failure, never a printed NaN.
  const COUNTERS = ['refine', 'merge', 'refetchParent', 'replacedOnScreen'];
  let lodDelta = null;
  if (w.lod1) {
    lodDelta = {};
    for (const k of COUNTERS) lodDelta[k] = (w.lod1[k] ?? NaN) - (w.lod0?.[k] ?? 0);
    const bad = COUNTERS.filter((k) => !Number.isFinite(lodDelta[k]));
    console.log(
      `  __flyTerra.lod(): ` +
        COUNTERS.map((k) => `${k} ${Number.isFinite(lodDelta[k]) ? lodDelta[k] : 'ABSENT'}`).join(' · ')
    );
    if (bad.length)
      gate(
        '(1b) A\'S LOD COUNTERS ARE READABLE BY THE NAMES THIS GATE USES',
        false,
        `absent: ${bad.join(', ')} — present keys: ${Object.keys(w.lod1).join(', ')}. A counter ` +
          'read by the wrong name reads NaN, and NaN compares false against every threshold: the ' +
          'gate would go quiet exactly when it should shout'
      );
  }
  if (stats)
    console.log(
      `  fixture refetches: ${refetched.length} distinct tile URLs fetched more than once` +
        (refetched.length ? `, worst ${Math.max(...refetched.map((r) => r[1]))}x ${refetched.sort((a, b) => b[1] - a[1])[0][0]}` : '')
    );

  // --- the assertions. Each is RED on the flag-off tree by construction.
  gate(
    '(2) THE CENSUS HAS SOMETHING TO COUNT — tiles are displayed and the sweep moved them',
    w.frames > 20 && w.appears + w.disappears > 0,
    `frames=${w.frames} events=${w.appears + w.disappears}`
  );
  gate(
    '(3) NO TILE LEAVES AND COMES BACK ON A PURE YAW (culling re-stream)',
    w.reappears === 0,
    `${w.reappears} re-appearances — the position never moved, so anything that came back left ` +
      'because it was culled, not because it was far'
  );
  red.push(['T1/T3 bend-blind merge re-streams the near field', 'verify-lod-fade (3)', `${w.reappears} reappears`, '0']);
  gate(
    '(4) NO HARD LOD SWAP — a parent never leaves on the same frame its children arrive',
    w.hardSwaps === 0 && w.hardMerges === 0,
    `refines ${w.hardSwaps} · merges ${w.hardMerges}`
  );
  red.push(['T4 atomic all-four-or-nothing LOD swap', 'verify-lod-fade (4)', `${w.hardSwaps}+${w.hardMerges}`, '0']);
  gate(
    '(5) A PARENT-RETAINED CROSSFADE WINDOW EXISTS',
    w.maxOverlapRun >= 2,
    `longest run of frames with a parent and its child both displayed: ${w.maxOverlapRun} ` +
      '(1 or 0 means the swap is atomic — this is the LOD_CROSSFADE contract)'
  );
  red.push(['T4 no crossfade window', 'verify-lod-fade (5)', `${w.maxOverlapRun} frames`, '>= 2 frames']);

  if (fx) {
    // THE DENOMINATOR FIRST (§2.10 WEAK, now closed). "0 refetched" is also
    // what a sweep that fetched NOTHING reports — `/__stats/reset` was called
    // right before the yaw, so an empty window would sail through (6) while
    // proving the opposite of what the gate claims. Assert a real fetch
    // population before reading the refetch count.
    const fetchedTiles = stats
      ? Object.keys(stats.byUrl).filter((u) => u.startsWith('/img/') || u.startsWith('/dem/'))
      : [];
    gate(
      '(6a) THE REFETCH COUNT HAS A DENOMINATOR — tiles were fetched during the sweep',
      fetchedTiles.length >= 8,
      `${fetchedTiles.length} distinct tile URLs fetched in the window (total ${stats?.total ?? '?'}) — ` +
        'without this, "0 refetched" and "nothing happened" are the same reading'
    );
    gate(
      '(6) NO UNBOUNDED TILE REFETCH during the sweep (fixture /__stats)',
      refetched.length === 0,
      `${refetched.length} of ${fetchedTiles.length} tile URLs refetched` +
        (refetched.length ? `: e.g. ${refetched[0][0]} x${refetched[0][1]}` : '')
    );
  }

  // --- Owens: the draw ceiling must not move because of a fade
  //
  // [D note] SETTLED, not "waited SETTLE ms". Gate (18) asserts the two arms'
  // draw and triangle counts are EQUAL, and a fixed wait makes that equality a
  // race with the streamer: a chunk that lands one poll later on one leg moves
  // the number. `settleWorld` returns only when terrain has reached its zoom,
  // the ground elevation has stopped moving, every chunk has resolved
  // ready-or-empty, and `__flyStats` has REPUBLISHED since we asked — so the
  // number it hands back is a settled scene's, not a snapshot of one still
  // assembling.
  await page.evaluate(PIN_POSE, OWENS);
  const owensSettleOff = await settleWorld(page, { capMs: 300000 });
  console.log(
    `  OFF Owens settle: ${owensSettleOff.settled ? 'SETTLED' : `NOT settled — ${owensSettleOff.why}`} ` +
      `in ${(owensSettleOff.ms / 1000).toFixed(0)}s (maxZ ${owensSettleOff.maxZ}, load ${owensSettleOff.load})`
  );
  const owens = await page.evaluate(() => ({
    draws: window.__flyStats?.drawCalls ?? null,
    tris: window.__flyStats?.triangles ?? null,
  }));
  console.log(`\nOwens (fixture column): draws=${owens.draws} tris=${owens.tris}`);
  soft(
    '(7) OWENS DRAW COLUMN',
    `${owens.draws} — a FIXTURE number. The live ceiling is <= 261 and is NOT re-baselineable from ` +
      'here; what this leg certifies is that the flag-on column equals the flag-off column at ' +
      'the empty-desert pose, i.e. a crossfade adds nothing where there is nothing to fade.'
  );

  gate('(8) NO PAGE ERRORS', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

  // ===========================================================================
  // THE ON LEG — LOD_CROSSFADE pinned on, same pose, same sweep, same census.
  // The contract below is D's, reviewed against lib/fly/lod-crossfade.js; the
  // eight corrections they made to my first draft are marked [D1]..[D8].
  //
  // WHY IT IS A SECOND BOOT AND NOT A MID-SESSION FLIP. `attachLodFade`
  // returns null when `cfg().enabled` is false (lod-crossfade.js:140), so a
  // tile material patched during the OFF leg is never armed; flipping the pin
  // afterwards would leave the resident field on the other program and every
  // swap would land in `skip.unpatched`. The override has to be in place
  // BEFORE the first tile material is patched, which means addInitScript on a
  // fresh context. The fixture server is shared (`ensureServer` caches it), so
  // the second context costs a boot, not a second world.
  //
  // [D1] THERE IS NO SUCH THING AS "hardSwaps FLAT". `refines`/`merges` are
  // incremented UNCONDITIONALLY at the two call sites (lod-crossfade.js:331,
  // 367) and then the swap takes EITHER `hardSwaps` (no blend) OR `faded`
  // (blend armed). So the ladder's own identity is
  //     refines + merges === hardSwaps + faded
  // in both arms, `refines + merges` must be FLAT across the flip (the feature
  // may not change how often the quadtree refines), and the flip moves mass
  // from hardSwaps to faded. The frame-diff census in this file counts a
  // different thing — parent-and-children-on-the-same-frame — so its
  // "8 refines + 3 merges" is REPORTED beside D's numbers and asserted against
  // neither.
  //
  // [D2] `{ enabled: true }` ALONE CANNOT REACH THE FADE WINDOW HERE.
  // `skipBootMs` is 6000 ms of FADE CLOCK, and the fade clock advances at most
  // 50 ms per RENDERED frame (FlyScene clamps `dt = min(delta, 0.05)`), so it
  // is 120 rendered frames — more than this whole sweep at 1-3 fps. The pin
  // therefore carries `skipBootMs: 0`. Boot suppression is POLICY and is
  // already gated structurally by verify-lod-fade.mjs §5; this leg measures
  // "does the blend happen at all".
  //
  // [D3] WARP SUPPRESSION IS A FRAME COUNT TOO. `lodFadeWarp()` sets
  // `_warpUntil = now() + 900` fade-ms = 18 rendered frames. The pose warp is
  // therefore followed by >= 20 RENDERED frames before the counters are
  // snapshotted. `skip.warp` reading 0 in the window is the proof that wait
  // was long enough; non-zero means the snapshot was early, not that the
  // feature is broken.
  //
  // [D7] TERRA_PACE IS NOT PINNED IN EITHER LEG. Both read the shipped
  // constants, and the gate asserts that no pace override exists on either
  // page — otherwise this would be measuring two different streamers.
  //
  // WHAT IT MUST NOT ASSERT: gate (5)'s co-display window. `mode:
  // 'parentBlend'` blends the PARENT'S TEXTURE into the child material and
  // disposes the parent model as before — it deliberately does not keep the
  // parent drawn (fly-constants.js:5300, and archived R22.1 B3 measured that
  // an ordered dither under SMAA-only AA reads as shimmer). So the OFF leg's
  // "longest co-display run 0" is NOT a number this flag moves, and the ON leg
  // recomputes it only to say so out loud.
  // ===========================================================================
  const offLeg = {
    hard: w.hardSwaps + w.hardMerges,
    hardSwaps: w.hardSwaps,
    hardMerges: w.hardMerges,
    reappears: w.reappears,
    overlapRun: w.maxOverlapRun,
    frames: w.frames,
    owensDraws: owens.draws,
    owensTris: owens.tris,
    // D's counters, OFF arm
    refines: gd('refines'),
    merges: gd('merges'),
    hardSwapsD: gd('hardSwaps'),
    fadedD: gd('faded'),
  };

  // The ladder identity, OFF arm. It is bookkeeping, not a feature, so it must
  // hold here too — and if it does not, every ON-leg number below is suspect.
  if (g1)
    gate(
      '(8b) LADDER BOOKKEEPING, OFF ARM — refines + merges === hardSwaps + faded',
      offLeg.refines + offLeg.merges === offLeg.hardSwapsD + offLeg.fadedD,
      `${offLeg.refines} + ${offLeg.merges} = ${offLeg.refines + offLeg.merges} vs ` +
        `${offLeg.hardSwapsD} + ${offLeg.fadedD} = ${offLeg.hardSwapsD + offLeg.fadedD}`
    );

  if (process.env.LOD_OFF_ONLY) {
    notCalibrated('(9)-(19) THE ON LEG', 'LOD_OFF_ONLY=1 — the flag-on column was not measured by this run');
  } else {
    // maxConcurrent is SOURCE-PARSED rather than hard-coded: it is D's number,
    // and a gate that copies another owner's constant goes quietly stale the
    // day they tune it.
    //
    // ANCHORED TO THE KEY, AND THE VALUE IS PRINTED. D's own config readers
    // matched a block's PROSE before the key twice in one gate — these blocks
    // carry long comments that quote their own knobs, so `/key:\s*(\d+)/`
    // will happily read a number out of an English sentence. The pattern is
    // therefore `^\s*key:` in multiline mode, the search is bounded to the
    // object literal (first line that is exactly `};`), and the parsed value
    // is echoed so a wrong read is visible in the log rather than silently
    // relaxing a threshold.
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'lib', 'fly', 'fly-constants.js'),
      'utf8'
    );
    const after = src.slice(src.indexOf('export const LOD_CROSSFADE'));
    const endM = after.match(/^};$/m);
    const block = endM ? after.slice(0, endM.index) : after;
    const mMax = block.match(/^\s*maxConcurrent:\s*(\d+)/m);
    const MAXC = mMax ? Number(mMax[1]) : null;
    console.log(
      `ON  source-parsed LOD_CROSSFADE.maxConcurrent = ${MAXC ?? 'NOT FOUND'} ` +
        `(anchored ^\\s*maxConcurrent:, block ${block.length} chars)`
    );

    // The pin. `fadeSec` is deliberately NOT pinned: 0.25 s of fade clock is 5
    // rendered frames at any fps (the dt clamp), which is enough for the blend
    // to be entered and drained inside this sweep, and it is the number that
    // ships. `LOD_FADE_SEC` exists only for a mid-fade screenshot on a real
    // GPU. `skipBootMs: 0` is [D2].
    const PIN = { enabled: true, skipBootMs: 0 };
    if (process.env.LOD_FADE_SEC) PIN.fadeSec = Number(process.env.LOD_FADE_SEC);
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const fx2 = process.env.FLY_TILE_FIXTURE ? await require('./_fixture').attachFixture(ctx2) : null;
    const p2 = await ctx2.newPage();
    const errors2 = [];
    p2.on('pageerror', (e) => errors2.push(String(e)));
    await p2.addInitScript(INSTALL_TILE_CENSUS);
    await p2.addInitScript(([pin]) => {
      window.__flyLodFadeOverride = pin;
    }, [PIN]);

    console.log(`\n=== ON LEG — __flyLodFadeOverride ${JSON.stringify(PIN)} ===`);
    await bootFly(p2, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
    await p2.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
    await p2.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
      timeout: 120000,
      polling: 250,
    });

    // [D7] both legs must be streaming under the SAME pace policy.
    const pace = await Promise.all([
      page.evaluate(() => window.__flyTerraPaceOverride ?? null),
      p2.evaluate(() => window.__flyTerraPaceOverride ?? null),
    ]);
    gate(
      '(9) TERRA_PACE IS THE SHIPPED STATE ON BOTH LEGS — no pace pin on either page',
      pace[0] == null && pace[1] == null,
      `OFF ${JSON.stringify(pace[0])} · ON ${JSON.stringify(pace[1])} — pinning the streamer on ` +
        'one leg only would make the two columns describe two different worlds'
    );

    await p2.evaluate(PIN_POSE, POWELL);
    await p2.waitForTimeout(SETTLE);
    // [D3]/[D-C2] the warp cut is 900 ms of FADE CLOCK — 18 rendered frames at
    // this venue, ~54 at 60 fps, ~130 at 144 Hz. No frame count is right on
    // every machine, so wait for skip.warp to STOP ADVANCING instead of
    // guessing at the duration. Identical call on the OFF arm (see above).
    const onWarp = await waitSettled(p2, () => window.__flyStats?.terra?.fades?.skip?.warp ?? 0, {
      label: 'ON skip.warp',
    });
    const warpFrames = onWarp.frames;

    const f0 = await p2.evaluate(SNAP_FADES);
    if (fx2) await fx2.resetStats();
    await p2.evaluate(() => {
      const S = window.__lodWatch;
      S.frames = S.hardSwaps = S.hardMerges = S.appears = S.disappears = 0;
      S.crossfadeFrames = S.maxOverlapRun = S.reappears = 0;
      S.samples.length = 0;
    });
    await p2.evaluate(START_YAW, [YAW_SEC]);
    await p2.waitForTimeout(YAW_SEC * 1000 + 4000);
    const w2 = await p2.evaluate(() => ({ ...window.__lodWatch, seenEver: undefined, samples: undefined }));
    const f1 = await p2.evaluate(SNAP_FADES);
    // [D5]/[D-C1] THE DRAIN IS A POLL, NOT A FRAME COUNT. A fixed
    // waitFrames(10) is 500 ms of fade clock here and 167 ms at 60 fps, so a
    // hard `active === 0` after it is a FALSE RED on a fast machine — the gate
    // would fail exactly where the feature works. Poll to the cap and report
    // what it took; the cap being hit is itself the finding.
    const drain = await waitUntil(p2, () => (window.__flyStats?.terra?.fades?.active ?? 1) === 0, {
      capFrames: 90,
      label: 'blend drain (active -> 0)',
    });
    const drainFrames = drain.frames;
    const f2 = await p2.evaluate(SNAP_FADES);
    const d = (k) => (f1 && f0 ? (f1[k] ?? 0) - (f0[k] ?? 0) : NaN);
    const ds = (k) => (f1 && f0 ? (f1.skip?.[k] ?? 0) - (f0.skip?.[k] ?? 0) : NaN);
    const swapsON = d('refines') + d('merges');

    console.log(
      `ON  SWEEP: ${w2.frames} frames · ${w2.appears} appearances / ${w2.disappears} disappearances · ` +
        `${w2.reappears} RE-appearances · ${w2.hardSwaps} hard refines · ${w2.hardMerges} hard merges · ` +
        `co-display run ${w2.maxOverlapRun}   [frame-diff census — NOT D's counters]`
    );
    console.log(
      `ON  terra.fades (delta over the sweep): refines ${d('refines')} · merges ${d('merges')} · ` +
        `hardSwaps ${d('hardSwaps')} · faded ${d('faded')} · active now ${f2?.active} · retained ` +
        `${f2?.retained} · peakActive ${f1?.peakActive} (SESSION high-water, includes boot) / max ${MAXC ?? '?'}`
    );
    console.log(
      `ON  skip: disabled ${ds('disabled')} · boot ${ds('boot')} · warp ${ds('warp')} · ` +
        `concurrency ${ds('concurrency')} · shape ${ds('shape')} · noParentMap ${ds('noParentMap')} · ` +
        `unpatched ${ds('unpatched')}   [warp settle was ${warpFrames} rendered frames, drain ${drainFrames}]`
    );
    console.log(
      `OFF vs ON, side by side — D's counters: refines+merges ${offLeg.refines}+${offLeg.merges} -> ` +
        `${d('refines')}+${d('merges')} · hardSwaps ${offLeg.hardSwapsD} -> ${d('hardSwaps')} · faded ` +
        `${offLeg.fadedD} -> ${d('faded')}\n` +
        `                        frame-diff census: hard ${offLeg.hardSwaps}+${offLeg.hardMerges} -> ` +
        `${w2.hardSwaps}+${w2.hardMerges} · re-appearances ${offLeg.reappears} -> ${w2.reappears} · ` +
        `co-display run ${offLeg.overlapRun} -> ${w2.maxOverlapRun} · frames ${offLeg.frames} -> ${w2.frames}`
    );

    // ---- the preconditions, before any claim about the feature -------------
    gate(
      '(10) THE ON LEG IS ACTUALLY ARMED — the override reached the ladder',
      f1 != null && ds('disabled') === 0,
      `skip.disabled ${ds('disabled')} (must be 0 — EVERY swap increments it when the flag is off). ` +
        'A run where the pin silently missed looks exactly like a run where nothing swapped, which ' +
        'is why this precedes every other ON gate'
    );
    gate(
      '(11) THE WINDOW CONTAINS SWAPS — refines + merges > 0',
      swapsON > 0,
      `${d('refines')} refines + ${d('merges')} merges = ${swapsON}. Zero here makes every gate ` +
        'below NOT CALIBRATED, not green: nothing was offered to the ladder'
    );
    gate(
      '(12) NO FADE WAS DENIED FOR A REASON THAT IS A DEFECT',
      ds('shape') === 0 && ds('noParentMap') === 0 && ds('unpatched') === 0,
      `shape ${ds('shape')} · noParentMap ${ds('noParentMap')} · unpatched ${ds('unpatched')} — each ` +
        'must be 0. unpatched in particular means a material the ladder could not reach, i.e. the ' +
        'pin landed after patching'
    );
    if (ds('warp') !== 0)
      soft(
        '(12b) WARP SUPPRESSION LEAKED INTO THE WINDOW',
        `skip.warp ${ds('warp')} — the snapshot was taken inside the 900 fade-ms (18 rendered ` +
          `frame) warp cut, not a defect. Warp settle measured ${warpFrames} frames; lengthen it`
      );

    if (swapsON <= 0) {
      notCalibrated(
        '(13)-(17) THE ON-LEG FLIP CRITERIA',
        'refines + merges is 0 in the measured window — the ladder was never offered a swap, so ' +
          '"faded > 0" and "hardSwaps fell" would both be readings of an empty population'
      );
    } else {
      // [D1] the ladder identity and the mass transfer.
      gate(
        '(13) LADDER BOOKKEEPING, ON ARM — refines + merges === hardSwaps + faded',
        swapsON === d('hardSwaps') + d('faded'),
        `${d('refines')} + ${d('merges')} = ${swapsON} vs ${d('hardSwaps')} + ${d('faded')} = ` +
          `${d('hardSwaps') + d('faded')}`
      );
      // [D-C4] BOTH OF THESE COMPARE AGAINST THE OFF ARM, so they need the
      // OFF arm's own calibration guard — the mirror of (11). An OFF leg that
      // was offered no swaps makes "flat" and "dropped" readings of an empty
      // population, and a comparison against 0 is not a red.
      const swapsOFF = offLeg.refines + offLeg.merges;
      // [D-C3] …and the two arms only render comparable numbers of frames by
      // luck at 1-3 fps. Strict equality of a per-frame-ish count across two
      // legs that rendered 47 and 12 frames would be a coin. The window has to
      // be comparable before the equality means anything.
      const framesOFF = offLeg.frames;
      const framesON = w2.frames;
      const frameRatio = framesOFF > 0 ? framesON / framesOFF : NaN;
      const comparable = Number.isFinite(frameRatio) && frameRatio >= 0.75 && frameRatio <= 1.25;
      if (!Number.isFinite(swapsOFF) || swapsOFF === 0)
        notCalibrated(
          '(14)/(15) THE OFF-ARM COMPARISONS',
          `the OFF leg recorded ${swapsOFF} refines + merges — with no swaps on that side, "flat" ` +
            'and "hardSwaps dropped" are both comparisons against an empty population'
        );
      else {
        if (!comparable)
          notCalibrated(
            '(14) THE FEATURE DOES NOT CHANGE HOW OFTEN THE LOD REFINES — refines + merges FLAT',
            `the two arms did not render comparable numbers of frames (OFF ${framesOFF} -> ON ` +
              `${framesON}, ratio ${Number.isFinite(frameRatio) ? frameRatio.toFixed(2) : frameRatio}, ` +
              'tolerance ±25%). At 1-3 fps the swap count follows the frame count, so equality here ' +
              'would be decided by load rather than by the feature'
          );
        else
          gate(
            '(14) THE FEATURE DOES NOT CHANGE HOW OFTEN THE LOD REFINES — refines + merges FLAT',
            swapsOFF === swapsON,
            `OFF ${swapsOFF} -> ON ${swapsON} over ${framesOFF} -> ${framesON} frames (ratio ` +
              `${frameRatio.toFixed(2)}). A crossfade may only put a blend over the swaps the ` +
              "quadtree already makes; changing their COUNT would mean it moved the streamer, " +
              "which is A's territory and a different flag"
          );
        gate(
          '(15) THE MASS MOVED — faded RISES and hardSwaps DROPS toward 0',
          d('faded') > 0 && d('hardSwaps') < offLeg.hardSwapsD,
          `faded ${offLeg.fadedD} -> ${d('faded')} · hardSwaps ${offLeg.hardSwapsD} -> ${d('hardSwaps')}. ` +
            "D's flip criterion, stated the way the counters actually work. NOTE: with skipBootMs " +
            'pinned to 0 the BOOT itself fades, so peakActive may have been set before the sweep — ' +
            'faded > 0 IN THE WINDOW is the sweep proof, not the high-water mark'
        );
      }
      gate(
        '(16) EVERY BLEND DRAINS, AND NOTHING IS RETAINED AT REST',
        f2 != null && f2.active === 0 && f2.retained === 0,
        `active ${f2?.active} · retained ${f2?.retained} after ${drainFrames} rendered frames ` +
          `(${drain.ok ? 'drained' : `NEVER DRAINED — hit the ${90}-frame cap`}). retained > 0 at ` +
          'rest is a PARENT-TEXTURE LEAK — a parent map kept alive past unloadModel() forever — ' +
          'and is the single most important thing this leg can catch'
      );
      gate(
        '(17) CONCURRENCY IS BOUNDED AND WAS EXERCISED — 0 < peakActive <= maxConcurrent',
        MAXC != null && f1 != null && f1.peakActive > 0 && f1.peakActive <= MAXC,
        `peakActive ${f1?.peakActive} against maxConcurrent ${MAXC ?? '?'} (source-parsed). This is a ` +
          'session high-water mark, so it includes boot'
      );
      // [D6] a denial for concurrency is the bound doing its job ONLY at the cap.
      if (ds('concurrency') > 0 && f1?.peakActive === MAXC)
        soft(
          '(17b) FADES DENIED AT THE CAP',
          `skip.concurrency ${ds('concurrency')} with peakActive at the cap (${MAXC}) — the bound ` +
            'doing exactly its job: reported, not failed'
        );
      else
        gate(
          '(17b) NO FADE WAS DENIED FOR CONCURRENCY BELOW THE CAP',
          ds('concurrency') === 0,
          `skip.concurrency ${ds('concurrency')} with peakActive ${f1?.peakActive} < ${MAXC ?? '?'} — ` +
            'a denial below the cap means the accounting, not the bound, decided which swaps got a blend'
        );
    }

    soft(
      '(4-ON)/(5-ON) RECOMPUTED BY THE SAME CENSUS THAT MEASURED 0',
      `hard refines ${w2.hardSwaps} · hard merges ${w2.hardMerges} · longest co-display run ` +
        `${w2.maxOverlapRun}. The co-display run is EXPECTED to stay at ${offLeg.overlapRun}: ` +
        'parentBlend never keeps the parent drawn, so this number is not a flip criterion. The ' +
        'blend is visible in terra.fades.faded above, and in a mid-fade screenshot on a real GPU'
    );

    await p2.evaluate(PIN_POSE, OWENS);
    const owensSettleOn = await settleWorld(p2, { capMs: 300000 });
    console.log(
      `  ON  Owens settle: ${owensSettleOn.settled ? 'SETTLED' : `NOT settled — ${owensSettleOn.why}`} ` +
        `in ${(owensSettleOn.ms / 1000).toFixed(0)}s (maxZ ${owensSettleOn.maxZ}, load ${owensSettleOn.load})`
    );
    const owens2 = await p2.evaluate(() => ({
      draws: window.__flyStats?.drawCalls ?? null,
      tris: window.__flyStats?.triangles ?? null,
    }));
    console.log(`ON  Owens (fixture column): draws=${owens2.draws} tris=${owens2.tris}`);
    // [D8] EQUAL to the OFF leg's fixture numbers, not "under the live ceiling".
    if (!owensSettleOff.settled || !owensSettleOn.settled)
      notCalibrated(
        '(18) OWENS IS BIT-FOR-BIT THE SAME SCENE — draws AND triangles equal the OFF leg',
        `an arm did not settle (OFF ${owensSettleOff.settled} — ${owensSettleOff.why} · ON ` +
          `${owensSettleOn.settled} — ${owensSettleOn.why}). Read: ON ${owens2.draws}/${owens2.tris} ` +
          `vs OFF ${offLeg.owensDraws}/${offLeg.owensTris}. Equality across an unsettled scene is a ` +
          'race with the streamer, not a property of the flag'
      );
    else
      gate(
        '(18) OWENS IS BIT-FOR-BIT THE SAME SCENE — draws AND triangles equal the OFF leg',
        Number.isFinite(owens2.draws) &&
          owens2.draws === offLeg.owensDraws &&
          owens2.tris === offLeg.owensTris,
        `ON ${owens2.draws} draws / ${owens2.tris} tris vs OFF ${offLeg.owensDraws} / ${offLeg.owensTris}. ` +
          'Equality is the assertion — the live <= 261 ceiling is not what this leg is for; a ' +
          'crossfade adds nothing where there is nothing to fade'
      );
    gate('(19) NO PAGE ERRORS ON THE ON LEG', errors2.length === 0, errors2.slice(0, 3).join(' | ') || 'clean');
    await ctx2.close();
  }

  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  console.log(`\n${pass} passed, ${fail} failed${notCalSummary()}`);
  await browser.close();
  process.exit(fail || notCalCount() ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

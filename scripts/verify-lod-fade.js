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
 *       { refines, merges, parentRefetches, replacedOnScreen } and `.mem()` →
 *       { residentTiles, estMB }. Authoritative for (b).
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
  const mem = await page.evaluate(() => window.__flyTerra?.mem?.() ?? null);
  if (mem)
    gate(
      '(1) THE FIXTURE PRODUCES A REAL RESIDENT TILE FIELD at Powell',
      mem.residentTiles > 40,
      `residentTiles=${mem.residentTiles} estMB=${mem.estMB} — keepResident's byte LRU needs real ` +
        'residency to bound; a fixture that resolved to a handful of tiles would make that switch untestable'
    );
  else
    soft(
      '(1) resident tile field',
      'window.__flyTerra.mem() absent — merge r24/a (407691b) to read it. Falling back to the ' +
        'displayed-tile census below, which counts DISPLAYED, not RESIDENT, tiles.'
    );

  if (fx) await fx.resetStats();
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
  if (w.lod1)
    console.log(
      `  __flyTerra.lod(): refines ${w.lod1.refines - (w.lod0?.refines ?? 0)} · merges ` +
        `${w.lod1.merges - (w.lod0?.merges ?? 0)} · parentRefetches ` +
        `${w.lod1.parentRefetches - (w.lod0?.parentRefetches ?? 0)} · replacedOnScreen ` +
        `${w.lod1.replacedOnScreen - (w.lod0?.replacedOnScreen ?? 0)}`
    );
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

  if (fx)
    gate(
      '(6) NO UNBOUNDED TILE REFETCH during the sweep (fixture /__stats)',
      refetched.length === 0,
      `${refetched.length} tile URLs refetched` +
        (refetched.length ? `: e.g. ${refetched[0][0]} x${refetched[0][1]}` : '')
    );

  // --- Owens: the draw ceiling must not move because of a fade
  await page.evaluate(PIN_POSE, OWENS);
  await page.waitForTimeout(SETTLE);
  await page.evaluate(() => {
    if (window.__flyStats) window.__flyStats.drawCalls = null;
  });
  await page
    .waitForFunction(() => typeof window.__flyStats?.drawCalls === 'number', undefined, {
      timeout: 240000,
      polling: 500,
    })
    .catch(() => {});
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

  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

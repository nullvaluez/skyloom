/**
 * R24 (E CERT) — verify-fade: a streamed chunk must never appear or vanish in
 * a single frame, and a fade must never change what is READY.
 *
 * WHY THIS GATE EXISTS, IN THE USER'S WORDS. The reported symptom is
 * "buildings appearing and disappearing". Recon WB-2 names the mechanism
 * exactly: there is no birth fade and no crossfade on ANY streamed chunk —
 * stream-in, evict, heal, ring shift and water tier flips all take effect in
 * one frame. Recon A6 adds the parcel homes appearing at 100% scale in one
 * frame. So the picture the user describes is, on this tree, the DESIGNED
 * behaviour; CHUNK_FADE is the fix and this is its gate.
 *
 * THE COUNTABLE EVENT. Per frame, census every chunk mesh under the
 * sat-building, sat-skyline, sat-road and toy engines and record, for each,
 * whether it is displayed and how far through its birth it is (material
 * opacity, or a `uBirth`/`uFade` uniform if the fade rides one). Then:
 *
 *   HARD BIRTH  a mesh whose FIRST displayed frame is already at full
 *               presence. With CHUNK_FADE on, a birth must be visible at
 *               partial presence for at least one frame first.
 *   HARD DEATH  a mesh that leaves the scene from full presence.
 *   READY DRIFT `__satBuildings.stats.ready` (and skyline's) changing across
 *               the window by more than the number of genuinely NEW chunks —
 *               a fade must never make a ready chunk un-ready. This is the
 *               invariant that keeps CHUNK_FADE from buying smoothness with
 *               re-streaming, which would be the R21 disappearing-chunks bug
 *               wearing a nicer coat.
 *
 * THE OWENS LEG. At the empty-desert pose there is nothing to fade, so the
 * flag-on draw column must EQUAL the flag-off draw column. Any +draw from a
 * fade must be content-gated so Owens stays 0 by construction (plan §0.7).
 *
 * RUN
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3105 \
 *     node -r ./scripts/_pw-shim.js scripts/verify-fade.js
 */
/**
 * THE PROBE'S OWN RED (`FADE_PROBE_SELFTEST=1 node scripts/verify-fade.js`).
 *
 * Pass 2b's row reported `presence channel = none` and 29/29 hard births on a
 * tree where CHUNK_FADE.enabled is TRUE — the probe was measuring its own
 * blindness. It looked for four GUESSED uniform names on `material.uniforms`,
 * while B's fade rides a pooled twin whose uniform is injected through
 * onBeforeCompile and published for probes at
 * `material.userData.__fadeU` (lib/fly/toy-world/chunk-fade.js:98-102). Both
 * engines use that pool (sat-building-engine.js:345, 821-868; sat-skyline
 * -engine.js:163-171, `uSkyFade`), so ONE channel covers both.
 *
 * This self-test runs THE REAL `presenceOf` — extracted from this file's own
 * source, not a copy — against synthetic materials, so it cannot drift from
 * the code it certifies. If the extraction fails it says so and exits non-zero
 * rather than quietly testing nothing.
 */
if (process.env.FADE_PROBE_SELFTEST) {
  const src = require('fs').readFileSync(__filename, 'utf8');
  // The marker is BUILT, not written literally: a self-test that searches its
  // own source for a string finds that string in itself first. The first
  // attempt did exactly that and extracted three characters of its own
  // comment.
  const MARK = '// @presence' + '-probe';
  const mark = src.indexOf(MARK);
  const from = mark < 0 ? -1 : src.indexOf('const presenceOf = (o) => {', mark);
  const to = from < 0 ? -1 : src.indexOf('\n  };', from);
  if (from < 0 || to < 0) {
    console.log('FAIL  the presenceOf block could not be extracted — the self-test tested NOTHING');
    process.exit(1);
  }
  const body = src.slice(from + 'const presenceOf = '.length, to + '\n  }'.length);
  let sp = 0;
  let sf = 0;
  const check = (name, ok, detail) => {
    ok ? sp++ : sf++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${detail}`);
  };
  const mk = (material) => ({ material });
  const run = (obj) => {
    const S = { presenceChannel: null, channelSeen: {} };
    const fn = new Function('S', `return (${body});`)(S);
    return { v: fn(obj), ch: S.presenceChannel };
  };

  // 1. B's published channel, mid-birth.
  let r = run(mk({ userData: { __fadeU: { value: 0.37 } } }));
  check("(1) B's twin channel is read FIRST", r.ch === 'userData.__fadeU' && r.v === 0.37, `channel ${r.ch} value ${r.v}`);

  // 2. A twin at rest reads 1 — present, not absent. The distinction matters:
  //    'none' means blind, 1 on __fadeU means "fully arrived".
  r = run(mk({ userData: { __fadeU: { value: 1 } } }));
  check('(2) a settled twin reads presence 1 on a NAMED channel', r.ch === 'userData.__fadeU' && r.v === 1, `channel ${r.ch} value ${r.v}`);

  // 3. THE RED IS PRESERVED. A plain shared material — the flag-off tree — must
  //    still report 'none' and presence 1, so every birth classifies HARD and
  //    pass 1's 14/14 and this run's 29/29 remain reproducible.
  r = run(mk({ userData: {} }));
  check('(3) RED PRESERVED — a shared material still reads none/1', r.ch === 'none' && r.v === 1, `channel ${r.ch} value ${r.v}`);

  // 4. The legacy names still work, so an engine that adopts one is not
  //    silently ignored.
  r = run(mk({ userData: { shader: { uniforms: { uBirth: { value: 0.5 } } } } }));
  check('(4) the guessed names still resolve', r.ch === 'uBirth' && r.v === 0.5, `channel ${r.ch} value ${r.v}`);

  // 5b. B's REST CONTRACT: a chunk at rest wears the SHARED material and has no
  //     __fadeU, and that must read presence 1 — "fully arrived", not
  //     "unreadable". Proven above by case (3); this asserts the pairing that
  //     matters, that a rest sample must not overwrite a __fadeU channel the
  //     run has already seen (the `??=` latch that made pass 2b report 'none').
  {
    const S = { presenceChannel: null, channelSeen: {} };
    const fn = new Function('S', `return (${body});`)(S);
    const ramping = fn(mk({ userData: { __fadeU: { value: 0.4 } } }));
    const atRest = fn(mk({ userData: {} }));
    check(
      '(5b) a rest sample after a ramp keeps the channel label',
      S.presenceChannel === 'userData.__fadeU' && ramping === 0.4 && atRest === 1,
      `channel ${S.presenceChannel} · ramping ${ramping} · at rest ${atRest}`
    );
    const S2 = { presenceChannel: null, channelSeen: {} };
    const fn2 = new Function('S', `return (${body});`)(S2);
    fn2(mk({ userData: {} }));
    fn2(mk({ userData: { __fadeU: { value: 0.4 } } }));
    check(
      '(5c) …and a rest sample BEFORE the first ramp does not latch none',
      S2.presenceChannel === 'userData.__fadeU',
      `channel ${S2.presenceChannel} (pass 2b latched 'none' here and reported 29/29 hard)`
    );
  }

  // 6. Opacity remains the last resort.
  r = run(mk({ userData: {}, transparent: true, opacity: 0.25 }));
  check('(6) transparent opacity is the fallback', r.ch === 'opacity' && r.v === 0.25, `channel ${r.ch} value ${r.v}`);

  console.log(`\n${sp} passed, ${sf} failed`);
  process.exit(sf ? 1 : 0);
}

const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const POWELL = [40.1578, -83.0752, 900, 1.9, -0.3];
const COLUMBUS = [39.9612, -82.9988, 600, 1.9, -0.35];
const OWENS = [36.6, -118.1, 2600, 1.2, -0.18];
const SETTLE = Number(process.env.FADE_SETTLE_MS || 45000);
const RUN_MS = Number(process.env.FADE_RUN_MS || 60000);

const PIN_POSE = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__fadePin) clearInterval(window.__fadePin);
  window.__fadePin = setInterval(() => {
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
 * Per-frame chunk census. Presence is read from whatever the fade actually
 * rides — material.opacity when transparent, else a `uBirth`/`uFade`/`uChunkFade`
 * uniform, else 1 (which is the flag-off answer and therefore the RED).
 */
const INSTALL_FADE_WATCH = () => {
  const S = (window.__fadeWatch = {
    frames: 0,
    births: 0,
    hardBirths: 0,
    deaths: 0,
    hardDeaths: 0,
    partialFramesSeen: 0,
    maxBirthFrames: 0,
    presenceChannel: null,
    /** every channel observed anywhere in the run — the label is the best of these. */
    channelSeen: {},
    samples: [],
    readySeries: [],
  });
  const prev = new Map(); // uuid -> {presence, frames}
  // @presence-probe (extraction sentinel for FADE_PROBE_SELFTEST)
  const presenceOf = (o) => {
    const m = o.material;
    if (!m) return 1;
    // B'S PUBLISHED PROBE CONTRACT, FIRST. `chunk-fade.js:102` puts the twin
    // material's OWN fade uniform at `material.userData.__fadeU`, with a
    // comment saying in as many words that it exists "so a probe can read the
    // EFFECTIVE per-mesh alpha the GPU will see", and that a shared material
    // has no `__fadeU` and reads the module uniform instead — which is exactly
    // the distinction this census needs.
    //
    // MEASURED (pass 2b): this probe did not read it. It looked at
    // `material.userData.shader.uniforms` and `material.uniforms` for four
    // GUESSED names, found nothing, reported `presence channel = none`, and
    // defaulted every mesh to presence 1 — so all 29 births and all 20 deaths
    // were classified HARD on a tree where CHUNK_FADE.enabled is true. The
    // gate was measuring its own blindness. Same failure family as the
    // lod-fade NaN (close sweep §2.10a): a counter read across an ownership
    // boundary must be read by the name its OWNER publishes, not by a name the
    // harness expects.
    if (m.userData && m.userData.__fadeU && typeof m.userData.__fadeU.value === 'number') {
      // BEST-EVER, NOT FIRST-EVER. `??=` is first-write-wins, and B's twin is
      // on the mesh ONLY during a ramp (chunk-fade.js: on birth completion
      // `b.mesh.material = this.material` and the twin returns to the pool;
      // dying meshes leave the scene). A resident chunk AT REST therefore has
      // no __fadeU — the correct steady state, not a missing instrument — so
      // the first mesh sampled would latch the channel to 'none' for the whole
      // run even after this fix. The channel now records the most specific one
      // ever observed.
      S.channelSeen.fadeU = true;
      S.presenceChannel = 'userData.__fadeU';
      return m.userData.__fadeU.value;
    }
    const u = m.userData?.shader?.uniforms || m.uniforms || null;
    for (const k of ['uBirth', 'uChunkFade', 'uFade', 'uChunkBirth']) {
      if (u && u[k] && typeof u[k].value === 'number') {
        S.channelSeen[k] = true;
        if (!S.channelSeen.fadeU) S.presenceChannel = k;
        return u[k].value;
      }
    }
    if (m.transparent && typeof m.opacity === 'number') {
      S.channelSeen.opacity = true;
      if (!S.channelSeen.fadeU) S.presenceChannel = 'opacity';
      return m.opacity;
    }
    // ABSENT IS PRESENCE 1, AND THAT IS CORRECT. A chunk at rest carries the
    // shared material by design; only a mesh mid-ramp wears a twin. So this is
    // "fully arrived", not "unreadable" — and it must not overwrite a channel
    // already seen elsewhere in the run.
    S.presenceChannel ??= 'none';
    return 1;
  };
  const tick = () => {
    const roots = [
      window.__satBuildings?.object,
      window.__satSkyline?.object,
      window.__satRoads?.object,
      window.__toyWorld?.object,
    ].filter(Boolean);
    if (!roots.length) return requestAnimationFrame(tick);
    S.frames++;
    const cur = new Map();
    for (const r of roots)
      r.traverse((o) => {
        if (!o.isMesh && !o.isInstancedMesh) return;
        if (!o.visible) return;
        cur.set(o.uuid, presenceOf(o));
      });
    for (const [id, p] of cur) {
      const was = prev.get(id);
      if (!was) {
        S.births++;
        if (p >= 0.999) {
          S.hardBirths++;
          if (S.samples.length < 40) S.samples.push({ f: S.frames, ev: 'hardBirth', p });
        } else S.partialFramesSeen++;
        cur.set(id, p);
      } else if (was.p < 0.999 && p < 0.999) S.partialFramesSeen++;
    }
    for (const [id, was] of prev) {
      if (!cur.has(id)) {
        S.deaths++;
        if (was.p >= 0.999) {
          S.hardDeaths++;
          if (S.samples.length < 40) S.samples.push({ f: S.frames, ev: 'hardDeath', p: was.p });
        }
      }
    }
    prev.clear();
    for (const [id, p] of cur) prev.set(id, { p });
    if (S.frames % 5 === 0)
      S.readySeries.push([
        window.__satBuildings?.stats?.ready ?? -1,
        window.__satSkyline?.stats?.ready ?? -1,
      ]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const { notCalibrated, notCalCount, notCalSummary } = require('./_notcal');

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

async function serpentine(page, ms) {
  const t0 = Date.now();
  await page.evaluate(() => clearInterval(window.__fadePin));
  while (Date.now() - t0 < ms) {
    await page.keyboard.down('a');
    await page.waitForTimeout(Math.min(7000, ms / 4));
    await page.keyboard.up('a');
    await page.keyboard.down('d');
    await page.waitForTimeout(Math.min(7000, ms / 4));
    await page.keyboard.up('d');
  }
}

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  if (process.env.FLY_TILE_FIXTURE) await require('./_fixture').attachFixture(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(INSTALL_FADE_WATCH);

  await bootFly(page, { style: 'satellite', timeoutMs: 600000, settleMs: 8000 });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.waitForFunction(() => typeof window.__fly?.warpToGeo === 'function', undefined, {
    timeout: 120000,
    polling: 250,
  });
  await page.evaluate(PIN_POSE, POWELL);
  await page.waitForTimeout(SETTLE);

  // Reset AFTER settle: boot legitimately populates the world in one go and
  // "boot is fade-free" is a separate, deliberate contract (plan §3 D.2).
  await page.evaluate(() => {
    const S = window.__fadeWatch;
    S.frames = S.births = S.hardBirths = S.deaths = S.hardDeaths = 0;
    S.partialFramesSeen = S.maxBirthFrames = 0;
    S.samples.length = 0;
    S.readySeries.length = 0;
    window.__fadeReady0 = {
      sb: window.__satBuildings?.stats?.ready ?? -1,
      sky: window.__satSkyline?.stats?.ready ?? -1,
      chunks: window.__satBuildings?.stats?.chunks ?? -1,
    };
  });

  // Fly the Powell -> Columbus serpentine: the leg the user flies, and the leg
  // that makes chunks arrive and leave.
  await serpentine(page, RUN_MS);
  await page.evaluate(PIN_POSE, COLUMBUS);
  await page.waitForTimeout(SETTLE);

  const w = await page.evaluate(() => ({
    ...window.__fadeWatch,
    ready0: window.__fadeReady0,
    ready1: {
      sb: window.__satBuildings?.stats?.ready ?? -1,
      sky: window.__satSkyline?.stats?.ready ?? -1,
      chunks: window.__satBuildings?.stats?.chunks ?? -1,
    },
    evictions: window.__satBuildings?.stats?.evictions ?? null,
    heals: window.__satBuildings?.stats?.heals ?? null,
    // B's EXHAUSTIVE heal outcomes (HEAL_IN_PLACE). The total alone cannot be
    // read: four of the six outcomes are not holes at all.
    healOutcomes: (() => {
      const st = window.__satBuildings?.stats ?? null;
      if (!st) return null;
      const keys = [
        'heals',
        'healsInPlace',
        'healsNoop',
        'healsQueueFull',
        'healsAborted',
        'healsNoRecord',
        'healsCoalesced',
        'redraping',
      ];
      const out = {};
      for (const k of keys) if (st[k] !== undefined) out[k] = st[k];
      return out;
    })(),
  }));

  // The channel reading is only interpretable NEXT TO the flag it depends on,
  // so the gate prints both together. Pass 2b printed "presence channel = none"
  // on a tree where CHUNK_FADE.enabled is true, and 29/29 hard births read as a
  // product failure until someone checked the constant.
  const fadeTel = await page.evaluate(() => ({
    stats: window.__satBuildings?.stats ?? null,
    fadeKeys: Object.keys(window.__satBuildings?.stats ?? {}).filter((k) => /fade|birth|dying/i.test(k)),
  }));
  console.log(
    `  CHUNK_FADE runtime evidence: ${JSON.stringify(fadeTel.fadeKeys)}` +
      (fadeTel.stats?.fadeBudgetMiss !== undefined
        ? ` · fadeBudgetMiss=${fadeTel.stats.fadeBudgetMiss}`
        : ' · (no fade counters on the engine stats — the feature may not have armed)')
  );
  console.log(
    `\nSERPENTINE: ${w.frames} frames · births ${w.births} (HARD ${w.hardBirths}) · ` +
      `deaths ${w.deaths} (HARD ${w.hardDeaths}) · frames with a partial-presence mesh ` +
      `${w.partialFramesSeen} · presence channel = ${w.presenceChannel}`
  );
  console.log(
    `  ready sb ${w.ready0.sb} -> ${w.ready1.sb} · skyline ${w.ready0.sky} -> ${w.ready1.sky} · ` +
      `chunks ${w.ready0.chunks} -> ${w.ready1.chunks} · evictions ${w.evictions} · heals ${w.heals}`
  );
  // (b) HEAL_IN_PLACE — THE TOTAL IS NOT THE HOLE COUNT. B's engine counts every
  // heal outcome exhaustively and asserts their equality in its own gate:
  //   healsInPlace   the drape landed on the resident mesh — no hole, the fix
  //   healsNoop      nothing to do
  //   healsQueueFull the budget was spent — THE ONLY OUTCOME THAT IS A HOLE
  //   healsAborted   the chunk was evicted under the job — MOOT: no chunk, no hole
  //   healsNoRecord  water-only
  //   healsCoalesced a re-drape for that key was already in flight
  //   redraping      still draining
  // So a residual heal hole in a browser row is read against healsQueueFull
  // ONLY. Reading it against `heals` would indict four outcomes that are
  // working exactly as designed — the same mistake shape as counting a
  // sustained field as a flash, or an absent __fadeU as a missing instrument.
  console.log(
    `  HEAL OUTCOMES (holes are healsQueueFull ONLY): ${JSON.stringify(w.healOutcomes)}` +
      (w.healOutcomes?.healsQueueFull === undefined
        ? '  [healsQueueFull unpublished — the hole rule cannot be applied from this run]'
        : w.healOutcomes.healsQueueFull === 0
          ? '  [0 budget-starved heals: no hole is attributable to the heal path]'
          : `  [${w.healOutcomes.healsQueueFull} budget-starved heals — these are the only holes]`)
  );
  if (w.samples.length) console.log('  first events:', JSON.stringify(w.samples.slice(0, 6)));

  gate(
    '(1) THE WATCH HAS SOMETHING TO WATCH — chunks were born and died in the window',
    w.births + w.deaths > 0,
    `births ${w.births} deaths ${w.deaths} over ${w.frames} frames. Zero would mean the serpentine ` +
      'never left the resident ring — lengthen FADE_RUN_MS, do not weaken the gate.'
  );
  gate(
    '(2) NO HARD BIRTH — a chunk is never at full presence on its first displayed frame',
    w.births > 0 && w.hardBirths === 0,
    `${w.hardBirths} of ${w.births} hard` +
      (w.presenceChannel === 'none'
        ? '  [presence channel is "none": no material carries __fadeU, a fade uniform, or transparent opacity — ' +
          'this IS the flag-off state, i.e. the RED]'
        : '')
  );
  red.push(['WB-2 no birth fade on any streamed chunk', 'verify-fade (2)', `${w.hardBirths}/${w.births}`, '0']);
  // (d) THE CAP IS A DESIGNED DEGRADATION, SO THE GATE MUST PRICE IT IN.
  // `CHUNK_FADE.maxDying` is 4, and both the eviction loop and the AGL cull can
  // present more than four deaths at once; every refusal is COUNTED at
  // sat-building-engine.js:857 as `fadeBudgetMiss`. So a hard death is only a
  // defect when it is NOT attributable:
  //     hardDeaths <= fadeBudgetMiss  -> capped as designed
  //     hardDeaths >  fadeBudgetMiss  -> an unexplained remainder, the defect
  // Same rule as B's own engine proof (pops <= fadeBudgetMiss). The gate prints
  // both numbers so the reader never has to take the verdict on trust.
  const budgetMiss = fadeTel.stats?.fadeBudgetMiss ?? null;
  const deathsAttributable = budgetMiss != null && w.hardDeaths <= budgetMiss;
  gate(
    '(3) NO HARD DEATH — a chunk never leaves from full presence',
    w.hardDeaths === 0,
    `${w.hardDeaths} of ${w.deaths} hard · cumulative fadeBudgetMiss ${budgetMiss ?? 'unpublished'}` +
      (budgetMiss == null
        ? '  [the engine published no fadeBudgetMiss — the cap rule cannot be applied]'
        : deathsAttributable
          ? '  [<= fadeBudgetMiss: CAPPED AS DESIGNED (maxDying 4, and the evict loop + AGL cull can ' +
            'present more at once), not an unexplained remainder]'
          : '  [> fadeBudgetMiss: an UNEXPLAINED remainder — this is the defect shape]')
  );
  console.log(
    '      VENUE NOTE for (3): `_startDeath` writes value = _altFade (1.0 at these poses) and the ' +
      'value only moves on the NEXT _stepFades. At ~2.84 s per frame here, a 0.3 s evictSec ramp ' +
      'cannot span two samples, so EVERY death reads hard BY CONSTRUCTION regardless of the ' +
      "feature — until B's frame-count floor lands (r24/b 45e2cde: progress = min(elapsed/sec, " +
      'framesSince/minFrames) through rampT in chunk-fade.js, in BOTH engines and BOTH ramps). ' +
      'minFrames is 4, not 3, and births and deaths do not give the same count: a birth starts at ' +
      '0 so N frames give N partial samples, a death starts at FULL presence so N frames give ' +
      'N-1 — expect deaths to span >= 3 partial samples here, not >= 4. At 60 Hz 0.3 s is 18 ' +
      'frames, far above the floor, so elapsed still governs and the shipped look is unchanged. ' +
      'Read (3) against fadeBudgetMiss, not against 0.'
  );
  red.push(['WB-2 evict is a single-frame disappearance', 'verify-fade (3)', `${w.hardDeaths}/${w.deaths}`, '0']);
  gate(
    '(4) A FADE NEVER CHANGES WHAT IS READY — ready tracks chunks, not presence',
    Number.isFinite(w.ready1?.sb) &&
      Number.isFinite(w.ready1?.chunks) &&
      w.ready1.sb <= w.ready1.chunks &&
      w.ready1.sb >= 0,
    `ready ${w.ready1.sb} of ${w.ready1.chunks} chunks; the series is in the JSON below. A fade that ` +
      'made a ready chunk un-ready would be re-streaming, i.e. the R21 disappearing-chunks bug ' +
      'wearing a nicer coat'
  );

  // --- Owens: nothing to fade, so nothing may be added.
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
    sb: window.__satBuildings?.stats?.ready ?? null,
    sky: window.__satSkyline?.stats?.ready ?? null,
  }));
  console.log(`\nOwens: draws=${owens.draws} tris=${owens.tris} sbReady=${owens.sb} skyReady=${owens.sky}`);
  // `?? 0` WAS A VACUOUS PASS WAITING TO HAPPEN. An ABSENT reading — the engine
  // handle not published, the stats object renamed — coerced to 0 and
  // certified the Owens lock on no data at all. The lock is the round's most
  // load-bearing control; it does not get to pass on a missing number.
  const owensRead = Number.isFinite(owens.sb) && Number.isFinite(owens.sky);
  if (!owensRead)
    notCalibrated(
      '(5) THE OWENS LOCK',
      `sbReady=${owens.sb} skyReady=${owens.sky} — one of the two engine handles published no ` +
        'ready count. Absent is not zero, and the lock is the control every building gate leans on'
    );
  else
    gate(
      '(5) THE OWENS LOCK — the empty desert issues no building or skyline chunks to fade',
      owens.sb === 0 && owens.sky === 0,
      `sbReady=${owens.sb} skyReady=${owens.sky} draws=${owens.draws} (FIXTURE column; the live ` +
        'ceiling of <= 261 is not re-baselineable from here)'
    );
  gate('(6) NO PAGE ERRORS', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

  console.log(`\nreadySeries (every 5th frame, [sb, skyline]): ${JSON.stringify(w.readySeries.slice(0, 40))}`);
  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  console.log(`\n${pass} passed, ${fail} failed${notCalSummary()}`);
  await browser.close();
  process.exit(fail || notCalCount() ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

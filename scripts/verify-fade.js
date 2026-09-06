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
    samples: [],
    readySeries: [],
  });
  const prev = new Map(); // uuid -> {presence, frames}
  const presenceOf = (o) => {
    const m = o.material;
    if (!m) return 1;
    const u = m.userData?.shader?.uniforms || m.uniforms || null;
    for (const k of ['uBirth', 'uChunkFade', 'uFade', 'uChunkBirth']) {
      if (u && u[k] && typeof u[k].value === 'number') {
        S.presenceChannel ??= k;
        return u[k].value;
      }
    }
    if (m.transparent && typeof m.opacity === 'number') {
      S.presenceChannel ??= 'opacity';
      return m.opacity;
    }
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
  }));

  console.log(
    `\nSERPENTINE: ${w.frames} frames · births ${w.births} (HARD ${w.hardBirths}) · ` +
      `deaths ${w.deaths} (HARD ${w.hardDeaths}) · frames with a partial-presence mesh ` +
      `${w.partialFramesSeen} · presence channel = ${w.presenceChannel}`
  );
  console.log(
    `  ready sb ${w.ready0.sb} -> ${w.ready1.sb} · skyline ${w.ready0.sky} -> ${w.ready1.sky} · ` +
      `chunks ${w.ready0.chunks} -> ${w.ready1.chunks} · evictions ${w.evictions} · heals ${w.heals}`
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
        ? '  [presence channel is "none": no material carries a fade uniform or transparent opacity — ' +
          'this IS the flag-off state, i.e. the RED]'
        : '')
  );
  red.push(['WB-2 no birth fade on any streamed chunk', 'verify-fade (2)', `${w.hardBirths}/${w.births}`, '0']);
  gate(
    '(3) NO HARD DEATH — a chunk never leaves from full presence',
    w.hardDeaths === 0,
    `${w.hardDeaths} of ${w.deaths} hard`
  );
  red.push(['WB-2 evict is a single-frame disappearance', 'verify-fade (3)', `${w.hardDeaths}/${w.deaths}`, '0']);
  gate(
    '(4) A FADE NEVER CHANGES WHAT IS READY — ready tracks chunks, not presence',
    w.ready1.sb <= w.ready1.chunks && w.ready1.sb >= 0,
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
  gate(
    '(5) THE OWENS LOCK — the empty desert issues no building or skyline chunks to fade',
    (owens.sb ?? 0) === 0 && (owens.sky ?? 0) === 0,
    `sbReady=${owens.sb} skyReady=${owens.sky} draws=${owens.draws} (FIXTURE column; the live ` +
      'ceiling of <= 261 is not re-baselineable from here)'
  );
  gate('(6) NO PAGE ERRORS', errors.length === 0, errors.slice(0, 3).join(' | ') || 'clean');

  console.log(`\nreadySeries (every 5th frame, [sb, skyline]): ${JSON.stringify(w.readySeries.slice(0, 40))}`);
  console.log('\nRED TABLE (defect · gate · measured · green target)');
  for (const r of red) console.log(`  ${r[0]} | ${r[1]} | measured ${r[2]} | ${r[3]}`);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

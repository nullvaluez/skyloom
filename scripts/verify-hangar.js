/**
 * Round 17 §A1 — THE PLAYER HANGAR.
 *
 * Static gates (node, no browser — they run first and fail fast):
 *   1. every PLAYER_AIRCRAFT url exists on disk and is ≤ 1MB
 *   2. every PLAYER_AIRCRAFT url is already covered by FLY_ASSETS (the
 *      reuse-only rule: no new asset, therefore no new CC-BY credit)
 *   3. the FIGHTER has NO HANGAR.byId entry — the no-pick default has to fall
 *      through to the round-16 constants, not to hand-copied numbers
 *   4. TRAFFIC_MODELS is still length 13 and assets.js still holds exactly 10
 *      `{ url: '/models/` literals — this guards verify-warbirds gate d1 and
 *      verify-fleet's mapped-slot count BY CONSTRUCTION
 *
 * Browser gates:
 *   5. no saved pick ⇒ the FIGHTER — (a) the round-16 fx (burner armed, twin
 *      contrail, player-jet.glb parsed at 20 m, colour guard a no-op) and
 *      (b) an envelope that matches the round-16 FLIGHT block field for field
 *      (the "default = bit-identical" contract, pinned as literals here)
 *   6. mid-session swap (setAircraftId → warbird-jet): the GLB changes, the
 *      aircraft does NOT respawn (position continuity + heading preserved)
 *   7. the hangar UI opens from the pause menu, picks, and persists
 *   8. a persisted pick survives a reload and re-resolves pre-mount
 *   9. seeded 'cargo': the 747 loads, no afterburner mounts, boost 310
 *  10. pressing '3' in the cargo converges toward 310 and NEVER exceeds 400
 *  11. seeded 'glider': no burner, no contrail, audio profile 'wind'
 *  12. seeded 'military': every graded hull material whose geometry carries
 *      COLOR_0 has vertexColors true (the flat-white-hull guard) + a close-up
 *      screenshot — ALWAYS eyeball it, a white jet passes every numeric gate
 *  13. zero pageerrors across all four desktop sessions
 *  14. phone (390×844): full-bleed 100svh sheet, 9 cards, ≥44px controls, no
 *      horizontal overflow (the wave-2 mobile round builds on these testids)
 *  15. zero pageerrors (phone)
 *
 * Run: npm run dev (:3000), then `node scripts/verify-hangar.js`.
 * Debugging against a private dev server: FLY_URL=http://localhost:3101 node scripts/verify-hangar.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');
const { bootMobile, MOBILE_CTX, LAUNCH_ARGS } = require('./_mobile-boot');

const ROOT = path.join(__dirname, '..');
const MAX_GLB_BYTES = 1024 * 1024;
const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

const fails = [];
const gate = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** Seeded pre-mount. Idempotent across the reload gate's re-run. */
function seedAircraft(id) {
  try {
    localStorage.setItem('fly-aircraft', id);
  } catch {
    /* storage blocked — the gates below fail loudly */
  }
}

(async () => {
  // =========================================================================
  // STATIC
  // =========================================================================
  const paSrc = read('lib/fly/player-aircraft.js');
  const assetsSrc = read('lib/fly/assets.js');
  const constSrc = read('lib/fly/fly-constants.js');

  const ids = [...paSrc.matchAll(/^\s{4}id:\s*'([^']+)'/gm)].map((m) => m[1]);
  // Anchored to the entry indent — the file's own doc block quotes a
  // `{ url: '/models/` literal when it explains why this manifest is separate.
  const urls = [...paSrc.matchAll(/^\s{4}url:\s*'(\/models\/[^']+)'/gm)].map((m) => m[1]);
  gate(
    '1a PLAYER_AIRCRAFT is 9 aircraft, one url each, no helicopter',
    ids.length === 9 &&
      urls.length === 9 &&
      ids[0] === 'fighter' &&
      !urls.some((u) => u.includes('helicopter')),
    `${ids.length} ids [${ids.join(', ')}]`
  );

  let sizesOk = true;
  const sizeNotes = [];
  for (const u of urls) {
    const p = path.join(ROOT, 'public', u);
    const exists = fs.existsSync(p);
    const size = exists ? fs.statSync(p).size : -1;
    if (!exists || size > MAX_GLB_BYTES) sizesOk = false;
    sizeNotes.push(`${path.basename(u)} ${exists ? Math.round(size / 1024) + 'KB' : 'MISSING'}`);
  }
  gate('1b every player GLB exists on disk and is ≤ 1MB', sizesOk, sizeNotes.join(', '));

  // Reuse-only: every player url must already be a FLY_ASSETS `file:` entry, so
  // the credits panel (which renders from that manifest alone) stays complete
  // with ZERO credit work this round.
  const manifestFiles = new Set(
    [...assetsSrc.matchAll(/file:\s*'public(\/models\/[^']+\.glb)'/g)].map((m) => m[1])
  );
  const uncredited = urls.filter((u) => !manifestFiles.has(u));
  gate(
    '2 every player GLB is already credited in FLY_ASSETS (reuse-only)',
    uncredited.length === 0,
    uncredited.join(', ') || `${urls.length} urls covered by ${manifestFiles.size} manifest models`
  );

  // The fighter must be statically absent from HANGAR.byId.
  const hangarBlock = constSrc.slice(
    constSrc.indexOf('export const HANGAR = {'),
    constSrc.indexOf('\n};', constSrc.indexOf('export const HANGAR = {'))
  );
  const byIdBlock = hangarBlock.slice(hangarBlock.indexOf('byId: {'));
  const overrideKeys = [...byIdBlock.matchAll(/^\s{4}'?([a-z-]+)'?:\s*\{/gm)].map((m) => m[1]);
  gate(
    '3 the fighter has NO HANGAR.byId entry (default falls through to R16)',
    hangarBlock.length > 0 &&
      overrideKeys.length === 8 &&
      !overrideKeys.includes('fighter') &&
      overrideKeys.every((k) => ids.includes(k)),
    `byId keys: ${overrideKeys.join(', ')}`
  );

  const trafficLen = (() => {
    const body = assetsSrc.slice(
      assetsSrc.indexOf('export const TRAFFIC_MODELS = ['),
      assetsSrc.indexOf('\n];', assetsSrc.indexOf('export const TRAFFIC_MODELS = ['))
    );
    return (
      [...body.matchAll(/^\s{2}\{\s*url:/gm)].length + [...body.matchAll(/^\s{2}null,/gm)].length
    );
  })();
  const modelLiterals = [...assetsSrc.matchAll(/\{\s*url:\s*'\/models\//g)].length;
  gate(
    '4 assets.js untouched: TRAFFIC_MODELS 13 + 10 model url literals',
    trafficLen === 13 && modelLiterals === 10,
    `TRAFFIC_MODELS ${trafficLen}, literals ${modelLiterals}`
  );

  if (fails.length) {
    console.log(`VERIFY: FAIL (${fails.join(', ')})`);
    process.exit(1);
  }

  // =========================================================================
  // BROWSER
  // =========================================================================
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const errs = [];

  const session = async (label, seedId, fn, style = null) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(`${label}: ${e.message}`));
    if (seedId) await page.addInitScript(seedAircraft, seedId);
    await bootFly(page, { ...BOOT_OPTS, ...(style ? { style } : {}) });
    try {
      await fn(page);
    } finally {
      await ctx.close();
    }
  };

  const stats = (page) => page.evaluate(() => window.__flyStats ?? {});
  // The 60-frame dev-stats block writes `aircraft`; poll rather than assume.
  const waitAircraft = (page, id, timeout = 20000) =>
    page.waitForFunction(
      (want) => window.__flyStats?.aircraft?.id === want && !!window.__flyStats?.player,
      id,
      { timeout, polling: 200 }
    );

  // --- 5/6/7/8: default fighter → mid-session swap → UI pick → reload -------
  await session('default', null, async (page) => {
    await waitAircraft(page, 'fighter');
    const s = await stats(page);
    const cfg = await page.evaluate(() => ({
      ...window.__fly.flight.cfg,
      audio: window.__fly.audio?.profile ?? null,
      audioSpeeds: window.__fly.audio?.speeds ?? null,
    }));
    gate(
      '5a no saved pick ⇒ the fighter, with the round-16 fx',
      s.aircraft?.id === 'fighter' &&
        s.aircraft?.url === '/models/player-jet.glb' &&
        s.aircraft?.afterburner === true &&
        s.aircraft?.contrailEmitters === 2 &&
        s.player?.url === '/models/player-jet.glb' &&
        s.player?.meshes > 0 &&
        s.player?.withColorAttr === 0 && // player-jet has no COLOR_0 → guard is a no-op
        Math.abs(s.player?.lenM - 20) < 0.5,
      `AB ${s.aircraft?.afterburner}, ribbons ${s.aircraft?.contrailEmitters}, ${s.player?.meshes} meshes @ ${s.player?.lenM?.toFixed(1)}m`
    );
    // THE default = bit-identical contract, spelled out. These literals ARE the
    // round-16 FLIGHT block; if a hangar edit ever leaks into the no-pick path,
    // this is the gate that catches it.
    const R16_FLIGHT = {
      maxPitchRateDeg: 45,
      maxRollRateDeg: 110,
      maxYawRateDeg: 20,
      rateLambda: 5,
      bankLambda: 3,
      maxBankDeg: 70,
      accel: 40,
      highSpeedTurnCutover: 400,
      floorClearance: 50,
      floorSoftZone: 150,
      ceiling: 15000,
      ceilingSoftZone: 1000,
      autoLevelIdleSec: 1.5,
      autoLevelMaxBankDeg: 30,
      autoLevelRateDeg: 25,
      cameraOffsetScale: 1,
    };
    const drift = Object.entries(R16_FLIGHT).filter(([k, v]) => cfg[k] !== v);
    gate(
      '5b the fighter envelope IS the round-16 FLIGHT block, field for field',
      drift.length === 0 &&
        cfg.speeds?.slow === 60 &&
        cfg.speeds?.cruise === 180 &&
        cfg.speeds?.boost === 750 &&
        cfg.audio?.mode === 'jet' &&
        cfg.audio?.hzMul === 1 &&
        cfg.audio?.gainMul === 1 &&
        cfg.audio?.subMul === 1 &&
        cfg.audioSpeeds?.boost === 750,
      drift.length
        ? drift.map(([k, v]) => `${k} ${cfg[k]}≠${v}`).join(', ')
        : `speeds ${cfg.speeds?.slow}/${cfg.speeds?.cruise}/${cfg.speeds?.boost}, identity audio`
    );
    await page.screenshot({ path: path.join(__dirname, 'hangar-01-fighter.png') });

    // --- 6: mid-session swap keeps you exactly where you were --------------
    const before = await page.evaluate(() => ({
      x: window.__fly.flight.pos.x,
      y: window.__fly.flight.pos.y,
      z: window.__fly.flight.pos.z,
      hdg: window.__fly.flight.heading,
      lat: window.__fly.flight.latDeg,
    }));
    await page.evaluate(() => window.__flyStore.getState().setAircraftId('warbird-jet'));
    await waitAircraft(page, 'warbird-jet');
    await page.waitForFunction(
      () => window.__flyStats?.player?.url === '/models/traffic-warbird-jet.glb',
      undefined,
      { timeout: 25000, polling: 200 }
    );
    const after = await page.evaluate(() => ({
      x: window.__fly.flight.pos.x,
      y: window.__fly.flight.pos.y,
      z: window.__fly.flight.pos.z,
      hdg: window.__fly.flight.heading,
      speed: window.__fly.flight.speed,
      boost: window.__fly.flight.cfg.speeds.boost,
    }));
    // World units are mercator-stretched horizontally; divide back out so the
    // threshold is honest METERS at this latitude.
    const k = 1 / Math.cos((before.lat * Math.PI) / 180);
    const moved = Math.hypot((after.x - before.x) / k, after.y - before.y, (after.z - before.z) / k);
    const dHdg = Math.abs(((after.hdg - before.hdg + Math.PI) % (2 * Math.PI)) - Math.PI);
    gate(
      '6 mid-session swap: new GLB, no respawn (position + heading continuous)',
      moved < 500 && dHdg < 0.08 && after.boost === 420 && after.speed <= 420,
      `moved ${moved.toFixed(0)}m, Δheading ${(dHdg * 57.3).toFixed(2)}°, speed ${after.speed.toFixed(0)} ≤ boost ${after.boost}`
    );

    // --- 7: the UI itself ---------------------------------------------------
    await page.keyboard.press('Escape'); // → paused
    await page.waitForSelector('[data-testid="pause-hangar"]', { timeout: 15000 });
    const btnText = (
      await page.locator('[data-testid="pause-hangar"]').textContent()
    ).trim();
    await page.locator('[data-testid="pause-hangar"]').click();
    await page.waitForSelector('[data-testid="hangar"]', { timeout: 10000 });
    await page.waitForTimeout(900);
    const phaseOpen = await page.evaluate(() => window.__flyStore.getState().phase);
    const cards = await page.locator('[data-testid^="hangar-card-"]').count();
    // Every visible tap target in the panel must clear 44px (mobile-round floor).
    const smallTargets = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="hangar"] button')]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.width < 44 || r.height < 44)).length
    );
    await page.screenshot({ path: path.join(__dirname, 'hangar-02-panel.png') });
    await page.locator('[data-testid="hangar-card-bizjet"]').click();
    await page.waitForTimeout(500);
    await page.locator('[data-testid="hangar-fly"]').click();
    await page.waitForTimeout(800);
    const picked = await page.evaluate(() => ({
      store: window.__flyStore.getState().aircraftId,
      ls: localStorage.getItem('fly-aircraft'),
      open: window.__flyStore.getState().hangarOpen,
      phase: window.__flyStore.getState().phase,
    }));
    gate(
      '7 pause → hangar → pick: opens flying, ≥44px targets, applies + persists',
      /Hangar/.test(btnText) &&
        phaseOpen === 'flying' &&
        cards === 9 &&
        smallTargets === 0 &&
        picked.store === 'bizjet' &&
        picked.ls === 'bizjet' &&
        picked.open === false &&
        picked.phase === 'flying',
      `"${btnText}", ${cards} cards, ${smallTargets} undersized, store/ls ${picked.store}/${picked.ls}`
    );

    // --- 8: the pick survives a reload -------------------------------------
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, {
      timeout: 180000,
      polling: 250,
    });
    await waitAircraft(page, 'bizjet', 40000);
    const back = await stats(page);
    gate(
      '8 a persisted pick re-resolves pre-mount on the next boot',
      back.aircraft?.id === 'bizjet' &&
        back.aircraft?.boost === 255 &&
        back.player?.url === '/models/traffic-jet.glb',
      `${back.aircraft?.id} @ boost ${back.aircraft?.boost}, model ${back.player?.url}`
    );
  });

  // --- 9/10: the cargo 747 --------------------------------------------------
  await session('cargo', 'cargo', async (page) => {
    await waitAircraft(page, 'cargo', 40000);
    const s = await stats(page);
    gate(
      '9 seeded cargo: the 747 loads, no afterburner, boost 310',
      s.aircraft?.id === 'cargo' &&
        s.aircraft?.boost === 310 &&
        s.aircraft?.afterburner === false &&
        s.player?.url === '/models/traffic-cargo.glb' &&
        s.player?.meshes > 0 &&
        // The freighter must actually DRAW at 70 m — the whole point of a
        // hangar is that a heavy feels like a heavy.
        Math.abs(s.player?.lenM - 70) < 1 &&
        s.player?.offCenterM < 5,
      `boost ${s.aircraft?.boost}, AB ${s.aircraft?.afterburner}, ${s.player?.lenM?.toFixed(1)}×${s.player?.spanM?.toFixed(1)}m, off-centre ${s.player?.offCenterM?.toFixed(1)}m`
    );
    await page.screenshot({ path: path.join(__dirname, 'hangar-03-cargo.png') });

    // Boost preset: converge toward 310 without ever seeing a fighter number.
    await page.keyboard.press('3');
    let peak = 0;
    let last = 0;
    for (let i = 0; i < 40; i++) {
      last = await page.evaluate(() => window.__fly.flight.speed);
      peak = Math.max(peak, last);
      if (last > 300) break;
      await page.waitForTimeout(250);
    }
    gate(
      "10 '3' in the cargo converges toward 310 and never exceeds 400",
      last > 290 && peak <= 400,
      `settled ${last.toFixed(0)} m/s, peak ${peak.toFixed(0)}`
    );
  });

  // --- 11: the glider -------------------------------------------------------
  await session('glider', 'glider', async (page) => {
    await waitAircraft(page, 'glider', 40000);
    const s = await stats(page);
    const audio = await page.evaluate(() => window.__fly.audio?.profile ?? null);
    const speeds = await page.evaluate(() => window.__fly.audio?.speeds ?? null);
    gate(
      '11 seeded glider: no burner, no contrail, engine-free wind audio',
      s.aircraft?.id === 'glider' &&
        s.aircraft?.afterburner === false &&
        s.aircraft?.contrailEmitters === 0 &&
        audio?.mode === 'wind' &&
        speeds?.boost === 58,
      `AB ${s.aircraft?.afterburner}, ribbons ${s.aircraft?.contrailEmitters}, audio ${audio?.mode} @ boost ${speeds?.boost}`
    );
    await page.screenshot({ path: path.join(__dirname, 'hangar-04-glider.png') });
  });

  // --- 12: the flat-white-hull guard ---------------------------------------
  // SATELLITE deliberately: the eyeball evidence is a DAYLIGHT hull. Neon at
  // night renders the hero as a lit silhouette, in which a flat-white plane and
  // a properly liveried one look identical. This session also exercises the
  // per-aircraft PlayerGroundShadow radius (satellite-only).
  await session(
    'military',
    'military',
    async (page) => {
      await waitAircraft(page, 'military', 40000);
      const s = await stats(page);
      // colorLo/Hi is the real test: vertexColors:true on a uniformly WHITE
      // attribute is exactly the R8→R14 flat-white-hull bug wearing the fix's
      // clothes. A genuine baked livery spans a wide range.
      gate(
        '12 seeded military: baked COLOR_0 livery is armed AND not flat white',
        s.player?.url === '/models/traffic-military.glb' &&
          s.player?.withColorAttr > 0 &&
          s.player?.vertexColored >= s.player?.withColorAttr &&
          s.player?.colorHi - s.player?.colorLo > 0.2,
        `${s.player?.meshes} meshes, ${s.player?.withColorAttr} with COLOR_0, ${s.player?.vertexColored} vertexColored, livery range ${s.player?.colorLo?.toFixed(2)}–${s.player?.colorHi?.toFixed(2)}`
      );
      // Close-up on the hero: EYEBALL THIS against a flat-white silhouette.
      await page.waitForTimeout(1500);
      await page.screenshot({
        path: path.join(__dirname, 'hangar-05-military-hull.png'),
        clip: { x: 620, y: 340, width: 360, height: 240 },
      });
    },
    'satellite'
  );

  gate('13 zero pageerrors (desktop sessions)', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();

  // --- 14: phone sheet ------------------------------------------------------
  // The R17 wave-2 mobile round builds on these testids, so the panel ships
  // already fitting a 390×844 phone: full-bleed 100svh sheet, no horizontal
  // overflow, every control ≥44px.
  const mobileBrowser = await chromium.launch({ headless: true, args: LAUNCH_ARGS });
  const mctx = await mobileBrowser.newContext(MOBILE_CTX);
  const mp = await mctx.newPage();
  const mErrs = [];
  mp.on('pageerror', (e) => mErrs.push(e.message));
  await bootMobile(mp, { style: 'toy', ...(process.env.FLY_URL ? { url: process.env.FLY_URL } : {}) });
  await mp.waitForTimeout(2500);
  const stickBefore = await mp.locator('[data-testid="touch-joystick"]').count();
  await mp.locator('[data-testid="touch-pause"]').click();
  await mp.waitForTimeout(600);
  await mp.locator('[data-testid="pause-hangar"]').click();
  await mp.waitForSelector('[data-testid="hangar"]', { timeout: 10000 });
  await mp.waitForTimeout(900);
  const stickDuring = await mp.locator('[data-testid="touch-joystick"]').count();
  const sheet = await mp.evaluate(() => {
    const root = document.querySelector('[data-testid="hangar"]');
    const panel = root?.firstElementChild;
    const r = panel?.getBoundingClientRect();
    const small = [...document.querySelectorAll('[data-testid="hangar"] button')]
      .map((el) => el.getBoundingClientRect())
      .filter((b) => b.width > 0 && (b.width < 44 || b.height < 44)).length;
    return r
      ? {
          w: Math.round(r.width),
          h: Math.round(r.height),
          vw: innerWidth,
          vh: innerHeight,
          small,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        }
      : null;
  });
  const mCards = await mp.locator('[data-testid^="hangar-card-"]').count();
  await mp.screenshot({ path: path.join(__dirname, 'hangar-06-phone.png') });
  gate(
    '14 phone (390×844): full-bleed sheet, 9 cards, ≥44px, no overflow, stick hidden',
    !!sheet &&
      sheet.w >= sheet.vw - 2 &&
      sheet.h >= sheet.vh - 24 &&
      sheet.small === 0 &&
      !sheet.overflow &&
      mCards === 9 &&
      stickBefore === 1 &&
      stickDuring === 0,
    sheet
      ? `panel ${sheet.w}×${sheet.h} of ${sheet.vw}×${sheet.vh}, ${mCards} cards, ${sheet.small} undersized, overflow ${sheet.overflow}, stick ${stickBefore}→${stickDuring}`
      : 'panel not found'
  );
  gate('15 zero pageerrors (phone)', mErrs.length === 0, mErrs.slice(0, 3).join(' | '));
  await mobileBrowser.close();

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});

/**
 * Round 18 §A5 GRAVITY — CRASH STAKES + THE BOOST METER.
 *
 * The round gives the game consequences, so this harness spends most of its
 * effort proving the OPPOSITE: that consequences cannot reach anything that is
 * not a player flying badly. Read gates 1, 2, 6 and 9 as one argument —
 *
 *   1  SOURCE (no browser): the arm delay is >= 5s and both flags shipped ON.
 *      Runs first and fails fast, because every other safety claim in this
 *      file rests on the arm delay being real.
 *   2  Thirty seconds of level flight, armed, over real terrain: no crash.
 *   6  A warp INTO an Alpine wall, below the local peaks: no crash. This is
 *      the whole browser fleet's immunity in one gate — every harness pose in
 *      scripts/ arrives by warpTo/warpToGeo (or a pinScene built on one), and
 *      a warp disarms.
 *   9  Forgiving mode: the same dive that crashes in gate 3 slides exactly
 *      like round 17 did.
 *
 * And that they CAN reach a player flying badly:
 *
 *   3  Full-stick dive at boost -> crash inside 15s, CrashFlash on screen,
 *      respawn at ground+400m at cruise, crashEpoch 1.
 *   4  ...and again -> 2. A crash is a beat in a session, not a terminal state.
 *   5  Building crash: satellite only, and only at/above 45 m/s. Driven
 *      through an INJECTED column so the gate is deterministic and does not
 *      wait on A1's sat-building engine (see the note at gate 5).
 *
 * Boost meter:
 *   7  Hold: drains to empty in ~capacitySec, blocks, speed falls back to
 *      cruise while the HUD legend still reads BOOST; 4s of release re-arms
 *      past rearmFrac.
 *   8  The autopilot exemption predicate: engaged -> no drain, no block.
 *
 * Run: npm run dev (:3000), then `node scripts/verify-crash.js`.
 * Private dev server: FLY_URL=http://localhost:3105 node scripts/verify-crash.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

const ROOT = path.join(__dirname, '..');
const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

const fails = [];
const gate = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// Owens Valley: real relief, no city, nothing else in the round measures it
// for draws — a clean place to fly a plane into the ground.
const DIVE_AT = [36.5, -117.5, 3200];
// Chamonix, 2,500 m — below Mont Blanc and the Aiguilles either side. A warp
// here lands the aircraft INSIDE the mountain's shadow volume; the DEM streams
// in afterwards and shoves the floor up past the aircraft.
const ALPS = [45.9237, 6.8694, 2500];
// Read out of CRASH.building by gate 1 — the speed gates below compare against
// the SHIPPED number rather than a copy that could drift away from it.
let CRASH_MIN_SPEED = 0;

(async () => {
  // =========================================================================
  // 1. SOURCE GATES — no browser. The arm delay is the fleet-safety invariant;
  //    assert it before anything is allowed to launch.
  // =========================================================================
  const constSrc = read('lib/fly/fly-constants.js');
  const crashBlock = constSrc.slice(
    constSrc.indexOf('export const CRASH = {'),
    constSrc.indexOf('\n};', constSrc.indexOf('export const CRASH = {'))
  );
  const meterBlock = constSrc.slice(
    constSrc.indexOf('export const BOOST_METER = {'),
    constSrc.indexOf('\n};', constSrc.indexOf('export const BOOST_METER = {'))
  );
  const armDelay = Number((crashBlock.match(/armDelaySec:\s*([\d.]+)/) || [])[1]);
  const crashOn = /enabled:\s*true/.test(crashBlock);
  const meterOn = /enabled:\s*true/.test(meterBlock);
  const capacity = Number((meterBlock.match(/capacitySec:\s*([\d.]+)/) || [])[1]);
  const regen = Number((meterBlock.match(/regenSec:\s*([\d.]+)/) || [])[1]);
  const rearm = Number((meterBlock.match(/rearmFrac:\s*([\d.]+)/) || [])[1]);
  CRASH_MIN_SPEED = Number((crashBlock.match(/minSpeedMps:\s*([\d.]+)/) || [])[1]);
  gate(
    '1a CRASH.armDelaySec >= 5 and CRASH ships enabled (crashes ON by default)',
    armDelay >= 5 && crashOn,
    `armDelaySec ${armDelay}, enabled ${crashOn}`
  );
  gate(
    '1b BOOST_METER ships enabled at 6 / 12 / 0.25',
    meterOn && capacity === 6 && regen === 12 && rearm === 0.25,
    `enabled ${meterOn}, ${capacity}s / ${regen}s / rearm ${rearm}`
  );

  // The two seams that make "flag off == round 17" true, asserted in source
  // rather than inferred: the model's boost coercion must DEFAULT to identity,
  // and the building query must be optional-chained AND satellite-gated (A1's
  // engine may simply not be there).
  const modelSrc = read('lib/fly/flight-model.js');
  const sysSrc = read('lib/fly/crash-system.js');
  gate(
    // W1 integration (Fable): the meter now governs the '3' preset too — the
    // coercion swaps an effective preset in, and stays an identity while
    // boostBlocked is false (the default). Assert the NEW shape.
    '1c flight-model: boostBlocked defaults false and coerces held boost AND the preset',
    /this\.boostBlocked\s*=\s*false/.test(modelSrc) &&
      /const boosting = this\.boostBlocked \? false : cmd\.boost/.test(modelSrc) &&
      /this\.boostBlocked && cmd\.speedPreset === 'boost' \? 'cruise' : cmd\.speedPreset/.test(
        modelSrc
      ) &&
      /F\.speeds\[boosting \? 'boost' : effPreset\]/.test(modelSrc),
    'coercion is an identity at the default'
  );
  gate(
    '1d crash-system: queryColumns is optional-chained and satellite-gated',
    /ctx\.satellite && flight\.speed >= CRASH\.building\.minSpeedMps/.test(sysSrc) &&
      /ctx\.satBuildings\?\.queryColumns\?\.\(/.test(sysSrc),
    'building crashes evaporate without A1s engine'
  );
  gate(
    '1d2 crash-system: the autopilot is exempt, and BEFORE any rule runs',
    // ...and BEFORE the rules, not woven into one of them. (Compared against
    // the terrain rule's actual statement — `floorContact` appears in this
    // module's doc block long before any code does.)
    /if \(ctx\.autopilot\) return null;/.test(sysSrc) &&
      sysSrc.indexOf('if (ctx.autopilot) return null;') <
        sysSrc.indexOf('const hit = flight.floorContact;'),
    'an assist you asked for cannot kill you'
  );
  gate(
    '1e the two new testids exist in source (crash-flash / pause-stakes)',
    /data-testid="crash-flash"/.test(read('components/fly/CrashFlash.jsx')) &&
      /testid="pause-stakes"/.test(read('components/fly/PauseMenu.jsx')),
    ''
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

  const session = async (label, seed, fn, style = 'satellite') => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(`${label}: ${e.message}`));
    await page.addInitScript((s) => {
      try {
        localStorage.setItem('fly-quality-tier', 'high');
        if (s) localStorage.setItem('fly-crash-mode', s);
      } catch {
        /* storage blocked — the gates below fail loudly */
      }
    }, seed);
    await bootFly(page, { ...BOOT_OPTS, style });
    try {
      await fn(page);
    } finally {
      await ctx.close();
    }
  };

  const snap = (page) =>
    page.evaluate(() => {
      const f = window.__fly;
      return {
        pitch: f.flight.pitch,
        speed: f.flight.speed,
        y: f.flight.pos.y,
        agl: f.flight.agl,
        ground: f.flight.groundElev,
        armT: f.crashSys?.armT ?? -1,
        armed: !!f.crashSys?.armed,
        state: f.crash?.state ?? '?',
        blocked: !!f.flight.boostBlocked,
        boost: f.boost ? { frac: f.boost.frac, armed: f.boost.armed } : null,
        epoch: window.__flyStore.getState().crashEpoch,
        last: window.__flyStore.getState().lastCrash,
        stakes: window.__flyStats?.crashStakes,
      };
    });

  // Warp, then sit out the arm delay. Returns the armed state so a gate can
  // prove it actually got there instead of assuming.
  const warpAndArm = async (page, [lat, lon, altM], waitMs = 7000) => {
    await page.evaluate(
      ([la, lo, a]) => window.__fly.warpToGeo(la, lo, { altM: a, name: null }),
      [lat, lon, altM]
    );
    await page.waitForTimeout(waitMs);
    return snap(page);
  };

  // A full-stick dive. 'w' is nose-DOWN (this model is stick-forward: 's'
  // pulls up), and '3' selects the boost preset. The meter DOES govern the
  // preset since the W1 integration, but every bootFly session carries the
  // fleet-wide __flyBoostInfinite pin (scripts/_boot.js) — so the dive is
  // fast and stays fast, exactly like the pre-R18 envelope.
  //
  // Everything here is measured against the epoch the phase STARTED on, never
  // against 0: crashEpoch is cumulative for the whole session and this file
  // deliberately crashes several times in one page. The tail settle matters
  // for the same reason — the model's pitch auto-level has a 4 s time constant,
  // so a dive released early keeps sinking and would otherwise land its crash
  // inside the NEXT gate's window.
  const dive = async (page, seconds, base) => {
    await page.keyboard.press('3');
    await page.keyboard.down('w');
    const t0 = Date.now();
    let hit = null;
    let flying = true;
    while (Date.now() - t0 < seconds * 1000) {
      await page.waitForTimeout(250);
      const s = await snap(page);
      if (s.epoch > base && !hit) {
        hit = { ...s, tSec: (Date.now() - t0) / 1000 };
        // Let go THE MOMENT it hits. The stick is neutralized for the whole
        // sequence, so a still-held nose-down would be handed straight back to
        // the aircraft the instant it returns to 'idle' — which is a fine
        // thing for the game to do and a terrible thing to measure a recovery
        // attitude against.
        await page.keyboard.up('w');
        await page.keyboard.press('2');
        flying = false;
      }
      if (hit && s.state === 'idle') break;
    }
    if (flying) {
      await page.keyboard.up('w');
      await page.keyboard.press('2');
    }
    return hit;
  };

  // Fly it straight and level again, and prove the epoch has stopped moving
  // before the next phase claims a number.
  const settle = async (page) => {
    await page.waitForTimeout(4000);
    const a = (await snap(page)).epoch;
    await page.waitForTimeout(4000);
    const b = (await snap(page)).epoch;
    return b === a ? b : -1;
  };

  // -- 2/3/4: level flight is safe, a dive is not, and a crash is repeatable --
  await session('stakes', null, async (page) => {
    // 2 — thirty seconds of armed, level flight over real terrain.
    let s = await warpAndArm(page, [40.6892, -74.0445, 1200]);
    gate(
      '2a the arm gate closes after the warp (armT >= armDelaySec)',
      s.armed && s.armT >= 5 && s.armT < 20,
      `armT ${s.armT.toFixed(1)}s, stakes ${s.stakes}`
    );
    await page.waitForTimeout(30000);
    s = await snap(page);
    gate(
      '2b 30s of ARMED level flight over terrain: no crash',
      s.epoch === 0 && s.state === 'idle' && s.armed,
      `epoch ${s.epoch}, armT ${s.armT.toFixed(0)}s, agl ${s.agl.toFixed(0)}m`
    );

    // 3 — the dive. Arm the flash watcher BEFORE the dive: the overlay lives
    // for CRASH.sequence.flashMs (900ms) and polling would race it.
    await warpAndArm(page, DIVE_AT);
    const before = await snap(page);
    const flashSeen = page
      .waitForSelector('[data-testid="crash-flash"]', { timeout: 25000, state: 'attached' })
      .then(() => true)
      .catch(() => false);
    const flashShot = page
      .waitForSelector('[data-testid="crash-flash"]', { timeout: 25000, state: 'attached' })
      .then(() => page.screenshot({ path: path.join(__dirname, 'r18a5-01-crash-flash.png') }))
      .catch(() => null);
    const hit = await dive(page, 15, 0);
    const sawFlash = await flashSeen;
    await flashShot;
    gate(
      '3 full-stick dive at boost: crash inside 15s, CrashFlash on screen',
      !!hit && hit.epoch === 1 && sawFlash && hit.last?.kind === 'terrain',
      hit
        ? `crashed at ${hit.tSec.toFixed(1)}s from ${before.agl.toFixed(0)}m AGL, kind ${hit.last?.kind}, flash ${sawFlash}`
        : `NO CRASH in 15s (started ${before.agl.toFixed(0)}m AGL, armT ${before.armT.toFixed(0)}s)`
    );

    // Respawn. The EXACT contract is measured off the pose as placed
    // (crash.respawn, written at the teleport): 2 km back along the track the
    // ground is genuinely somewhere else, and over Owens Valley relief that is
    // ~100 m the constant does not owe anyone. The LIVE agl is gated
    // separately, and only for what actually matters — that you come back well
    // clear of the floor band (floorClearance 50 + floorSoftZone 150), at
    // cruise, wings level, with the arm gate and the meter reset.
    await page.waitForTimeout(300);
    const rs = await page.evaluate(() => {
      const f = window.__fly;
      return {
        placed: f.crash?.respawn ?? null,
        agl: f.flight.pos.y - f.flight.groundElev,
        speed: f.flight.speed,
        cruise: f.flight.cfg.speeds.cruise,
        pitch: f.flight.pitch,
        bank: f.flight.bank,
        armT: f.crashSys.armT,
        boostFrac: f.boost?.frac,
      };
    });
    await page.screenshot({ path: path.join(__dirname, 'r18a5-02-respawn.png') });
    const placedAgl = rs.placed ? rs.placed.y - rs.placed.elev : NaN;
    gate(
      '3b respawn is placed at EXACTLY ground+400m',
      Math.abs(placedAgl - 400) < 0.001,
      `placed y ${rs.placed?.y?.toFixed(1)} over DEM ${rs.placed?.elev?.toFixed(1)} = ${placedAgl.toFixed(3)}m`
    );
    gate(
      '3c ...and flies out of it at cruise, level, well clear of the floor band',
      rs.agl > 200 &&
        rs.agl < 700 &&
        Math.abs(rs.speed - rs.cruise) < 45 &&
        Math.abs(rs.pitch) < 0.35 &&
        Math.abs(rs.bank) < 0.35 &&
        rs.armT < 5 &&
        rs.boostFrac === 1,
      `live agl ${rs.agl.toFixed(0)}m (${(rs.agl - placedAgl).toFixed(0)}m of terrain 2km back), speed ${rs.speed.toFixed(0)} vs cruise ${rs.cruise}, armT ${rs.armT.toFixed(1)}s, meter ${rs.boostFrac}`
    );

    // 4 — do it again. (The respawn re-armed the gate, so sit it out first.)
    const base4 = await settle(page);
    await page.waitForTimeout(3000);
    const hit2 = await dive(page, 15, base4);
    gate(
      '4 a second dive crashes again (a crash is a beat, not a terminal state)',
      base4 === 1 && !!hit2 && hit2.epoch === 2,
      hit2
        ? `epoch ${base4} -> ${hit2.epoch} at ${hit2.tSec.toFixed(1)}s`
        : `no second crash (base ${base4})`
    );

    // -- 5: buildings ------------------------------------------------------
    // A1's sat-building engine publishes runtime.satBuildings.queryColumns in
    // the same wave; this file has to gate its own consumption WITHOUT it, so
    // the columns are injected. Prefer the real engine when it exists (after
    // the A1 -> A5 merge, this gate upgrades itself for free).
    const base5 = await settle(page);
    await warpAndArm(page, [40.758, -73.9855, 900]);
    const real = await page.evaluate(
      () => typeof window.__fly.satBuildings?.queryColumns === 'function'
    );
    // Slow first: below minSpeedMps, threading the towers is the playground.
    // The speed drops SYNCHRONOUSLY in the same task that plants the column —
    // an interval alone loses the race, because a frame can land in the 8 ms
    // before its first tick and that frame still sees cruise. (It cost a run
    // to find out: the "slow" phase crashed at 180 m/s and read as a rule
    // failure rather than a harness one.)
    await page.evaluate(() => {
      const f = window.__fly;
      f.flight.speed = 30;
      if (typeof f.satBuildings?.queryColumns !== 'function') {
        // one column, centred on the aircraft, tall enough to swallow it
        f.satBuildings = {
          queryColumns: (px, pz) => [{ x: px, z: pz, topY: 1e6, r: 200 }],
        };
      }
      window.__slowMax = 0;
      window.__slow = setInterval(() => {
        window.__slowMax = Math.max(window.__slowMax, f.flight.speed);
        f.flight.speed = 30;
      }, 8);
    });
    await page.waitForTimeout(6000);
    const slow = await snap(page);
    const slowMax = await page.evaluate(() => {
      clearInterval(window.__slow);
      return window.__slowMax;
    });
    await page.waitForTimeout(6000);
    const fast = await snap(page);
    gate(
      `5a building crash: silent under 45 m/s, fires above it (${real ? 'REAL engine' : 'injected column'})`,
      base5 === 2 &&
        slowMax < CRASH_MIN_SPEED &&
        slow.epoch === base5 &&
        fast.epoch === base5 + 1 &&
        fast.last?.kind === 'building',
      `base ${base5}; slow peaked ${slowMax.toFixed(1)} m/s (< ${CRASH_MIN_SPEED}) epoch ${slow.epoch}; fast ${fast.speed.toFixed(0)} m/s epoch ${fast.epoch} kind ${fast.last?.kind}`
    );

    // Style gate: the same column in Neon must do nothing at all.
    // Pull the stub FIRST. It is planted at the aircraft's own position on
    // every query, so it re-crashes the respawn about every six seconds — the
    // world's most patient skyscraper. (A real engine's columns stay where the
    // buildings are; this is purely an artifact of injecting one.)
    await page.evaluate(() => {
      window.__fly.satBuildings = undefined;
    });
    const base5b = await settle(page);
    await page.evaluate(() => window.__flyStore.getState().setMapStyle('toy'));
    await warpAndArm(page, [40.758, -73.9855, 900]);
    await page.evaluate(() => {
      const f = window.__fly;
      f.satBuildings = { queryColumns: (px, pz) => [{ x: px, z: pz, topY: 1e6, r: 200 }] };
    });
    await page.waitForTimeout(8000);
    const toy = await snap(page);
    gate(
      '5b the same column in toy style never crashes (satellite-only rule)',
      base5b > 0 && toy.epoch === base5b && toy.speed >= CRASH_MIN_SPEED,
      `base ${base5b} -> ${toy.epoch} (must not move), speed ${toy.speed.toFixed(0)} m/s (>= ${CRASH_MIN_SPEED})`
    );
  });

  // -- 6: the warp-arrival invariant, in the worst place on Earth for it ----
  await session('alps', null, async (page) => {
    const t0 = Date.now();
    await page.evaluate(
      ([la, lo, a]) => window.__fly.warpToGeo(la, lo, { altM: a, name: null }),
      ALPS
    );
    // Sample hard through the whole arm window — the DEM streams in during it
    // and shoves the floor up past the aircraft.
    let worstAgl = Infinity;
    let epoch = 0;
    let armedDuring = false;
    while (Date.now() - t0 < 5200) {
      const s = await snap(page);
      epoch = Math.max(epoch, s.epoch);
      armedDuring = armedDuring || s.armed;
      worstAgl = Math.min(worstAgl, s.agl);
      await page.waitForTimeout(150);
    }
    gate(
      '6 warp INTO an Alpine wall: no crash inside the arm window',
      epoch === 0 && !armedDuring,
      `epoch ${epoch}, min AGL ${worstAgl.toFixed(0)}m, armed-during-window ${armedDuring}`
    );
  });

  // -- 7/8: the boost meter -------------------------------------------------
  await session('meter', null, async (page) => {
    // THE one deliberate un-pin in the fleet (the verify-weather idiom): this
    // session certifies the meter itself, so the _boot.js unlimited-boost pin
    // is cleared before any boost is held.
    await page.evaluate(() => {
      window.__flyBoostInfinite = false;
    });
    await warpAndArm(page, [40.6892, -74.0445, 4000]);
    const legend = () =>
      page.evaluate(() => {
        const el = [...document.querySelectorAll('*')].find(
          (n) => n.children.length === 0 && /^(BOOST|CRUISE|SLOW)$/.test(n.textContent.trim())
        );
        return el ? el.textContent.trim() : null;
      });

    await page.keyboard.down('Shift');
    let minFrac = 1;
    let sawBlocked = false;
    let blockedSpeed = null;
    let blockedLegend = null;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(400);
      const s = await snap(page);
      minFrac = Math.min(minFrac, s.boost?.frac ?? 1);
      if (s.blocked && !sawBlocked) {
        sawBlocked = true;
        blockedLegend = await legend();
      }
      if (s.blocked) blockedSpeed = s.speed;
    }
    await page.keyboard.up('Shift');
    const cruise = await page.evaluate(() => window.__fly.flight.cfg.speeds.cruise);
    gate(
      '7a hold boost 8s: the meter empties, blocks, and the plane falls to cruise',
      minFrac <= 0.02 && sawBlocked && blockedSpeed != null && blockedSpeed < 460,
      `min frac ${minFrac.toFixed(3)}, blocked ${sawBlocked}, speed while blocked ${blockedSpeed?.toFixed(0)} (cruise ${cruise}, boost 750)`
    );
    gate(
      '7b ...while the HUD legend still reads BOOST (the raw stick is never coerced)',
      blockedLegend === 'BOOST',
      `legend "${blockedLegend}"`
    );
    await page.waitForTimeout(4000);
    const back = await snap(page);
    gate(
      '7c 4s of release re-arms past rearmFrac',
      back.boost.armed && back.boost.frac >= 0.25 && !back.blocked,
      `frac ${back.boost.frac.toFixed(3)}, armed ${back.boost.armed}`
    );

    // 8 — the exemption PREDICATE. The autopilot is stubbed to a no-op so the
    // mode cannot disengage itself on a missing target; the real closing
    // speeds it produces stay gated by verify-fly-formation and
    // verify-inspect-actions, which run against this same build.
    // The stub is TWO methods, not one. `update` returning null keeps the mode
    // from disengaging itself on a missing target; `disengage` has to go too,
    // because FlyScene disengages on any targeting release (and a soft lock on
    // passing traffic releases whenever the traffic passes) — without it the
    // exemption gates below would flip to "off" mid-measurement and read as a
    // rule failure. What is under test is the PREDICATE; the autopilot's real
    // flying stays gated by verify-fly-formation and verify-inspect-actions,
    // which run against this same build.
    await page.evaluate(() => {
      const ap = window.__fly.autopilot;
      window.__apReal = ap.update;
      window.__apRealOff = ap.disengage;
      ap.update = () => null;
      ap.disengage = () => {};
      ap.mode = 'formation';
    });
    const apStart = (await snap(page)).boost.frac;
    await page.keyboard.down('Shift');
    await page.waitForTimeout(8000);
    const apEnd = await snap(page);
    await page.keyboard.up('Shift');
    gate(
      '8 autopilot engaged: 8s of held boost neither drains nor blocks the meter',
      apEnd.boost.frac >= Math.min(1, apStart) - 0.001 && !apEnd.blocked && apEnd.boost.armed,
      `frac ${apStart.toFixed(2)} -> ${apEnd.boost.frac.toFixed(2)}, blocked ${apEnd.blocked}`
    );

    // 8b — the SAME exemption on the crash side. The assist is still stubbed
    // on, so this is a full-stick dive straight into the ground with the
    // autopilot nominally flying: it must not crash. Then hand control back
    // and fly the identical dive: it must.
    await warpAndArm(page, DIVE_AT);
    const apDive = await dive(page, 15, 0);
    const apAfter = await snap(page);
    await page.evaluate(() => {
      const ap = window.__fly.autopilot;
      ap.update = window.__apReal;
      ap.disengage = window.__apRealOff;
      ap.mode = 'off';
    });
    await warpAndArm(page, DIVE_AT);
    const ownDive = await dive(page, 15, 0);
    gate(
      '8b autopilot engaged: the same dive that crashes on the stick does NOT crash',
      !apDive && apAfter.epoch === 0 && apAfter.armed && !!ownDive && ownDive.epoch === 1,
      `assist: epoch ${apAfter.epoch} (armed ${apAfter.armed}, ${apAfter.agl.toFixed(0)}m AGL); stick: ${ownDive ? `crashed at ${ownDive.tSec.toFixed(1)}s` : 'NO CRASH'}`
    );

    // The pause-menu row, and the evidence shot of it.
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid="pause-stakes"]', { timeout: 15000 });
    const rowText = (await page.locator('[data-testid="pause-stakes"]').textContent()).trim();
    await page.screenshot({ path: path.join(__dirname, 'r18a5-03-pause-stakes.png') });
    await page.locator('[data-testid="pause-stakes"]').click();
    await page.waitForTimeout(400);
    const toggled = await page.evaluate(() => ({
      text: document.querySelector('[data-testid="pause-stakes"]').textContent.trim(),
      ls: localStorage.getItem('fly-crash-mode'),
    }));
    gate(
      '9a the pause menu carries the stakes row, and a CLICK persists it',
      /Crashes ON/.test(rowText) &&
        /Forgiving/.test(toggled.text) &&
        toggled.ls === 'forgiving',
      `"${rowText}" -> "${toggled.text}", storage ${toggled.ls}`
    );
  });

  // -- 9b: Forgiving is round 17, frame for frame ---------------------------
  await session('forgiving', 'forgiving', async (page) => {
    const s0 = await warpAndArm(page, DIVE_AT);
    const hit = await dive(page, 15, 0);
    const s = await snap(page);
    gate(
      '9b seeded forgiving: the SAME dive slides like R17 (no crash, alive at the floor)',
      s0.stakes === false &&
        !hit &&
        s.epoch === 0 &&
        s.state === 'idle' &&
        s.agl > 0 &&
        s.agl < 120,
      `stakes ${s0.stakes}, epoch ${s.epoch}, sliding at ${s.agl.toFixed(0)}m AGL (floorClearance 50)`
    );
  });

  gate('10 zero pageerrors across every session', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});

/**
 * ROUND 18 (A4 SHOWTIME) — verify-juice.
 *
 * Gates the arcade layer end to end:
 *
 *   A. NEAR MISS — a synthetic aircraft is flown at the player ON THE DOMAIN
 *      CLOCK (fix1.t stamped with traffic.serverNow, positions in world units
 *      with the mercator stretch applied) so the REAL TrafficEngine dead-
 *      reckons it, the REAL distM is recomputed at priority -45, and the real
 *      detector sees a real closest approach. Asserts: fires EXACTLY once,
 *      the cooldown holds on a second run-in, and sessionScore moves by
 *      NEARMISS.basePts x mult EXACTLY. Then a second chain event proves the
 *      combo chip renders the multiplier that was actually paid.
 *   B. SHAKE — quaternion deviation under trauma vs a settled cruise baseline,
 *      and decay back inside 3 s. Also the verify-chase-cam SAFETY gate: at
 *      cruise with zero trauma the pose is byte-stable, which is the whole
 *      reason the speed term is gated at SHAKE.speedFrac of BOOST.
 *   C. MUSIC — node-count A/B (__flyMusicOverride='off' ⇒ zero nodes) plus a
 *      source assertion that construction is behind `MUSIC.enabled`, and a
 *      layer response to a speed-preset flip.
 *   D. BOOST BAR — absent while A5's runtime.boost does not exist.
 *   E. TOASTS — the five pre-R18 testids still exist in source, and the new
 *      flavor renders as `nearmiss-toast`.
 *
 * Run: npm run dev (:3000), then `node scripts/verify-juice.js`.
 * Private dev server: FLY_URL=http://localhost:3144 node scripts/verify-juice.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly } = require('./_boot');

const ROOT = path.join(__dirname, '..');
const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const fails = [];
const gate = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) fails.push(name);
};

const SYNTH_HEX = 'ff18a4';

/**
 * Aim a synthetic contact so it passes the player at `cpaM` metres.
 *
 * Placed `leadM` ahead along the player's own forward vector with a lateral
 * offset, closing head-on. Horizontal offsets are multiplied by the mercator
 * scale (the world is stretched; velocities in the fix are TRUE m/s and the
 * engine applies the same k when it dead-reckons), and `t` comes from
 * traffic.serverNow — a monotonic-clock stamp would make the fix ~1.8 billion
 * seconds old and the stale ladder would delete the track on the next frame.
 */
async function launchPass(page, { leadM, cpaM, closeMps }) {
  return page.evaluate(
    ({ hex, leadM: lead, cpaM: cpa, closeMps: vc }) => {
      const fly = window.__fly;
      if (!fly?.traffic || !fly.flight) return null;
      const clientSec = performance.now() / 1000;
      let now = fly.traffic.serverNow(clientSec);
      if (now == null) {
        fly.traffic._skewSec = 0; // egress-blocked CI: seed a clock, never clobber a live one
        now = clientSec;
      }
      const f = fly.flight;
      const p = f.pos;
      const fwd = f.forward();
      const k = 1 / Math.cos(((f.latDeg ?? 0) * Math.PI) / 180);
      // Horizontal right-hand perpendicular to the forward vector.
      const hl = Math.hypot(fwd.x, fwd.z) || 1;
      const rx = -fwd.z / hl;
      const rz = fwd.x / hl;

      const track = {
        hex,
        meta: { flight: 'NEARMS1', r: 'N18A4', t: 'B738', color: '#fbbf24', iconType: 'airliner' },
        archetype: 0,
        flags: 0,
        fix0: null,
        fix1: {
          t: now,
          latRad: ((f.latDeg ?? 0) * Math.PI) / 180,
          x: p.x + fwd.x * lead * k + rx * cpa * k,
          y: p.y + fwd.y * lead,
          z: p.z + fwd.z * lead * k + rz * cpa * k,
          // Head-on: velocity is -forward at vc true m/s. World -Z is north.
          vE: -fwd.x * vc,
          vN: fwd.z * vc,
          vUp: 0,
        },
        groundElev: 0,
        renderLift: 0,
        _liftTarget: 0,
      };
      fly.traffic.tracks.set(hex, track);
      return { closingMps: Math.round(f.speed + vc), etaSec: +(lead / (f.speed + vc)).toFixed(2) };
    },
    { hex: SYNTH_HEX, leadM, cpaM, closeMps }
  );
}

const clearPass = (page) =>
  page.evaluate((hex) => {
    window.__fly?.traffic?.tracks?.delete(hex);
    const items = window.__fly?.traffic?.items;
    if (items) {
      const i = items.findIndex((x) => x.hex === hex);
      if (i >= 0) items.splice(i, 1);
    }
  }, SYNTH_HEX);

const juiceStats = (page) => page.evaluate(() => window.__flyStats?.juice ?? null);

/** Max angle (rad) between any sampled quaternion and the first. */
async function quatSpread(page, samples, everyMs) {
  const qs = [];
  for (let i = 0; i < samples; i++) {
    qs.push(
      await page.evaluate(() => {
        const q = window.__fly.camera.quaternion;
        return [q.x, q.y, q.z, q.w];
      })
    );
    await page.waitForTimeout(everyMs);
  }
  let max = 0;
  for (const q of qs) {
    const dot = Math.abs(q[0] * qs[0][0] + q[1] * qs[0][1] + q[2] * qs[0][2] + q[3] * qs[0][3]);
    max = Math.max(max, 2 * Math.acos(Math.min(1, dot)));
  }
  return max;
}

(async () => {
  // ---------------------------------------------------------------- source
  const juiceSrc = read('components/fly/JuiceSystems.jsx');
  const toastSrc = read('components/fly/hud/SpotToast.jsx');
  const camSrc = read('lib/fly/chase-camera.js');
  const constSrc = read('lib/fly/fly-constants.js');

  // Source-derived expectations, so a knob move retunes the gate instead of
  // silently invalidating it.
  const pick = (block, key) => {
    const b = constSrc.match(new RegExp(`export const ${block} = \\{[\\s\\S]*?\\n\\};`));
    const m = (b ? b[0] : constSrc).match(new RegExp(`${key}:\\s*([0-9.]+)`));
    return m ? Number(m[1]) : NaN;
  };
  const NEARMISS_BASE_PTS = pick('NEARMISS', 'basePts');
  const COMBO_STEP = Number((constSrc.match(/COMBO = \{[^}]*multStep:\s*([0-9.]+)/) || [])[1]);
  const COMBO_WINDOW = Number((constSrc.match(/COMBO = \{[^}]*windowSec:\s*([0-9.]+)/) || [])[1]);
  const MULT2 = 1 + COMBO_STEP; // the multiplier the second link of a chain pays
  gate(
    'constants readable from source',
    Number.isFinite(NEARMISS_BASE_PTS) && Number.isFinite(COMBO_STEP) && Number.isFinite(COMBO_WINDOW),
    `basePts=${NEARMISS_BASE_PTS} multStep=${COMBO_STEP} windowSec=${COMBO_WINDOW}`
  );

  gate(
    'music construction gated on MUSIC.enabled',
    /if\s*\(MUSIC\.enabled[\s\S]{0,400}?new MusicDirector/.test(juiceSrc),
    'source'
  );
  gate(
    'shake block gated on SHAKE.enabled + zero-amp early out',
    /if\s*\(SHAKE\.enabled\)/.test(camSrc) && /ampDeg\s*>\s*1e-4/.test(camSrc),
    'source'
  );
  // The positioning column has no look of its own, so it must not exist when
  // both children are absent — that is what makes "flags false ⇒ zero HUD
  // elements" literally true rather than merely invisible.
  const hudSrc = read('components/fly/hud/JuiceHud.jsx');
  gate(
    'juice HUD column is conditional (zero DOM when empty)',
    /showColumn\s*=\s*combo\s*>=\s*2\s*\|\|\s*hasBoost/.test(hudSrc) &&
      /!photoActive\s*&&\s*showColumn\s*&&/.test(hudSrc),
    'source'
  );

  const FROZEN_TESTIDS = [
    'contract-toast',
    'badge-toast',
    'buzz-toast',
    'spicy-toast',
    'spot-toast',
  ];
  gate(
    'pre-R18 toast testids intact',
    FROZEN_TESTIDS.every((t) => toastSrc.includes(`'${t}'`)),
    FROZEN_TESTIDS.join(', ')
  );

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked — the gates below fail loudly */
    }
  });
  await bootFly(page, { ...BOOT_OPTS, style: 'satellite' });

  // Neutral steering (cursor on the reference dot) so the player flies straight
  // — the pass geometry and the settled-pose gate both depend on it.
  await page.mouse.move(800, 450);
  // The AudioContext is created by the first user gesture (useFlyAudio's
  // listener). Control has no fly binding, so this arms audio without also
  // arming boost/photo/pause.
  await page.keyboard.press('Control');
  await page.waitForTimeout(3000);

  // ============================================================ A. NEAR MISS
  const before = await juiceStats(page);
  gate('juice telemetry present', !!before, JSON.stringify(before));

  const pass1 = await launchPass(page, { leadM: 900, cpaM: 40, closeMps: 40 });
  gate('synthetic pass launched', !!pass1, JSON.stringify(pass1));

  // Watch for the toast DURING the pass: it is pushed on the detection frame
  // and only dwells NEARMISS.toastMs, so a fixed sleep past the whole run-in
  // measures an empty stack and proves nothing.
  const toastSeen = await page
    .waitForSelector('[data-testid="nearmiss-toast"]', { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  gate('nearmiss toast rendered', toastSeen);
  if (toastSeen) {
    await page.screenshot({ path: path.join(__dirname, 'r18a4-01-nearmiss-toast.png') });
  }

  // Let the track open fully back up past CPA before reading the tallies.
  await page.waitForTimeout(5000);
  const afterPass = await juiceStats(page);
  const nmDelta = (afterPass?.nearMisses ?? 0) - (before?.nearMisses ?? 0);
  gate('near miss fired exactly once', nmDelta === 1, `delta=${nmDelta}`);

  const scoreDelta = (afterPass?.sessionScore ?? 0) - (before?.sessionScore ?? 0);
  // First link of a chain always banks at x1 (COMBO.multStep * (1-1) === 0),
  // so the expected delta is NEARMISS.basePts read straight from the constant.
  gate(
    'sessionScore delta = basePts x mult exactly',
    scoreDelta === NEARMISS_BASE_PTS,
    `${scoreDelta} vs ${NEARMISS_BASE_PTS}`
  );

  // Second run-in on the SAME hex, inside NEARMISS.cooldownSec: must NOT fire.
  await clearPass(page);
  await page.waitForTimeout(300);
  await launchPass(page, { leadM: 900, cpaM: 40, closeMps: 40 });
  await page.waitForTimeout(9000);
  const afterCooldown = await juiceStats(page);
  gate(
    'per-hex cooldown holds on re-approach',
    (afterCooldown?.nearMisses ?? 0) === (afterPass?.nearMisses ?? 0),
    `${afterPass?.nearMisses} -> ${afterCooldown?.nearMisses}`
  );
  await clearPass(page);

  // ============================================================== A2. COMBO
  const combo = await page.evaluate(() => {
    const s0 = window.__flyStats.juice.sessionScore;
    // Two chain events back to back: the second banks at x1.25 and the chip
    // must show exactly that multiplier.
    window.__fly.juice.onEvent('buzz', 100);
    window.__fly.juice.onEvent('buzz', 100);
    return { s0 };
  });
  await page.waitForTimeout(600);
  const comboState = await page.evaluate(() => ({
    combo: window.__flyStats.juice.combo,
    score: window.__flyStats.juice.sessionScore,
    chip: document.querySelector('[data-testid="combo-chip"]')?.textContent ?? null,
  }));
  gate('combo chain advanced to 2', comboState.combo === 2, String(comboState.combo));
  gate(
    'combo chip visible with multiplier',
    !!comboState.chip &&
      comboState.chip.includes(`×${MULT2}`) &&
      /combo 2/.test(comboState.chip),
    JSON.stringify(comboState.chip)
  );
  if (comboState.chip) {
    await page.screenshot({ path: path.join(__dirname, 'r18a4-02-combo-chip.png') });
  }
  const expectBanked = 100 + Math.round(100 * MULT2);
  gate(
    'banked points honour the multiplier',
    comboState.score - combo.s0 === expectBanked,
    `${comboState.score - combo.s0} vs ${expectBanked}`
  );

  // Window expiry drops the chain and unmounts the chip.
  await page.waitForTimeout(COMBO_WINDOW * 1000 + 1500);
  const expired = await page.evaluate(() => ({
    combo: window.__flyStats.juice.combo,
    chip: !!document.querySelector('[data-testid="combo-chip"]'),
  }));
  gate('combo window expires to 0', expired.combo === 0 && !expired.chip, JSON.stringify(expired));

  // ============================================================== B. SHAKE
  await page.waitForTimeout(2500); // settle the chase pose at cruise
  const quiet = await quatSpread(page, 20, 100);
  gate('cruise pose byte-stable with zero trauma', quiet < 2e-3, `${quiet.toExponential(2)} rad`);

  await page.evaluate(() => window.__fly.juice.addTrauma(1));
  const shaken = await quatSpread(page, 12, 40);
  gate(
    'trauma deviates the camera',
    shaken > quiet * 20 && shaken > 5e-3,
    `${shaken.toExponential(2)} rad vs quiet ${quiet.toExponential(2)}`
  );

  await page.waitForTimeout(3000);
  const decayed = await quatSpread(page, 12, 40);
  gate(
    'trauma decays back inside 3 s',
    decayed < Math.max(quiet * 4, 2e-3),
    `${decayed.toExponential(2)} rad`
  );

  // ============================================================== C. MUSIC
  await page.evaluate(() => window.__fly.audio?.resume?.());
  await page.keyboard.press('1'); // slow — the player's own lever, not a poke
  await page.waitForTimeout(2000);
  const slow = await juiceStats(page);
  await page.keyboard.press('3'); // boost
  await page.waitForTimeout(2500);
  const boost = await juiceStats(page);

  gate('music graph built (nodes > 0)', (boost?.musicNodes ?? 0) > 0, `${boost?.musicNodes} nodes`);
  gate(
    'speed pulse layer closed at slow, open at boost',
    slow?.musicPulseRate === 0 && (boost?.musicPulseRate ?? 0) > 0,
    `slow ${slow?.musicPulseRate} -> boost ${boost?.musicPulseRate}`
  );
  gate(
    'active layer count rises with the pulse',
    (boost?.musicLayers ?? 0) > (slow?.musicLayers ?? 0),
    `slow ${slow?.musicLayers} -> boost ${boost?.musicLayers}`
  );

  // ============================================================ D. BOOST BAR
  const boostBar = await page.evaluate(() => ({
    el: !!document.querySelector('[data-testid="boost-bar"]'),
    runtimeBoost: window.__fly.boost === undefined ? 'undefined' : typeof window.__fly.boost,
  }));
  gate(
    'boost bar absent while runtime.boost is undefined',
    !boostBar.el && boostBar.runtimeBoost === 'undefined',
    JSON.stringify(boostBar)
  );

  gate('zero pageerrors (main session)', errs.length === 0, errs.slice(0, 3).join(' | '));
  await ctx.close();

  // ============================================ C2. MUSIC OFF — the A/B leg
  const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page2 = await ctx2.newPage();
  const errs2 = [];
  page2.on('pageerror', (e) => errs2.push(e.message));
  await page2.addInitScript(() => {
    window.__flyMusicOverride = 'off';
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked */
    }
  });
  await bootFly(page2, { ...BOOT_OPTS, style: 'satellite' });
  await page2.keyboard.press('Control');
  await page2.waitForTimeout(4000);
  const off = await juiceStats(page2);
  gate('MUSIC off ⇒ zero nodes, zero layers', off?.musicNodes === 0 && off?.musicLayers === 0, JSON.stringify(off));
  gate('zero pageerrors (music-off session)', errs2.length === 0, errs2.slice(0, 3).join(' | '));
  await ctx2.close();

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

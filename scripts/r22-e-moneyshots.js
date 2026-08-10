/**
 * ROUND 22 (E "CERT") — the W3 money-shot capture.
 *
 * Four evidence sets, each a controlled A/B at a FIXED pose, for the user
 * checkpoints in FLY_ROUND22.md §6:
 *
 *   #1 P-LEWIS   the round's headline — low-AGL sharpness + clutter.
 *                A = every R22 family forced OFF, B = ship state.
 *   #2 P-DUBLIN  the warp arrival, captured AT the reveal and again settled,
 *                with the hold duration recorded in the same run.
 *   —  OWENS     the empty control. These two frames must look the SAME; that
 *                is the whole point of them, and it is the R20 instrument
 *                restated in pixels.
 *   #3 DEPTH     `DEPTH_PASS` off vs armed at P-LEWIS, for the checkpoint that
 *                decides whether it ever ships on.
 *
 * DISCIPLINE: sun pinned, weather baseline (bootFly), tier pinned high, the
 * hero and traffic parked at their owner-published roots, and the flight
 * integrator suspended so the two frames of a pair are the same camera. The
 * A arm forces the R22 families off through the SAME per-family overrides the
 * gates use, so "before" is this tree with the features disarmed rather than a
 * different commit — which is what makes the pair a controlled comparison
 * instead of two screenshots taken a week apart.
 *
 * Run: FLY_URL=http://localhost:3224 node scripts/r22-e-moneyshots.js
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { bootFly, unpinPins } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};
const SHOT = (n) => path.join(__dirname, `r22-e-money-${n}.png`);

const P_LEWIS = [40.2083, -83.0701, 400];
const P_DUBLIN = [40.0992, -83.1141, 9144];
const FAR_START = [36.75, -118.05, 9144];
const OWENS = [36.601, -118.06, 500];
const NOON = Date.UTC(2026, 6, 17, 19, 30);

/** Force every R22 family to a state. `on=false` is the "before" arm. */
const FORCE_ALL = ([on, depth]) => {
  window.__flyTerraForce = { sharp: on, pipe: on, cache: on };
  window.__r22Unpinned = {
    __flySettlePin: on ? 0 : 1,
    __flyClutterPin: on ? 0 : 1,
    __flyDepthPin: 1,
  };
  window.__flyDepthArm = depth ? 1 : 0;
};

const PARK = () => {
  if (window.__flyPlayer) window.__flyPlayer.visible = false;
  let scene = window.__flyPlayer ?? window.__fly?.engine?.object ?? null;
  while (scene && scene.parent) scene = scene.parent;
  scene?.traverse((o) => {
    if (o.isInstancedMesh && (o._isModel !== undefined || o._painted !== undefined)) o.visible = false;
  });
};

const STATS = () => {
  const rt = window.__fly;
  const f = rt?.flight;
  const eng = rt?.engine;
  if (!f || !eng) return { err: 'no-runtime' };
  const g = eng.worldToGeo(f.pos);
  const ga = eng.getGroundAt(+g.x, +g.y);
  let maxLeafZ = 0;
  try {
    eng.object.traverse((o) => {
      if (o.isTile && o.children.length <= 1 && o.z > maxLeafZ) maxLeafZ = o.z;
    });
  } catch {
    maxLeafZ = null;
  }
  return {
    camTileZ: ga ? ga.tileZ : null,
    maxLeafZ,
    aglM: Math.round(f.pos.y - f.groundElev),
    draws: window.__flyStats?.drawCalls ?? null,
    tris: window.__flyStats?.triangles ?? null,
    clutter: window.__flyStats?.clutter
      ? {
          parked: window.__flyStats.clutter.parked?.count,
          moving: window.__flyStats.clutter.moving?.count,
          poles: window.__flyStats.clutter.poles?.count,
        }
      : null,
    veg: window.__satVeg?.mesh?.geometry?.index
      ? window.__satVeg.mesh.geometry.index.count / 3
      : null,
  };
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const out = { when: new Date().toISOString(), shots: {} };
  const newPage = async (on, depth = false) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const p = await ctx.newPage();
    await p.addInitScript(unpinPins, ['__flySettlePin', '__flyClutterPin', '__flyDepthPin']);
    await p.addInitScript(FORCE_ALL, [on, depth]);
    await bootFly(p, { style: 'satellite', ...BOOT_OPTS });
    await p.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
    await p.mouse.move(800, 450);
    return p;
  };
  const pose = async (p, [lat, lon, altM], settleMs) => {
    await p.evaluate(
      ([la, lo, al, su]) => {
        window.__flySunOverride = su;
        const f = window.__fly.flight;
        delete f.step;
        delete f.__frozen;
        window.__fly.warpToGeo(la, lo, { altM: al, name: null });
        const px = f.pos.x;
        const pz = f.pos.z;
        f.__frozen = true;
        f.step = () => {};
        f.pos.x = px;
        f.pos.z = pz;
      },
      [lat, lon, altM, NOON]
    );
    await p.waitForTimeout(settleMs);
    await p.evaluate(PARK);
    await p.mouse.move(800, 450);
    await p.waitForTimeout(800);
  };
  const grab = async (p, name) => {
    await p.locator('.fixed.inset-0 canvas').first().screenshot({ path: SHOT(name) });
    const st = await p.evaluate(STATS);
    out.shots[name] = st;
    console.log(`${name}: ${JSON.stringify(st)}`);
  };

  /* ---- #1 P-LEWIS + the OWENS control, both arms ------------------------ */
  for (const [arm, on] of [['before', false], ['after', true]]) {
    const p = await newPage(on);
    await pose(p, P_LEWIS, 26000);
    await grab(p, `lewis-${arm}`);
    await pose(p, OWENS, 24000);
    await grab(p, `owens-${arm}`);
    await p.close();
  }

  /* ---- #2 P-DUBLIN warp arrival, both arms ------------------------------ */
  for (const [arm, on] of [['before', false], ['after', true]]) {
    const p = await newPage(on);
    await pose(p, FAR_START, 14000);
    await p.evaluate(() => {
      const f = window.__fly.flight;
      delete f.step;
      delete f.__frozen;
    });
    const t0 = Date.now();
    await p.evaluate(
      ([la, lo, al]) => window.__fly.warpToGeo(la, lo, { altM: al, name: 'Dublin OH' }),
      P_DUBLIN
    );
    // Poll for the reveal, then shoot the very first settled frame after it.
    let holdMs = null;
    for (let i = 0; i < 120; i++) {
      const stage = await p.evaluate(
        () => document.querySelector('[data-testid="warp-hold"]')?.getAttribute('data-stage') ?? null
      );
      if (stage === 'reveal' || (stage === null && i > 4)) {
        holdMs = Date.now() - t0;
        break;
      }
      await p.waitForTimeout(100);
    }
    await p.evaluate(() => {
      const f = window.__fly.flight;
      if (!f.__frozen) {
        f.__frozen = true;
        f.step = () => {};
      }
    });
    await p.evaluate(PARK);
    await p.waitForTimeout(400);
    await grab(p, `dublin-${arm}-at-reveal`);
    out.shots[`dublin-${arm}-at-reveal`].holdMs = holdMs;
    console.log(`  hold ${holdMs} ms (${arm})`);
    await p.waitForTimeout(18000);
    await p.evaluate(PARK);
    await grab(p, `dublin-${arm}-settled`);
    await p.close();
  }

  /* ---- #3 DEPTH_PASS off vs armed at P-LEWIS ---------------------------- */
  for (const [arm, depth] of [['off', false], ['on', true]]) {
    const p = await newPage(true, depth);
    await pose(p, P_LEWIS, 26000);
    await grab(p, `depth-${arm}`);
    await p.close();
  }

  fs.writeFileSync(path.join(__dirname, 'r22-e-moneyshots.json'), JSON.stringify(out, null, 1));
  console.log('\nMONEY SHOTS written to scripts/r22-e-money-*.png');
  await browser.close();
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});

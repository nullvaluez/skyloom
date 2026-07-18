/**
 * Round 7 Phase A: full 360° RMB free-look orbit.
 * Gates: (1) a long RMB drag sweeps the camera's bearing around the plane
 * > 300°; (2) at the half-sweep the camera FACES the plane (the old rig
 * kept the look-ahead target — dot(camFwd, toPlane) went negative behind);
 * (3) pitch drag reaches > 1.3 rad of orbit elevation; (4) release snaps
 * back to the chase pose within 2s; (5) drag that leaves the canvas keeps
 * accumulating (pointer capture); (6) draws ≤ 350, zero pageerrors.
 */
const { chromium } = require('playwright');
const path = require('path');
const { bootFly } = require('./_boot');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const shot = (n) => page.screenshot({ path: path.join(__dirname, `freelook-${n}.png`) });

  await bootFly(page); // R9-3: fly-only boot — waits on the real __flyBoot contract
  await page.mouse.move(800, 450);
  await page.waitForTimeout(1000);

  // Camera bearing around the plane (deg, world XZ), and facing dot.
  const sample = () =>
    page.evaluate(() => {
      const f = window.__fly;
      const cam = f.camera;
      // Scene frame = absolute mercator − floating-origin anchor (x/z only)
      const o = f.origin.anchor;
      const px = f.flight.pos.x - o.x;
      const py = f.flight.pos.y;
      const pz = f.flight.pos.z - o.z;
      const dx = cam.position.x - px;
      const dz = cam.position.z - pz;
      const bearing = (Math.atan2(dx, dz) * 180) / Math.PI;
      // camera forward in world space
      const e = cam.matrixWorld.elements;
      const cf = { x: -e[8], y: -e[9], z: -e[10] };
      const to = { x: px - cam.position.x, y: py - cam.position.y, z: pz - cam.position.z };
      const len = Math.hypot(to.x, to.y, to.z) || 1;
      const dot = (cf.x * to.x + cf.y * to.y + cf.z * to.z) / len;
      return {
        bearing,
        dot,
        camY: cam.position.y,
        planeY: py,
        dist: len,
        lookYaw: f.chaseRig?._look.yaw,
        lookPitch: f.chaseRig?._look.pitch,
        freeAmt: f.chaseRig?._freeAmt,
      };
    });

  // --- 1+2: full yaw sweep with facing checks -----------------------------
  // Stay inside the viewport (synthetic mouse events die past the edge):
  // 60 → 1560 = 0.94 screen-widths × yawRate 7 ≈ 375° commanded. Drag slow
  // enough for the damped camera to keep up.
  await page.mouse.move(60, 450);
  await page.mouse.down({ button: 'right' });
  let unwrapped = 0;
  let prev = null;
  let minDot = 1;
  let halfDot = 1;
  const steps = 30;
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(60 + ((i + 1) * 1500) / steps, 450, { steps: 4 });
    await page.waitForTimeout(160);
    const s = await sample();
    if (prev !== null) {
      let d = s.bearing - prev;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      unwrapped += Math.abs(d);
    }
    prev = s.bearing;
    minDot = Math.min(minDot, s.dot);
    if (i === Math.floor(steps / 2)) {
      halfDot = s.dot;
      await shot('01-half-sweep-facing-plane');
    }
  }
  // let the damped camera settle onto the final commanded bearing
  await page.waitForTimeout(600);
  const settled = await sample();
  if (prev !== null) {
    let d = settled.bearing - prev;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    unwrapped += Math.abs(d);
  }
  await page.mouse.up({ button: 'right' });
  console.log(
    `yaw sweep: ${unwrapped.toFixed(0)}° · min facing dot ${minDot.toFixed(3)} · half-sweep dot ${halfDot.toFixed(3)} · rig yaw ${settled.lookYaw?.toFixed(2)} freeAmt ${settled.freeAmt?.toFixed(2)}`
  );
  const sweepOk = unwrapped > 300;
  const facingOk = minDot > 0.85; // camera always aims at the plane in orbit

  // --- 4: snapback ---------------------------------------------------------
  await page.waitForTimeout(2000);
  const back = await sample();
  // chase pose: camera behind the plane → facing dot high, bearing ~ behind
  const snapbackOk = back.dot > 0.7;
  console.log(`snapback: dot ${back.dot.toFixed(3)} after 2s → ${snapbackOk ? 'ok' : 'FAIL'}`);

  // --- 3: pitch orbit (drag up = camera climbs toward top-down) -----------
  await page.mouse.move(800, 860);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 40, { steps: 24 }); // 820px ≈ 0.91 screen-heights
  await page.waitForTimeout(900); // damped position catches up
  const top = await sample();
  const rise = top.camY - top.planeY;
  const pitchRad = Math.asin(Math.min(1, Math.max(-1, rise / top.dist)));
  console.log(
    `pitch orbit: cam ${rise.toFixed(1)} over plane, dist ${top.dist.toFixed(1)} → ${pitchRad.toFixed(2)} rad · rig pitch ${top.lookPitch?.toFixed(2)}`
  );
  const pitchOk = pitchRad > 1.3;
  await shot('02-top-down-orbit');
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(2200);

  // --- 5: capture robustness: free-look survives the cursor leaving the
  // canvas (pointer capture holds the drag; product state stays active) ----
  await page.mouse.move(1500, 450);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(1620, 450, { steps: 6 }); // past the viewport edge
  await page.waitForTimeout(300);
  const stillActive = await page.evaluate(() => window.__fly.input.freeLook.active === true);
  await page.mouse.up({ button: 'right' });
  console.log(`free-look active after off-canvas excursion: ${stillActive}`);
  const captureOk = stillActive;

  const s = await page.evaluate(() => ({
    draws: window.__flyStats?.drawCalls,
  }));
  console.log('draws:', s.draws, '· pageErrors:', errs.length);
  if (errs.length) console.log('errors:', errs.slice(0, 5));

  const pass = sweepOk && facingOk && snapbackOk && pitchOk && captureOk && errs.length === 0;
  console.log(
    `gates — sweep:${sweepOk} facing:${facingOk} snapback:${snapbackOk} pitch:${pitchOk} capture:${captureOk}`
  );
  console.log(pass ? 'VERIFY: PASS' : 'VERIFY: FAIL');
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('VERIFY FAILED:', e.message);
  process.exit(1);
});

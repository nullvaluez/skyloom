/**
 * Round 17 §A3 — PHOTO MODE.
 *
 * Nine gates:
 *   1. P enters photo mode: cameraMode 'photo', the flying HUD (contracts
 *      panel + stats strip + legend) is HIDDEN — and the Esri/OSM attribution
 *      is STILL VISIBLE (hard legal constraint: every UI state, no exceptions)
 *   2. the stick is neutralized — a button-0 drag does not steer the plane
 *      (heading is unchanged across the drag) …
 *   3. …while the SAME drag orbits the camera (photo yaw + true camera
 *      azimuth around the aircraft both move)
 *   4. wheel scrubs the orbit distance inside PHOTO.minDistM..maxDistM
 *   5. capture through the runtime bus returns a real PNG: magic bytes, IHDR
 *      dimensions === the GL drawing buffer, watermark flag set
 *   6. Esc exits photo mode back to 'chase'
 *   7. phase never left 'flying' at any point (photo mode is NOT a pause)
 *   8. satellite: P + capture work there too (different attribution baked in)
 *   9. zero pageerrors
 *
 * The capture is exercised through window.__flyRuntimeBus — the same
 * at-call-time resolution the shutter button uses — and the returned blob is
 * written to scripts/shots/photo-capture-sample.png so the watermark and the
 * grade can be eyeballed.
 *
 * Run: npm run dev (:3000), then `node scripts/verify-photo.js`.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly } = require('./_boot');

const SHOTS = path.join(__dirname, 'shots');
const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];
const MIN_DIST_M = 25; // PHOTO.minDistM
const MAX_DIST_M = 600; // PHOTO.maxDistM

/** Read the page-side capture as base64 + a few decodable header facts. */
async function capture(page) {
  return page.evaluate(async () => {
    const fn = window.__flyRuntimeBus?.getRuntimeAction('capturePhoto');
    if (!fn) return { err: 'capturePhoto not registered on the bus' };
    const res = await fn();
    const buf = new Uint8Array(await res.blob.arrayBuffer());
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < buf.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
    }
    const be32 = (o) => (buf[o] << 24) | (buf[o + 1] << 16) | (buf[o + 2] << 8) | buf[o + 3];
    const gl = document.querySelector('.fixed.inset-0 canvas'); // R3F canvas is first
    return {
      filename: res.filename,
      size: buf.length,
      magic: Array.from(buf.slice(0, 8)),
      ihdr: String.fromCharCode(...buf.slice(12, 16)),
      pngW: be32(16),
      pngH: be32(20),
      glW: gl?.width ?? 0,
      glH: gl?.height ?? 0,
      stats: window.__flyStats?.photo ?? null,
      b64: btoa(bin),
    };
  });
}

/** Camera azimuth around the aircraft, absolute frame (rad). */
function orbitProbe(page) {
  return page.evaluate(() => {
    const fly = window.__fly;
    const ax = fly.origin.anchor.x;
    const az = fly.origin.anchor.z;
    const dx = fly.camera.position.x + ax - fly.flight.pos.x;
    const dz = fly.camera.position.z + az - fly.flight.pos.z;
    return {
      azimuth: Math.atan2(dx, dz),
      heading: fly.flight.heading,
      yaw: fly.photoRig?._look?.yaw ?? null,
      pitch: fly.photoRig?._look?.pitch ?? null,
      dist: fly.photoRig?._dist ?? null,
      mode: window.__flyStore.getState().cameraMode,
      phase: window.__flyStore.getState().phase,
    };
  });
}

/** Signed angle difference in degrees, wrapped to (-180, 180]. */
const degDiff = (a, b) => {
  let d = ((a - b) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
};

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const fails = [];
  const gate = (name, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!ok) fails.push(name);
  };
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, `photo-${n}.png`) });

  // Every phase sample the run takes; gate 7 asserts the whole series.
  const phases = [];
  const samplePhase = async () =>
    phases.push(await page.evaluate(() => window.__flyStore.getState().phase));

  await bootFly(page); // Neon (toy), weather pinned baseline, controls seen
  await page.mouse.move(800, 450); // dead-center: mouse-steer deadzone
  await page.waitForTimeout(2500); // let any residual bank level out
  await samplePhase();

  // --- 1. P enters photo mode; HUD hides, attribution does NOT -------------
  await page.keyboard.press('p');
  await page.waitForTimeout(900);
  await samplePhase();
  const entered = await page.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    // The Esri line is the FIRST link inside the attribution bar.
    const attr = document.querySelector('.absolute.bottom-2.left-2');
    return {
      mode: window.__flyStore.getState().cameraMode,
      contracts: vis('[data-testid="contracts-panel"]'),
      hudTier: vis('[data-testid="hud-quality-tier"]'),
      bar: vis('[data-testid="photo-bar"]'),
      shutter: vis('[data-testid="photo-shutter"]'),
      attrVisible: !!attr && attr.getBoundingClientRect().width > 0,
      attrText: attr?.textContent ?? '',
    };
  });
  gate(
    'P → photo mode: HUD hidden, photo bar up, ATTRIBUTION STILL VISIBLE',
    entered.mode === 'photo' &&
      entered.contracts === false &&
      entered.hudTier === false &&
      entered.bar === true &&
      entered.shutter === true &&
      entered.attrVisible === true &&
      /Esri/.test(entered.attrText),
    `mode ${entered.mode}, contracts vis ${entered.contracts}, hud vis ${entered.hudTier}, bar ${entered.bar}, attr "${entered.attrText.slice(0, 40)}"`
  );

  // --- 2 + 3. one drag: no steering, real orbit ----------------------------
  const before = await orbitProbe(page);
  await page.mouse.move(800, 450);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(800 + i * 30, 450 + i * 4, { steps: 2 });
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await page.waitForTimeout(900); // orbit damping settles
  const after = await orbitProbe(page);
  await samplePhase();

  const headingDrift = Math.abs(degDiff(after.heading, before.heading));
  gate(
    'stick neutralized: a button-0 drag does not steer the plane',
    headingDrift < 3,
    `heading drift ${headingDrift.toFixed(2)}°`
  );

  const yawMoved = Math.abs(((after.yaw - before.yaw) * 180) / Math.PI);
  const azMoved = Math.abs(degDiff(after.azimuth, before.azimuth));
  gate(
    'the same drag ORBITS the camera',
    yawMoved > 15 && azMoved > 10,
    `photo yaw Δ ${yawMoved.toFixed(1)}°, camera azimuth Δ ${azMoved.toFixed(1)}°`
  );
  await shot('01-active');

  // --- 4. wheel zoom -------------------------------------------------------
  const d0 = after.dist;
  await page.mouse.move(800, 450);
  await page.mouse.wheel(0, -1200); // scroll up = closer
  await page.waitForTimeout(700);
  const dIn = (await orbitProbe(page)).dist;
  await page.mouse.wheel(0, 4000); // and back out, hard, to hit the clamp
  await page.waitForTimeout(900);
  const dOut = (await orbitProbe(page)).dist;
  gate(
    `wheel scrubs orbit distance inside ${MIN_DIST_M}..${MAX_DIST_M} m`,
    dIn < d0 - 1 &&
      dOut > dIn + 1 &&
      dIn >= MIN_DIST_M - 0.5 &&
      dOut <= MAX_DIST_M + 0.5,
    `${d0.toFixed(1)}m → in ${dIn.toFixed(1)}m → out ${dOut.toFixed(1)}m`
  );

  // --- 5. capture ----------------------------------------------------------
  // Frame the sample shot from a sane distance first — gate 4 deliberately
  // parked the rig on the far clamp.
  await page.mouse.wheel(0, -1000);
  await page.waitForTimeout(900);
  const cap = await capture(page);
  await samplePhase();
  if (cap.b64) {
    fs.writeFileSync(path.join(SHOTS, 'photo-capture-sample.png'), Buffer.from(cap.b64, 'base64'));
  }
  gate(
    'capture returns a graded PNG with baked attribution',
    !cap.err &&
      PNG_MAGIC.every((b, i) => cap.magic[i] === b) &&
      cap.ihdr === 'IHDR' &&
      cap.pngW === cap.glW &&
      cap.pngH === cap.glH &&
      cap.glW > 0 &&
      cap.stats?.watermark === true &&
      cap.stats?.captures >= 1 &&
      /^skyloom-photo-.*\.png$/.test(cap.filename || '') &&
      cap.size > 20000,
    cap.err ||
      `${cap.filename} — ${cap.pngW}×${cap.pngH} (canvas ${cap.glW}×${cap.glH}), ${(cap.size / 1024) | 0} KB, ${cap.stats?.ms}ms, style ${cap.stats?.style}`
  );

  // --- 6. Esc exits --------------------------------------------------------
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  await samplePhase();
  const exited = await page.evaluate(() => ({
    mode: window.__flyStore.getState().cameraMode,
    bar: !!document.querySelector('[data-testid="photo-bar"]'),
    contracts: !!document
      .querySelector('[data-testid="contracts-panel"]')
      ?.getBoundingClientRect().width,
  }));
  gate(
    'Esc leaves photo mode and restores the HUD',
    exited.mode === 'chase' && exited.bar === false && exited.contracts === true,
    `mode ${exited.mode}, bar mounted ${exited.bar}, contracts back ${exited.contracts}`
  );

  // --- 7. never paused -----------------------------------------------------
  await samplePhase();
  gate(
    "phase stayed 'flying' throughout (photo mode is not a pause)",
    phases.length >= 6 && phases.every((p) => p === 'flying'),
    phases.join(' → ')
  );

  gate('zero pageerrors (toy)', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();

  // --- 8. satellite --------------------------------------------------------
  const satBrowser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const sp = await satBrowser.newPage({ viewport: { width: 1600, height: 900 } });
  const satErrs = [];
  sp.on('pageerror', (e) => satErrs.push(e.message));
  await bootFly(sp, { style: 'satellite' });
  await sp.mouse.move(800, 450);
  await sp.waitForTimeout(2500);
  await sp.keyboard.press('p');
  await sp.waitForTimeout(1200);
  const satMode = await sp.evaluate(() => window.__flyStore.getState().cameraMode);
  const satCap = await capture(sp);
  if (satCap.b64) {
    fs.writeFileSync(
      path.join(SHOTS, 'photo-capture-satellite.png'),
      Buffer.from(satCap.b64, 'base64')
    );
  }
  await sp.screenshot({ path: path.join(SHOTS, 'photo-02-satellite.png') });
  const satPhase = await sp.evaluate(() => window.__flyStore.getState().phase);
  gate(
    'satellite: P + capture work there too',
    satMode === 'photo' &&
      !satCap.err &&
      PNG_MAGIC.every((b, i) => satCap.magic[i] === b) &&
      satCap.pngW === satCap.glW &&
      satCap.stats?.watermark === true &&
      satCap.stats?.style === 'satellite' &&
      satPhase === 'flying',
    satCap.err ||
      `mode ${satMode}, ${satCap.pngW}×${satCap.pngH}, style ${satCap.stats?.style}, phase ${satPhase}`
  );
  gate('zero pageerrors (satellite)', satErrs.length === 0, satErrs.slice(0, 3).join(' | '));
  await satBrowser.close();

  console.log(fails.length ? `VERIFY: FAIL (${fails.join(', ')})` : 'VERIFY: PASS');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.stack || e.message);
  process.exit(1);
});

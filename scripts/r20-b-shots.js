/**
 * R20 B "HOMES" — A/B evidence pass for SatParcelHomes.
 *
 * Same pinned pose, same settled frame, layer OFF then ON via the dev park
 * handle `window.__flyParcelHomesOff` (a bare mesh.visible flip would be
 * overwritten by the layer's own 2 s cadence — R19 §7). Writes
 * scripts/r20-b-<scene>-{off,on}.png.
 *
 * Each scene carries its OWN sun override: 17:00 UTC is 13:00 in Ohio and
 * 04:00 in Melbourne, and an A/B of a suburb photographed in the dark proves
 * nothing about a suburb.
 *
 * Usage: FLY_URL=http://localhost:3121 node scripts/r20-b-shots.js [scene]
 */
const { chromium } = require('playwright');
const path = require('path');
const sharp = require('sharp');
const { bootFly } = require('./_boot');

const BOOT_OPTS = process.env.FLY_URL ? { url: process.env.FLY_URL } : {};

const SCENES = [
  // THE GAP: Melbourne's outer suburbs — 22.85 km² of landuse=residential
  // against 851 real footprints (37/km², i.e. 6% of a real suburb's housing).
  ['melton-au', [-37.68172, 144.57398, 700, 1.9, -0.34], Date.UTC(2026, 6, 27, 2, 0, 0)],
  // THE CONTROL: Powell OH, where A SPRAWL's per-polygon fix made the real
  // data dense (1863 footprints). This pair is the anti-duplication proof.
  ['powell', [40.15153, -83.08533, 700, 1.9, -0.34], Date.UTC(2026, 6, 27, 17, 0, 0)],
  // SMALL-TOWN US: Plain City OH — 1.51 km² residential, 293 real footprints
  // (195/km²), and one of its nine z14 tiles carries residential landuse with
  // NO `building` layer at all.
  ['plaincity-oh', [40.1073, -83.2674, 700, 1.9, -0.34], Date.UTC(2026, 6, 27, 17, 0, 0)],
  // A MAPPED non-US town, as the second anti-duplication control: Blagnac
  // ships 22,448 building polygons over its 3x3 and must stay ~untouched.
  ['blagnac-fr', [43.63379, 1.38366, 700, 1.9, -0.34], Date.UTC(2026, 6, 27, 11, 0, 0)],
  // NIGHT: the same Melbourne pose after dusk — window glow, not lit boxes.
  ['melton-au-night', [-37.68172, 144.57398, 700, 1.9, -0.34], Date.UTC(2026, 6, 27, 15, 0, 0)],
  // THE SECOND GAP, and the scene that forced the dedicated anchor emission:
  // Craigieburn ships 22.72 km² of residential landuse and ZERO cls-4 canopy
  // anchors (its scatter budget is spent in all nine tiles).
  ['craigieburn-au', [-37.595, 144.94, 700, 1.9, -0.34], Date.UTC(2026, 6, 27, 2, 0, 0)],
  // THE LOCK: Owens Valley must be identical in both frames.
  ['owens', [36.6, -118.1, 2600, 1.2, -0.18], Date.UTC(2026, 6, 27, 17, 0, 0)],
];

/**
 * How much of the frame the ON pass actually changed, and where.
 *
 * "Powell is near-identical" and "Melton fills the gap" are both CLAIMS ABOUT
 * PIXELS, and an eyeball on two 1600x900 frames cannot separate 2,068 small
 * houses from re-arriving imagery tiles. So the pair is differenced (the
 * verify-groundlife recipe, absolute luma here because a house both brightens
 * a roof and darkens the ground beside it — a signed metric would cancel), and
 * the SUPPRESSED scenes are read as the control: whatever they score is this
 * instrument's own noise floor, and a gap-fill scene has to beat it.
 * Writes r20-b-<scene>-diff.png when the pair moved at all.
 */
async function diffPair(fileA, fileB, out) {
  const A = await sharp(path.join(__dirname, fileA)).raw().toBuffer({ resolveWithObject: true });
  const B = await sharp(path.join(__dirname, fileB)).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = A.info;
  const buf = Buffer.alloc(width * height * 3);
  let max = 0;
  let above = 0;
  let sum = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const d = Math.abs(
      0.2126 * (A.data[o] - B.data[o]) +
        0.7152 * (A.data[o + 1] - B.data[o + 1]) +
        0.0722 * (A.data[o + 2] - B.data[o + 2])
    );
    if (d > max) max = d;
    if (d > 6) above += 1;
    sum += d;
    const v = Math.max(0, Math.min(255, d * 16));
    buf[i * 3] = v;
    buf[i * 3 + 1] = v;
    buf[i * 3 + 2] = v;
  }
  if (above > 0)
    await sharp(buf, { raw: { width, height, channels: 3 } })
      .png()
      .toFile(path.join(__dirname, out));
  return {
    max: +max.toFixed(1),
    movedPct: +((100 * above) / (width * height)).toFixed(3),
    mean: +(sum / (width * height)).toFixed(3),
  };
}

const pinScene = ([lat, lon, altM, heading, pitch]) => {
  window.__fly.warpToGeo(lat, lon, { altM, name: null });
  const f = window.__fly.flight;
  f.heading = heading;
  f.pitch = pitch;
  f.bank = 0;
  const p = { x: f.pos.x, y: f.pos.y, z: f.pos.z };
  if (window.__pin) clearInterval(window.__pin);
  window.__pin = setInterval(() => {
    f.pos.x = p.x;
    f.pos.y = p.y;
    f.pos.z = p.z;
    f.heading = heading;
    f.pitch = pitch;
    f.bank = 0;
    f.speed = 0;
  }, 8);
};

(async () => {
  const only = process.argv[2] || null;
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem('fly-quality-tier', 'high');
    } catch {
      /* storage blocked */
    }
  });
  await bootFly(page, { style: 'satellite', ...BOOT_OPTS });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.mouse.move(800, 450);

  const shot = (n) =>
    page.locator('.fixed.inset-0 canvas').first().screenshot({ path: path.join(__dirname, n) });

  for (const [name, pose, sunUTC] of SCENES) {
    if (only && name !== only) continue;
    await page.evaluate((s) => {
      window.__flySunOverride = s;
    }, sunUTC);
    await page.evaluate(pinScene, pose);
    await page.waitForTimeout(28000);
    await page.mouse.move(800, 450);

    await page.evaluate(() => {
      window.__flyParcelHomesOff = true;
    });
    await page.waitForTimeout(4000);
    const off = await page.evaluate(() => ({
      draws: window.__flyStats?.drawCalls ?? -1,
      tris: window.__flyStats?.triangles ?? -1,
      placed: window.__flyStats?.parcelHomes?.placed ?? -1,
    }));
    await shot(`r20-b-${name}-off.png`);

    await page.evaluate(() => {
      window.__flyParcelHomesOff = false;
    });
    await page.waitForTimeout(4000);
    const on = await page.evaluate(() => ({
      draws: window.__flyStats?.drawCalls ?? -1,
      tris: window.__flyStats?.triangles ?? -1,
      ph: window.__flyStats?.parcelHomes ?? {},
    }));
    await shot(`r20-b-${name}-on.png`);

    const dif = await diffPair(
      `r20-b-${name}-on.png`,
      `r20-b-${name}-off.png`,
      `r20-b-${name}-diff.png`
    );

    console.log(
      `SHOT ${name.padEnd(12)} diff[max=${dif.max} moved=${dif.movedPct}% mean=${dif.mean}] ` +
        `off[draws=${off.draws} tris=${off.tris} placed=${off.placed}] ` +
        `on[draws=${on.draws} tris=${on.tris} placed=${on.ph.placed} anchors=${on.ph.anchors} ` +
        `suppressed=${on.ph.suppressed} meanDens=${(on.ph.meanDens ?? 0).toFixed(0)}/km2 ` +
        `meanScalar=${(on.ph.meanScalar ?? 0).toFixed(2)} regDens=${(on.ph.regionalDens ?? 0).toFixed(0)} regK=${(on.ph.regK ?? 0).toFixed(2)} realCols=${on.ph.realCols} homeTris=${on.ph.tris}] ` +
        `dDraws=${on.draws - off.draws}`
    );
  }
  await browser.close();
})();

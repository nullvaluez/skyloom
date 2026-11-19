// Capture the player-visible F-35 flight, using the same Paris pose in both
// arms. Example: node scripts/review-flight-clarity.cjs <local origin> after
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const sharp = require('sharp');
const { enterFlight } = require('./_skip-menus');

async function compareTurns() {
  const root = path.resolve('.graphics-review/cockpit-grain');
  const frames = [];
  const width = 1208, height = 292;
  const label = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1208" height="40"><g fill="white" font-family="Arial" font-size="17"><text x="12" y="26">Current defaults</text><text x="620" y="26">Flight clarity preview</text></g></svg>');
  const before = JSON.parse(fs.readFileSync(path.join(root, 'before', 'flight.json')));
  const after = JSON.parse(fs.readFileSync(path.join(root, 'after', 'flight.json')));
  assert.deepEqual(before.turn, after.turn);
  for (let i = 0; i < before.turn.headingRadians.length; i++) {
    const name = 'turn-' + String(i).padStart(2, '0') + '.png';
    const panel = sharp({ create: { width, height, channels: 3, background: '#15202a' } }).composite([
      { input: label, left: 0, top: 0 },
      { input: path.join(root, 'before', name), left: 0, top: 40 },
      { input: path.join(root, 'after', name), left: 608, top: 40 },
    ]);
    frames.push(await panel.removeAlpha().raw().toBuffer());
  }
  // Ping-pong so the end of the slow camera sweep never cuts back to its start.
  const sequence = frames.concat(frames.slice(1, -1).reverse());
  const raw = { width, height: height * sequence.length, pageHeight: height, channels: 3 };
  await sharp(Buffer.concat(sequence), { raw }).webp({ lossless: true, delay: 115, loop: 0 }).toFile(path.join(root, 'paris-motion.webp'));
}

async function main() {
  const [origin, arm] = process.argv.slice(2);
  if (origin === 'compare') return compareTurns();
  assert.ok(['before', 'after', 'touch', 'valley'].includes(arm));
  const touch = arm === 'touch';
  const valley = arm === 'valley';
  const out = path.resolve('.graphics-review/cockpit-grain', arm);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: touch ? { width: 844, height: 390 } : { width: 1600, height: 900 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  const report = { arm, errors: [], shots: [], checks: [] };
  const save = () => fs.writeFileSync(path.join(out, 'flight.json'), JSON.stringify(report, null, 2));
  page.on('pageerror', e => { report.errors.push(e.message); save(); });
  page.on('console', e => { if (e.type() === 'error' && /shader|WebGL|GLSL|\[wp-reach\]/i.test(e.text())) { report.errors.push(e.text().slice(0, 1200)); save(); } });
  const delay = ms => page.waitForTimeout(ms);
  async function shot(file) {
    await page.screenshot({ path: path.join(out, file), style: 'nextjs-portal{display:none!important}' });
    report.shots.push(file); save(); console.log('Captured ' + file);
  }
  async function sampleCity() {
    // Fixed-pose temporal noise, in native 8-bit luma. Each capture reads the
    // same buildings below the Seine, away from the aircraft and HUD.
    const clip = { x: 280, y: 750, width: 240, height: 40 };
    let previous, sum = 0, pixels = 0;
    for (let frame = 0; frame < 8; frame++) {
      const image = await page.screenshot({ clip });
      const luma = await sharp(image).greyscale().raw().toBuffer();
      if (previous) for (let i = 0; i < luma.length; i++) {
        sum += Math.abs(luma[i] - previous[i]); pixels++;
      }
      previous = luma;
    }
    return { frames: 8, clip, meanAbsoluteLumaChange: sum / pixels };
  }
  async function sampleTurn() {
    const clip = { x: 100, y: 505, width: 600, height: 252 };
    const base = await page.evaluate(() => window.__clarityHold.heading);
    const poses = [];
    for (let step = 0; step < 12; step++) {
      const heading = base + step * .00065;
      await page.evaluate(h => { window.__clarityHold.heading = h; }, heading);
      await delay(200);
      const filename = 'turn-' + String(step).padStart(2, '0') + '.png';
      await page.screenshot({ path: path.join(out, filename), clip });
      poses.push(heading);
    }
    await page.evaluate(h => { window.__clarityHold.heading = h; }, base);
    return { headingRadians: poses, clip };
  }
  try {
    const link = new URL(origin);
    link.searchParams.set('graphicsReview', '1');
    if (valley) link.searchParams.set('fly', 'yosemite');
    else link.searchParams.set('at', '48.835,2.305,4920');
    link.searchParams.set('aircraft', valley ? 'glider' : 'f35');
    link.searchParams.set('flags', arm === 'before' ? '-FLIGHT_CLARITY,-F35_COCKPIT' : 'FLIGHT_CLARITY,F35_COCKPIT');
    link.searchParams.set('sunUtc', valley ? '2026-06-22T01:20:00Z' : '2026-06-21T14:00:00Z');
    link.searchParams.set('weather', 'baseline');
    await page.addInitScript(({ touch }) => {
      localStorage.setItem('fly-quality-tier', touch ? 'medium' : 'high');
      localStorage.setItem('fly-sound-on', '0');
      localStorage.setItem('fly-controls-seen', '1');
      localStorage.setItem('fly-explorer-preferences-v1', JSON.stringify({ version: 1, settings: { tutorial: 'done' } }));
      window.__flyGovPin = 'hold';
    }, { touch });
    await page.goto(link.href, { waitUntil: 'domcontentloaded', timeout: 150000 });
    await page.waitForFunction(() => window.__flyStore?.getState().screen === 'flight' && window.__flyBoot?.pct === 100, null, { timeout: 180000 });
    assert.equal(await page.evaluate(() => window.__flyStore.getState().aircraftId), valley ? 'glider' : 'f35');
    if (valley) {
      await page.waitForFunction(() => window.__fly.terraStats?.sharp && !window.__fly.worldLoading);
      const selection = await page.evaluate(() => window.__flyStore.getState().f35PilotSeat);
      await page.keyboard.press('4');
      await page.waitForFunction(previous => window.__flyStore.getState().f35PilotSeat !== previous, selection);
      assert.equal(await page.evaluate(() => window.__flyStore.getState().cameraMode), 'chase');
      await shot('yosemite-glider.png');
      report.checks.push('Public Yosemite entry selects the glider and 4 toggles its seat');
      assert.deepEqual(report.errors, []);
      return;
    }
    const pose = { lat: 48.835, lon: 2.305, headingDeg: 35, altM: 1500, name: null };
    await enterFlight(page, pose);
    await page.evaluate((pose) => {
      const f = window.__fly.flight;
      window.__clarityHold = { x: f.pos.x, y: pose.altM, z: f.pos.z, bank: 0, heading: pose.headingDeg * Math.PI / 180 };
      const step = f.step.bind(f);
      f.step = (dt, cmd) => {
        step(dt, cmd);
        const h = window.__clarityHold;
        if (!h) return;
        f.pos.set(h.x, h.y, h.z); f.heading = h.heading; f.bank = h.bank; f.pitch = .016;
      };
    }, pose);
    await page.waitForFunction(() => window.__fly.terraStats?.sharp && !window.__fly.worldLoading && !document.querySelector('[data-testid="warp-hold"]'), null, { timeout: 150000 });
    if (!touch) await page.waitForFunction(() => {
      const b = window.__fly.satBuildings?.stats, skyline = window.__fly.satSkyline;
      return b?.ready >= 12 && skyline?.stats?.ready >= 20 && skyline._photos?.stat.fetched >= 20;
    }, null, { timeout: 150000 });
    await delay(5000);
    report.scene = await page.evaluate(() => {
      const r = window.__fly, s = window.__flyStore.getState();
      const ground = r.satSkyline;
      const canvas = [...document.querySelectorAll('canvas')].find(c => c.getContext('webgl2'));
      const gl = canvas.getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { gpu: ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), flags: window.__flyUrlFlags,
        tier: s.qualityTier, preset: s.qualityPreset, screen: s.screen, aircraft: s.aircraftId, sharp: r.terraStats?.sharp,
        readyBuildings: r.satBuildings?.stats?.ready, readySkyline: ground?.stats?.ready, photos: ground?._photos?.stat,
        photoSliceHeight: ground?._atlas?.texture?.image?.height, dpr: canvas.width / canvas.clientWidth };
    });
    console.log(JSON.stringify(report.scene)); save();
    if (arm !== 'before') {
      await shot(touch ? 'touch-seat.png' : 'pilot-seat.png');
      if (!touch) {
        await page.keyboard.down(']'); await delay(540); await shot('side-view.png'); await page.keyboard.up(']');
        await delay(850);
        await page.keyboard.press('4');
        await page.waitForFunction(() => !window.__flyStore.getState().f35PilotSeat);
      }
    }
    if (touch) {
      assert.ok(await page.evaluate(() => window.__flyStore.getState().f35PilotSeat));
      for (const seated of [false, true]) {
        await page.getByTestId('touch-fab').tap();
        await page.getByTestId('touch-seat').tap();
        await page.waitForFunction(value => window.__flyStore.getState().f35PilotSeat === value, seated);
      }
      report.checks.push('Flight Actions switches between pilot and chase in both directions');
      await page.setViewportSize({ width: 390, height: 844 }); await delay(1100); await shot('portrait-seat.png');
    } else {
      await delay(1000); await shot('paris-exterior.png');
      report.stationaryCity = await sampleCity();
      report.turn = await sampleTurn(); save();
      if (arm === 'after') {
        await page.keyboard.press('4'); await page.waitForFunction(() => window.__flyStore.getState().f35PilotSeat);
        await page.keyboard.press('p'); await page.waitForFunction(() => window.__flyStore.getState().cameraMode === 'photo');
        await page.keyboard.press('p'); await page.waitForFunction(() => window.__flyStore.getState().cameraMode === 'chase');
        report.checks.push('4 switches seat/chase both ways', 'P enters and leaves photo from pilot view');
        await page.evaluate(() => { window.__clarityHold.bank = .2; });
        await page.mouse.move(510, 330); await page.mouse.down({ button: 'right' });
        await page.mouse.move(900, 366, { steps: 10 }); await delay(700);
        await shot('canopy-paris.png'); await page.mouse.up({ button: 'right' });
        await delay(700);
        await page.evaluate(() => { window.__clarityHold = null; });
        await page.keyboard.down('ArrowRight'); await delay(900);
        await shot('banking.png'); await page.keyboard.up('ArrowRight');
        const motion = await page.evaluate(() => {
          const f = window.__fly.flight;
          return { position: f.pos.toArray(), bankRad: f.bank, headingRad: f.heading };
        });
        report.motion = motion;
        await page.evaluate(() => {
          const r = window.__fly;
          const heading = 17 * Math.PI / 180;
          if (r.warpToGeo(48.835, 2.246, { altM: 1160, headingRad: heading }) === false) throw Error('Seine flight refused');
          window.__clarityHold = { x: r.flight.pos.x, y: 1160, z: r.flight.pos.z, heading, bank: .115 };
        });
        await delay(5000);
        await page.waitForFunction(() => window.__fly.terraStats?.sharp && !window.__fly.worldLoading, null, {timeout: 90000});
        await delay(6000);
        await page.mouse.move(470, 300); await page.mouse.down({ button: 'right' });
        await page.mouse.move(843, 354, { steps: 10 }); await delay(1000);
        await shot('seine.png'); await page.mouse.up({ button: 'right' });
      }
    }
    assert.deepEqual(report.errors, []);
    assert.ok(report.scene.sharp);
  } catch (e) {
    report.failure = e.message; await shot('capture-error.png').catch(() => {}); throw e;
  } finally { save(); await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

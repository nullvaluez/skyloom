const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { bootFly } = require('./_boot');
const out = '.graphics-review/aircraft-effects';
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [], cases = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && /shader|THREE.WebGLProgram/i.test(m.text())) errors.push(m.text()); });
  const shot = async name => page.screenshot({ path: out + '/' + name + '.png' });
  const state = () => page.evaluate(() => {
    const r = window.__fly, s = window.__flyStore.getState();
    const gear = window.__flyPlayer?.getObjectByName('player-landing-gear');
    const exhaust = window.__flyPlayer?.getObjectByName('player-engine-exhaust');
    const gl = document.querySelector('.fixed.inset-0 canvas')?.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return { gear: r.operations.gear, gearVisible: gear?.visible ?? false, exhaustVisible: exhaust?.visible ?? false,
      phase: r.operations.phase, screen: s.screen, aircraft: s.aircraftId, wake: window.__flyStats?.aircraftWake,
      traffic: window.__flyStats?.trafficWake, anchors: r.flight.aircraftVisual, speed: r.flight.speed,
      altitude: r.flight.pos.y, loading: r.worldLoading, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      draws: window.__flyStats?.drawCalls, programs: window.__flyStats?.programs };
  });
  const pose = async kind => page.evaluate(kind => {
    window.__fly.chaseRig.update = (dt, f, cam) => {
      const p = f.pos;
      if (kind === 'trail') { cam.position.set(p.x+1500,p.y+350,p.z+1000); cam.lookAt(p.x,p.y,p.z+800); }
      else { const size = f.aircraftVisual?.size.z ?? 20; cam.position.set(p.x+size*1.5,p.y+size*.52,p.z+size*1.6); cam.lookAt(p.x,p.y+size*.03,p.z); }
    };
  }, kind);
  try {
    await bootFly(page, { style: 'toy', settleMs: 1000 });
    await page.waitForFunction(() => typeof window.__fly?.launchSetup === 'function');
    await page.evaluate(() => {
      if (!window.__fly.launchSetup({ flightMode: 'free', aircraftId: 'fighter', dest: 'columbus-practice' })) throw Error('Launch failed');
    });
    await page.waitForFunction(() => window.__fly.operations.phase === 'airborne' && window.__flyStore.getState().screen === 'flight');
    await page.evaluate(() => window.__fly.warpToGeo(40.09, -83.07, { altM: 9500, headingRad: 0 }));
    await page.waitForTimeout(10000);
    let s = await state(); assert.equal(s.gear, 0); assert.equal(s.gearVisible, false); assert.ok(s.wake.points > 10);
    cases.push({ name: 'airborne-cruise', ...s });
    await pose('trail'); await page.waitForTimeout(1000); await shot('neon-wakes');
    await page.evaluate(() => {
      window.__flySunOverride = Date.UTC(2026, 8, 25, 17, 0);
      window.__flyStore.getState().setMapStyle('satellite');
    });
    await page.waitForTimeout(12000); await shot('satellite-wakes');
    s = await state(); assert.ok(s.traffic.ribbons > 0); assert.equal(s.traffic.draws, 1);
    assert.ok(s.traffic.aircraft <= s.traffic.capacity); cases.push({ name: 'satellite-wakes', ...s });
    await pose('hero');
    await page.keyboard.down('Shift'); await page.waitForTimeout(6500); await shot('fighter-exhaust');
    s = await state(); assert.ok(s.exhaustVisible); cases.push({ name: 'boost', ...s });
    await page.keyboard.up('Shift');
    for (const id of ['military','warbird-jet','warbird-prop','prop','glider','bizjet','airliner','cargo','fighter']) {
      console.log('Reviewing ' + id);
      // Inspect the fleet in the already-revealed airborne world. Lifecycle
      // launch/departure transitions are separate cases, not screenshot gates.
      await page.evaluate(id => window.__flyStore.getState().setAircraftId(id), id);
      await page.waitForFunction(id => window.__fly.flight.aircraftVisual?.id === id, id);
      await page.waitForFunction(() => !window.__fly.worldLoading, undefined, { timeout: 90000 });
      await page.locator('[data-testid="warp-hold"]').waitFor({ state: 'hidden', timeout: 20000 });
      await page.waitForTimeout(500);
      s = await state(); assert.equal(s.gear, 0, id); assert.equal(s.gearVisible, false, id);
      if (['prop','glider','warbird-prop','bizjet','airliner','cargo'].includes(id)) assert.equal(s.exhaustVisible, false, id);
      cases.push({ name: 'free-' + id, ...s }); await shot('free-' + id);
    }
    await page.evaluate(() => window.__fly.beginDeparture('fighter','KLCK','runway'));
    await page.waitForTimeout(500); s = await state();
    assert.equal(s.gear, 1); assert.equal(s.gearVisible, true); assert.equal(s.phase, 'parked');
    cases.push({ name: 'runway-gear-state', ...s });
    await page.evaluate(() => window.__fly.launchSetup({ flightMode: 'free', aircraftId: 'fighter', dest: 'columbus-practice' }));
    await page.waitForTimeout(800); s = await state(); assert.equal(s.gear,0); assert.equal(s.gearVisible,false);
    cases.push({ name: 'departure-to-free', ...s });
    assert.deepEqual(errors, []);
    console.log('VERIFY: PASS (' + cases.length + ' browser cases)');
  } finally {
    fs.writeFileSync(out + '/browser-report.json', JSON.stringify({ cases, errors }, null, 2));
    await browser.close();
  }
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

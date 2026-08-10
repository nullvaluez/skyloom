/**
 * Preflight — run this BEFORE any capture. It answers, in order:
 *
 *   1. Is the network policy letting the world stream? (tiles + ADS-B hosts)
 *   2. Does the dev server answer at FLY_URL?
 *   3. Does the app reach `__flyBoot.pct === 100`?
 *   4. What fps does this container hold at 1600×900 / high tier? (brief §5:
 *      ≥ ~20–24 fps or drop the VIEWPORT, never the tier — tier gates the
 *      night-window/bloom look.)
 *   5. Did the world actually stream (probe.assertWorldStreamed)?
 *
 * Exit code 0 = clear to capture. Exit 2 = boot/world failed. Exit 3 = the
 * network gate is shut (the expected offline answer).
 *
 * Run:
 *   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *   FLY_URL=http://localhost:3100 node scripts/trailer/preflight.js
 */

const { execFileSync } = require('child_process');
const { launch, newCaptureContext, bootTrailer, bootProgress, BOOT_URL } = require('./boot');
const { measureFps, assertWorldStreamed, waitForPlateau, readStats } = require('./probe');

/** Hosts the streamed world needs. adsb hosts are OR-ed; the rest are AND-ed. */
const HOSTS = [
  { url: 'https://tiles.openfreemap.org/planet', label: 'OpenFreeMap vector tiles', required: true },
  {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/8/98/73',
    label: 'Esri World Imagery',
    required: true,
  },
  { url: 'https://api.adsb.lol/v2/point/40.7/-74.0/50', label: 'adsb.lol live traffic', group: 'adsb' },
  { url: 'https://opendata.adsb.fi/api/v2/lat/40.7/lon/-74.0/dist/50', label: 'adsb.fi live traffic', group: 'adsb' },
  { url: 'https://api.open-meteo.com/v1/forecast?latitude=40.7&longitude=-74&current=temperature_2m', label: 'open-meteo weather', optional: true },
];

function probeHost(url) {
  try {
    const out = execFileSync(
      'curl',
      ['-sS', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '12', url],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    return { code: parseInt(out.trim(), 10) || 0, err: null };
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    return { code: 0, err: stderr.split('\n').pop() || e.message };
  }
}

function checkNetwork() {
  console.log('--- network gate ---');
  const results = HOSTS.map((h) => ({ ...h, ...probeHost(h.url) }));
  for (const r of results) {
    const ok = r.code >= 200 && r.code < 400;
    console.log(`  ${ok ? 'OPEN  ' : 'BLOCKED'} ${String(r.code).padStart(3)}  ${r.label}${r.err ? '  (' + r.err + ')' : ''}`);
  }
  const req = results.filter((r) => r.required);
  const adsb = results.filter((r) => r.group === 'adsb');
  const reqOk = req.every((r) => r.code >= 200 && r.code < 400);
  const adsbOk = adsb.some((r) => r.code >= 200 && r.code < 400);
  return { open: reqOk && adsbOk, reqOk, adsbOk, results };
}

(async () => {
  const net = checkNetwork();
  console.log(`  => world hosts ${net.reqOk ? 'reachable' : 'BLOCKED'}, live traffic ${net.adsbOk ? 'reachable' : 'BLOCKED'}`);

  console.log('\n--- dev server ---');
  console.log(`  target: ${BOOT_URL}`);

  const browser = await launch();
  const context = await newCaptureContext(browser, {
    width: 1600,
    height: 900,
    videoDir: null,
    record: false,
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  let booted = false;
  let bootMs = null;
  try {
    const r = await bootTrailer(page, { timeoutMs: Number(process.env.BOOT_TIMEOUT_MS || 240000) });
    bootMs = r.ms;
    booted = true;
    console.log(`  boot: pct 100 in ${(bootMs / 1000).toFixed(1)}s`);
  } catch (e) {
    const prog = await bootProgress(page).catch(() => null);
    console.log(`  boot: DID NOT COMPLETE — ${e.message.split('\n')[0]}`);
    console.log(`  last progress: ${JSON.stringify(prog)}`);
  }

  if (booted) {
    console.log('\n--- plateau / stats ---');
    const pl = await waitForPlateau(page);
    console.log(`  plateau=${pl.plateaued} after ${(pl.ms / 1000).toFixed(1)}s  tris history: ${pl.history.join(' → ')}`);
    console.log(`  stats: ${JSON.stringify(await readStats(page))}`);

    console.log('\n--- fps (1600×900, high tier) ---');
    const fps = await measureFps(page, 5000);
    console.log(`  ${fps} fps`);
    if (fps < 20) console.log('  WARNING: below the brief\'s ~20–24 fps floor — drop VIEWPORT to 1280×720, keep tier high.');

    console.log('\n--- world streamed? ---');
    const w = await assertWorldStreamed(page);
    console.log(`  ${w.ok ? 'YES' : 'NO'}  pixels=${JSON.stringify(w.pixels)}`);
    if (!w.ok) w.reasons.forEach((r) => console.log(`    - ${r}`));
  }

  if (pageErrors.length) {
    console.log(`\n--- pageerrors (${pageErrors.length}) ---`);
    pageErrors.slice(0, 8).forEach((e) => console.log(`  ${e.slice(0, 200)}`));
  }

  await context.close();
  await browser.close();

  console.log('\n=== verdict ===');
  if (!net.open) {
    console.log('  NETWORK GATE SHUT — capture is not possible. Nothing to do but wait for a policy that allows the tile/ADS-B hosts.');
    process.exit(3);
  }
  if (!booted) {
    console.log('  Network is open but the app did not boot. Investigate before capturing.');
    process.exit(2);
  }
  console.log('  CLEAR TO CAPTURE.');
  process.exit(0);
})().catch((e) => {
  console.error('preflight crashed:', e);
  process.exit(1);
});

/**
 * R24 D ATMOS — the LOD hard-pop probe (browser leg, offline fixture).
 *
 * This is the instrument, and the RED/GREEN numbers, that E's `verify-lod-fade`
 * is meant to adopt. It is deliberately NOT a gate: nothing here asserts a
 * bound, because every number it produces is a FIXTURE number on SwiftShader.
 *
 * WHAT IT DRIVES. A serpentine is unaffordable at ~1 fps, so the probe forces
 * the same events with an ALTITUDE LADDER at one pinned lat/lon: descending
 * shrinks `distance / tileSize` and refines the field; climbing merges it back.
 * That is exactly the pair `_loadSubTiles` / `_removeSubTiles` implement.
 *
 * WHAT IT READS.
 *   A's `__flyTerra.lod()`      — refines / merges / parent refetches /
 *                                 tiles REPLACED WHILE ON SCREEN.
 *   D's `__flyStats.terra.fades` — hardSwaps (the RED: swaps with no blend
 *                                 over them), faded, peakActive, skip reasons.
 *
 * THE SwiftShader CAVEAT, stated up front: the clock advances ~1000 ms per
 * frame here, so a shipped 250 ms blend completes INSIDE one frame and cannot
 * be photographed. The ON leg therefore pins `fadeSec` long enough to span
 * several frames — same code path, slowed down so the camera can see it. The
 * fade's real DURATION is a user-machine number; what this proves is that the
 * blend happens, on which swaps, how many at once, and what it looks like.
 *
 * RUN (dev server on 3104):
 *   FLY_TILE_FIXTURE=1 FLY_URL=http://localhost:3104 \
 *     node -r ./scripts/_pw-shim.js scripts/r24-d-lodprobe.js [off|on|slow]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { bootFly } = require('./_boot');

const LEG = process.argv[2] || 'off';
const OUT = path.join(__dirname, 'r24-out');
const SETTLE = Number(process.env.LODPROBE_SETTLE_MS || 9000);
// [altM] — descend (refines), then climb (merges).
const LADDER = (process.env.LODPROBE_LADDER || '4000,1600,800,380,1600,4000').split(',').map(Number);
const POSE = { lat: 40.1578, lon: -83.0752, heading: 1.9, pitch: -0.3 };

const PIN = {
  off: null,
  on: { enabled: true },
  // `slow` is the same code path with the blend stretched so SwiftShader can
  // photograph it; boot suppression is shortened for the same reason (6 s of
  // frame-clock is 6 frames here, which is most of the settle).
  slow: { enabled: true, fadeSec: 6, skipBootMs: 1500 },
}[LEG];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  let closed = false;
  page.on('close', () => { closed = true; });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  if (PIN) await page.addInitScript((p) => { window.__flyLodFadeOverride = p; }, PIN);
  // A's residency trio ON for both legs: keepResident is what stops the
  // frustum-exit merges, so the crossfade's measured value is on REFINES and
  // on whatever merges survive memory pressure. Measuring D against an A-off
  // tree would credit D with A's fix.
  // A's pacing switches ON for both legs. keepResident is what stops the
  // frustum-exit merges, and walkWhileSaturated is what stops the quadtree
  // freezing at z6 behind a busy loader — measuring D against an A-off tree
  // would both credit D with A's fix and measure a stalled tree.
  await page.addInitScript((pace) => { window.__flyTerraPaceOverride = pace; }, {
    enabled: true,
    timerFix: true,
    mergeHysteresis: true,
    keepResident: true,
    walkWhileSaturated: true,
    bboxCache: true,
  });

  await bootFly(page, { style: 'satellite', settleMs: SETTLE });
  await page.evaluate(({ lat, lon, heading, pitch }) => {
    window.__fly.warpToGeo(lat, lon, { altM: 4000, name: null });
    const f = window.__fly.flight;
    window.__lodPose = { y: 4000, heading, pitch };
    if (window.__lodPin) clearInterval(window.__lodPin);
    window.__lodPin = setInterval(() => {
      f.pos.y = window.__lodPose.y + (window.__fly.flight.groundElev || 0);
      f.heading = window.__lodPose.heading;
      f.pitch = window.__lodPose.pitch;
      if (f.vel) { f.vel.x = 0; f.vel.y = 0; f.vel.z = 0; }
    }, 16);
  }, POSE);
  await page.waitForTimeout(SETTLE * 2);
  // A's LOD counters are opt-in (they monkey-patch the Tile prototype), so
  // arm them before the ladder and zero both instruments together.
  await page.evaluate(() => { window.__flyTerra?.instrument?.(); window.__flyTerra?.reset?.(); });

  const rows = [];
  const read = async () => {
    if (closed) return { lod: null, fades: null, resident: null, draws: null };
    try { return await page.evaluate(() => ({
    lod: window.__flyTerra?.lod?.() ?? null,
    fades: JSON.parse(JSON.stringify(window.__flyStats?.terra?.fades ?? null)),
      resident: window.__flyTerra?.mem?.()?.residentTiles ?? null,
      draws: window.__flyStats?.draws ?? null,
    })); } catch { return { lod: null, fades: null, resident: null, draws: null, lost: true }; }
  };

  const before = await read();
  for (const altM of LADDER) {
    if (closed) break;
    try {
      await page.evaluate((a) => { window.__lodPose.y = a; }, altM);
      await page.waitForTimeout(SETTLE);
    } catch { break; }
    const s = await read();
    rows.push({ altM, ...s });
    // Mid-ladder capture, where the field is actively refining.
    if (!closed && rows.length === 3) {
      try { await page.screenshot({ path: path.join(OUT, `lod-${LEG}-powell-mid.png`) }); } catch {}
    }
  }
  const after = await read();
  if (!closed) { try { await page.screenshot({ path: path.join(OUT, `lod-${LEG}-powell-final.png`) }); } catch {} }

  const d = (k) => (after.lod?.[k] ?? 0) - (before.lod?.[k] ?? 0);
  console.log(`\nR24 D — LOD probe, leg "${LEG}"  (pin ${JSON.stringify(PIN)})\n`);
  console.log('  alt(m)  refines merges replacedOnScreen | hardSwaps faded active peak | resident');
  for (const r of rows) {
    const l = r.lod ?? {};
    const f = r.fades ?? {};
    console.log(
      `  ${String(r.altM).padStart(6)}  ${String(l.refine ?? '—').padStart(7)} ${String(l.merge ?? '—').padStart(6)} ` +
      `${String(l.replacedOnScreen ?? '—').padStart(16)} | ${String(f.hardSwaps ?? '—').padStart(9)} ${String(f.faded ?? '—').padStart(5)} ` +
      `${String(f.active ?? '—').padStart(6)} ${String(f.peakActive ?? '—').padStart(4)} | ${String(r.resident ?? '—').padStart(8)}`
    );
  }
  console.log('\n  ladder totals:',
    `A: refine ${d('refine')} · merge ${d('merge')} · refetchParent ${d('refetchParent')} · replacedOnScreen ${d('replacedOnScreen')}`);
  console.log('  fades      :', JSON.stringify(after.fades));
  console.log('  pageerrors :', errors.length, errors.slice(0, 3).join(' | '));
  fs.writeFileSync(path.join(OUT, `lod-${LEG}.json`), JSON.stringify({ leg: LEG, PIN, rows, before, after, errors }, null, 2));
  console.log(`  wrote scripts/r24-out/lod-${LEG}.json + PNGs\n`);
  if (closed) console.log('  NOTE: the browser closed mid-run (SwiftShader/memory) — rows above are what was collected.');
  try { await browser.close(); } catch {}
})().catch((e) => { console.error(e); process.exit(1); });

/**
 * ROUND 22 (B SETTLE, W3 review) — WHY satRoads STILL LANDS LATE.
 *
 * E CERT measures satRoads reaching 90% of its settled chunk count at
 * reveal+15.2 s (red) / +9.5 s (armed) on the Owens → Powell OH warp. My warp
 * gate already waits on the road ring — `roadFrac >= ringTerms.roadReadyFrac`
 * (0.5), consulted only inside SAT_ROADS.cullAglOffM (5200 m) — and that leg
 * reveals at 900 m AGL, so the term IS consulted. The question is therefore
 * not "was it skipped" but "what did it actually assert".
 *
 * The hypothesis is my own documented instrument fragility: `roadFrac` is
 * (ready + empty) / chunks, and `chunks` is the set the engine has ASKED for
 * so far, not the set it will end up with. Early in a stream a 4-chunk ring
 * with 3 resolved reads 0.75 and satisfies a 0.5 threshold while the ring is
 * still expanding toward its settled 16.
 *
 * This samples the road ring every 100 ms across exactly that warp and prints
 * chunks/ready/empty AT the reveal alongside the settled count, so the
 * denominator claim is measured rather than asserted.
 *
 * Usage: FLY_URL=http://localhost:3221 node scripts/r22-b-roadring.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const OWENS = [36.75, -118.05, 2500];
const POWELL = [40.1578, -83.0752, 900];

const TRACE = () => {
  const S = (window.__r22rr = { t0: performance.now(), rows: [], revealAt: null });
  S.tick = setInterval(() => {
    const r = window.__flyStats?.satRoads ?? null;
    const b = window.__flyStats?.satBuildings ?? null;
    const el = document.querySelector('[data-testid="warp-hold"]');
    const as = window.__fly?.arrivalStats ?? null;
    if (S.revealAt == null && as && as.kind === 'far' && as.revealAt != null) {
      S.revealAt = performance.now() - S.t0;
    }
    S.rows.push({
      t: Math.round(performance.now() - S.t0),
      stage: el ? el.getAttribute('data-stage') : null,
      rChunks: r?.chunks ?? null,
      rReady: r?.ready ?? null,
      rEmpty: r?.empty ?? null,
      bChunks: b?.chunks ?? null,
      bReady: b?.ready ?? null,
      bEmpty: b?.empty ?? null,
    });
  }, 100);
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.addInitScript(unpinPins, ['__flyTerraPin', '__flySettlePin']);
  await bootFly(page, { style: 'satellite' });
  await page.evaluate(() => window.__flyStore.getState().setQualityTier('high'));
  await page.evaluate(([p]) => window.__fly.warpToGeo(p[0], p[1], { altM: p[2], name: null }), [OWENS]);
  await page.waitForTimeout(9000);
  await page.evaluate(TRACE);
  await page.evaluate(
    ([p]) => window.__fly.warpToGeo(p[0], p[1], { altM: p[2], name: 'Powell OH' }),
    [POWELL]
  );
  await page.waitForTimeout(22000);
  const out = await page.evaluate(() => {
    const S = window.__r22rr;
    clearInterval(S.tick);
    const rows = S.rows;
    const rv = S.revealAt;
    const at = (ms) => rows.find((r) => r.t >= ms) ?? null;
    const settledR = rows[rows.length - 1]?.rChunks ?? 0;
    const settledB = rows[rows.length - 1]?.bChunks ?? 0;
    const frac = (r) => (r && r.rChunks > 0 ? (r.rReady + r.rEmpty) / r.rChunks : null);
    // t90 against the SETTLED denominator — E's definition, not the live one.
    const t90 = rows.find((r) => settledR > 0 && (r.rReady + r.rEmpty) >= 0.9 * settledR);
    return {
      revealAtMs: rv == null ? null : Math.round(rv),
      atReveal: rv == null ? null : at(rv),
      fracAtReveal: rv == null ? null : frac(at(rv)),
      settledRoadChunks: settledR,
      settledBldgChunks: settledB,
      t90FromRevealMs: t90 && rv != null ? Math.round(t90.t - rv) : null,
      series: rows.filter((_, i) => i % 5 === 0).slice(0, 60),
      warpGate: window.__flyStats?.warpGate ?? null,
    };
  });
  const a = out.atReveal;
  console.log(
    `ROADRING reveal@${out.revealAtMs}ms · at reveal: roads ${a?.rReady}+${a?.rEmpty} of ${a?.rChunks} chunks ` +
      `(liveFrac ${out.fracAtReveal?.toFixed(2)}) · buildings ${a?.bReady}+${a?.bEmpty} of ${a?.bChunks}`
  );
  console.log(
    `  settled: roads ${out.settledRoadChunks} chunks, buildings ${out.settledBldgChunks} · ` +
      `t90 (settled denominator) = reveal+${out.t90FromRevealMs} ms`
  );
  console.log(
    `  ⇒ fracAtReveal was computed over ${a?.rChunks} of the eventual ${out.settledRoadChunks} chunks ` +
      `(${((a?.rChunks / Math.max(1, out.settledRoadChunks)) * 100).toFixed(0)}% of the settled ring)`
  );
  console.log(`  warpGate: ${JSON.stringify(out.warpGate)}`);
  console.log(`  pageerrors: ${errs.length}`);
  fs.writeFileSync(path.join(__dirname, 'r22-b-roadring.json'), JSON.stringify(out, null, 2));
  console.log('  → scripts/r22-b-roadring.json');
  await browser.close();
})();

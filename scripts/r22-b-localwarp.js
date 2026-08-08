/**
 * ROUND 22 (B SETTLE, W3) — the LOCAL-WARP hold, proven on a REAL deficit.
 *
 * verify-arrival (9b) drives its local warp by inspecting whatever live
 * aircraft `traffic.getNearest` happens to return, so the deficit it produces
 * is whatever the sky offered that minute: the W3 red run measured 3 levels,
 * the post-fix run measured -1 and the gate passed on its first disjunct
 * ("deficit <= 2") without ever exercising the hold. A pass that never ran the
 * feature is not evidence the feature works.
 *
 * This drives a DETERMINISTIC local warp instead — a fixed 60 km hop (inside
 * WARP.farKmThreshold, so `warpKind` is 'local') from a settled pose to ground
 * that has never streamed — and reports, per arm:
 *   · the tileZ deficit AT FLASH-END (the quantity the gate actually reads)
 *   · whether the veil appeared, and for how long (data-stage === 'hold')
 *   · whether it ended on content or on the 1500 ms cap
 *
 * The control arm (`__flyArrivalForce = 0`) must show the R21 behavior: a
 * 900 ms flash, no hold stage, whatever zoom happens to be resident.
 *
 * Usage: FLY_URL=http://localhost:3221 node scripts/r22-b-localwarp.js
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { bootFly, unpinPins } = require('./_boot');

const URL = process.env.FLY_URL || 'http://localhost:3221';

// Powell OH → ~60 km NW (Bellefontaine OH). Far enough that the destination
// pyramid has certainly not streamed, close enough to stay 'local'.
const FROM = { lat: 40.1578, lon: -83.0752 };
const TO = { lat: 40.3609, lon: -83.7594 };

const TRACE = () => {
  const S = (window.__r22lw = { t0: performance.now(), rows: [] });
  S.tick = setInterval(() => {
    const el = document.querySelector('[data-testid="warp-hold"]');
    const ts = window.__fly?.terraStats ?? null;
    S.rows.push({
      t: Math.round(performance.now() - S.t0),
      stage: el ? el.getAttribute('data-stage') : null,
      camTileZ: ts?.camTileZ ?? null,
      targetZ: ts?.targetZ ?? null,
    });
  }, 40);
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const rows = [];

  const leg = async (on) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on('pageerror', (e) => console.log('  pageerror:', e.message));
    // TERRA must be un-pinned as well as SETTLE. The fleet pin makes the
    // engine publish NO terraStats at all ("undefined = legacy" —
    // terrain-engine.js:318), and the tileZ deficit this leg is about lives
    // in exactly that publish, so a TERRA-pinned page can never reach the
    // local hold. `unpinPins` is the shared accessor idiom: a plain
    // assignment here would be overwritten by _boot's own init script, which
    // registers AFTER this one.
    await page.addInitScript(unpinPins, ['__flyTerraPin', '__flySettlePin']);
    await page.addInitScript(
      ([o, f]) => {
        window.__flySettleForce = 1;
        window.__flyArrivalForce = o ? 1 : 0;
        localStorage.setItem('fly-last-pos', JSON.stringify(f));
      },
      [on, FROM]
    );
    await bootFly(page, { style: 'satellite' });
    await page.waitForTimeout(6000); // let the DEPARTURE pose settle deep
    const before = await page.evaluate(() => ({
      ...(window.__fly?.terraStats ?? window.__fly?.engine?.terraStats ?? {}),
    }));
    await page.evaluate(TRACE);
    await page.evaluate(
      ([t]) => window.__fly.warpToGeo(t.lat, t.lon, { altM: 700, name: null }),
      [TO]
    );
    await page.waitForTimeout(5000);
    const out = await page.evaluate(() => {
      const S = window.__r22lw;
      clearInterval(S.tick);
      const held = S.rows.filter((r) => r.stage === 'hold');
      // The deficit AT FLASH-END is the first sample at or after 900 ms — the
      // exact moment the fixed code evaluates it.
      const atFlashEnd = S.rows.find((r) => r.t >= 900) ?? null;
      return {
        kind: window.__flyStore.getState().warpKind,
        holdSamples: held.length,
        holdMs: held.length ? held[held.length - 1].t - held[0].t + 40 : 0,
        deficitAtFlashEnd:
          atFlashEnd && atFlashEnd.targetZ != null && atFlashEnd.camTileZ != null
            ? atFlashEnd.targetZ - atFlashEnd.camTileZ
            : null,
        zAtFlashEnd: atFlashEnd?.camTileZ ?? null,
        zAtEnd: S.rows[S.rows.length - 1]?.camTileZ ?? null,
        stageAt250: (S.rows.find((r) => r.t >= 250) ?? {}).stage ?? null,
        warpGate: window.__flyStats?.warpGate ?? null,
        arrivalStats: window.__fly?.arrivalStats ?? null,
      };
    });
    await page.close();
    return { on, departZ: before.camTileZ ?? null, ...out };
  };

  for (const on of [false, true]) rows.push(await leg(on));
  for (const r of rows) {
    console.log(
      `LOCALWARP flags=${r.on ? 'ON ' : 'OFF'} kind=${r.kind} departZ=${r.departZ} ` +
        `deficit@flashEnd=${r.deficitAtFlashEnd} (camTileZ ${r.zAtFlashEnd}→${r.zAtEnd}) ` +
        `holdStageSamples=${r.holdSamples} holdMs=${r.holdMs} stage@250ms=${r.stageAt250} ` +
        `reason=${r.warpGate?.reason ?? r.arrivalStats?.reason ?? '-'} capped=${r.warpGate?.capped ?? '-'}`
    );
  }
  fs.writeFileSync(
    path.join(__dirname, 'r22-b-localwarp.json'),
    JSON.stringify(rows, null, 2)
  );
  console.log('  → scripts/r22-b-localwarp.json');
  await browser.close();
})();

/**
 * R25 (E CERT) — skip every menu and put the aircraft AIRBORNE at a pose.
 *
 * This is `bootFly`'s legacy airborne skip, lifted out so the harnesses that
 * do their own `page.goto` (graphics-flight.cjs, graphics-capture.cjs, and any
 * direct-goto gate) can use the SAME sequence instead of warping underneath a
 * mandatory hangar — which is what every one of them has done since the
 * hangar landed in 2c624a3 (they `warpToGeo` with `hangarOpen` still true, so
 * the flight is frozen in phase 'hangar' behind an opaque z-60 overlay).
 * scripts/_boot.js now calls this too, so there is ONE copy of the sequence.
 *
 * THE SEQUENCE (verbatim from _boot.js, R24/2c624a3):
 *   operations.phase = 'airborne', profile = null, operations.warp(flight),
 *   setHangarOpen(false)          -> screen 'flight' (W0 mirror), which also
 *                                    leaves an R25 title if one is showing,
 *   warpToGeo(lat, lon, {altM, headingRad})
 *
 * It does not pin anything and does not wait for a reveal unless asked
 * (`{ waitReveal: true }` waits for `__flyBoot.pct === 100`).
 */

/** bootFly's historical pose (the NYC airborne fixture). */
const DEFAULT_GEO = Object.freeze({ lat: 40.6892, lon: -74.0445, altM: 800, headingRad: 0 });

async function enterFlight(page, geo = DEFAULT_GEO, { timeoutMs = 180000, waitReveal = false } = {}) {
  const g = { ...DEFAULT_GEO, ...(geo || {}) };
  if (g.headingDeg != null && geo.headingRad == null) g.headingRad = (g.headingDeg * Math.PI) / 180;
  await page.waitForFunction(() => !!window.__fly?.operations && !!window.__flyStore, undefined, {
    timeout: timeoutMs,
  });
  await page.evaluate((g) => {
    const rt = window.__fly, store = window.__flyStore.getState();
    rt.operations.phase = 'airborne';
    rt.operations.profile = null;
    rt.operations.warp(rt.flight);
    store.setHangarOpen(false);
    const opts = { altM: g.altM, headingRad: g.headingRad };
    if ('name' in g) opts.name = g.name; // graphics harnesses pass name:null (no arrival banner)
    rt.warpToGeo(g.lat, g.lon, opts);
  }, g);
  if (waitReveal)
    await page.waitForFunction(() => window.__flyBoot?.pct === 100, undefined, { timeout: timeoutMs, polling: 250 });
}

module.exports = { enterFlight, DEFAULT_GEO };

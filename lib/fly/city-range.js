/**
 * SHIP PASS CITY (FLY_SHIP_PASS.md 5.3, CT-1 and CT-2) — the city's altitude
 * bands, in one place.
 *
 * The satellite city is two rings: the DETAILED ring (sat-building-engine.js,
 * a few kilometres of real footprints) and the SKYLINE mass beyond it
 * (sat-skyline-engine.js). The detailed ring dithers out across
 * SAT_BLDG_FADE's 2,400-3,000 m band and evicts at 3,200 m, so from about
 * 8,000 ft a hero city is the skyline mass (towers >= 35 m only) over imagery:
 * half of the "grey veil" the owner sees over Midtown (the other half is the
 * atmosphere, SKY's AERIAL_CLARITY). This module resolves the band every
 * consumer reads, from three sources, in order:
 *
 *  1. CT-1 DIAGNOSIS PINS (frozen contract, read whether or not CITY_RANGE is
 *     on): `window.__flyCityDiag = { fadeStartM?, fadeEndM?, skylinePremix?: 0|1 }`.
 *     Absent = today's behaviour exactly. When a consumer honours a pin it
 *     publishes `window.__flyCityDiagApplied = true`. SKY's veil harness (SK-1)
 *     drives these; CITY's own probe (scripts/ship-city-probe.cjs) too.
 *  2. CITY_RANGE (flag, `?flags=CITY_RANGE`): on desktop High / Ultra
 *     (deviceFeature('CITY_RANGE').budget.detailedM) the detailed ring lives to
 *     ~4,500 m with a lite LOD past 2,400 m; on every allowed device the
 *     skyline takes a denser core (cityRangeRequest()).
 *  3. The shipped constants (SAT_BLDG_FADE / SAT_BUILDINGS), never edited.
 *
 * No renderer imports: node gates import this directly. The worker never
 * imports it (the resolved numbers travel inside each build request).
 */
import { SAT_BLDG_FADE, SAT_BUILDINGS } from './fly-constants';
import { shipPassBlock, shipPassOn } from './ship-pass';
import { deviceFeature } from './device-policy';

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * CT-1: the diagnosis pins, validated, or null when absent / malformed. Read
 * live (one property lookup), so a harness may set or clear them mid-session.
 * A fade pin needs BOTH ends with fadeEndM > fadeStartM >= 0.
 */
export function cityDiag(win = globalThis.window) {
  const d = win?.__flyCityDiag;
  if (!d || typeof d !== 'object') return null;
  const out = {};
  if (finite(d.fadeStartM) && finite(d.fadeEndM) && d.fadeStartM >= 0 && d.fadeEndM > d.fadeStartM) {
    out.fadeStartM = d.fadeStartM;
    out.fadeEndM = d.fadeEndM;
  }
  if (d.skylinePremix === 0 || d.skylinePremix === 1) out.skylinePremix = d.skylinePremix;
  return Object.keys(out).length ? out : null;
}

/** CT-1: a consumer honoured a pin (the frozen acknowledgement global). */
export function noteCityDiagApplied(win = globalThis.window) {
  if (win && win.__flyCityDiagApplied !== true) win.__flyCityDiagApplied = true;
}

/** The resolved CITY_RANGE block (constants merged with its `?flags=` pin). */
export function cityRangeBlock() {
  return shipPassBlock('CITY_RANGE');
}

/**
 * The device class the city asks the policy about. `window.__flyCityDeviceClass`
 * is a HARNESS pin for the cloud venue (SwiftShader classes as 'software', which
 * the policy refuses): a probe passes 'dgpu' or 'phone' to see either arm on the
 * offline fixture. Production never sets it.
 */
function policyCtx(tier, win = globalThis.window) {
  const cls = win?.__flyCityDeviceClass;
  return typeof cls === 'string' ? { tier, cls } : { tier };
}

/**
 * CT-2: the CITY_RANGE resolution for a scene tier, or null when the flag is
 * off or the policy refuses this device. `detailed` is true only where the
 * policy grants the long detailed ring (desktop High / Ultra).
 */
export function cityRangeFor(tier = 'high', win = globalThis.window) {
  if (!shipPassOn('CITY_RANGE')) return null;
  const policy = deviceFeature('CITY_RANGE', policyCtx(tier, win));
  if (!policy.allowed) return null;
  return { detailed: policy.budget?.detailedM != null, block: cityRangeBlock() };
}

/**
 * THE BAND the detailed ring obeys this frame: { liteStartM, fadeStartM,
 * fadeEndM, evictM, armOnM, source }. `range` is cityRangeFor(tier) (the
 * engine caches it on tier changes). With no pin and no range this returns
 * exactly the shipped numbers (source 'shipped'); SAT_BLDG_FADE disabled keeps
 * its own legacy semantics (null fade band, hard evict at cullAglOffM) and
 * ignores both overrides.
 */
export function buildingBand(range = null, win = globalThis.window) {
  const F = SAT_BLDG_FADE;
  const S = SAT_BUILDINGS;
  if (!F.enabled) {
    return { liteStartM: Infinity, fadeStartM: null, fadeEndM: null, evictM: S.cullAglOffM, armOnM: S.cullAglOnM, source: 'legacy' };
  }
  const band = {
    liteStartM: Infinity,
    fadeStartM: F.fadeStartAglM,
    fadeEndM: F.fadeEndAglM,
    evictM: F.evictAglM,
    armOnM: S.cullAglOnM,
    source: 'shipped',
  };
  if (range?.detailed) {
    const R = range.block;
    band.liteStartM = R.liteStartM;
    band.fadeStartM = R.fadeStartM;
    band.fadeEndM = R.fadeEndM;
    band.evictM = R.evictM;
    band.armOnM = R.armOnM;
    band.source = 'range';
  }
  const pin = cityDiag(win);
  if (pin?.fadeEndM != null) {
    // The pin moves the dissolve; eviction keeps the shipped margin past it,
    // and the ring arms at least up to the pinned end so a pose reached by a
    // warp ABOVE the shipped arm height still streams the city it pins.
    const margin = F.evictAglM - F.fadeEndAglM;
    band.fadeStartM = pin.fadeStartM;
    band.fadeEndM = pin.fadeEndM;
    band.evictM = pin.fadeEndM + margin;
    band.armOnM = Math.max(S.cullAglOnM, Math.min(pin.fadeEndM, band.evictM - 1));
    band.source = 'diag';
  }
  return band;
}

/**
 * buildingBand(), memoised for the per-frame callers (the two engines): the
 * same object comes back until the range or a pin field changes, so a frame
 * allocates nothing. A harness that edits the pin object in place is seen
 * too (the fields are compared, not the object).
 */
export function makeBandMemo() {
  let range;
  let s = NaN;
  let e = NaN;
  let band = null;
  return (r = null, win = globalThis.window) => {
    const d = win?.__flyCityDiag;
    const ds = d && typeof d === 'object' ? d.fadeStartM : undefined;
    const de = d && typeof d === 'object' ? d.fadeEndM : undefined;
    if (band && r === range && Object.is(ds, s) && Object.is(de, e)) return band;
    range = r;
    s = ds;
    e = de;
    band = buildingBand(r, win);
    return band;
  };
}

/** 1 - smoothstep of eyeAgl across the band's dissolve (1 = solid). */
export function bandFade(band, eyeAglM) {
  if (band.fadeStartM == null) return 1;
  const t = Math.min(1, Math.max(0, (eyeAglM - band.fadeStartM) / Math.max(1, band.fadeEndM - band.fadeStartM)));
  return 1 - t * t * (3 - 2 * t);
}

/**
 * Extra skyline build-request options (`range` = cityRangeFor(tier), cached by
 * the engine), merged OVER the engine's own literal
 * request (so `{ visuals: this.visuals, ...trueAreasRequest() }` stays the
 * exact text verify-true-areas (7) reads). Off / refused / no pin: the SAME
 * object comes back, so the worker sees today's request byte for byte.
 *   cityRange: { denseMinH, denseTallCount }  CT-2 dense-core skyline
 *   premix: false                             CT-1 skylinePremix: 0
 */
export function cityRangeRequest(base, range = null, win = globalThis.window) {
  let extra = null;
  if (range) {
    const sk = range.block.skyline ?? {};
    if (finite(sk.denseMinH) && finite(sk.denseTallCount)) extra = { cityRange: { denseMinH: sk.denseMinH, denseTallCount: sk.denseTallCount } };
  }
  const pin = cityDiag(win);
  if (pin?.skylinePremix === 0) {
    extra = { ...(extra ?? {}), premix: false };
    noteCityDiagApplied(win);
  } else if (pin?.skylinePremix === 1) noteCityDiagApplied(win); // today's premix, honoured as-is
  return extra ? { ...(base ?? {}), ...extra } : base;
}

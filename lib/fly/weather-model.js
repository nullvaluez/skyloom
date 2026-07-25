/**
 * Round 16 "Living World" — the weather STATE MACHINE (pure).
 *
 * The sky was static: one cumulus deck, no visibility, no wind, no rain. This
 * module is the whole model between a normalized `/api/weather` payload and
 * the numbers the renderers consume (CloudField's deck, FlyScene's -50
 * atmosphere block, PrecipLayer). It is deliberately:
 *
 *   • ZERO-IMPORT — every config value arrives as an argument, so this file
 *     is loadable in plain node for a future harness (and can never drag
 *     three/next into a worker or a script).
 *   • ALLOCATION-FREE on the hot path — `computeTargets` writes into a caller
 *     -owned `out` object, `stepWeather` mutates `wx` in place, and
 *     `applyWeatherAtmo` mutates the caller's rim/void triples in place.
 *   • EXACTLY NEUTRAL AT BASELINE — this is the round's #1 correctness
 *     invariant. With no data (or `window.__flyWeatherOverride = 'baseline'`)
 *     every multiplier is the IEEE-exact identity: presence/size/opacity 1,
 *     overcast/fog/precip 0, fogMul 1, wind = [cfg.wind.baseMps, 0] (which is
 *     CLOUDS.driftMps, today's +X drift). `expApproach(x, x, k, dt)` returns
 *     x bit-for-bit, so a baseline session never leaves the certified values
 *     and the ~30 existing harnesses can't see this round at all.
 *
 * Vocabulary
 *   targets  = where the weather wants to be (recomputed at 1 Hz by
 *              use-fly-weather; cheap, no allocation)
 *   wx       = where it IS right now (damped toward targets once per frame by
 *              FlyScene's -50 block via `stepWeather`)
 *
 * Frames: world X = east, world Z = SOUTH (mercatorWorldXZ negates the
 * latitude term), which is what makes the meteorological wind mapping below
 * `[-sin θ, +cos θ]` rather than the more familiar `[-sin θ, -cos θ]`.
 */

/** Deck states, coarse → the CloudField coverage table keys. */
export const WEATHER_STATES = ['baseline', 'clear', 'few', 'scattered', 'broken', 'overcast'];

/** Representative cover for a state-name override (harness convenience). */
const STATE_COVER = { clear: 5, few: 25, scattered: 50, broken: 75, overcast: 100 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Local copy of coords.js expApproach — this file imports nothing. */
function approach(x, target, k, dt) {
  return x + (target - x) * (1 - Math.exp(-k * dt));
}

/**
 * Cloud cover % → deck state. `null`/junk is NOT "clear" — it is 'baseline',
 * the byte-identical no-weather look. Never invent weather from a miss.
 */
export function classifyCover(pct) {
  if (pct == null || !Number.isFinite(pct)) return 'baseline';
  if (pct < 12) return 'clear';
  if (pct < 35) return 'few';
  if (pct < 60) return 'scattered';
  if (pct < 88) return 'broken';
  return 'overcast';
}

/**
 * Per-puff presence for a stable rank in [0,1). Puffs below the coverage
 * fraction are full; a `feather`-wide band around the cut scales the rest
 * out so a coverage change dissolves instead of popping.
 *
 * BASELINE SHORT-CIRCUIT: presence ≥ 1 returns exactly 1 (no smoothstep), so
 * every puff keeps its certified scale to the last bit. (The ≥1−1e-3 slack
 * also covers `broken`/`overcast`, whose damped presence approaches 1
 * asymptotically and would otherwise dim the top-ranked puffs forever.)
 */
export function puffPresence(rank, presenceFrac, feather) {
  if (!(presenceFrac < 1 - 1e-3)) return 1;
  if (presenceFrac <= 0) return 0;
  const f = feather > 1e-6 ? feather : 1e-6;
  const x = clamp01((presenceFrac - rank) / f);
  return x * x * (3 - 2 * x); // smoothstep
}

/** A fresh, exactly-neutral wx. Never mutate the config through it. */
export function createWeatherState(cfg) {
  const vis = cfg?.vis ?? {};
  const oc = cfg?.overcast ?? {};
  return {
    state: 'baseline',
    // deck (CloudField)
    presenceFrac: 1,
    sizeMul: 1,
    opacityMul: 1,
    // ambience (FlyScene -50 block)
    overcastT: 0,
    fogT: 0,
    fogMul: 1,
    hazeAdd: 0,
    fogCap: vis.densityCap ?? 5.2e-5,
    rimGreyK: oc.rimGrey ?? 0,
    voidGreyK: oc.voidGrey ?? 0,
    rimLumaK: oc.rimLumaK ?? 1,
    voidLumaK: oc.voidLumaK ?? 1,
    // wind (world XZ, m/s) — baseline IS today's constant +X cloud drift
    windX: cfg?.wind?.baseMps ?? 5,
    windZ: 0,
    // precipitation (PrecipLayer)
    precip: 'none',
    precipT: 0,
    // provenance / read-only telemetry
    tempC: null,
    visM: null,
    coverPct: null,
    source: null,
    found: false,
  };
}

/** `window.__flyWeatherOverride`, or undefined outside a browser. */
function readOverride() {
  if (typeof window === 'undefined') return undefined;
  return window.__flyWeatherOverride;
}

/**
 * Resolve the payload the targets are computed from. Returns `null` for
 * "baseline" (no weather at all). Honors the override, which is how every
 * harness drives this system deterministically:
 *
 *   window.__flyWeatherOverride = 'baseline'                  // hard neutral
 *   window.__flyWeatherOverride = 'overcast'                  // state name
 *   window.__flyWeatherOverride = { cloudCoverPct: 100, visM: 1200,
 *                                   windDirDeg: 90, windMps: 12,
 *                                   precip: 'rain', tempC: 8 }
 */
function resolvePayload(data) {
  const ov = readOverride();
  if (ov === 'baseline' || ov === 'off' || ov === false) return null;
  if (typeof ov === 'string') {
    const pct = STATE_COVER[ov];
    return pct == null ? null : { found: true, cloudCoverPct: pct, source: 'override' };
  }
  if (ov && typeof ov === 'object') return { found: true, source: 'override', ...ov };
  if (!data || data.found === false) return null;
  return data;
}

/**
 * Payload → targets. `out` is reused across calls (no allocation); the
 * smoothing rates are baked in so `stepWeather` needs no config.
 *
 * The signature `(data, cfg)` is the frozen contract; the third `out`
 * argument is optional and returns the same object it was handed.
 */
export function computeTargets(data, cfg, out) {
  const t = out || {};
  const src = resolvePayload(data);
  const cov = cfg.coverage;
  const vis = cfg.vis;
  const oc = cfg.overcast;
  const sm = cfg.smooth;

  const state = src ? classifyCover(src.cloudCoverPct) : 'baseline';
  const row = cov[state] || cov.baseline;

  t.state = state;
  t.presenceFrac = row.presence;
  t.sizeMul = row.size;
  t.opacityMul = row.opacity;
  t.overcastT = row.overcast;

  // --- visibility → fog thickening + haze widening -------------------------
  // `visPlus` is the METAR "10+" convention (reported ceiling, not measured):
  // treat it as "at least the reference", never as haze.
  let fogT = 0;
  const visM = src ? src.visM : null;
  if (src && Number.isFinite(visM) && !src.visPlus) {
    fogT = clamp01((vis.refM - visM) / Math.max(1, vis.refM - vis.minM));
  }
  t.fogT = fogT;
  t.fogMul = 1 + (vis.maxMul - 1) * fogT;
  t.hazeAdd = vis.hazeAdd * fogT;

  // --- wind ---------------------------------------------------------------
  // Meteorological direction = where the wind comes FROM. Toward-vector in
  // (east, north) is [-sin θ, -cos θ]; world Z points SOUTH, so vz = +cos θ.
  if (src && Number.isFinite(src.windMps) && Number.isFinite(src.windDirDeg)) {
    const v = Math.min(cfg.wind.maxMps, Math.max(0, src.windMps));
    const th = (src.windDirDeg * Math.PI) / 180;
    t.windX = -Math.sin(th) * v;
    t.windZ = Math.cos(th) * v;
  } else {
    t.windX = cfg.wind.baseMps;
    t.windZ = 0;
  }

  // --- precipitation ------------------------------------------------------
  const p = cfg.precip;
  let kind = src && typeof src.precip === 'string' ? src.precip : 'none';
  if (kind !== 'none' && kind !== 'rain' && kind !== 'snow') kind = 'rain';
  if (kind !== 'none' && Number.isFinite(src.tempC) && src.tempC < p.snowTempC) kind = 'snow';
  t.precip = kind;
  if (kind === 'none') {
    t.precipT = 0;
  } else {
    const mm = Number.isFinite(src.precipMm) ? src.precipMm : 0;
    t.precipT = clamp01(p.minT + (1 - p.minT) * Math.min(1, mm / Math.max(1e-6, p.mmFull)));
  }

  // --- constants carried onto wx (so the consumers need no config) ---------
  t.fogCap = vis.densityCap;
  t.rimGreyK = oc.rimGrey;
  t.voidGreyK = oc.voidGrey;
  t.rimLumaK = oc.rimLumaK;
  t.voidLumaK = oc.voidLumaK;

  // --- provenance ---------------------------------------------------------
  t.tempC = src && Number.isFinite(src.tempC) ? src.tempC : null;
  t.visM = Number.isFinite(visM) ? visM : null;
  t.coverPct = src && Number.isFinite(src.cloudCoverPct) ? src.cloudCoverPct : null;
  t.source = src ? src.source || null : null;
  t.found = !!src;

  // damping rates (1/τ) — deck 8s, ambience 5s, wind 12s, precip 2s
  t.kDeck = 1 / sm.deckSec;
  t.kAmb = 1 / sm.ambienceSec;
  t.kWind = 1 / sm.windSec;
  t.kPrecip = 1 / sm.precipSec;
  return t;
}

/** Copy the non-damped scalars/labels (identical in step and snap). */
function carry(wx, t) {
  wx.state = t.state;
  wx.fogCap = t.fogCap;
  wx.rimGreyK = t.rimGreyK;
  wx.voidGreyK = t.voidGreyK;
  wx.rimLumaK = t.rimLumaK;
  wx.voidLumaK = t.voidLumaK;
  wx.tempC = t.tempC;
  wx.visM = t.visM;
  wx.coverPct = t.coverPct;
  wx.source = t.source;
  wx.found = t.found;
  // The KIND only changes once the old precipitation has faded out, so a
  // rain→snow flip never swaps the sprite mid-shower.
  if (t.precip !== 'none' || wx.precipT < 0.02) wx.precip = t.precip;
}

/**
 * One damped step toward `targets` (call once per frame with real dt).
 * At an equal target `approach` is exact — steady weather (and baseline
 * forever) keeps its values bit-for-bit.
 */
export function stepWeather(wx, targets, dt) {
  if (!wx || !targets) return wx;
  const d = dt > 0.25 ? 0.25 : dt > 0 ? dt : 0;
  wx.presenceFrac = approach(wx.presenceFrac, targets.presenceFrac, targets.kDeck, d);
  wx.sizeMul = approach(wx.sizeMul, targets.sizeMul, targets.kDeck, d);
  wx.opacityMul = approach(wx.opacityMul, targets.opacityMul, targets.kDeck, d);
  wx.overcastT = approach(wx.overcastT, targets.overcastT, targets.kAmb, d);
  wx.fogT = approach(wx.fogT, targets.fogT, targets.kAmb, d);
  wx.fogMul = approach(wx.fogMul, targets.fogMul, targets.kAmb, d);
  wx.hazeAdd = approach(wx.hazeAdd, targets.hazeAdd, targets.kAmb, d);
  wx.windX = approach(wx.windX, targets.windX, targets.kWind, d);
  wx.windZ = approach(wx.windZ, targets.windZ, targets.kWind, d);
  wx.precipT = approach(wx.precipT, targets.precipT, targets.kPrecip, d);
  carry(wx, targets);
  return wx;
}

/** Instant assignment — used under the warp flash, where damping would smear. */
export function snapWeather(wx, targets) {
  if (!wx || !targets) return wx;
  wx.presenceFrac = targets.presenceFrac;
  wx.sizeMul = targets.sizeMul;
  wx.opacityMul = targets.opacityMul;
  wx.overcastT = targets.overcastT;
  wx.fogT = targets.fogT;
  wx.fogMul = targets.fogMul;
  wx.hazeAdd = targets.hazeAdd;
  wx.windX = targets.windX;
  wx.windZ = targets.windZ;
  wx.precipT = targets.precipT;
  wx.precip = targets.precip;
  carry(wx, targets);
  return wx;
}

/**
 * Overcast grey-mix for the atmosphere triples — MUTATES `rim` and `vd`
 * (3-element arrays, sRGB 0..1) in place and returns the mix amount used.
 *
 * Frozen contract for FlyScene's -50 block: `applyWeatherAtmo(rim, vd, wx)`.
 * A 4th argument is accepted and ignored (the config it would carry is
 * already baked onto `wx` by computeTargets), so the plan's 4-arg call site
 * is valid too.
 *
 * At `overcastT === 0` the loop is skipped entirely — the rim triple is
 * untouched, so a clear/baseline sky is byte-identical to R15.
 */
export function applyWeatherAtmo(rim, vd, wx) {
  if (!wx || !rim) return 0;
  const gRim = wx.overcastT * wx.rimGreyK;
  const gVoid = wx.overcastT * wx.voidGreyK;
  if (gRim <= 0 && gVoid <= 0) return 0;
  if (gRim > 0) {
    const lum = 0.2126 * rim[0] + 0.7152 * rim[1] + 0.0722 * rim[2];
    const tgt = lum * wx.rimLumaK;
    rim[0] += (tgt - rim[0]) * gRim;
    rim[1] += (tgt - rim[1]) * gRim;
    rim[2] += (tgt - rim[2]) * gRim;
  }
  if (vd && gVoid > 0) {
    const lum = 0.2126 * vd[0] + 0.7152 * vd[1] + 0.0722 * vd[2];
    const tgt = lum * wx.voidLumaK;
    vd[0] += (tgt - vd[0]) * gVoid;
    vd[1] += (tgt - vd[1]) * gVoid;
    vd[2] += (tgt - vd[2]) * gVoid;
  }
  return gRim;
}

/**
 * Scene fog density under weather: the base density (already altitude-blended
 * by the caller) times the visibility multiplier, hard-capped so a 200 m-vis
 * report can never white out the whole world. At baseline fogMul is exactly 1
 * and the base is far below the cap → returns the base unchanged.
 */
export function weatherFogDensity(baseDensity, wx) {
  if (!wx) return baseDensity;
  const d = baseDensity * wx.fogMul;
  return d > wx.fogCap ? wx.fogCap : d;
}

/** Aerial-haze max under weather (haze widens as visibility drops). */
export function weatherHazeMax(baseMax, wx) {
  if (!wx) return baseMax;
  const m = baseMax + wx.hazeAdd;
  return m > 1 ? 1 : m;
}

/**
 * Deterministic PROCEDURAL weather — the designed-but-OFF fallback for when
 * both upstreams miss (`WEATHER.fallback: 'procedural'`; ships 'baseline').
 * Seeded on the 0.25° cell + the 3-hour UTC bucket, so neighbours agree and a
 * session doesn't shimmer. Shaped exactly like a route payload.
 *
 * Turning this on is a USER decision: it makes the game show weather that is
 * not real, which is the opposite of this round's premise.
 */
export function proceduralWeather(lat, lon, tMs, cfg) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cell = cfg?.cellDeg ?? 0.25;
  const cy = Math.round(lat / cell);
  const cx = Math.round(lon / cell);
  const bucket = Math.floor((tMs ?? Date.now()) / (3 * 3600 * 1000));
  const h = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const seed = cx * 0.731 + cy * 1.193 + bucket * 2.437;
  const cover = Math.round(Math.pow(h(seed), 0.8) * 100);
  const wet = h(seed + 17.3);
  const tempC = 24 - Math.abs(lat) * 0.45;
  return {
    found: true,
    source: 'procedural',
    cloudCoverPct: cover,
    windMps: 2 + h(seed + 41.1) * 9,
    windDirDeg: h(seed + 63.7) * 360,
    visM: cover > 88 && wet > 0.75 ? 3000 + h(seed + 5.5) * 9000 : null,
    precip: cover > 88 && wet > 0.82 ? (tempC < (cfg?.precip?.snowTempC ?? 1) ? 'snow' : 'rain') : 'none',
    precipMm: wet > 0.82 ? (wet - 0.82) * 12 : 0,
    tempC,
  };
}

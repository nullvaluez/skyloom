import { NextResponse } from 'next/server';

/**
 * Round 16 "Living World" — keyless CURRENT-WEATHER proxy.
 *
 * The sky in Fly mode was static: one cumulus deck, no visibility, no wind,
 * no rain, anywhere on Earth. This route answers "what is it actually doing
 * over the player right now" so the deck, the atmosphere and the precipitation
 * layer can be REAL.
 *
 * NO API KEYS (hard project rule). Two keyless sources, house failover pattern
 * (see app/api/aircraft/[hex]/info/route.js), both verified live 2026-07-24:
 *
 *   1. open-meteo — global, no key, everything we need in one `current` block.
 *      GET https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..
 *          &current=temperature_2m,cloud_cover,wind_speed_10m,
 *                   wind_direction_10m,precipitation,snowfall,visibility,
 *                   weather_code&wind_speed_unit=ms&timezone=UTC
 *      hit 200 { current: { cloud_cover: 90 (%), wind_speed_10m: 4.1 (m/s),
 *                 wind_direction_10m: 137 (° FROM), precipitation: 0 (mm),
 *                 snowfall: 0 (cm), visibility: 49100 (m), weather_code: 3,
 *                 temperature_2m: 25.1 } }
 *      Licensed CC-BY 4.0 → it is a `kind:'data'` entry in lib/fly/assets.js.
 *
 *   2. aviationweather.gov METAR — US-centric but AUTHORITATIVE where it has
 *      stations (it is what a real pilot reads), and a genuinely independent
 *      failure domain.
 *      GET https://aviationweather.gov/api/data/metar?format=json&bbox=…
 *      hit 200 [ { icaoId, cover:'FEW', clouds:[{cover,base}], visib:'10+',
 *                  wdir, wspd (kt), temp, rawOb, lat, lon, name } … ]
 *      ⚠ `visib` is polymorphic: a number, "10+", or "1 1/2" — and "10+" is a
 *        REPORTING CEILING, not a measurement, so it must not read as haze
 *        (that is what the `visPlus` flag is for).
 *      ⚠ the array can be EMPTY over open ocean / outside the US — an empty
 *        array is a legitimate miss, not a failure: do not cool the source.
 *
 * THE ROUTE NEVER FABRICATES WEATHER. A total miss is `{ found: false }` with
 * HTTP 200 and the client renders the byte-identical no-weather baseline. It
 * never throws (React Query would retry-storm) and never returns a non-200.
 *
 * Requests are snapped to a 0.25° cell (both the memo key AND the coordinates
 * sent upstream) so a whole flight inside ~25 km is one upstream call, and so
 * we are a good citizen of two free services.
 */

// = WEATHER.cellDeg. Hard-coded rather than imported: this is a server
// boundary and the client already snaps its query key to the same grid, so
// the second snap is idempotent — not worth pulling the constants module in.
const CELL_DEG = 0.25;

const ATTEMPT_TIMEOUT_MS = 4500;
const COOLDOWN_FAIL_MS = 30_000;

// Current conditions are published every 10-15 minutes upstream.
const MEMO_HIT_MS = 10 * 60 * 1000;
const MEMO_MISS_MS = 2 * 60 * 1000;
const MEMO_MAX = 500;

// Contact-bearing UA — the R15 planespotters lesson (a bare UA is how you
// discover a 403 six months later). Public repo URL, no personal details.
const USER_AGENT = 'SkyTracker/1.0 (+https://github.com/nullvaluez/skyloom)';

const SM_TO_M = 1609.344;
const KT_TO_MPS = 0.514444;

/** @type {Map<string, { data: object, ts: number, ttl: number }>} */
const memo = new Map();
const cooldownUntil = new Map();

const num = (v) => (Number.isFinite(v) ? v : null);
const snap = (v) => Math.round(v / CELL_DEG) * CELL_DEG;

// METAR sky-cover token → an equivalent cloud-cover percentage (the midpoint
// of each octa band, which is exactly how a human reads them).
const COVER_PCT = {
  CLR: 0, SKC: 0, CAVOK: 0, NSC: 0, NCD: 0,
  FEW: 20, SCT: 45, BKN: 75, OVC: 100, OVX: 100, VV: 100,
};

// METAR present-weather tokens. Checked against wxString (or the pre-RMK part
// of rawOb) — the remark section is full of false friends.
const SNOW_RE = /(^|\s)[-+]?(VC)?(SH|TS|FZ|BL|DR)?(SN|SG|IC|PL)\b/;
const RAIN_RE = /(^|\s)[-+]?(VC)?(SH|TS|FZ)?(RA|DZ|GR|GS|UP)\b/;

// METAR carries intensity, not a rate. These are the conventional readings of
// the -/none/+ prefixes as mm in a 15-minute window (open-meteo's unit), used
// ONLY to drive precipitation density — never reported as a measurement.
const INTENSITY_MM = { light: 0.4, moderate: 1.2, heavy: 3 };

function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** METAR `visib`: number (SM) | "10+" | "1 1/2" | "1/2SM" → { visM, visPlus }. */
function parseVisib(v) {
  if (v == null) return { visM: null, visPlus: false };
  if (typeof v === 'number') return { visM: Number.isFinite(v) ? v * SM_TO_M : null, visPlus: false };
  const raw = String(v).toUpperCase().replace(/SM/g, '').trim();
  if (!raw) return { visM: null, visPlus: false };
  const visPlus = raw.endsWith('+');
  const core = (visPlus ? raw.slice(0, -1) : raw).trim();
  let sm = 0;
  let any = false;
  for (const part of core.split(/\s+/)) {
    if (!part) continue;
    if (part.includes('/')) {
      const [n, d] = part.split('/').map(Number);
      if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) {
        sm += n / d;
        any = true;
      }
    } else {
      const n = Number(part);
      if (Number.isFinite(n)) {
        sm += n;
        any = true;
      }
    }
  }
  return { visM: any ? sm * SM_TO_M : null, visPlus };
}

/** Present-weather string → { precip, precipMm }. */
function parsePresentWeather(wxString, rawOb) {
  let s = wxString ? String(wxString) : '';
  if (!s && rawOb) s = String(rawOb).split(' RMK')[0];
  s = s.toUpperCase();
  if (!s) return { precip: 'none', precipMm: 0 };
  const snow = SNOW_RE.test(s);
  const rain = !snow && RAIN_RE.test(s);
  if (!snow && !rain) return { precip: 'none', precipMm: 0 };
  const token = (snow ? SNOW_RE : RAIN_RE).exec(s)?.[0] ?? '';
  const mm = token.includes('+')
    ? INTENSITY_MM.heavy
    : token.includes('-')
      ? INTENSITY_MM.light
      : INTENSITY_MM.moderate;
  return { precip: snow ? 'snow' : 'rain', precipMm: mm };
}

// WMO codes that mean frozen precipitation (open-meteo weather_code).
const WMO_SNOW = new Set([71, 73, 75, 77, 85, 86, 56, 57, 66, 67]);

const SOURCES = [
  {
    name: 'open-meteo',
    url: (lat, lon) =>
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      '&current=temperature_2m,cloud_cover,wind_speed_10m,wind_direction_10m,' +
      'precipitation,snowfall,visibility,weather_code&wind_speed_unit=ms&timezone=UTC',
    normalize: (data) => {
      const c = data?.current;
      if (!c || typeof c !== 'object' || !Number.isFinite(c.cloud_cover)) return null;
      const snowCm = Number.isFinite(c.snowfall) ? c.snowfall : 0;
      const rainMm = Number.isFinite(c.precipitation) ? c.precipitation : 0;
      const code = Number.isFinite(c.weather_code) ? c.weather_code : null;
      let precip = 'none';
      let precipMm = 0;
      if (snowCm > 0) {
        // `precipitation` already carries the liquid equivalent of the snow;
        // the snowfall depth is only the KIND tie-break (density comes from mm).
        precip = 'snow';
        precipMm = Math.max(rainMm, snowCm);
      } else if (rainMm > 0) {
        precip = code != null && WMO_SNOW.has(code) ? 'snow' : 'rain';
        precipMm = rainMm;
      }
      return {
        cloudCoverPct: c.cloud_cover,
        windMps: num(c.wind_speed_10m),
        windDirDeg: num(c.wind_direction_10m),
        visM: num(c.visibility),
        visPlus: false,
        precip,
        precipMm,
        tempC: num(c.temperature_2m),
        metarRaw: null,
        station: null,
      };
    },
  },
  {
    name: 'metar',
    url: (lat, lon) => {
      const minLat = Math.max(-90, lat - 0.8).toFixed(2);
      const maxLat = Math.min(90, lat + 0.8).toFixed(2);
      const minLon = (lon - 1.1).toFixed(2);
      const maxLon = (lon + 1.1).toFixed(2);
      return (
        'https://aviationweather.gov/api/data/metar?format=json' +
        `&bbox=${minLat},${minLon},${maxLat},${maxLon}`
      );
    },
    normalize: (data, lat, lon) => {
      if (!Array.isArray(data) || data.length === 0) return null;
      // Nearest station wins — a bbox over a metro area returns a dozen.
      let best = null;
      let bestKm = Infinity;
      for (const m of data) {
        if (!m || !Number.isFinite(m.lat) || !Number.isFinite(m.lon)) continue;
        const km = haversineKm(lat, lon, m.lat, m.lon);
        if (km < bestKm) {
          bestKm = km;
          best = m;
        }
      }
      if (!best) return null;

      // Max layer wins (a BKN deck under a FEW layer is a BKN sky).
      let cover = null;
      const layers = Array.isArray(best.clouds) ? best.clouds : [];
      for (const l of layers) {
        const pct = COVER_PCT[String(l?.cover ?? '').toUpperCase()];
        if (pct != null && (cover == null || pct > cover)) cover = pct;
      }
      if (cover == null) {
        const pct = COVER_PCT[String(best.cover ?? '').toUpperCase()];
        if (pct != null) cover = pct;
      }
      if (cover == null) return null; // no sky condition = not a usable report

      const { visM, visPlus } = parseVisib(best.visib);
      const { precip, precipMm } = parsePresentWeather(best.wxString, best.rawOb);
      return {
        cloudCoverPct: cover,
        windMps: Number.isFinite(best.wspd) ? best.wspd * KT_TO_MPS : null,
        // 'VRB' (variable) is a string — no usable direction.
        windDirDeg: Number.isFinite(best.wdir) ? best.wdir : null,
        visM,
        visPlus,
        precip,
        precipMm,
        tempC: num(best.temp),
        metarRaw: best.rawOb ? String(best.rawOb) : null,
        station: best.icaoId ? String(best.icaoId) : null,
      };
    },
  },
];

/**
 * FIXED order, deliberately not sticky-preference: open-meteo has global
 * coverage, so a METAR-shaped gap (mid-ocean, outside the US) must not demote
 * it. The cooldown map covers the only case that matters — a source actually
 * being down.
 */
function orderedSources() {
  return SOURCES;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = ATTEMPT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function memoGet(key) {
  const hit = memo.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > hit.ttl) {
    memo.delete(key);
    return null;
  }
  return hit.data;
}

function memoSet(key, data) {
  memo.set(key, { data, ts: Date.now(), ttl: data.found ? MEMO_HIT_MS : MEMO_MISS_MS });
  if (memo.size > MEMO_MAX) {
    const oldest = [...memo.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < oldest.length - Math.floor(MEMO_MAX * 0.75); i++) {
      memo.delete(oldest[i][0]);
    }
  }
}

function respond(data, cached) {
  const maxAge = data.found ? 600 : 120;
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=1800`,
      'x-weather-source': data.source || 'none',
      'x-weather-cache': cached ? 'HIT' : 'MISS',
    },
  });
}

/** GET /api/weather?lat=..&lon.. — normalized current conditions (never throws). */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const rawLat = searchParams.get('lat');
  const rawLon = searchParams.get('lon');
  // `Number(null)` is 0 — a MISSING parameter must not become Null Island and
  // come back as real weather (the R13 null-island boot-sun bug, same shape).
  const lat = rawLat == null || rawLat.trim() === '' ? NaN : Number(rawLat);
  const lon = rawLon == null || rawLon.trim() === '' ? NaN : Number(rawLon);

  // Junk coordinates never reach an upstream — same graceful shape.
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return NextResponse.json(
      { found: false, cell: null },
      { headers: { 'Cache-Control': 'public, s-maxage=600' } }
    );
  }

  const cLat = snap(lat);
  const cLon = snap(lon);
  const key = `${cLat.toFixed(2)},${cLon.toFixed(2)}`;
  const cached = memoGet(key);
  if (cached) return respond(cached, true);

  const now = Date.now();
  let attempted = 0;

  for (const source of orderedSources()) {
    if ((cooldownUntil.get(source.name) ?? 0) > now) continue;
    attempted += 1;
    try {
      const response = await fetchWithTimeout(source.url(cLat, cLon), {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        next: { revalidate: 600 },
      });

      if (!response.ok) {
        cooldownUntil.set(source.name, Date.now() + COOLDOWN_FAIL_MS);
        console.warn(`weather ${source.name} ${response.status} — failing over`);
        continue;
      }

      const raw = await response.json().catch(() => null);
      const rec = source.normalize(raw, cLat, cLon);
      if (!rec) continue; // legitimate no-data (empty bbox) — next source, no cooldown

      const data = {
        found: true,
        source: source.name,
        cell: { lat: cLat, lon: cLon },
        ...rec,
      };
      memoSet(key, data);
      return respond(data, false);
    } catch (error) {
      cooldownUntil.set(source.name, Date.now() + COOLDOWN_FAIL_MS);
      console.warn(`weather ${source.name} ${error?.name ?? 'error'} — failing over`);
    }
  }

  // A real miss (open ocean, both sources thin) is worth a short negative
  // memo; "everyone was cooling" is not — retry as soon as they are back.
  const miss = { found: false, cell: { lat: cLat, lon: cLon } };
  if (attempted > 0) memoSet(key, miss);
  return respond(miss, false);
}

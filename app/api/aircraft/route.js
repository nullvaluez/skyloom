import { NextResponse } from 'next/server';

// Per-attempt upstream timeout. Keep short so a hung preferred source
// fails over inside the client's ~12s abort budget.
const ATTEMPT_TIMEOUT_MS = 3500;

// Rate-limit cooldowns per source (module state — per server instance).
const COOLDOWN_RATE_MS = 45_000;
const COOLDOWN_FAIL_MS = 15_000;

// Serve last-good payload when every upstream is cooling / down.
const STALE_MAX_MS = 90_000;

const cooldownUntil = new Map();
/** @type {string | null} */
let preferredSource = null;
/** @type {Map<string, { payload: object, ts: number, source: string }>} */
const lastGood = new Map();

/**
 * Keyless community readsb aggregators. Preference is sticky to the last
 * healthy source — adsb.lol often 420/429s or hangs >5s, so pinning a
 * working failover (adsb.fi / airplanes.live) avoids burning every poll
 * on a dead primary.
 */
const SOURCES = [
  {
    name: 'adsb.lol',
    url: (lat, lon, dist) => `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
  },
  {
    name: 'adsb.fi',
    url: (lat, lon, dist) =>
      `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${dist}`,
  },
  {
    name: 'airplanes.live',
    url: (lat, lon, dist) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${dist}`,
  },
];

function isRateLimited(status) {
  // 420 = "Enhance Your Calm" (adsb.lol); 429 = standard rate limit
  return status === 429 || status === 420;
}

function orderedSources() {
  if (!preferredSource) return SOURCES;
  const pref = SOURCES.find((s) => s.name === preferredSource);
  if (!pref) return SOURCES;
  return [pref, ...SOURCES.filter((s) => s.name !== preferredSource)];
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

function cacheKey(lat, lon, dist) {
  return `${lat}|${lon}|${dist}`;
}

/** Nearest last-good within ~0.1° when the exact cell has no cache. */
function findStale(lat, lon, dist) {
  const exact = lastGood.get(cacheKey(lat, lon, dist));
  const now = Date.now();
  if (exact && now - exact.ts < STALE_MAX_MS) return exact;

  const qLat = Number(lat);
  const qLon = Number(lon);
  let best = null;
  let bestD = Infinity;
  for (const [key, entry] of lastGood) {
    if (now - entry.ts >= STALE_MAX_MS) continue;
    const [eLat, eLon, eDist] = key.split('|');
    if (eDist !== String(dist)) continue;
    const d = Math.hypot(Number(eLat) - qLat, Number(eLon) - qLon);
    if (d < bestD && d <= 0.1) {
      bestD = d;
      best = entry;
    }
  }
  return best;
}

function softUnavailable(lastStatus, stale) {
  if (stale) {
    return NextResponse.json(
      { ...stale.payload, stale: true, error: 'serving_stale' },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=30',
          'x-adsb-source': stale.source,
          'x-adsb-stale': '1',
        },
      }
    );
  }

  // Always 200 + empty so clients soft-fail (dead reckoning) instead of
  // React Query retry-storming 503/429 during a cooldown window.
  return NextResponse.json(
    {
      error: isRateLimited(lastStatus) ? 'rate_limited' : 'all upstream sources unavailable',
      ac: [],
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'x-adsb-unavailable': String(lastStatus || 503),
      },
    }
  );
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lon = searchParams.get('lon');
  const dist = searchParams.get('dist') || '250';

  if (!lat || !lon) {
    return NextResponse.json(
      { error: 'Missing required parameters: lat and lon' },
      { status: 400 }
    );
  }

  // Round to ~5km (0.05°) so fly-mode motion reuses Next's fetch cache and
  // our last-good map. At 100–250nm radius this offset is noise; 0.01° was
  // still minting a fresh upstream URL every couple seconds in flight.
  const qLat = (Math.round(Number(lat) * 20) / 20).toFixed(2);
  const qLon = (Math.round(Number(lon) * 20) / 20).toFixed(2);
  const key = cacheKey(qLat, qLon, dist);

  const now = Date.now();
  let lastStatus = 0;
  let attempted = 0;

  for (const source of orderedSources()) {
    if ((cooldownUntil.get(source.name) ?? 0) > now) continue;
    attempted += 1;
    const upstreamUrl = source.url(qLat, qLon, dist);
    try {
      const response = await fetchWithTimeout(upstreamUrl, {
        next: { revalidate: 3 },
      });

      if (!response.ok) {
        lastStatus = response.status;
        cooldownUntil.set(
          source.name,
          Date.now() + (isRateLimited(response.status) ? COOLDOWN_RATE_MS : COOLDOWN_FAIL_MS)
        );
        console.warn(`ADS-B source ${source.name} ${response.status} — failing over`);
        continue;
      }

      const data = await response.json();
      // Normalize shapes: adsb.fi serves the list as `aircraft` (and `now`
      // in epoch seconds — the client worker normalizes s/ms defensively).
      const ac = Array.isArray(data.ac)
        ? data.ac
        : Array.isArray(data.aircraft)
          ? data.aircraft
          : null;
      if (!ac) {
        cooldownUntil.set(source.name, Date.now() + COOLDOWN_FAIL_MS);
        console.warn(`ADS-B source ${source.name} returned no aircraft array — failing over`);
        continue;
      }

      const payload = { ...data, ac, aircraft: undefined };
      preferredSource = source.name;
      lastGood.set(key, { payload, ts: Date.now(), source: source.name });

      // Bound the stale map (fly crosses many cells).
      if (lastGood.size > 80) {
        const oldest = [...lastGood.entries()].sort((a, b) => a[1].ts - b[1].ts);
        for (let i = 0; i < oldest.length - 60; i++) lastGood.delete(oldest[i][0]);
      }

      return NextResponse.json(payload, {
        headers: {
          'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
          'x-adsb-source': source.name,
        },
      });
    } catch (error) {
      lastStatus = error.name === 'AbortError' ? 504 : 502;
      cooldownUntil.set(source.name, Date.now() + COOLDOWN_FAIL_MS);
      console.warn(`ADS-B source ${source.name} ${error.name ?? 'error'} — failing over`);
    }
  }

  // Nothing attempted ⇒ every source still cooling. Prefer stale over 503.
  if (attempted === 0) {
    console.warn('ADS-B all sources cooling — serving stale/empty');
  }

  return softUnavailable(lastStatus, findStale(qLat, qLon, dist));
}

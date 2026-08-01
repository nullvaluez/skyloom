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
  // First source that answered 200 with a valid but EMPTY aircraft list. Held
  // rather than returned so the rest of the rotation gets a chance to disagree
  // — see the ac.length === 0 branch below.
  /** @type {{ payload: object, source: string } | null} */
  let emptyCandidate = null;

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

      // A WELL-FORMED EMPTY ANSWER IS NOT A HEALTHY ANSWER. A degraded
      // aggregator whose spatial index has fallen over still answers 200 with
      // `{"ac":[],"msg":"No error","total":0}` — syntactically perfect, and
      // indistinguishable from real airspace by every check above. Observed
      // live: adsb.lol served 0 rows for Manhattan/LAX/Tokyo/Sydney at dist
      // 250 while adsb.fi and airplanes.live served ~1050 for the same point
      // (its non-geographic /v2/mil was still fine — the index, not the host).
      //
      // Accepting that as success is a TOTAL live-traffic kill, not a
      // degradation: the client engine's stale ladder only ever ages tracks
      // out, so a run of empty batches deletes every aircraft in the sky
      // (measured 281 -> 253 -> 0). And because `preferredSource` is sticky,
      // one empty answer pinned the broken source to the FRONT of the
      // rotation, so the two healthy aggregators were never even asked.
      //
      // So an empty result is held as a CANDIDATE and the rotation continues.
      // Only if every source agrees the cell is empty do we return it — over
      // genuinely quiet airspace (mid-ocean, small hours) that is the honest
      // answer, and it costs one extra upstream call per poll cell there.
      // Deliberately NOT a cooldown: an empty cell is not misbehaviour, and
      // cooling every source over quiet airspace would strand the rotation.
      if (ac.length === 0) {
        if (!emptyCandidate) emptyCandidate = { payload, source: source.name };
        console.warn(`ADS-B source ${source.name} returned 0 aircraft — trying next source`);
        continue;
      }

      preferredSource = source.name;
      // Only NON-EMPTY payloads become last-good. Caching an empty one would
      // poison the stale path, which exists to hold the last real frame
      // through an outage.
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

  // Every reachable source agreed the cell is empty. That is a real answer —
  // return it, but do NOT pin `preferredSource` to whoever said it first: if
  // one aggregator is empty because it is broken rather than because the sky
  // is, pinning it would put it back at the head of the rotation and make the
  // outage self-sustaining. Leaving the preference alone lets the last
  // genuinely healthy source keep the lead.
  if (emptyCandidate) {
    return NextResponse.json(emptyCandidate.payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=10',
        'x-adsb-source': emptyCandidate.source,
        'x-adsb-empty': 'all-sources',
      },
    });
  }

  // Nothing attempted ⇒ every source still cooling. Prefer stale over 503.
  if (attempted === 0) {
    console.warn('ADS-B all sources cooling — serving stale/empty');
  }

  return softUnavailable(lastStatus, findStale(qLat, qLon, dist));
}

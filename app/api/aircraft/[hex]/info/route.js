import { NextResponse } from 'next/server';

/**
 * Round 15 "Ground Truth" — keyless aircraft REGISTRY proxy.
 *
 * ADS-B tells you where a plane is; it does not tell you what it IS. This
 * route answers "the actual real plane": manufacturer, the real model name,
 * the registered owner/operator and the registry country — the identity the
 * inspect card was inventing from an ICAO type code alone.
 *
 * NO API KEYS (hard project rule). Two keyless community registries with the
 * house multi-source failover pattern (see app/api/aircraft/route.js):
 *
 *   1. adsbdb.com  — best coverage BY FAR (hits on GA/experimental tails that
 *      hexdb 404s), and the only one carrying registry country.
 *      GET https://api.adsbdb.com/v0/aircraft/{hex}
 *      hit  200 { response: { aircraft: { type, icao_type, manufacturer,
 *                 mode_s, registration, registered_owner,
 *                 registered_owner_country_name,
 *                 registered_owner_country_iso_name,
 *                 registered_owner_operator_flag_code, url_photo… } } }
 *      miss 404 { response: "unknown aircraft" }   ← a STRING, not an object
 *
 *   2. hexdb.io — thinner (airline fleets mostly), no country field.
 *      GET https://hexdb.io/api/v1/aircraft/{hex}
 *      hit  200 { ModeS, Registration, Manufacturer, ICAOTypeCode, Type,
 *                 RegisteredOwners, OperatorFlagCode }
 *      miss 404 { status: "404", error: "Aircraft not found." }
 *      ⚠ the miss body is JSON-shaped, so `response.ok` alone is NOT enough —
 *      every normalizer must prove a real record (ModeS/Registration) before
 *      claiming a hit.
 *
 * Registry data is near-static, so: a long CDN cache, a long in-process memo
 * (the /api/:path* s-maxage=3 header in next.config would otherwise cap the
 * edge TTL — the memo makes the real-world hit rate independent of it), and a
 * shorter negative TTL so a freshly-registered tail appears within hours.
 *
 * NEVER throws to the client: total miss / all-upstreams-down both degrade to
 * 200 `{ found: false }` so React Query can't retry-storm, and the card just
 * renders its honest "no registry record" state (military/blocked/PIA hexes
 * legitimately have none).
 */

const ATTEMPT_TIMEOUT_MS = 4500;
const COOLDOWN_FAIL_MS = 30_000;

// Registry records change on the order of months.
const MEMO_HIT_MS = 24 * 60 * 60 * 1000;
const MEMO_MISS_MS = 6 * 60 * 60 * 1000;
const MEMO_MAX = 600;

const HEX_RE = /^[0-9a-f]{6}$/i;

/** @type {Map<string, { data: object, ts: number, ttl: number }>} */
const memo = new Map();
const cooldownUntil = new Map();

function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s && s.toLowerCase() !== 'null' ? s : null;
}

const SOURCES = [
  {
    name: 'adsbdb',
    url: (hex) => `https://api.adsbdb.com/v0/aircraft/${hex}`,
    normalize: (data) => {
      // miss shape is `{ response: "unknown aircraft" }` — a string
      const a = data?.response?.aircraft;
      if (!a || typeof a !== 'object') return null;
      if (!clean(a.mode_s) && !clean(a.registration)) return null;
      return {
        registration: clean(a.registration),
        manufacturer: clean(a.manufacturer),
        model: clean(a.type),
        typeCode: clean(a.icao_type),
        owner: clean(a.registered_owner),
        operatorFlagCode: clean(a.registered_owner_operator_flag_code),
        country: clean(a.registered_owner_country_name),
        countryIso: clean(a.registered_owner_country_iso_name),
      };
    },
  },
  {
    name: 'hexdb',
    url: (hex) => `https://hexdb.io/api/v1/aircraft/${hex}`,
    normalize: (data) => {
      // miss shape is `{ status: "404", error: "…" }` — JSON, so prove a record
      if (!data || typeof data !== 'object') return null;
      if (!clean(data.ModeS) && !clean(data.Registration)) return null;
      return {
        registration: clean(data.Registration),
        manufacturer: clean(data.Manufacturer),
        model: clean(data.Type),
        typeCode: clean(data.ICAOTypeCode),
        owner: clean(data.RegisteredOwners),
        operatorFlagCode: clean(data.OperatorFlagCode),
        country: null, // hexdb carries no registry country
        countryIso: null,
      };
    },
  },
];

/**
 * Fixed order, deliberately NOT the sticky-preference variant used by the
 * live-traffic proxy. adsbdb is a practical superset of hexdb (hexdb 404s
 * most GA tails) so demoting it after one legitimate 404 would cost every
 * later GA lookup an extra round trip. The cooldown map covers the only
 * case that matters here: adsbdb actually being down.
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
  const maxAge = data.found ? 86_400 : 21_600;
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': `public, s-maxage=${maxAge}, stale-while-revalidate=604800`,
      'x-registry-source': data.source || 'none',
      'x-registry-cache': cached ? 'HIT' : 'MISS',
    },
  });
}

/** GET /api/aircraft/[hex]/info — normalized registry record (never throws). */
export async function GET(request, { params }) {
  const { hex } = await params;

  // Junk / missing hex never reaches an upstream — same graceful shape.
  if (!hex || !HEX_RE.test(hex)) {
    return NextResponse.json(
      { found: false, hex: hex ? String(hex).slice(0, 12).toUpperCase() : null },
      { headers: { 'Cache-Control': 'public, s-maxage=86400' } }
    );
  }

  const key = hex.toUpperCase();
  const cached = memoGet(key);
  if (cached) return respond(cached, true);

  const now = Date.now();
  let attempted = 0;

  for (const source of orderedSources()) {
    if ((cooldownUntil.get(source.name) ?? 0) > now) continue;
    attempted += 1;
    try {
      const response = await fetchWithTimeout(source.url(key), {
        headers: { Accept: 'application/json' },
        next: { revalidate: 86_400 },
      });

      // 404 is a legitimate "no record here" — try the next registry, but
      // do NOT cool the source down (it answered correctly and fast).
      if (response.status === 404) continue;

      if (!response.ok) {
        cooldownUntil.set(source.name, Date.now() + COOLDOWN_FAIL_MS);
        console.warn(`registry ${source.name} ${response.status} — failing over`);
        continue;
      }

      const raw = await response.json().catch(() => null);
      const rec = source.normalize(raw);
      if (!rec) continue; // JSON-shaped miss (hexdb) — next source

      const data = { found: true, hex: key, ...rec, source: source.name };
      memoSet(key, data);
      return respond(data, false);
    } catch (error) {
      cooldownUntil.set(source.name, Date.now() + COOLDOWN_FAIL_MS);
      console.warn(`registry ${source.name} ${error?.name ?? 'error'} — failing over`);
    }
  }

  // Genuine miss (blocked/military/PIA tails) vs "everyone was cooling":
  // only the former is worth memoizing as a negative.
  const miss = { found: false, hex: key };
  if (attempted > 0) memoSet(key, miss);
  return respond(miss, false);
}

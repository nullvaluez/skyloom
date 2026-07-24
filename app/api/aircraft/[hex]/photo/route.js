import { NextResponse } from 'next/server';
import { PLANESPOTTERS_URL } from '@/lib/constants';

/**
 * Planespotters photo proxy (keyless).
 *
 * ⚠ ROUND 15 FIX — THE HERO PHOTO WAS DEAD. planespotters now enforces a
 * contact-bearing User-Agent and answers anything else with **403**:
 *
 *   $ curl -A 'ShadowADSB/1.0' .../pub/photos/hex/A0F1BB
 *   403 {"error":"Server User-Agent strings must include a contact URL or
 *        email so we can reach you, e.g. MyFlightTracker/1.2
 *        (+https://example.com/contact)…"}
 *
 * 403 is not 404, so the old handler threw, the catch swallowed it, and every
 * single lookup returned `{ photos: [] }` — the inspect card silently fell
 * back to the 3D turntable forever. With the compliant UA below the same hex
 * returns a real photo + photographer. Verified live 2026-07-24 on A0F1BB
 * (A321/AAL), 869560 (B77W/ANA), A6F5D7 (CRJ9/SkyWest), A42E51 (BE36 — GA
 * tails have photos too).
 *
 * Keep the UA contactable. planespotters' terms also require the photographer
 * credit + a link back to the photo page; the card renders both
 * (`inspect-photo-credit`) and that is NOT optional.
 */

// Contact-bearing UA (planespotters requirement). Public repo URL — no
// personal contact details leave the server.
const USER_AGENT = 'SkyTracker/1.0 (+https://github.com/nullvaluez/skyloom)';

const ATTEMPT_TIMEOUT_MS = 6000;
const HEX_RE = /^[0-9a-f]{6}$/i;

// A miss caches shorter than a hit: photos get uploaded, and a tail that had
// none this morning may have one tomorrow. (A hit is effectively immutable.)
const HIT_CACHE = 'public, s-maxage=86400, stale-while-revalidate=604800';
const MISS_CACHE = 'public, s-maxage=10800, stale-while-revalidate=86400';

const empty = (reason) =>
  NextResponse.json(
    { photos: [], reason },
    { headers: { 'Cache-Control': MISS_CACHE, 'x-photo-miss': reason } }
  );

export async function GET(request, { params }) {
  const { hex } = await params;

  if (!hex) {
    return NextResponse.json(
      { error: 'Missing required parameter: hex' },
      { status: 400 }
    );
  }
  // Junk identifiers never reach the upstream (keeps our UA in good standing).
  if (!HEX_RE.test(hex)) return empty('bad-hex');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);

  try {
    const response = await fetch(`${PLANESPOTTERS_URL}/${hex.toUpperCase()}`, {
      signal: controller.signal,
      next: { revalidate: 86400 },
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      // 404 = no photos for this tail. Anything else (403 UA rejection, 429,
      // 5xx) is OUR problem — shout about it in the log instead of quietly
      // pretending the fleet is unphotographed, but still degrade to empty so
      // the card falls back to the turntable rather than erroring.
      if (response.status !== 404) {
        console.warn(
          `planespotters ${response.status} for ${hex} — photo hero degraded ` +
            `(check the User-Agent contact requirement)`
        );
        return empty(`upstream-${response.status}`);
      }
      return empty('no-photos');
    }

    const data = await response.json();
    const photos = Array.isArray(data?.photos) ? data.photos : [];
    if (!photos.length) return empty('no-photos');

    return NextResponse.json(
      { photos },
      { headers: { 'Cache-Control': HIT_CACHE } }
    );
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'timeout' : 'network';
    console.warn(`planespotters ${reason} for ${hex} — photo hero degraded`);
    return empty(reason);
  } finally {
    clearTimeout(timeoutId);
  }
}

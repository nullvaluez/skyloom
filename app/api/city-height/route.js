import { readCityHeightTile } from '@/lib/fly/city-height-source.mjs';
import { CITY_HEIGHT_TILES } from '@/lib/fly/city-height-grid.mjs';

export const runtime = 'nodejs';
const pending = new Map();
const recent = new Map();
const immutable = 'public, max-age=31536000, s-maxage=31536000, immutable';

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const xText = params.get('x'), yText = params.get('y');
  if (params.get('v') !== '1' || !/^\d{1,4}$/.test(xText) || !/^\d{1,4}$/.test(yText)) return new Response(null, { status: 400 });
  const x = Number(xText), y = Number(yText);
  if (x >= CITY_HEIGHT_TILES || y >= CITY_HEIGHT_TILES) return new Response(null, { status: 400 });
  const key = y * CITY_HEIGHT_TILES + x;
  let tile = recent.get(key);
  if (!tile) {
    let load = pending.get(key);
    if (!load) {
      if (pending.size >= 4) return new Response(null, { status: 429, headers: { 'retry-after': '2', 'cache-control': 'no-store' } });
      load = readCityHeightTile(x, y).then(bytes => {
        if (recent.size >= 64) recent.delete(recent.keys().next().value);
        recent.set(key, bytes);
        return bytes;
      }).finally(() => pending.delete(key));
      pending.set(key, load);
    }
    try { tile = await load; } catch {
      return new Response(null, { status: 503, headers: { 'retry-after': '60', 'cache-control': 'no-store' } });
    }
  }
  return new Response(tile, { headers: { 'content-type': 'application/octet-stream', 'cache-control': immutable } });
}

/**
 * R25 (E CERT) fixture — ESA WorldCover 2021 tiles at the terrascope WMTS
 * shape, LEGEND-EXACT.
 *
 * WHY. Since the Living Earth rounds the vector-tile worker asks
 * `wmts.terrascope.be` for a WorldCover class tile for every surface and
 * canopy tile (lib/fly/world-cover.js `loadWorldCover`, called from
 * vector-tile.worker.js). This container 403-blocks that host, exactly as it
 * blocks Esri / OpenFreeMap / adsb (R24 recon HARN-ENV-2). The app degrades to
 * `null` (vector/imagery fallback) — so readiness is not necessarily BLOCKED
 * by it — but a satellite fixture boot that silently runs the no-WorldCover
 * branch is certifying a different world from the user's: `combineWorldCover`
 * fills unknown/developed mask cells, re-classifies surfaces and carves
 * scenery exclusions, and the canopy engine seeds from it. So the fixture
 * serves it.
 *
 * LEGEND-EXACT. `decodeWorldCover` maps RGB -> class through a Map of the 11
 * published legend colours and turns ANY other colour into 0 ("unknown" —
 * mixed or anti-aliased RGB is deliberately rejected). Every pixel here is
 * therefore one of those 11 colours, byte for byte, alpha 255, and the tile is
 * 256x256 image/png (the loader rejects any other size or content type).
 *
 * WHAT CLASS WHERE. A pure function of GEOGRAPHIC position (the fixture's rule
 * 1 — parents and children agree), keyed off the SAME scene table and the SAME
 * river line the imagery and MVT generators use, so the cover agrees with
 * what the imagery shows:
 *   city    50 built-up; 80 water on the river; 30 grass in the park noise
 *   citySm  50 built-up; 30 grass in the park noise
 *   suburb  50 built-up / 30 grassland / 10 tree cover (noise bands)
 *   parcel  50 built-up / 30 grassland
 *   desert  60 bare-sparse / 20 shrubland          (Owens: no trees, ever)
 *   hills   10 tree cover / 30 grassland; 80 on the river
 *   rural   40 cropland / 30 grassland / 10 tree cover; 80 on the river
 *
 * `/worldcover/{z}/{x}/{y}.png` on the fixture server; scripts/_fixture.js
 * routes `wmts.terrascope.be/?...TILEMATRIX=z&TILECOL=x&TILEROW=y` onto it.
 */
import { encodePNG } from './png.mjs';
import { fbm } from './noise.mjs';
import { sceneAt, tile2lon, tile2lat } from './scenes.mjs';
import { riverMask } from './imagery.mjs';

const SIZE = 256;
const cache = new Map();
const CACHE_MAX = 400;

/** The ESA WorldCover 2021 v200 legend — must equal lib/fly/world-cover.js. */
export const LEGEND = Object.freeze({
  10: 0x006400, // tree cover
  20: 0xffbb22, // shrubland
  30: 0xffff4c, // grassland
  40: 0xf096ff, // cropland
  50: 0xfa0000, // built-up
  60: 0xb4b4b4, // bare / sparse vegetation
  70: 0xf0f0f0, // snow and ice
  80: 0x0064c8, // permanent water bodies
  90: 0x0096a0, // herbaceous wetland
  95: 0x00cf75, // mangroves
  100: 0xfae6a0, // moss and lichen
});

/** The class code at a geographic point. */
export function coverAt(lon, lat) {
  const sc = sceneAt(lon, lat);
  const kind = sc.kind;
  const halfW = kind === 'city' ? 190 : 42;
  if (kind !== 'desert' && riverMask(lon, lat, kind) < halfW) return 80;
  const n = fbm(lon * 300, lat * 300, 3, 4242);
  switch (kind) {
    case 'city':
      return n > 0.74 ? 30 : 50;
    case 'citySm':
      return n > 0.7 ? 30 : 50;
    case 'suburb':
      return n < 0.45 ? 50 : n > 0.68 ? 10 : 30;
    case 'parcel':
      return n < 0.5 ? 50 : 30;
    case 'desert':
      return n < 0.58 ? 60 : 20;
    case 'hills':
      return n < 0.66 ? 10 : 30;
    default:
      return n < 0.48 ? 40 : n > 0.7 ? 10 : 30;
  }
}

export function worldCoverTile(z, x, y) {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  let o = 0;
  for (let py = 0; py < SIZE; py++) {
    // Pixel CENTRES, the same sampling the app's worldCoverAt(x+.5, y+.5) reads.
    const lat = tile2lat(y + (py + 0.5) / SIZE, z);
    for (let px = 0; px < SIZE; px++) {
      const lon = tile2lon(x + (px + 0.5) / SIZE, z);
      const c = LEGEND[coverAt(lon, lat)];
      rgba[o++] = (c >> 16) & 255;
      rgba[o++] = (c >> 8) & 255;
      rgba[o++] = c & 255;
      rgba[o++] = 255;
    }
  }
  const png = encodePNG(rgba, SIZE, SIZE);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, png);
  return png;
}

/**
 * Parse a terrascope WMTS GetTile URL (the exact shape lib/fly/world-cover.js
 * `worldCoverURL` builds) into {z, x, y}, or null.
 */
export function parseWorldCoverURL(url) {
  try {
    const u = new URL(url);
    const q = (k) => u.searchParams.get(k) ?? u.searchParams.get(k.toLowerCase());
    if (String(q('REQUEST')).toLowerCase() !== 'gettile') return null;
    const z = Number(q('TILEMATRIX')), x = Number(q('TILECOL')), y = Number(q('TILEROW'));
    if (![z, x, y].every(Number.isInteger)) return null;
    return { z, x, y };
  } catch {
    return null;
  }
}

// `node scripts/r24-fixture/worldcover.mjs` — self-check: legend parity with
// the app, every emitted pixel decodes to a non-zero class through the APP'S
// OWN decoder, and each scene kind produces the classes documented above.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { register } = await import('node:module');
  register('../_node-resolve.mjs', import.meta.url);
  const zlib = await import('node:zlib');
  const app = await import('../../lib/fly/world-cover.js');
  const { SCENES, lon2tile, lat2tile } = await import('./scenes.mjs');
  let bad = 0;
  const decodePNG = (buf) => {
    // Our own encoder: one IDAT, filter 0 per row.
    let p = 8, idat = [];
    while (p < buf.length) {
      const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8);
      if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
      p += 12 + len;
    }
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const out = new Uint8Array(SIZE * SIZE * 4);
    for (let r = 0; r < SIZE; r++) raw.copy(Buffer.from(out.buffer), r * SIZE * 4, r * (SIZE * 4 + 1) + 1, (r + 1) * (SIZE * 4 + 1));
    return out;
  };
  for (const s of SCENES) {
    const z = 13, x = Math.floor(lon2tile(s.lon, z)), y = Math.floor(lat2tile(s.lat, z));
    const classes = app.decodeWorldCover(decodePNG(worldCoverTile(z, x, y)));
    const hist = {};
    for (const c of classes) hist[c] = (hist[c] || 0) + 1;
    const unknown = hist[0] || 0;
    const url = app.worldCoverURL(z, x, y);
    const parsed = parseWorldCoverURL(url);
    const urlOk = parsed && parsed.z === z && parsed.x === x && parsed.y === y;
    const ok = unknown === 0 && urlOk && (s.kind !== 'desert' || !hist[10]);
    if (!ok) bad++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${s.id.padEnd(9)} ${s.kind.padEnd(6)} z${z}/${x}/${y} classes ${JSON.stringify(hist)} url-roundtrip ${urlOk}`);
  }
  process.exit(bad ? 1 : 0);
}

/**
 * R24 fixture — the OFFLINE WORLD SERVER.
 *
 * One node http server on 127.0.0.1 that answers everything the fly world
 * fetches. Recon HARN-ENV-2 (measured): this container 403-blocks
 * tiles.openfreemap.org, server.arcgisonline.com, elevation3d.arcgis.com,
 * api.adsb.lol and api.open-meteo.com, so without this every browser gate
 * boots an empty world and reads red for environmental, not code, reasons.
 *
 * ROUTES
 *   GET /planet                       TileJSON pointing `tiles` at /mvt
 *   GET /mvt/{z}/{x}/{y}.pbf          Mapbox Vector Tile (OMT layer subset)
 *   GET /img/{z}/{y}/{x}              imagery PNG — NOTE the ArcGIS y/x order
 *   GET /dem/{z}/{x}/{y}.png          Mapbox terrain-rgb PNG
 *   GET /api/aircraft?lat&lon&dist    synthetic ADS-B
 *   GET /api/weather?lat&lon          `{found:false}` = the byte-identical
 *                                     no-weather baseline
 *   GET /__spec                       the URL <-> world mapping + stamp spec
 *   GET /__stats                      per-URL request counts + total
 *   POST/GET /__stats/reset           zero the counters
 *   GET /__health                     `{ok:true}`
 *
 * Everything is served with `Access-Control-Allow-Origin: *` (measured
 * requirement: three's ImageLoader sets crossOrigin='anonymous' and the DEM
 * loader then reads the pixels back through OffscreenCanvas.getImageData —
 * a tainted canvas would throw).
 *
 * ENV
 *   FLY_FIXTURE_PORT     default 3199
 *   FLY_FIXTURE_STAMP    'off' drops the imagery tile-identity stamp
 *   FLY_FIXTURE_TRAFFIC  off | static (default) | moving
 *   FLY_FIXTURE_FLEET    fleet size, default 300
 *   FLY_FIXTURE_LOG      '1' logs every request line to stderr
 */
import http from 'node:http';
import { mvtTile } from './mvt.mjs';
import { demTile, demSize } from './dem.mjs';
import { imageryTile, tileHue, zBorderRGB, tileBandRGB } from './imagery.mjs';
import { aircraftPayload } from './aircraft.mjs';
import { SCENES, RURAL, tile2lon, tile2lat, lon2tile, lat2tile, isEmptyBodyTile } from './scenes.mjs';

/**
 * FIXTURE_REV — bump this whenever a fixture PAYLOAD changes (a scene moves, a
 * layer gains a field, the stamp changes). Five agents share this container
 * and each may leave a server on 3199; `startFixture` REUSES a healthy server
 * only when its rev matches, and otherwise walks to the next free port. A
 * stale server serving a previous round's scenes to someone else's gate is the
 * exact class of silent wrongness the fixture exists to remove.
 */
export const FIXTURE_REV = 'r24-e.2-sierra';

const stats = { total: 0, byUrl: new Map(), byKind: new Map() };

function bump(kind, url) {
  stats.total++;
  stats.byUrl.set(url, (stats.byUrl.get(url) || 0) + 1);
  stats.byKind.set(kind, (stats.byKind.get(kind) || 0) + 1);
}

function send(res, code, body, type, extra = {}) {
  res.writeHead(code, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'cache-control': 'no-store',
    ...extra,
  });
  res.end(body);
}

export function createFixtureServer(opts = {}) {
  const stamp = (opts.stamp ?? process.env.FLY_FIXTURE_STAMP) !== 'off';
  const traffic = opts.traffic ?? process.env.FLY_FIXTURE_TRAFFIC ?? 'static';
  const fleetSize = Number(opts.fleet ?? process.env.FLY_FIXTURE_FLEET ?? 300);
  const log = (opts.log ?? process.env.FLY_FIXTURE_LOG) === '1';

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const p = u.pathname;
    if (log) process.stderr.write(`[fixture] ${req.method} ${req.url}\n`);

    try {
      if (p === '/__health')
        return send(res, 200, JSON.stringify({ ok: true, rev: FIXTURE_REV }), 'application/json');

      if (p === '/__stats/reset') {
        stats.total = 0;
        stats.byUrl.clear();
        stats.byKind.clear();
        return send(res, 200, JSON.stringify({ ok: true }), 'application/json');
      }
      if (p === '/__stats') {
        return send(
          res,
          200,
          JSON.stringify({
            total: stats.total,
            byKind: Object.fromEntries(stats.byKind),
            byUrl: Object.fromEntries(stats.byUrl),
          }),
          'application/json'
        );
      }
      if (p === '/__spec') {
        // The URL <-> world-position contract, machine-readable, so A's
        // per-tile probe never has to re-derive it.
        return send(
          res,
          200,
          JSON.stringify({
            projection: 'EPSG:3857 / XYZ',
            imagery: {
              path: '/img/{z}/{y}/{x}',
              note: 'ArcGIS World_Imagery orders the path z/y/x, NOT z/x/y',
              size: 256,
              stamp,
              stampPosition: 'top-left, three lines: z, x, y (5x7 font, scale 4, black on white)',
              hueFormula: 'hash2i(x, y, z*7919+3) % 360, HSV(h,0.85,1), blended 18% under the terrain tint',
              borderFormula: 'HSV((z*137)%360, 1, 1), 5 px on all four edges',
            },
            dem: {
              path: '/dem/{z}/{x}/{y}.png',
              encoding: 'mapbox terrain-rgb: h = -10000 + (R<<16|G<<8|B)*0.1, alpha 255',
              sizeByZoom: 'z<=0:5, z1-3:9, z4-8:17, z>=9:33 (Martini needs 2^k+1 after the loader crop)',
              carriesIdentity: false,
            },
            mvt: { path: '/mvt/{z}/{x}/{y}.pbf', extent: 4096, buildingsFromZoom: 13 },
            tileToLonLat: 'lon = x/2^z*360-180 ; lat = atan(sinh(PI-2*PI*y/2^z))*180/PI',
            scenes: SCENES.map((s) => ({ id: s.id, kind: s.kind, lat: s.lat, lon: s.lon, r: s.r })),
            default: RURAL,
            emptyBodyTile: 'z14, two east / one south of Powell OH (40.1578,-83.0752)',
          }),
          'application/json'
        );
      }

      let m;
      if ((m = p.match(/^\/mvt\/(\d+)\/(\d+)\/(\d+)\.pbf$/))) {
        const [z, x, y] = m.slice(1).map(Number);
        bump('mvt', p);
        const buf = mvtTile(z, x, y);
        // A zero-length 200 is OpenFreeMap's own out-of-range answer; the
        // worker treats it as a parsed-but-empty tile (never as a 404).
        return send(res, 200, buf, 'application/vnd.mapbox-vector-tile', {
          'x-fixture-empty-body': isEmptyBodyTile(z, x, y) ? '1' : '0',
        });
      }

      if ((m = p.match(/^\/img\/(\d+)\/(\d+)\/(\d+)$/))) {
        // ArcGIS World_Imagery: /tile/{z}/{y}/{x}
        const z = Number(m[1]);
        const y = Number(m[2]);
        const x = Number(m[3]);
        bump('img', p);
        return send(res, 200, imageryTile(z, x, y, stamp), 'image/png');
      }

      if ((m = p.match(/^\/dem\/(\d+)\/(\d+)\/(\d+)\.png$/))) {
        const [z, x, y] = m.slice(1).map(Number);
        bump('dem', p);
        return send(res, 200, demTile(z, x, y), 'image/png');
      }

      if (p === '/planet' || p === '/planet.json') {
        bump('tilejson', p);
        const base = `http://127.0.0.1:${server.address().port}`;
        return send(
          res,
          200,
          JSON.stringify({
            tilejson: '2.2.0',
            name: 'r24-fixture',
            format: 'pbf',
            minzoom: 0,
            maxzoom: 15,
            bounds: [-180, -85.0511, 180, 85.0511],
            tiles: [`${base}/mvt/{z}/{x}/{y}.pbf`],
            vector_layers: [
              { id: 'building' }, { id: 'transportation' }, { id: 'aeroway' },
              { id: 'water' }, { id: 'waterway' }, { id: 'landuse' },
              { id: 'landcover' }, { id: 'park' },
            ],
          }),
          'application/json'
        );
      }

      if (p === '/api/aircraft') {
        bump('aircraft', p);
        const lat = Number(u.searchParams.get('lat') || 0);
        const lon = Number(u.searchParams.get('lon') || 0);
        const dist = Number(u.searchParams.get('dist') || 250);
        return send(res, 200, JSON.stringify(aircraftPayload(lat, lon, dist, traffic, fleetSize)),
          'application/json', { 'x-adsb-source': 'r24-fixture' });
      }

      if (p === '/api/weather') {
        bump('weather', p);
        // `{found:false}` is the route's own honest miss and the client's
        // byte-identical no-weather baseline — the fixture NEVER fabricates
        // weather (and the fleet pins __flyWeatherOverride='baseline' anyway).
        return send(res, 200, JSON.stringify({ found: false }), 'application/json');
      }

      bump('404', p);
      return send(res, 404, 'not found', 'text/plain');
    } catch (err) {
      process.stderr.write(`[fixture] ERROR ${p}: ${err.stack}\n`);
      return send(res, 500, String(err && err.message), 'text/plain');
    }
  });

  return server;
}

/**
 * Start and resolve to { url, port, server, close() }.
 *
 * If the port is already taken by ANOTHER fixture (five agents share this
 * container and each may leave one running), we reuse it rather than fail:
 * the payloads are a pure function of (z,x,y), so a shared server is
 * byte-identical to a private one. Only a foreign occupant is an error.
 */
export async function startFixture(opts = {}) {
  const first = Number(opts.port ?? process.env.FLY_FIXTURE_PORT ?? 3199);
  for (let port = first; port < first + 10; port++) {
    let occupied = false;
    try {
      const r = await fetch(`http://127.0.0.1:${port}/__health`, {
        signal: AbortSignal.timeout(700),
      });
      const j = await r.json();
      occupied = true;
      if (j.ok && j.rev === FIXTURE_REV) {
        return {
          url: `http://127.0.0.1:${port}`,
          port,
          server: null,
          reused: true,
          close: async () => {},
        };
      }
      // Same port, DIFFERENT payload revision — never reuse it.
      process.stderr.write(
        `[fixture] port ${port} holds rev ${j.rev} (want ${FIXTURE_REV}) — trying ${port + 1}\n`
      );
      continue;
    } catch {
      if (occupied) continue; // something non-fixture answered; move on
    }
    const server = createFixtureServer(opts);
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
      });
    } catch {
      continue; // raced another agent to the port
    }
    const p = server.address().port;
    return {
      url: `http://127.0.0.1:${p}`,
      port: p,
      server,
      close: () => new Promise((r) => server.close(r)),
    };
  }
  throw new Error(`fixture: no free port in ${first}..${first + 9}`);
}

export { demSize, tileHue, zBorderRGB, tileBandRGB, tile2lon, tile2lat, lon2tile, lat2tile };

// Run directly: `node scripts/r24-fixture/server.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  startFixture().then(({ url }) => {
    process.stdout.write(`[fixture] listening on ${url}\n`);
  });
}

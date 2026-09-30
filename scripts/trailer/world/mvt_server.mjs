#!/usr/bin/env node
/**
 * Minimal static MVT server over /tmp/claude-0/world, fixture-route compatible:
 *   GET /planet | /planet.json   -> TileJSON (tiles[0] = <base>/mvt/{z}/{x}/{y}.pbf)
 *   GET /mvt/{z}/{x}/{y}.pbf     -> the built tile, or a ZERO-LENGTH 200 when absent
 * Everything carries ACAO *. Used by validate_worker.cjs; also usable as a
 * stand-alone vector route for the trailer server (PORT env, default 3290).
 * Export startMvtServer({port}) for in-process use.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.WORLD_ROOT || '/tmp/claude-0/world';

export function startMvtServer({ port = Number(process.env.PORT || 3290), host = '127.0.0.1' } = {}) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const hdr = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Cache-Control': 'no-store' };
    if (u.pathname === '/planet' || u.pathname === '/planet.json') {
      const base = `http://${req.headers.host || `${host}:${port}`}`;
      res.writeHead(200, { ...hdr, 'Content-Type': 'application/json' });
      return res.end(
        JSON.stringify({
          tilejson: '2.2.0',
          name: 'skyloom-trailer-overture',
          format: 'pbf',
          minzoom: 0,
          maxzoom: 14,
          bounds: [-180, -85.0511, 180, 85.0511],
          tiles: [`${base}/mvt/{z}/{x}/{y}.pbf`],
          attribution: '© OpenStreetMap contributors, Overture Maps Foundation',
          vector_layers: ['building', 'transportation', 'aeroway', 'water', 'waterway', 'landuse', 'landcover', 'park'].map((id) => ({ id })),
        })
      );
    }
    const m = u.pathname.match(/^\/mvt\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
    if (m) {
      const fp = path.join(ROOT, 'mvt', m[1], m[2], `${m[3]}.pbf`);
      let body = Buffer.alloc(0);
      try {
        body = fs.readFileSync(fp);
      } catch {
        /* absent -> empty 200 (never 404 inside the flown area) */
      }
      res.writeHead(200, { ...hdr, 'Content-Type': 'application/vnd.mapbox-vector-tile', 'Content-Length': body.length });
      return res.end(body);
    }
    res.writeHead(404, hdr);
    res.end('not found');
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, url: `http://${host}:${server.address().port}` })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { url } = await startMvtServer();
  console.log(`[mvt_server] serving ${ROOT}/mvt at ${url}`);
}

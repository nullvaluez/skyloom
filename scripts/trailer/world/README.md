

## Real-data tile server — `server.py`, `pin.cjs`, `run-server.sh` (trailer-real-1)

A drop-in for the R24 offline fixture (`scripts/r24-fixture/server.mjs`) that serves the
real-world tile set under `/tmp/claude-0/world` on the fixture's routes, so
`scripts/_fixture.js` works unchanged through `FLY_FIXTURE_URL`. Python 3 stdlib
`ThreadingHTTPServer` (HTTP/1.1 keep-alive, exact `Content-Length`, one socket write per
response, `TCP_NODELAY`, listen backlog 512) + Pillow/numpy for the fallbacks.

### Routes (every response carries `Access-Control-Allow-Origin: *` + `Access-Control-Allow-Headers: *`; `OPTIONS` → 204)

| Route | On disk | When missing |
|---|---|---|
| `/__health` | — | `{"ok":true,"rev":"trailer-real-1"}` |
| `/__stats`, `GET/POST /__stats/reset`, `/__spec` | — | per-kind count/hit/miss/fallback/fallbackCached/neutral/errors, missByZ, ancestorDz, latency, last 64 misses, LRU stats |
| `/planet`, `/planet.json` | — | TileJSON, `tiles: ["http://127.0.0.1:<port>/mvt/{z}/{x}/{y}.pbf"]`, minzoom 0, maxzoom 14 |
| `/mvt/{z}/{x}/{y}.pbf` | `mvt/{z}/{x}/{y}.pbf` | **zero-length 200, never 404** (a 404 blocks the reveal). Gzip-on-disk is unwrapped and served raw (no `Content-Encoding`). |
| `/img/{z}/{y}/{x}` (**ArcGIS z/y/x in the URL**) | `img/{z}/{x}/{y}.jpg` (XYZ) | crop of the **nearest existing ancestor**, bicubic-upscaled to 256 (PIL `resize(box=…)`, sub-pixel exact), LRU-cached; no ancestor → opaque 256 tile of `img/manifest.json` `fallback_rgb` (else `#23384a`). Always 200. |
| `/dem/{z}/{x}/{y}.png` | `dem/{z}/{x}/{y}.png` | nearest ancestor's heights, bilinear, **edge-inclusive** at `N=min(64,(z+2)*3)`, re-encoded terrain-rgb (A=255, IHDR/IDAT/IEND only), LRU-cached; no ancestor → flat 0 m at N. Always 200. |
| `/worldcover/{z}/{x}/{y}.png` | `worldcover/{z}/{x}/{y}.png` | 404 (harmless for WorldCover) |
| `/api/aircraft?lat&lon&dist` | `traffic.json` (envelope or bare `ac` list) | `{"now":<s>,"messages":0,"total":0,"ctime":<ms>,"ptime":0,"msg":"No error","ac":[]}`; `now`/`ctime` are always fresh, `x-adsb-source: trailer-world` |
| `/api/aircraft/{hex}/{info,photo,route}` | `aircraft/{hex}/{kind}.json` | `{"found":false}` / `{"photos":[]}` / `null` |
| `/api/weather` | — | `{"found":false}` |

Freshness: a real tile always beats a synthesized one (checked first on every request). The
synthesized-tile cache key includes the ancestor's path + mtime + size, so an ancestor that lands
later or is rebuilt invalidates its descendants automatically. **Builders must write tiles
atomically (tmp file + `os.replace`)** — a half-written file at the exact path would be served
as-is. Zero-byte files are treated as missing.

### Env

`TRAILER_WORLD_PORT` (3301) · `TRAILER_WORLD_ROOT` (/tmp/claude-0/world) · `TRAILER_WORLD_HOST`
(127.0.0.1) · `TRAILER_WORLD_LOG=1` (per-request stderr lines; default silent) ·
`TRAILER_WORLD_MAX_AGE` (0 → `no-store`, fixture parity) · `TRAILER_WORLD_LRU_MB` (256) ·
`TRAILER_WORLD_EXTRA_PORTS` (e.g. `3302,3303`: extra listeners on the same world, so imagery /
DEM / MVT can each get their own ~6-socket browser pool) · `TRAILER_WORLD_MVT_BASE` /
`TRAILER_WORLD_PUBLIC` (base written into the TileJSON). run-server.sh also reads
`TRAILER_WORLD_NICE` (default 0: the server is latency-critical and nearly idle, so it is not
niced), `TRAILER_WORLD_PIDFILE`, `TRAILER_WORLD_LOGFILE` (defaults `/tmp/claude-0/world-server.<port>.{pid,log}`).

### Run

```bash
scripts/trailer/world/run-server.sh            # start in background (nohup) and wait for /__health; reuses a healthy one
scripts/trailer/world/run-server.sh status     # health + per-kind stats
scripts/trailer/world/run-server.sh restart | stop
```

### Capture harness usage (`pin.cjs`)

```js
const { attachWorld, waitForWorld, worldPin } = require('./scripts/trailer/world/pin.cjs');
const base = 'http://127.0.0.1:3301';
await waitForWorld(base);
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } }); // fresh: Cache API caches persist per profile
await attachWorld(context, base, { maxLevel: 16 });   // before the first goto
// sets FLY_FIXTURE_URL=base → _fixture.js attachFixture(context) (OpenFreeMap/Esri/terrascope/
// api routes via Node fetch), routes /api/aircraft/{hex}/{info,photo,route} to canned JSON
// (opt out: cannedInfo:false), and an init script: window.__flyTileFixture = worldPin(base, 16),
// __flyFinalizeBudgetK = 40, __flyWeatherOverride = 'baseline', localStorage fly-map-style-2 = 'satellite'.
```

* The pin's `maxLevel` overrides the tier default (z18 on high); three-tile crops the maxLevel
  tile itself for deeper LODs. Keep `dem.maxLevel` = `img.maxLevel` (default) — the server
  synthesizes DEM beyond the built depth anyway.
* Register your own aircraft route **after** `attachWorld` (Playwright runs the last-registered
  matching route first) to override `/api/aircraft`.
* Never toggle map style mid-session: the hot-swap path ignores the pin.
* **Write capture frames outside `scripts/`.** When `FLY_TILE_FIXTURE` is set, requiring
  `scripts/_fixture.js` redirects every write whose directory is exactly `scripts/`
  (incl. `page.screenshot({path})`) to `scripts/r24-out/fixture-<name>`. attachWorld does not
  set that variable, but e.g. `/tmp/claude-0/capture/` is safe either way.
* `attachWorld` throws if `_fixture.js` was already bound (same Node process) to another server.

### Validation (no browser)

* `python3 scripts/trailer/world/test_server.py` — builds a synthetic root (4-colour z10 imagery,
  a linear-ramp DEM, a fixture-generated Manhattan z14 MVT raw + gzipped, WorldCover,
  traffic.json), starts a private server on :3391 and checks 46 gates: every route + CORS +
  preflight + HEAD; zero-length MVT for 6 missing/malformed paths; imagery fallback colours per
  quadrant at dz=1 and dz=6, nearest-ancestor choice, neutral + manifest colour, late-arriving
  real tile beats the cache; DEM fallback sizes/alpha/no colour chunks, **bilinear edge-inclusive
  error ≤ 0.088 m (one 0.1 m quantum) on a linear ramp from z11 to z18**, sibling seams 0.000 m;
  traffic `now` advancing; keep-alive (50 requests / one socket); 200 parallel requests all 200
  with single-flight (25 identical synth requests built once). Keep-alive latency on the loaded
  box (load avg 4–9): p50 ≈ 0.2–0.3 ms, p95 < 0.5 ms for hits and cached fallbacks; a fresh
  fallback ≈ 1–3 ms. A 200-way curl burst (64 fresh syntheses) finished in 0.22 s wall.
* `python3 scripts/trailer/world/test_server.py --live http://127.0.0.1:3301` — read-only smoke
  against the real root (serves real tiles byte-identically, synthesizes children 2 levels down).
* `node scripts/trailer/world/test_node.cjs http://127.0.0.1:<port> [z/x/y]` — the repo's own
  seams: `installNodeFetchFixture()` routes `https://tiles.openfreemap.org/planet`, a `.pbf`, an
  ArcGIS `tile/{z}/{y}/{x}` and a terrascope WorldCover URL to the server; every Playwright route
  handler `attachFixture` + `attachWorld` register is driven with fake routes; the init script is
  executed on a fake window; with `z/x/y` the REAL `vector-tile.worker.js` is imported in-process
  (verify-seam pattern) and `buildTile(…, 'sat-buildings' | 'earth-surface')` runs through the
  server (fixture Manhattan tile: 42k building vertices, surface masks built).

// AIRFIELD DATA — the observed airport's OpenStreetMap facts on the main thread.
//
//   loadAirfieldFeatures(siteOrAirport, { signal, api, padM }) -> Promise<AirfieldData>
//   peekAirfieldFeatures(ident)                                 -> AirfieldData | null
//
// It asks the shared vector-tile worker for the 'sat-airport' detail of every
// z14 tile covering the airport's runways plus a pad, merges the tile-clipped
// pieces and caches the result per airport ident (a few airports, LRU). Every
// consumer (AIRFIELD ground and structures, the parked fleet) gets the SAME
// promise and object, so an airport is fetched and parsed once per session.
//
// Coordinates are absolute SCENE coordinates (Web-Mercator X, Z = -mercY;
// metres × k at the airport). Convert with lounge-site's worldToSite() or
// airfield-model's local frame. The object is shared: treat it as read-only.
//
// AirfieldData {
//   ident, revision, z, k, center:{x,z}, bounds:{minX,minZ,maxX,maxZ},
//   tiles:{ requested, loaded, empty, failed },
//   runwayLines:  [{ id, ref, pts:[x,z,...] }]         stitched centrelines
//   taxiwayLines: [{ id, ref, pts }]                   stitched centrelines
//   pavements:    [{ id, cls, ref, rings:[[x,z,...],...] }]  runway|taxiway|apron|helipad|heliport
//                 polygon pieces, clipped to tile squares (pieces of one
//                 feature abut exactly at tile borders; outer ring first)
//   aerodromes:   [{ id, ref, rings }]                 the airport boundary, same piece rule
//   gates:        [{ id, ref, x, z }]                  OSM aeroway=gate points (deduped)
//   labels:       [{ id, name, iata, icao, cls, ele, x, z }]
//   buildings:    [{ id, height, minHeight, colour, hide3d, pieces:[rings], area, cx, cz, minX, minZ, maxX, maxZ }]
//                 footprints inside the aerodrome, NO area cap (terminals
//                 included). `pieces` are tile-clipped parts of one footprint;
//                 an edge lying on a tile border is a cut, not a wall.
//   roads:        [{ id, cls, service, surface, brunnel, pts }]  roads inside the aerodrome
//   cover:        [{ bounds, data:Uint8Array(256*256) }]  ESA WorldCover codes per z14 tile
// }
import { AIRFIELD_TILE_REVISION } from './airfield-tile.js';
import { OPERATIONS_AIRPORTS, projectAirportPoint } from '../operations-airports.js';

export const AIRFIELD_DATA_REVISION = 1;
export const AIRFIELD_DATA_Z = 14;
const WORLD = 40075016.68557849;
const R = 6378137;
const CACHE_LIMIT = 3;
const CONCURRENCY = 4;
// Pieces of one line meet at tile borders; both sides compute the cut point in
// their own tile frame, so equality holds to float noise (scene units).
const JOIN_EPS = 0.05;

export const identOf = (a) => (a ? a.ident || String(a.id ?? a.airportId ?? '').split(':')[0] : '');

/** The registered runway records (catalog or authored) of one airport. */
export function airportRunways(ident, list = OPERATIONS_AIRPORTS) {
  return list.filter((a) => identOf(a) === ident);
}

/** Mercator scale (scene units per true metre) at a scene Z. */
export const mercatorK = (z) => Math.cosh(z / R);

/**
 * Scene-space box around every runway end, padded by `padM` true metres. With
 * no runway known it pads the fallback point (a lounge site, say).
 */
export function airfieldBounds(runways, padM = 3000, fallback = null) {
  const b = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  const add = (x, z) => {
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x);
    b.minZ = Math.min(b.minZ, z);
    b.maxZ = Math.max(b.maxZ, z);
  };
  for (const r of runways) {
    for (const end of [r.a, r.b]) {
      const p = projectAirportPoint(end.lon, end.lat);
      add(p.x, p.z);
    }
  }
  if (!Number.isFinite(b.minX) && fallback && Number.isFinite(fallback.x) && Number.isFinite(fallback.z)) add(fallback.x, fallback.z);
  if (!Number.isFinite(b.minX)) return null;
  const k = mercatorK((b.minZ + b.maxZ) / 2);
  const pad = padM * k;
  return { minX: b.minX - pad, minZ: b.minZ - pad, maxX: b.maxX + pad, maxZ: b.maxZ + pad };
}

/** z14 tile addresses covering a scene box, nearest the box centre first. */
export function airfieldTiles(bounds, z = AIRFIELD_DATA_Z, maxTiles = 64) {
  const n = 2 ** z;
  const span = WORLD / n;
  const tx = (v) => Math.floor((v + WORLD / 2) / span);
  const x0 = tx(bounds.minX);
  const x1 = tx(bounds.maxX);
  const y0 = Math.max(0, tx(bounds.minZ));
  const y1 = Math.min(n - 1, tx(bounds.maxZ));
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const out = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const mx = -WORLD / 2 + (x + 0.5) * span;
      const mz = -WORLD / 2 + (y + 0.5) * span;
      out.push({ z, x: ((x % n) + n) % n, y, d: Math.hypot(mx - cx, mz - cz) });
    }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, maxTiles).map(({ z: tz, x, y }) => ({ z: tz, x, y }));
}

const near = (ax, az, bx, bz) => Math.abs(ax - bx) <= JOIN_EPS && Math.abs(az - bz) <= JOIN_EPS;

/**
 * Join tile-clipped pieces of the same polyline end to end. Pieces only ever
 * meet where a border cut them, so a greedy walk is exact; a piece that
 * touches nothing stays a polyline of its own.
 */
export function stitchPieces(pieces) {
  const open = pieces.map((p) => p.slice());
  const out = [];
  while (open.length) {
    let line = open.pop();
    let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const p = open[i];
        const lx0 = line[0], lz0 = line[1], lx1 = line[line.length - 2], lz1 = line[line.length - 1];
        const px0 = p[0], pz0 = p[1], px1 = p[p.length - 2], pz1 = p[p.length - 1];
        let joined = null;
        if (near(lx1, lz1, px0, pz0)) joined = line.concat(p.slice(2));
        else if (near(lx1, lz1, px1, pz1)) joined = line.concat(reverseFlat(p).slice(2));
        else if (near(lx0, lz0, px1, pz1)) joined = p.concat(line.slice(2));
        else if (near(lx0, lz0, px0, pz0)) joined = reverseFlat(p).concat(line.slice(2));
        if (joined) {
          line = joined;
          open.splice(i, 1);
          grew = true;
          break;
        }
      }
    }
    out.push(line);
  }
  return out;
}

function reverseFlat(a) {
  const r = new Array(a.length);
  for (let i = 0; i < a.length; i += 2) {
    r[a.length - 2 - i] = a[i];
    r[a.length - 1 - i] = a[i + 1];
  }
  return r;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) a += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return a / 2;
}

/**
 * Merge per-tile 'sat-airport' payloads into one AirfieldData. Pure (node
 * gates call it on fixtures). Tiles that failed or carried nothing are counted,
 * never guessed at.
 */
export function mergeAirfieldTiles(tiles, { ident = '', bounds = null, requested = tiles.length, failed = 0 } = {}) {
  const lines = { runway: new Map(), taxiway: new Map() };
  const pavements = [];
  const aerodromes = [];
  const gates = [];
  const gateSeen = new Set();
  const labels = [];
  const buildingById = new Map();
  const roadPieces = new Map();
  const cover = [];
  const occluders = [];
  let occluderRevision = null;
  let loaded = 0;
  let empty = 0;
  let anon = 0;
  for (const t of tiles) {
    if (!t || t.revision !== AIRFIELD_TILE_REVISION) continue;
    loaded++;
    if (t.occluderRevision) { occluderRevision = t.occluderRevision; occluders.push(...t.occluders); }
    if (t.empty) empty++;
    for (const l of t.lines) {
      const map = lines[l.cls];
      if (!map || l.pts.length < 4) continue;
      // Anonymous features cannot be stitched across tiles; keep them whole.
      const key = l.id != null ? `${l.id}` : `anon:${anon++}`;
      const e = map.get(key) ?? { id: l.id, ref: l.ref, pieces: [] };
      if (!e.ref && l.ref) e.ref = l.ref;
      e.pieces.push(l.pts);
      map.set(key, e);
    }
    for (const p of t.polys) {
      if (!p.rings.length || p.rings[0].length < 6) continue;
      (p.cls === 'aerodrome' ? aerodromes : pavements).push({ id: p.id, cls: p.cls, ref: p.ref, rings: p.rings });
    }
    for (const g of t.gates) {
      const key = g.id != null ? `id:${g.id}` : `${g.ref}:${Math.round(g.x)}:${Math.round(g.z)}`;
      if (gateSeen.has(key)) continue;
      gateSeen.add(key);
      gates.push({ id: g.id, ref: g.ref, x: g.x, z: g.z });
    }
    for (const l of t.labels) labels.push(l);
    for (const b of t.buildings) {
      const key = b.id != null ? `${b.id}` : `anon:${anon++}`;
      let e = buildingById.get(key);
      if (!e) {
        e = { id: b.id, height: b.height, minHeight: b.minHeight, colour: b.colour, hide3d: b.hide3d, pieces: [] };
        buildingById.set(key, e);
      }
      e.pieces.push(b.rings);
    }
    for (const r of t.roads) {
      if (r.pts.length < 4) continue;
      const key = r.id != null ? `${r.id}` : `anon:${anon++}`;
      const e = roadPieces.get(key) ?? { id: r.id, cls: r.cls, service: r.service, surface: r.surface, brunnel: r.brunnel, pieces: [] };
      e.pieces.push(r.pts);
      roadPieces.set(key, e);
    }
    if (t.cover && t.cover.length === 256 * 256) cover.push({ bounds: t.bounds, data: t.cover });
  }
  const stitched = (map) => {
    const out = [];
    for (const e of map.values()) for (const pts of stitchPieces(e.pieces)) out.push({ id: e.id, ref: e.ref, pts });
    return out;
  };
  const buildings = [];
  for (const e of buildingById.values()) {
    let area = 0;
    let cx = 0;
    let cz = 0;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const rings of e.pieces) {
      const outer = rings[0];
      const a = Math.abs(ringArea(outer));
      for (let i = 0; i < outer.length; i += 2) {
        minX = Math.min(minX, outer[i]);
        maxX = Math.max(maxX, outer[i]);
        minZ = Math.min(minZ, outer[i + 1]);
        maxZ = Math.max(maxZ, outer[i + 1]);
      }
      let sx = 0, sz = 0;
      for (let i = 0; i < outer.length; i += 2) {
        sx += outer[i];
        sz += outer[i + 1];
      }
      cx += (sx / (outer.length / 2)) * a;
      cz += (sz / (outer.length / 2)) * a;
      area += a;
    }
    if (!(area > 0)) continue;
    buildings.push({ ...e, area, cx: cx / area, cz: cz / area, minX, minZ, maxX, maxZ });
  }
  const roads = [];
  for (const e of roadPieces.values()) for (const pts of stitchPieces(e.pieces)) roads.push({ id: e.id, cls: e.cls, service: e.service, surface: e.surface, brunnel: e.brunnel, pts });
  // The label nearest the box centre names the airport (neighbouring
  // airfields can share the box).
  const center = bounds ? { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 } : { x: 0, z: 0 };
  const seenLabel = new Set();
  const uniqueLabels = [];
  for (const l of labels.sort((a, b) => Math.hypot(a.x - center.x, a.z - center.z) - Math.hypot(b.x - center.x, b.z - center.z))) {
    const key = l.icao || l.iata || l.name;
    if (seenLabel.has(key)) continue;
    seenLabel.add(key);
    uniqueLabels.push(l);
  }
  return {
    ident,
    revision: AIRFIELD_DATA_REVISION,
    z: AIRFIELD_DATA_Z,
    k: mercatorK(center.z),
    center,
    bounds,
    tiles: { requested, loaded, empty, failed },
    runwayLines: stitched(lines.runway),
    taxiwayLines: stitched(lines.taxiway),
    pavements,
    aerodromes,
    gates,
    labels: uniqueLabels,
    buildings,
    roads,
    cover,
    ...(occluderRevision ? { occluderRevision, occluders } : {}),
  };
}

// --- loading -----------------------------------------------------------------

const cache = new Map(); // ident -> { promise, data, controller, users }

/** A dedicated worker for one load (browser only); terminated when done. */
async function createWorkerApi() {
  const [{ wrap }, { withRunwayGeometry }] = await Promise.all([import('comlink'), import('../runway-worker')]);
  const worker = new Worker(new URL('../toy-world/vector-tile.worker.js', import.meta.url), { type: 'module' });
  return { api: withRunwayGeometry(wrap(worker)), close: () => worker.terminate() };
}

const abortError = () => {
  const e = new Error('Airfield load cancelled');
  e.name = 'AbortError';
  return e;
};

async function fetchTiles(api, list, controller, occluders) {
  const results = new Array(list.length).fill(null);
  let failed = 0;
  let next = 0;
  const run = async () => {
    while (next < list.length && !controller.signal.aborted) {
      const i = next++;
      const t = list[i];
      for (let attempt = 0; attempt < 2 && !controller.signal.aborted; attempt++) {
        try {
          const r = await api.buildTile(t.z, t.x, t.y, 'sat-airport', occluders ? { occluders: true } : undefined);
          // A no-data tile (open water) answers {empty:true} with no payload.
          if (r?.airfield?.revision === AIRFIELD_TILE_REVISION) results[i] = r.airfield;
          break;
        } catch {
          if (attempt === 1) failed++;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, run));
  return { results, failed };
}

function start(ident, target, { api = null, padM = 3000, occluders = false, key = ident } = {}) {
  const controller = new AbortController();
  const entry = { ident, data: null, controller, users: 0, promise: null };
  entry.promise = (async () => {
    const runways = airportRunways(ident);
    const fallback = target && Number.isFinite(target.x) ? { x: target.x, z: target.z } : null;
    const bounds = airfieldBounds(runways, padM, fallback);
    if (!bounds) throw new Error(`No runway geometry for ${ident}`);
    const list = airfieldTiles(bounds);
    let owned = null;
    try {
      if (!api) owned = await createWorkerApi();
      const { results, failed } = await fetchTiles(api ?? owned.api, list, controller, occluders);
      if (controller.signal.aborted) throw abortError();
      const data = mergeAirfieldTiles(results, { ident, bounds, requested: list.length, failed });
      entry.data = data;
      return data;
    } finally {
      owned?.close();
    }
  })();
  // The entry, not each caller, owns failure: a failed load is forgotten so
  // the next request can try again.
  entry.promise.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });
  return entry;
}

/**
 * Load (or share) the airfield facts for a lounge site or airport record.
 * `signal` cancels THIS caller; the shared load stops only when its last
 * caller has gone. `api` injects a worker API (gates); by default a dedicated
 * vector-tile worker is spawned for the load and terminated after it.
 */
export function loadAirfieldFeatures(target, { signal = null, api = null, padM = 3000, occluders = false } = {}) {
  const ident = identOf(target);
  if (!ident) return Promise.reject(new Error('No airport to load'));
  // Enriched visibility data has its own cache identity: a prior ground-only
  // load must never satisfy a pier request without nearby rendered occluders.
  const key = occluders ? ident + '|occluders' : ident;
  let entry = cache.get(key);
  if (entry?.data) {
    cache.delete(key);
    cache.set(key, entry); // LRU touch
    return Promise.resolve(entry.data);
  }
  if (!entry) {
    entry = start(ident, target, { api, padM, occluders, key });
    cache.set(key, entry);
    while (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      const old = cache.get(oldest);
      if (old.data || old.users <= 0) {
        old.controller.abort();
        cache.delete(oldest);
      } else break;
    }
  }
  entry.users++;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true;
      entry.users--;
      signal?.removeEventListener('abort', onAbort);
      return true;
    };
    function onAbort() {
      if (!finish()) return;
      if (!entry.data && entry.users <= 0) {
        entry.controller.abort();
        if (cache.get(key) === entry) cache.delete(key);
      }
      reject(abortError());
    }
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    entry.promise.then(
      (d) => finish() && resolve(d),
      (e) => finish() && reject(e)
    );
  });
}

/** The cached data for an ident, or null while loading / never loaded. */
export function peekAirfieldFeatures(ident, { occluders = false } = {}) {
  if (occluders) return cache.get(ident + '|occluders')?.data ?? null;
  return cache.get(ident)?.data ?? cache.get(ident + '|occluders')?.data ?? null;
}

/** Drop every cached airport (tests, memory pressure). */
export function clearAirfieldCache() {
  for (const e of cache.values()) e.controller.abort();
  cache.clear();
}

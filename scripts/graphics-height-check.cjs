/* Bounded production-worker/source check, called by graphics-geography.cjs.
 * No browser is launched here. Raw responses are observed, never replaced or
 * evicted: looking up today's /planet would not prove the running worker used it.
 * `node scripts/graphics-height-check.cjs` runs only synthetic harness tests. */
const { createHash } = require('node:crypto');
const WORLD_SIZE = 2 * Math.PI * 6378137;
const EPS = 0.001; // metres; exceeds Float32 rounding for these bounded samples
const BASE_SINK = 6; // authored foundation below DEM; not part of supplied height
const MAX_SAMPLES = 12;
const near = (a, b) => Math.abs(a - b) <= EPS;
const pointNear = (a, b) => near(a[0], b[0]) && near(a[1], b[1]);

function compareWalls(candidate, groups) {
  const matches = groups.filter(g => pointNear(g.anchor, candidate.anchor));
  if (matches.length !== 1) return { status: 'BLOCKED', reason: matches.length ? 'Ambiguous emitted anchor' : 'Polygon not emitted (selection/exclusion may omit it)' };
  const g = matches[0];
  if (g.oversize || g.points.length !== candidate.points.length ||
      !candidate.points.every(p => g.points.some(q => pointNear(p, q)))) {
    return { status: 'BLOCKED', reason: 'Emitted wall boundary does not uniquely match the source polygon' };
  }
  // Roofs/parapets/gables are excluded by the worker's wall-only style attribute.
  const expectedBase = candidate.minHeight > 0 ? candidate.minHeight : -BASE_SINK;
  const valid = g.finite && g.ys.length === 2 && g.ys.some(y => near(y, candidate.height)) &&
    g.ys.some(y => near(y, expectedBase)) && g.points.every((_, i) =>
      near(g.pointBase[i], expectedBase) && near(g.pointTop[i], candidate.height));
  return { status: valid ? 'PASS' : 'FAIL', sourceFeature: candidate.id,
    sourceHeightKey: candidate.heightKey, sourceHeight: candidate.height,
    sourceMinHeight: candidate.minHeight, anchor: candidate.anchor,
    boundaryVertices: candidate.points.length, wallVertices: g.vertices,
    expectedBase, actualBase: Math.min(...g.ys), actualTop: Math.max(...g.ys),
    wallLevels: g.ys, finite: g.finite };
}

// Restrict the source to simple, unclipped convex polygons. This intentionally
// excludes courtyard/multipolygon/clip ambiguity instead of guessing provenance.
function candidatesFromTile(vt, tile) {
  const layer = vt.layers.building;
  if (!layer) return [];
  const span = WORLD_SIZE / 2 ** tile.z, scale = span / layer.extent;
  const mx0 = -WORLD_SIZE / 2 + tile.x * span, myTop = WORLD_SIZE / 2 - tile.y * span;
  const cx = mx0 + span / 2, cz = -(myTop - span / 2);
  const local = p => [Math.fround(mx0 + p.x * scale - cx), Math.fround(-(myTop - p.y * scale) - cz)];
  const allAnchors = [], candidates = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 3 || f.properties.hide_3d) continue;
    const rings = f.loadGeometry(), props = f.properties;
    for (const r of rings) {
      if (!r.length || r.some(p => p.x <= 0 || p.y <= 0 || p.x >= layer.extent || p.y >= layer.extent)) continue;
      // loadGeometry includes the closing point; the worker includes it in its
      // arithmetic anchor too. Removing it here would match the wrong location.
      allAnchors.push(local({ x: r.reduce((s, p) => s + p.x, 0) / r.length,
        y: r.reduce((s, p) => s + p.y, 0) / r.length }));
    }
    if (rings.length !== 1) continue;
    const ring = rings[0];
    if (ring.length < 4 || ring.length > 13 || ring.some(p => p.x <= 0 || p.y <= 0 || p.x >= layer.extent || p.y >= layer.extent)) continue;
    const heightKey = props.render_height != null ? 'render_height' : 'height';
    const height = Number(props[heightKey]);
    if (!Number.isFinite(height) || height <= 0 || height > 2000 ||
        (height === 5 && props.height == null)) continue; // OMT synthetic default
    if (props.height != null && (!Number.isFinite(Number(props.height)) || !near(Number(props.height), height))) continue;
    const minHeight = Number(props.render_min_height ?? 0);
    if (!Number.isFinite(minHeight) || minHeight < 0 ||
        (minHeight > 0 && (minHeight <= 1 || minHeight >= height - 3))) continue;
    // The worker consumes render_min_height. An unmirrored raw min_height is
    // unsupported evidence, never silently recast as a building at ground level.
    if (props.min_height != null && (!Number.isFinite(Number(props.min_height)) || !near(Number(props.min_height), minHeight))) continue;
    const unique = ring.slice();
    if (unique[0].x === unique.at(-1).x && unique[0].y === unique.at(-1).y) unique.pop();
    if (new Set(unique.map(p => `${p.x},${p.y}`)).size !== unique.length) continue;
    let sign = 0, convex = true;
    for (let j = 0; j < unique.length; j++) {
      const a = unique[j], b = unique[(j + 1) % unique.length], c = unique[(j + 2) % unique.length];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross && sign && Math.sign(cross) !== sign) convex = false;
      if (cross) sign = Math.sign(cross);
    }
    // Same-sign turns alone also admit self-intersecting stars.
    const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (let j = 0; j < unique.length; j++) for (let k = j + 2; k < unique.length; k++) {
      if (j === 0 && k === unique.length - 1) continue;
      const a = unique[j], b = unique[(j + 1) % unique.length], c = unique[k], d = unique[(k + 1) % unique.length];
      if (orient(a, b, c) * orient(a, b, d) <= 0 && orient(c, d, a) * orient(c, d, b) <= 0) convex = false;
    }
    if (!convex || !sign) continue;
    const anchor = local({ x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
      y: ring.reduce((s, p) => s + p.y, 0) / ring.length });
    candidates.push({ id: f.id ?? `feature-${i}`, heightKey, height, minHeight, anchor, points: unique.map(local) });
  }
  return candidates.filter(c => allAnchors.filter(a => pointNear(a, c.anchor)).length === 1)
    .sort((a, b) => Number(b.minHeight > 0) - Number(a.minHeight > 0) || b.height - a.height);
}

module.exports = async function graphicsHeightCheck(page) {
  const report = { status: 'BLOCKED', checked: 0, samples: [], tiles: [],
    scope: 'Supplied wall heights before DEM drape; roofs are excluded',
    elevatedBases: { status: 'BLOCKED', reason: 'No unambiguous supplied elevated-base sample' } };
  const tapped = [], token = `height-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const tiles = await page.evaluate(() => {
      const rt = window.__fly, b = rt?.satBuildings;
      if (!b?.visuals || !b.worker || window.__flyStore?.getState().mapStyle !== 'satellite') return [];
      return [...b.chunks.values()].filter(c => c.state === 'ready' && c.mesh?.visible && !c.coarse && c.tile)
        .sort((a, c) => Math.hypot(a.cx - rt.flight.pos.x, a.cz - rt.flight.pos.z) - Math.hypot(c.cx - rt.flight.pos.x, c.cz - rt.flight.pos.z))
        .slice(0, 3).map(c => ({ z: c.tile.z, x: c.tile.x, y: c.tile.y }));
    });
    if (!tiles.length) { report.reason = 'No ready cinematic building chunks'; return report; }
    const workers = page.workers();
    if (!workers.length || workers.length > 16) { report.reason = 'Loaded dedicated-worker inventory unavailable or exceeds bounded probe'; return report; }
    // Observe the exact responses the existing workers consume, including Cache
    // API hits. Fetch-only interception misses warm return visits by construction.
    for (const worker of workers) {
      await worker.evaluate(({ tiles, token }) => {
        if (globalThis.__graphicsHeightTap) throw new Error('Height observer already active');
        const tap = { token, records: [], pending: [], urls: new Set(), errors: [], calls: [] };
        // Comlink's installed APPLY/RAW wire shape is read from its implementation.
        // An ignored options marker identifies OUR calls on the existing worker;
        // another streaming worker's coincident tile request cannot certify them.
        tap.onMessage = event => {
          const m = event.data, args = m?.argumentList;
          if (m?.type === 'APPLY' && m.path?.at(-1) === 'buildTile' && args?.[4]?.value?.graphicsHeightProbe === token) {
            tap.calls.push(args.slice(0, 3).map(a => a.value).join('/'));
          }
        };
        globalThis.addEventListener('message', tap.onMessage);
        const capture = (input, response, via) => {
          const url = typeof input === 'string' ? input : input?.url;
          if (!url || !response?.ok || response.headers.get('x-fly-nodata') === '1') return;
          let tile;
          try { const path = new URL(url).pathname; tile = tiles.find(t => path.endsWith(`/${t.z}/${t.x}/${t.y}.pbf`) || path.endsWith(`/${t.z}/${t.x}/${t.y}`)); } catch { return; }
          if (!tile || tap.urls.has(url) || tap.urls.size >= 9) return;
          tap.urls.add(url);
          let clone;
          try { clone = response.clone(); } catch (error) { tap.errors.push(String(error)); return; }
          tap.pending.push(clone.arrayBuffer().then(buf => {
            if (!buf.byteLength || buf.byteLength > 4 * 1024 * 1024) { tap.errors.push('Raw response size outside probe bounds'); return; }
            tap.records.push({ tile, url, via, bytes: Array.from(new Uint8Array(buf)) });
          }).catch(e => tap.errors.push(String(e))));
        };
        tap.fetch = globalThis.fetch;
        tap.fetchWrapper = async function (...args) { const r = await tap.fetch.apply(this, args); capture(args[0], r, 'fetch'); return r; };
        globalThis.fetch = tap.fetchWrapper;
        if (typeof Cache !== 'undefined') {
          tap.match = Cache.prototype.match;
          tap.matchWrapper = async function (...args) { const r = await tap.match.apply(this, args); capture(args[0], r, 'cache'); return r; };
          Cache.prototype.match = tap.matchWrapper;
        }
        globalThis.__graphicsHeightTap = tap;
      }, { tiles, token });
      tapped.push(worker);
    }
    const geometry = [];
    for (const tile of tiles) {
      geometry.push(await page.evaluate(async tile => {
        const b = window.__fly?.satBuildings;
        if (!b?.visuals) return { tile, reason: 'Cinematic building worker changed during probe' };
        const out = await b.worker.buildTile(tile.z, tile.x, tile.y, 'sat-buildings', { visuals: b.visuals, graphicsHeightProbe: tile.probe });
        const g = out.satBuilding;
        if (!g?.pos || !g.anchor || !g.style) return { tile, reason: 'Worker returned no wall geometry/provenance attribute', protocol: out.v };
        if (g.pos.length > 1500000 || g.anchor.length !== g.pos.length / 3 * 2 || g.style.length !== g.pos.length) return { tile, reason: 'Worker geometry exceeds probe bounds or attribute lengths disagree' };
        const groups = new Map();
        for (let i = 0; i < g.pos.length / 3; i++) {
          if (g.style[i * 3 + 2] !== 1) continue;
          const anchor = [g.anchor[i * 2], g.anchor[i * 2 + 1]], key = anchor.join(',');
          let group = groups.get(key);
          if (!group) { group = { anchor, points: new Map(), ys: new Set(), vertices: 0, finite: true, oversize: false }; groups.set(key, group); }
          const x = g.pos[i * 3], y = g.pos[i * 3 + 1], z = g.pos[i * 3 + 2], pk = `${x},${z}`;
          group.vertices++; group.finite &&= [x, y, z, ...anchor].every(Number.isFinite);
          if (group.ys.size < 32) group.ys.add(y); else group.oversize = true;
          let point = group.points.get(pk);
          if (!point && group.points.size < 64) { point = { x, z, base: y, top: y }; group.points.set(pk, point); }
          else if (!point) group.oversize = true;
          if (point) { point.base = Math.min(point.base, y); point.top = Math.max(point.top, y); }
        }
        return { tile, protocol: out.v, groups: [...groups.values()].slice(0, 600).map(g => ({ ...g,
          points: [...g.points.values()].map(p => [p.x, p.z]), pointBase: [...g.points.values()].map(p => p.base),
          pointTop: [...g.points.values()].map(p => p.top), ys: [...g.ys] })) };
      }, { ...tile, probe: token }));
    }
    const receipts = [];
    for (const worker of tapped) {
      const captured = await worker.evaluate(async token => {
        const tap = globalThis.__graphicsHeightTap;
        if (tap?.token !== token) throw new Error('Height response observer lost');
        await Promise.all(tap.pending);
        return { records: tap.records.filter(r => tap.calls.includes(`${r.tile.z}/${r.tile.x}/${r.tile.y}`)), errors: tap.errors };
      }, token);
      if (captured.errors.length) throw new Error(captured.errors.join('; '));
      receipts.push(...captured.records);
    }
    const [{ VectorTile }, { PbfReader }] = await Promise.all([import('@mapbox/vector-tile'), import('pbf')]);
    for (const built of geometry) {
      const tileName = `${built.tile.z}/${built.tile.x}/${built.tile.y}`;
      const sources = receipts.filter(r => `${r.tile.z}/${r.tile.x}/${r.tile.y}` === tileName);
      const identities = new Map(sources.map(r => [r.url + ':' + createHash('sha256').update(Buffer.from(r.bytes)).digest('hex'), r]));
      const row = { tile: tileName, status: 'BLOCKED', protocol: built.protocol, checked: 0 };
      report.tiles.push(row);
      if (built.reason) { row.reason = built.reason; row.sourceUnavailable = true; continue; }
      if (identities.size !== 1) { row.reason = 'Missing or ambiguous exact worker-source response'; row.sourceUnavailable = true; continue; }
      const raw = [...identities.values()][0];
      row.source = { url: raw.url, sha256: createHash('sha256').update(Buffer.from(raw.bytes)).digest('hex'), via: [...new Set(sources.map(s => s.via))] };
      const candidates = candidatesFromTile(new VectorTile(new PbfReader(new Uint8Array(raw.bytes))), built.tile);
      row.candidates = candidates.length; row.omittedOrAmbiguous = 0;
      for (const candidate of candidates) {
        if (report.samples.length >= MAX_SAMPLES || row.checked >= 4) break;
        const checked = compareWalls(candidate, built.groups);
        if (checked.status === 'BLOCKED') { row.omittedOrAmbiguous++; continue; }
        row.checked++; report.samples.push({ tile: tileName, ...checked });
      }
      row.status = !row.checked ? 'BLOCKED' : report.samples.some(s => s.tile === tileName && s.status === 'FAIL') ? 'FAIL' : 'PASS';
      if (!row.checked) row.reason = 'No unambiguous supplied-height polygon emitted in bounded sample';
    }
    report.checked = report.samples.length;
    report.status = report.samples.some(s => s.status === 'FAIL') ? 'FAIL' :
      report.checked && !report.tiles.some(t => t.sourceUnavailable) ? 'PASS' : 'BLOCKED';
    if (report.tiles.some(t => t.sourceUnavailable)) report.reason = 'Some selected chunks lack an exact worker/source comparison';
    if (!report.checked) report.reason = 'No exact-source, unambiguous emitted wall samples available';
    const elevated = report.samples.filter(s => s.sourceMinHeight > 0);
    if (elevated.length) report.elevatedBases = { status: elevated.every(s => s.status === 'PASS') ? 'PASS' : 'FAIL', checked: elevated.length };
  } catch (error) { report.reason = String(error?.message || error); report.status = report.samples.some(s => s.status === 'FAIL') ? 'FAIL' : 'BLOCKED'; }
  finally {
    for (const worker of tapped) {
      try {
        await worker.evaluate(token => {
          const tap = globalThis.__graphicsHeightTap;
          if (tap?.token !== token) return;
          if (globalThis.fetch === tap.fetchWrapper) globalThis.fetch = tap.fetch;
          if (typeof Cache !== 'undefined' && Cache.prototype.match === tap.matchWrapper) Cache.prototype.match = tap.match;
          globalThis.removeEventListener('message', tap.onMessage);
          delete globalThis.__graphicsHeightTap;
        }, token);
      } catch (error) { if (report.status !== 'FAIL') report.status = 'BLOCKED'; report.cleanupError = String(error?.message || error); }
    }
  }
  return report;
};

if (require.main === module) {
  const assert = require('node:assert/strict');
  const candidate = { id: 1, heightKey: 'height', height: 200, minHeight: 0,
    anchor: [10, 10], points: [[0, 0], [20, 0], [20, 20], [0, 20]] };
  const group = { anchor: [10, 10], points: candidate.points, ys: [-6, 200], vertices: 16,
    pointBase: [-6, -6, -6, -6], pointTop: [200, 200, 200, 200], finite: true };
  assert.equal(compareWalls(candidate, [group]).status, 'PASS');
  assert.equal(compareWalls(candidate, [{ ...group, ys: [-6, 140], pointTop: [140, 140, 140, 140] }]).status, 'FAIL');
  assert.equal(compareWalls({ ...candidate, minHeight: 15 }, [group]).status, 'FAIL');
  assert.equal(compareWalls({ ...candidate, minHeight: 15 }, [{ ...group, ys: [15, 200], pointBase: [15, 15, 15, 15] }]).status, 'PASS');
  assert.equal(compareWalls(candidate, [{ ...group, points: [[1, 1], ...group.points.slice(1)] }]).status, 'BLOCKED');
  assert.equal(compareWalls(candidate, [group, group]).status, 'BLOCKED');
  assert.equal(compareWalls(candidate, [{ ...group, finite: false }]).status, 'FAIL');
  const ring = [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 10 }];
  const feature = properties => ({ type: 3, id: 7, properties, loadGeometry: () => [ring] });
  const tile = { z: 14, x: 4824, y: 6157 };
  const raw = features => candidatesFromTile({ layers: { building: { length: features.length, extent: 4096, feature: i => features[i] } } }, tile);
  assert.equal(raw([feature({ render_height: 200, render_min_height: 15 })])[0].minHeight, 15);
  assert.equal(raw([feature({ render_height: 5 })]).length, 0);
  assert.equal(raw([feature({ height: 5 })])[0].height, 5);
  assert.equal(raw([feature({ height: 200, min_height: 15 })]).length, 0);
  assert.equal(raw([feature({ height: 200 }), feature({ height: 100 })]).length, 0);
  assert.equal(raw([feature({ height: 200, render_height: 140 })]).length, 0);
  console.log('Height harness synthetic checks: 13 PASS (no browser or production claim)');
}

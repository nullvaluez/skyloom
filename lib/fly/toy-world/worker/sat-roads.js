/**
 * World Pass W0 (worker split): the 'sat-roads' detail (road glow ribbons,
 * runway lights) and its clutter-only fork (out.satRoadPaths / out.satParking,
 * selected by tileCtx.clutterOnly, the worker-global api.setClutterOnly).
 * Moved VERBATIM from vector-tile.worker.js (c2bf5c06). The only edits: the
 * builder takes the per-build tileCtx (worker/tile-ctx.js; `frame` is that
 * object, `vt` its decoded tile), the protocol arrives as tileCtx.v and the
 * clutter switch as tileCtx.clutterOnly.
 */
import { airportSceneryMask } from '../../airport-scenery-mask';
import { CLUTTER, SAT_ROADS } from '../../fly-constants';
import { hexToRGB } from '../toy-palette';
import { classifyRingsSat, clipRing, pointInPoly, clipSegment } from './geom';
import { withReason, transferResult } from './result';
import { buildBridges } from './ground-bridges'; // WORLD PASS E (GROUND)

// --- Round 16 (A2 "GND-W"): the SATELLITE ground-light network ---------------
// The 'sat-roads' detail path. Every satellite tile ALREADY carried the OMT
// `transportation` + `aeroway` layers — the R13 satellite branch just threw them
// away, which is why night satellite was a black void. This path ribbon-extrudes
// the road network FLAT at y=0 (the engine drapes it on a bilinear RAW-DEM grid)
// and bakes, per vertex: the class hue (vertex color), a CLASS CODE (1-6 roads,
// 7 runway; 0 is RESERVED and never written — a missing attribute reads 0, which
// the shader's LUT maps to weight 0 = black = invisible under additive blending)
// and the cumulative arc in TRUE METERS along its chain (streetlight spacing and
// dash wavelengths are real-world lengths, and local coords are mercator-
// stretched by k — hence the ×1/k on every accumulated length).
//
// The whole tile lands in ONE set of arrays → one merged mesh → ONE draw per
// chunk, runway lights included (the R7 "zero extra draws" technique). Nothing
// here touches a toy helper: `clipSegment` is CALLED, `pushRibbon`/
// `pushRunwayLights` are PORTED into satellite-local writers so the toy group
// layout (foam/glow sentinels) is untouched.
//
// New functions only — no toy output changes, 'sat-buildings' byte-unchanged.

const SAT_ROAD_MIN_CHAIN_M = 30; // a chain shorter than this is a clip stub, not a road
const SAT_ROAD_RUNWAY_W = 55; // runway ribbon width (m) — the toy aeroway value

/** Clip a line feature to the tile square, stitching contiguous runs into chains. */
function eachClippedChain(f, extent, cb) {
  for (const line of f.loadGeometry()) {
    let chain = [];
    for (let i = 0; i < line.length - 1; i++) {
      const seg = clipSegment(line[i], line[i + 1], extent);
      if (!seg) {
        if (chain.length > 1) cb(chain);
        chain = [];
        continue;
      }
      if (chain.length === 0) chain.push(seg[0]);
      chain.push(seg[1]);
    }
    if (chain.length > 1) cb(chain);
  }
}

/**
 * Tile-space chain → decimated LOCAL polyline [x,z,x,z,…], or null if it is not
 * worth a ribbon. OMT polylines carry far more vertices than a 6 m glowing
 * ribbon needs (minSegM drops them against the last KEPT point, so a curve does
 * not accumulate error), but a long straight run must be SUBDIVIDED (maxSegM) or
 * the per-chunk bilinear drape can only lift its endpoints and the ribbon cuts
 * through a ridge. All thresholds are TRUE meters.
 */
function satRoadPrepChain(chain, toLocal, kInv, S) {
  const keep = [];
  let kx = null;
  let kz = null;
  for (let i = 0; i < chain.length; i++) {
    const [lx, lz] = toLocal(chain[i].x, chain[i].y);
    if (kx === null) {
      keep.push(lx, lz);
      kx = lx;
      kz = lz;
      continue;
    }
    // the last point is always kept, so decimation can never shorten the chain
    const isLast = i === chain.length - 1;
    if (Math.hypot(lx - kx, lz - kz) * kInv < S.minSegM && !isLast) continue;
    keep.push(lx, lz);
    kx = lx;
    kz = lz;
  }
  if (keep.length < 4) return null;
  let total = 0;
  for (let i = 2; i < keep.length; i += 2) {
    total += Math.hypot(keep[i] - keep[i - 2], keep[i + 1] - keep[i - 1]) * kInv;
  }
  if (total < SAT_ROAD_MIN_CHAIN_M) return null;
  const pts = [keep[0], keep[1]];
  for (let i = 2; i < keep.length; i += 2) {
    const ax = keep[i - 2];
    const az = keep[i - 1];
    const bx = keep[i];
    const bz = keep[i + 1];
    const segM = Math.hypot(bx - ax, bz - az) * kInv;
    const n = segM > S.maxSegM ? Math.ceil(segM / S.maxSegM) : 1;
    for (let s = 1; s <= n; s++) {
      pts.push(ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n);
    }
  }
  return pts;
}

/**
 * Ribbon-extrude a LOCAL polyline into the shared sat-road arrays: one quad per
 * segment at y=0 (the engine drapes + lifts). `arcConst` null = accumulate arc
 * in TRUE meters along the chain (roads); a number = write that constant on
 * every vertex (runway light quads carry their normalized 0..1 position along
 * the runway, for the optional chase). `maxVerts` is a HARD stop — the caller
 * fills by class priority, so hitting it drops minor roads, never motorways.
 */
function pushSatRoadQuads(acc, pts, halfW, col, clsCode, kInv, arcConst, maxVerts) {
  const [r, g, b] = col;
  let arc = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    if (acc.vtx + 4 > maxVerts) return;
    const ax = pts[i];
    const az = pts[i + 1];
    const bx = pts[i + 2];
    const bz = pts[i + 3];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const nx = (-dz / len) * halfW;
    const nz = (dx / len) * halfW;
    const lenM = len * kInv;
    const a0 = arcConst === null ? arc : arcConst;
    const a1 = arcConst === null ? arc + lenM : arcConst;
    const base = acc.vtx;
    acc.pos.push(ax + nx, 0, az + nz, ax - nx, 0, az - nz, bx + nx, 0, bz + nz, bx - nx, 0, bz - nz);
    for (let c = 0; c < 4; c++) acc.col.push(r, g, b);
    acc.arc.push(a0, a0, a1, a1);
    acc.cls.push(clsCode, clsCode, clsCode, clsCode);
    acc.vtx += 4;
    acc.idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    arc += lenM;
  }
}

/**
 * Satellite port of the round-7 toy `pushRunwayLights` walker: pairs of small
 * bright quads every `spacingM` down a clipped runway centerline, plus threshold
 * crossbars at both ends — written into the SAME sat-road arrays (class code 7),
 * so an airport costs the chunk's single draw and nothing more. The toy function
 * is left untouched (it writes the toy group's foam/glow sentinel layout).
 */
function pushSatRunwayLights(acc, chain, toLocal, k, kInv, halfWWorld, col, clsCode, cfg, maxVerts) {
  const pts = [];
  let total = 0;
  for (let i = 0; i < chain.length; i++) {
    const [lx, lz] = toLocal(chain[i].x, chain[i].y);
    if (i > 0) total += Math.hypot(lx - pts[i - 1][0], lz - pts[i - 1][1]);
    pts.push([lx, lz, total]);
  }
  if (total < 40 * k) return; // stub fragments from clipping
  const spacing = cfg.spacingM * k;
  const off = halfWWorld + cfg.offsetM * k;
  const s = cfg.sizeM * k;
  const at = (d) => {
    // point + unit direction at arc distance d
    for (let i = 1; i < pts.length; i++) {
      if (pts[i][2] >= d || i === pts.length - 1) {
        const a = pts[i - 1];
        const b = pts[i];
        const seg = Math.max(b[2] - a[2], 1e-6);
        const t = Math.min(Math.max((d - a[2]) / seg, 0), 1);
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (b[0] - a[0]) / seg, (b[1] - a[1]) / seg];
      }
    }
    return null;
  };
  for (let d = spacing / 2; d < total; d += spacing) {
    if (acc.vtx + 8 > maxVerts) return;
    const p = at(d);
    if (!p) break;
    const [px, pz, dx, dz] = p;
    const nx = -dz;
    const nz = dx;
    const g = d / total;
    for (const side of [1, -1]) {
      const cxp = px + nx * off * side;
      const czp = pz + nz * off * side;
      pushSatRoadQuads(
        acc,
        [cxp - dx * s, czp - dz * s, cxp + dx * s, czp + dz * s],
        s,
        col,
        clsCode,
        kInv,
        g,
        maxVerts
      );
    }
  }
  // threshold crossbars spanning the runway width at both ends
  for (const [d, g] of [
    [Math.min(6 * k, total * 0.05), 0],
    [total - Math.min(6 * k, total * 0.05), 1],
  ]) {
    if (acc.vtx + 4 > maxVerts) return;
    const p = at(d);
    if (!p) continue;
    const [px, pz, dx, dz] = p;
    const nx = -dz;
    const nz = dx;
    pushSatRoadQuads(
      acc,
      [px + nx * off, pz + nz * off, px - nx * off, pz - nz * off],
      s * 1.4,
      col,
      clsCode,
      kInv,
      g,
      maxVerts
    );
  }
}

// --- Round 22 (C CLUTTER) — the ground-life fork of 'sat-roads' -------------
// Positional hash. NOT a mulberry32 stream: an RNG's output depends on how many
// times it has been called, so it couples every anchor to the FEATURE ORDER of
// the tile — and OMT feature order is not a contract. Hashing the point makes
// each anchor a pure function of where it is, which is what "hash-stable" has
// to mean for a gate that hashes instance matrices across two boots.
function clutterHash(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Local-space {outer,holes} with a bbox, so inRes() rejects in 4 compares. */
function localResPoly(poly, toL) {
  const outer = poly.outer.map(toL);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of outer) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { outer, holes: poly.holes.map((h) => h.map(toL)), minX, minY, maxX, maxY };
}

/**
 * Walk a LOCAL polyline at `spacing` (local units) and hand each sample to
 * `cb(x, z, ux, uz)` — the point plus the chain's unit direction there. One
 * walker for both anchor sources and for the pole/mover derivations that live
 * on the client, so "every 42 m along this chain" means the same thing in the
 * worker as it does in the shader.
 */
function walkChain(pts, spacing, phase, cb) {
  let acc = 0;
  let next = phase;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2];
    const az = pts[i - 1];
    const seg = Math.hypot(pts[i] - ax, pts[i + 1] - az);
    if (seg < 1e-6) continue;
    const ux = (pts[i] - ax) / seg;
    const uz = (pts[i + 1] - az) / seg;
    while (next <= acc + seg) {
      const t = next - acc;
      if (cb(ax + ux * t, az + uz * t, ux, uz) === false) return;
      next += spacing;
    }
    acc += seg;
  }
}

/**
 * ROUND 22 (C "CLUTTER") — the protocol-18 ground-life outputs.
 *
 * THE OWENS LOCK LIVES HERE, and it lives here on purpose. The charter's
 * requirement is "0 instances AND +0 draws at Owens BY CONSTRUCTION", and the
 * only construction that earns that word is the R18 empty-chunk idiom: a tile
 * that emits NOTHING cannot fill a pool, and an empty pool issues no draw. A
 * client-side filter would leave three pools that happen to be empty; this
 * leaves three pools that cannot be anything else.
 *
 * The floor is km of cls-4..6 centerline per TRUE km², measured over the 3x3
 * z13 ring at every certified pose (the table is on the CLUTTER block, and the
 * measurement is scripts/r22-c-density.mjs). The Owens draw-gate pose sits ON
 * Lone Pine — a real, mapped village with 25 service ways and 3.03 km² of
 * residential landuse — so "does this tile have streets?" was never going to
 * separate it from Ohio suburbia. Density does: Lone Pine's densest z13 tile
 * measures 1.50 against P-LEWIS's SPARSEST at 2.54.
 *
 * Writes out.satRoadPaths (movers + poles) and out.satParking (parked cars).
 * Both keys, and every byte of this function, are inside CLUTTER.enabled.
 */
function buildClutter(out, transfer, vt, frame, byCls, serviceChains, kInv) {
  const { tileSpan, mercX0, mercYTop, cx, cz, k } = frame;
  const W = CLUTTER.worker;

  // --- the density floor ----------------------------------------------------
  let streetLocal = 0;
  for (let cls = 4; cls <= 6; cls++) {
    const bucket = byCls.get(cls);
    if (!bucket) continue;
    for (const c of bucket) {
      const p = c.pts;
      for (let i = 2; i < p.length; i += 2) {
        streetLocal += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
      }
    }
  }
  const trueSpanKm = (tileSpan * kInv) / 1000;
  const areaKm2 = trueSpanKm * trueSpanKm;
  const streetKmPerKm2 = areaKm2 > 0 ? (streetLocal * kInv) / 1000 / areaKm2 : 0;
  if (streetKmPerKm2 < CLUTTER.minStreetKmPerKm2) return; // OWENS: nothing emitted

  // --- satRoadPaths: cls 3..6 centerlines, VERBATIM the ribbon points --------
  // The same decimated arrays pass 2 ribbon-extrudes, in the same order, so a
  // client walking them re-derives the shader's `aRoadArc` exactly — which is
  // what puts a lamp post ON a lamp pool instead of between two.
  const ptsArr = [];
  const offsets = [0];
  const clsArr = [];
  for (let cls = 3; cls <= 6; cls++) {
    const bucket = byCls.get(cls);
    if (!bucket) continue;
    for (const c of bucket) {
      if (clsArr.length >= W.maxPathsPerChunk) break;
      for (let i = 0; i < c.pts.length; i++) ptsArr.push(c.pts[i]);
      offsets.push(ptsArr.length / 2);
      clsArr.push(cls);
    }
  }

  // Junctions: chain endpoints two or more chains share (OMT splits ways at
  // intersections, so an endpoint census finds them without a segment sweep).
  // The client uses them to SUPPRESS a lamp that would stand in the middle of
  // a crossing — the one place the 42 m phase puts furniture in the road.
  const jmap = new Map();
  const q = (v) => Math.round(v / 2) * 2; // 2-unit bucket ≈ 1.5 true m
  for (let p = 0; p < clsArr.length; p++) {
    for (const idx of [offsets[p], offsets[p + 1] - 1]) {
      const jx = ptsArr[idx * 2];
      const jz = ptsArr[idx * 2 + 1];
      const key = `${q(jx)},${q(jz)}`;
      const e = jmap.get(key);
      if (e) e.n += 1;
      else jmap.set(key, { x: jx, z: jz, n: 1 });
    }
  }
  const junc = [];
  for (const e of jmap.values()) if (e.n >= 2) junc.push(e.x, e.z);

  // --- satParking: where a car actually stands ------------------------------
  // Residential CURBS first (this is the read the user asked for — "cars parked
  // on residential streets"), then the parking AISLES, so a commercial strip's
  // dense service web cannot spend the tile's whole anchor budget before the
  // subdivision gets any.
  const park = [];
  const spacing = W.parkingSpacingM * k; // true m → local (mercator) m
  const cap = W.maxParkingPerChunk;

  const resPolys = [];
  const lu = vt.layers.landuse;
  if (lu) {
    const scale = tileSpan / lu.extent;
    const toL = (p) => ({
      x: mercX0 + p.x * scale - cx,
      y: -(mercYTop - p.y * scale) - cz,
    });
    for (let i = 0; i < lu.length && resPolys.length < 24; i++) {
      const f = lu.feature(i);
      if (f.type !== 3 || f.properties.class !== 'residential') continue;
      const rings = f
        .loadGeometry()
        .map((r) => clipRing(r, lu.extent))
        .filter((r) => r.length >= 3);
      for (const poly of classifyRingsSat(rings)) {
        if (resPolys.length >= 24) break;
        resPolys.push(localResPoly(poly, toL));
      }
    }
  }
  const inRes = (x, z) => {
    for (const p of resPolys) {
      if (x < p.minX || x > p.maxX || z < p.minY || z > p.maxY) continue;
      if (pointInPoly(p, x, z)) return true;
    }
    return false;
  };

  if (resPolys.length > 0) {
    const half = cap >> 1;
    for (const cls of [6, 5]) {
      const bucket = byCls.get(cls);
      if (!bucket) continue;
      for (const c of bucket) {
        if (park.length / 4 >= half) break;
        const off = c.halfW + 1.6 * k; // outboard of the ribbon edge, at the kerb
        walkChain(c.pts, spacing, spacing * 0.5, (x, z, ux, uz) => {
          if (park.length / 4 >= half) return false;
          if (!inRes(x, z)) return true;
          const h = clutterHash(x, z);
          const side = h < 0.5 ? 1 : -1;
          // A kerbside car is PARALLEL to the street and faces with the flow of
          // its own side, so a residential block reads as two opposed rows.
          park.push(x - uz * off * side, z + ux * off * side, ux * side, uz * side);
          return true;
        });
      }
    }
  }
  if (serviceChains) {
    const svcOff = 3.4 * k; // aisle centre → the middle of a parking bay
    for (const pts of serviceChains) {
      if (park.length / 4 >= cap) break;
      walkChain(pts, spacing, spacing * 0.5, (x, z, ux, uz) => {
        if (park.length / 4 >= cap) return false;
        const h = clutterHash(x * 1.7, z * 1.3);
        const side = h < 0.5 ? 1 : -1;
        // A bay car is PERPENDICULAR to its aisle — nose in.
        const nx = -uz * side;
        const nz = ux * side;
        park.push(x + nx * svcOff, z + nz * svcOff, nx, nz);
        return true;
      });
    }
  }

  if (clsArr.length > 0) {
    const pts = new Float32Array(ptsArr);
    const offs = new Uint32Array(offsets);
    const cl = new Uint8Array(clsArr);
    const jn = new Float32Array(junc);
    out.satRoadPaths = { pts, offsets: offs, cls: cl, junctions: jn, streetKmPerKm2 };
    transfer.push(pts.buffer, offs.buffer, cl.buffer, jn.buffer);
  }
  if (park.length > 0) {
    const pk = new Float32Array(park);
    out.satParking = pk;
    transfer.push(pk.buffer);
  }
}

function buildSatRoads(tileCtx) {
  const { vt } = tileCtx;
  const frame = tileCtx;
  const { tileSpan, mercX0, mercYTop, cx, cz, k, t0 } = frame;
  const S = SAT_ROADS;
  const out = { empty: true, tessMs: 0, v: tileCtx.v };
  const kInv = 1 / k; // local (mercator) meters → TRUE meters
  const arteryCol = hexToRGB(S.colors.artery);
  const streetCol = hexToRGB(S.colors.street);
  const runwayCol = hexToRGB(S.colors.runway);

  // Pass 1 — COLLECT accepted chains only (nothing is tessellated yet), so the
  // minFeatures floor below can shed a whole sparse rural tile for zero cost.
  const byCls = new Map(); // cls → [{ pts, halfW, col }]
  const runways = [];
  let nFeatures = 0;
  // R22 (C CLUTTER): the parking-aisle / driveway chains, collected in the SAME
  // walk (a second pass over `transportation` would re-decode every feature).
  // Deliberately NOT counted into nFeatures: the shed lever is a road-RIBBON
  // budget and a tile whose only lines are driveways must still shed.
  const serviceChains = CLUTTER.enabled ? [] : null;
  const airfield=airportSceneryMask(vt,256,tileSpan/k,true,frame);
  const inAirfield=(chain,extent)=>{
    if(!airfield)return false;
    for(let i=1;i<chain.length;i++){
      const a=chain[i-1],b=chain[i],steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)*256/extent));
      for(let j=0;j<=steps;j++){
        const x=Math.floor((a.x+(b.x-a.x)*j/steps)*256/extent),y=Math.floor((a.y+(b.y-a.y)*j/steps)*256/extent);
        if(x>=0&&x<256&&y>=0&&y<256&&airfield[y*256+x])return true;
      }
    }
    return false;
  };

  // WORLD PASS E (GROUND), M2: read from the request only (rule 1).
  const bridgesOn = tileCtx.worldPass.ground.bridges === true;
  const tLayer = vt.layers.transportation;
  if (tLayer) {
    const scale = tileSpan / tLayer.extent;
    const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
    for (let i = 0; i < tLayer.length; i++) {
      const f = tLayer.feature(i);
      if (f.type !== 2) continue; // lines only
      if (f.properties.brunnel === 'tunnel') continue; // buried road = unlit road
      const spec = S.classes[f.properties.class]; // service/track/path/rail/ferry: out
      if (!spec) {
        if (serviceChains && f.properties.class === 'service') {
          eachClippedChain(f, tLayer.extent, (chain) => {
            if(inAirfield(chain,tLayer.extent))return;
            if (serviceChains.length >= CLUTTER.worker.maxPathsPerChunk) return;
            const pts = [];
            for (const p of chain) {
              const [lx, lz] = toLocal(p.x, p.y);
              pts.push(lx, lz);
            }
            if (pts.length >= 4) serviceChains.push(pts);
          });
        }
        continue;
      }
      const halfW = (spec.w * k) / 2; // true m → local (mercator) m
      const col = spec.cls <= 3 ? arteryCol : streetCol;
      eachClippedChain(f, tLayer.extent, (chain) => {
        if(inAirfield(chain,tLayer.extent))return;
        const pts = satRoadPrepChain(chain, toLocal, kInv, S);
        if (!pts) return;
        let bucket = byCls.get(spec.cls);
        if (!bucket) {
          bucket = [];
          byCls.set(spec.cls, bucket);
        }
        // WORLD PASS E: a bridge chain is marked (the object never leaves the worker).
        bucket.push(bridgesOn && f.properties.brunnel === 'bridge' ? { pts, halfW, col, bridge: true } : { pts, halfW, col });
        nFeatures += 1;
      });
    }
  }

  const aLayer = vt.layers.aeroway;
  if (aLayer) {
    const scale = tileSpan / aLayer.extent;
    const toLocal = (px, py) => [mercX0 + px * scale - cx, -(mercYTop - py * scale) - cz];
    const halfW = (SAT_ROAD_RUNWAY_W * k) / 2;
    for (let i = 0; i < aLayer.length; i++) {
      const f = aLayer.feature(i);
      if (f.type !== 2 || f.properties.class !== 'runway') continue;
      eachClippedChain(f, aLayer.extent, (chain) => {
        runways.push({ chain, toLocal, halfW });
        nFeatures += 1;
      });
    }
  }

  // THE SHED LEVER (verify-sat-depth ≤261 at Owens Valley): a tile with fewer
  // accepted chains than the floor returns EMPTY — no arrays, no satRoads key,
  // and the engine marks the chunk empty → zero draws for that tile. Default 0
  // = every tile with at least one chain draws.
  if (nFeatures < S.minFeatures) {
    out.tessMs = performance.now() - t0;
    // R21: 'zero' — THE SHED LEVER fired. Deliberate, deterministic, and
    // permanent for this tile: an engine may cache it, but it must never
    // confuse it with a rate-limited fetch.
    return withReason(out, 'zero');
  }

  const transfer = [];

  // --- R22 (C CLUTTER) — the protocol-18 ground-life outputs -----------------
  // Everything below is inside this one flag: with CLUTTER.enabled false the
  // function is byte-identical to protocol 17 (no keys, no transferables, no
  // extra layer decode — `serviceChains` is null and never collected).
  if (CLUTTER.enabled) {
    buildClutter(out, transfer, vt, frame, byCls, serviceChains, kInv);
  }
  // `clutterOnly` (set on the clutter engine's OWN worker via api.setClutterOnly)
  // returns here: that engine reads the two new keys and nothing else, and the
  // ribbon tessellation below is ~90% of this builder's cost. The ROAD engine's
  // worker never sets it, so its bundle is unchanged.
  if (tileCtx.clutterOnly) {
    out.tessMs = performance.now() - t0;
    // The road ring's sentinel is `!result.satRoads`, which is still true here —
    // so even if this bundle somehow reached SatRoadEngine it renders nothing.
    if (!out.satRoadPaths && !out.satParking) withReason(out, 'zero');
    return transfer.length ? transferResult(out, transfer) : out;
  }

  // WORLD PASS E (GROUND), M2: bridge decks. With it on, each bridge way's
  // flat glow ribbon is still emitted, and its index range is recorded
  // (`wpBridges.ribbon`, after pass 2) so the main thread hides only the
  // ribbons a drawn deck carries up (round 2: a bridge beyond the deck range
  // keeps its flat glow). Off: nothing here runs.
  let br = null;
  const ribbon = bridgesOn ? [] : null;
  if (bridgesOn) {
    br = buildBridges(tileCtx, S.classes);
    if (br) {
      out.wpBridges = br;
      out.empty = false;
      transfer.push(br.pts.buffer, br.chains.buffer);
    }
  }

  // Pass 2 — tessellate under a hard vertex budget, by PRIORITY: runway lights
  // first (bounded by runway count, and the airport is the payoff), then roads
  // motorway → minor, so a dense downtown z13 tile loses its residential grid
  // before it loses its skeleton.
  const acc = { pos: [], col: [], arc: [], cls: [], idx: [], vtx: 0 };
  const maxV = S.maxVertsPerChunk;
  for (const r of runways) {
    if (acc.vtx >= maxV) break;
    pushSatRunwayLights(acc, r.chain, r.toLocal, k, kInv, r.halfW, runwayCol, 7, S.runway, maxV);
  }
  for (let cls = 1; cls <= 6; cls++) {
    const bucket = byCls.get(cls);
    if (!bucket) continue;
    for (const c of bucket) {
      if (acc.vtx >= maxV) break;
      const i0 = acc.idx.length; // WORLD PASS E: (ribbon is null with the flag off)
      pushSatRoadQuads(acc, c.pts, c.halfW, c.col, cls, kInv, null, maxV);
      if (c.bridge && ribbon && acc.idx.length > i0) ribbon.push(i0, acc.idx.length - i0, ...ribbonProbes(c.pts));
    }
  }
  if (br && ribbon.length) {
    br.ribbon = new Float32Array(ribbon);
    transfer.push(br.ribbon.buffer);
  }

  if (acc.idx.length > 0) {
    const pos = new Float32Array(acc.pos);
    const col = new Float32Array(acc.col);
    const arc = new Float32Array(acc.arc);
    const cls = new Float32Array(acc.cls);
    const idx = acc.vtx > 65535 ? new Uint32Array(acc.idx) : new Uint16Array(acc.idx);
    out.satRoads = { pos, col, arc, cls, idx };
    out.empty = false;
    transfer.push(pos.buffer, col.buffer, arc.buffer, cls.buffer, idx.buffer);
  }
  out.tessMs = performance.now() - t0;
  withReason(out, 'zero'); // no accepted chain survived tessellation
  return transfer.length ? transferResult(out, transfer) : out;
}

/** WORLD PASS E: x, z at 25, 50 and 75 % of a local polyline's length (bridge ribbon probes). */
function ribbonProbes(pts) {
  let L = 0;
  for (let i = 2; i < pts.length; i += 2) L += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
  const out = [];
  for (const f of [0.25, 0.5, 0.75]) {
    let want = L * f, x = pts[0], z = pts[1];
    for (let i = 2; i < pts.length; i += 2) {
      const s = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      if (s >= want) { const t = s ? want / s : 0; x = pts[i - 2] + (pts[i] - pts[i - 2]) * t; z = pts[i - 1] + (pts[i + 1] - pts[i - 1]) * t; break; }
      want -= s; x = pts[i]; z = pts[i + 1];
    }
    out.push(x, z);
  }
  return out;
}

export { buildSatRoads, buildClutter, eachClippedChain, satRoadPrepChain, pushSatRoadQuads, pushSatRunwayLights, walkChain, clutterHash };

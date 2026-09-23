/* eslint-disable */
// =============================================================================
// R24 A — the readable source of the DEM worker's R24 tail.
// =============================================================================
// THIS FILE IS NOT IMPORTED BY THE APP. `scripts/build-tile-worker.mjs`
// stringifies it into `lib/fly/vendor/three-tile/workers/skirt-tail.built.js`,
// and the vendored bundle splices that string into three-tile's own inline DEM
// worker source in place of its `self.onmessage = …` tail (PATCH 5). It runs
// INSIDE that worker, so the identifiers it calls — the decode entry point,
// substituted as `__DECODE__` — belong to the upstream worker's IIFE scope and
// are undefined here. That is why the file is eslint-disabled and why nothing
// imports it.
//
// WHY A SPLICE RATHER THAN A REWRITE. three-tile's worker is ~8 KB of minified
// LERC decoder plus Martini. Re-authoring it readably would be a large,
// unreviewable diff against a decoder nobody wants to re-derive. Splicing keeps
// every upstream byte and puts ONLY the new code in a readable file — which is
// also what makes it a safe place for another agent to add worker-side work
// (C's smooth DEM normals, recon T6: add a function here, call it from the
// handler below, and give it its own switch).
//
// WHAT IT DOES (recon T2 / FL-02 / A2). Upstream builds the tile skirt on the
// MAIN THREAD in the promise continuation after the worker returns: an
// allocate-and-sort boundary-edge finder plus four full typed-array copies, per
// DEM tile. `TERRA_PACE.skirtFast` made the edge finder O(E); this moves the
// whole thing — boundary scan, skirt vertices, attribute concatenation — into
// the worker and returns the finished arrays as TRANSFERABLES, so the main
// thread does nothing but wrap them in BufferAttributes.
//
// OUTPUT IDENTITY. The boundary scan is the same algorithm as PATCH 4 and the
// skirt assembly is a transliteration of upstream's `Re`/`Xe`/`E`; when the
// scan does not claim an input (see the bail list) the worker leaves the
// geometry unskirted and does NOT set `r24Skirted`, so the main thread runs
// upstream's own skirt build exactly as before. `scripts/verify-skirt-worker.mjs`
// compares this file's output against the main-thread path element by element.

function r24BoundaryEdges(idx) {
  var n = idx.length;
  if (n === 0 || n % 3 !== 0) return null;
  var cap = 1024;
  while (cap < n * 2) cap <<= 1;
  var keyMin = new Int32Array(cap);
  var keyMax = new Int32Array(cap);
  var meta = new Int32Array(cap); // count in bits 0-1, direction flag in bit 2
  var used = new Uint8Array(cap);
  var occ = new Int32Array(cap);
  var mask = cap - 1;
  var occN = 0;
  for (var t = 0; t < n; t += 3) {
    var i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    if (i0 < 0 || i1 < 0 || i2 < 0) return null;
    for (var e = 0; e < 3; e++) {
      var a = e === 0 ? i0 : e === 1 ? i1 : i2;
      var b = e === 0 ? i1 : e === 1 ? i2 : i0;
      if (a === b) return null;
      var lo = a < b ? a : b;
      var hi = a < b ? b : a;
      var dir = a === lo ? 0 : 1;
      var s = (Math.imul(lo, 2654435761) ^ Math.imul(hi, 2246822519)) & mask;
      for (;;) {
        if (!used[s]) {
          used[s] = 1;
          keyMin[s] = lo;
          keyMax[s] = hi;
          meta[s] = 1 | (dir << 2);
          occ[occN++] = s;
          break;
        }
        if (keyMin[s] === lo && keyMax[s] === hi) {
          var m = meta[s];
          if ((m & 3) >= 2) return null; // seen 3x
          if (m >> 2 === dir) return null; // same winding: upstream keeps both
          meta[s] = 2 | (m & 4);
          break;
        }
        s = (s + 1) & mask;
      }
    }
  }
  var keep = [];
  for (var k = 0; k < occN; k++) {
    if ((meta[occ[k]] & 3) === 1) keep.push(occ[k]);
  }
  keep.sort(function (x, y) {
    return keyMin[x] !== keyMin[y] ? keyMin[x] - keyMin[y] : keyMax[x] - keyMax[y];
  });
  var out = new Array(keep.length);
  for (var q = 0; q < keep.length; q++) {
    var sl = keep[q];
    out[q] = meta[sl] >> 2 === 0 ? [keyMin[sl], keyMax[sl]] : [keyMax[sl], keyMin[sl]];
  }
  return out;
}

function r24Concat(a, b) {
  var out = new a.constructor(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/**
 * Upstream `Re` + `Xe`, transliterated. Returns null when the boundary scan
 * declines the input, in which case the caller leaves the geometry unskirted
 * and the main thread does exactly what it does today.
 */
// =============================================================================
// R24 C — SMOOTH DEM NORMALS (recon T6 / L8), inside the worker.
// =============================================================================
// THE DEFECT: three-tile's own per-vertex normal pass is `t[n] = t[s] = t[o] =
// g * w` — every vertex of every triangle is ASSIGNED that triangle's face
// normal, so a shared vertex ends up holding whichever triangle happened to be
// LAST. There is no accumulation and no normalisation. Martini triangulates a
// 2^n+1 grid into long slivers on gentle slopes, so "whichever was last" is
// arbitrary in exactly the places the eye reads as a smooth hillside, and the
// relief FACETS. C's fragment-stage N·L (TERRAIN_LIGHT.fragmentHill)
// interpolates the normal instead of the dot, which is necessary but not
// sufficient: interpolating an arbitrary normal field is still arbitrary.
//
// THE FIX: accumulate the UN-NORMALISED cross product per triangle into all
// three of its vertices, then normalise once. The un-normalised cross product
// has magnitude 2·area, so the accumulation is AREA-WEIGHTED for free — which
// matters here specifically, because it is what stops Martini's long thin
// slivers from out-voting the real surface at a vertex they merely touch.
//
// ORIENTATION: the result is flipped to +z when needed rather than trusted to
// the winding. Tile-local +z IS world up on this path (the skirt builder below
// drops `position[i*3+2]`, and the tile mesh is rotated −90° by the caller), so
// a terrain surface normal always has a positive z component, and asserting
// that makes the function independent of upstream's winding convention — a
// convention recon WB-1/A1 already caught being wrong once elsewhere.
//
// WHAT THIS DOES NOT FIX, stated because the recon asked for more: normals
// remain per-TILE. Two tiles at different Martini errors still decimate their
// shared edge differently, so a shading discontinuity can survive at a LOD
// boundary. Fixing that needs central differences over the FULL decoded DEM
// grid, and the grid is not reachable from here — the decode entry point
// (`__DECODE__`) returns the Martini mesh only. The follow-up ask is exactly
// one line of upstream shape: have the decode also return the raster and its
// side length (which must be READ from the payload, never assumed to be 257 —
// the terrain-rgb path resizes to clamp((z+2)*3, 2, 64) and Martini throws
// unless the grid is 2^k+1).
function r24SmoothNormals(attributes, indices) {
  var pos = attributes.position && attributes.position.value;
  var nrm = attributes.normal && attributes.normal.value;
  if (!pos || !nrm || nrm.length !== pos.length) return false;
  var n = indices.length;
  if (n === 0 || n % 3 !== 0) return false;
  var i;
  for (i = 0; i < nrm.length; i++) nrm[i] = 0;
  for (var t = 0; t < n; t += 3) {
    var a = indices[t] * 3;
    var b = indices[t + 1] * 3;
    var c = indices[t + 2] * 3;
    var ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    var e1x = pos[b] - ax, e1y = pos[b + 1] - ay, e1z = pos[b + 2] - az;
    var e2x = pos[c] - ax, e2y = pos[c + 1] - ay, e2z = pos[c + 2] - az;
    var nx = e1y * e2z - e1z * e2y;
    var ny = e1z * e2x - e1x * e2z;
    var nz = e1x * e2y - e1y * e2x;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
    nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
    nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
  }
  for (var v = 0; v < nrm.length; v += 3) {
    var x = nrm[v], y = nrm[v + 1], z = nrm[v + 2];
    var l = Math.sqrt(x * x + y * y + z * z);
    if (l > 1e-12) { nrm[v] = x / l; nrm[v + 1] = y / l; nrm[v + 2] = z / l; }
    else { nrm[v] = 0; nrm[v + 1] = 0; nrm[v + 2] = 1; }
  }
  return true;
}

// =============================================================================
// R25 D — DEM RELIEF NORMAL MAP (R25_GROUND.relief), inside the worker.
// =============================================================================
// The follow-up the R24 C note above asked for: the decode's own GRID, not the
// Martini mesh. `__R25_MESH_WRAP__` (below the handler) is replaced at splice
// time by one assignment that wraps the worker's grid->Martini function, so
// the full decoded (and clipped) grid is captured on its way into the mesher —
// the decode entry point itself stays upstream's, byte for byte. When the
// request carries `r25Relief` (a map size; Visuals Enhanced), the handler
// returns a mapPx^2 RG8 WORLD-frame normal map built by central differences
// over that full grid. KEEP IN LOCK-STEP with lib/fly/r25-relief.js
// `reliefFromGrid`: scripts/verify-r25-ground.mjs diffs the two byte for byte.
var r25Grid = null;
function r25CaptureMesh(mesh) {
  return function (g, z, e) {
    r25Grid = g;
    return mesh(g, z, e);
  };
}
function r25ReliefMap(dem, w, h, z, N) {
  var out = new Uint8Array(N * N * 2);
  if (!dem || w < 2 || h < 2 || dem.length < w * h || N < 2) return out;
  var span = (2 * Math.PI * 6378137) / Math.pow(2, z);
  var sx = span / (w - 1);
  var sz = span / (h - 1);
  var gx = new Float32Array(w * h);
  var gz = new Float32Array(w * h);
  var r, c;
  for (r = 0; r < h; r++) {
    var r0 = r > 0 ? r - 1 : r;
    var r1 = r < h - 1 ? r + 1 : r;
    for (c = 0; c < w; c++) {
      var c0 = c > 0 ? c - 1 : c;
      var c1 = c < w - 1 ? c + 1 : c;
      var k = r * w + c;
      gx[k] = (dem[r * w + c1] - dem[r * w + c0]) / ((c1 - c0) * sx);
      gz[k] = (dem[r1 * w + c] - dem[r0 * w + c]) / ((r1 - r0) * sz);
    }
  }
  var inv = 1 / (N - 1);
  // 2x2 box prefilter when the grid is denser than the map (see r25-relief.js).
  var q = w - 1 > N - 1 ? 0.25 * ((w - 1) / (N - 1)) : 0;
  var qz = h - 1 > N - 1 ? 0.25 * ((h - 1) / (N - 1)) : 0;
  var taps = q > 0 || qz > 0 ? 4 : 1;
  var hx = 0;
  var hz = 0;
  function tap(fx, fy) {
    if (fx < 0) fx = 0;
    else if (fx > w - 1) fx = w - 1;
    if (fy < 0) fy = 0;
    else if (fy > h - 1) fy = h - 1;
    var x0 = Math.floor(fx);
    if (x0 > w - 2) x0 = w - 2;
    var y0 = Math.floor(fy);
    if (y0 > h - 2) y0 = h - 2;
    var tx = fx - x0;
    var ty = fy - y0;
    var a = y0 * w + x0;
    var b = a + 1;
    var cc = a + w;
    var d = cc + 1;
    var ga = gx[a] + (gx[b] - gx[a]) * tx;
    var gb = gx[cc] + (gx[d] - gx[cc]) * tx;
    var za = gz[a] + (gz[b] - gz[a]) * tx;
    var zb = gz[cc] + (gz[d] - gz[cc]) * tx;
    hx += ga + (gb - ga) * ty;
    hz += za + (zb - za) * ty;
  }
  for (var j = 0; j < N; j++) {
    var fy = (1 - j * inv) * (h - 1);
    for (var i = 0; i < N; i++) {
      var fx = i * inv * (w - 1);
      hx = 0;
      hz = 0;
      if (taps === 1) tap(fx, fy);
      else {
        tap(fx - q, fy - qz);
        tap(fx + q, fy - qz);
        tap(fx - q, fy + qz);
        tap(fx + q, fy + qz);
        hx *= 0.25;
        hz *= 0.25;
      }
      var l = Math.sqrt(hx * hx + 1 + hz * hz);
      var o = (j * N + i) * 2;
      out[o] = Math.round((-hx / l * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round((-hz / l * 0.5 + 0.5) * 255);
    }
  }
  return out;
}

function r25PostUnskirted(geom) {
  var t = [geom.attributes.position.value.buffer, geom.attributes.texcoord.value.buffer, geom.attributes.normal.value.buffer, geom.indices.buffer];
  if (geom.r25Relief) t.push(geom.r25Relief.buffer);
  var uniq = [];
  for (var q = 0; q < t.length; q++) if (t[q] && uniq.indexOf(t[q]) < 0) uniq.push(t[q]);
  self.postMessage(geom, uniq);
}

function r24AddSkirt(attributes, indices, skirtHeight, r24InheritNormals) {
  var edges = r24BoundaryEdges(indices);
  if (!edges) return null;
  var s = edges.length;
  var newPosition = new Float32Array(s * 6);
  var newTexcoord = new Float32Array(s * 4);
  var newTriangles = new indices.constructor(s * 6);
  var newNormals = new Float32Array(s * 6);
  var pos = attributes.position.value;
  var uv = attributes.texcoord.value;
  var base = pos.length / 3;
  for (var i = 0; i < s; i++) {
    var e0 = edges[i][0];
    var e1 = edges[i][1];
    var c = i * 2;
    var u = c + 1;
    newPosition[c * 3] = pos[e0 * 3];
    newPosition[c * 3 + 1] = pos[e0 * 3 + 1];
    newPosition[c * 3 + 2] = pos[e0 * 3 + 2] - skirtHeight;
    newPosition[u * 3] = pos[e1 * 3];
    newPosition[u * 3 + 1] = pos[e1 * 3 + 1];
    newPosition[u * 3 + 2] = pos[e1 * 3 + 2] - skirtHeight;
    newTexcoord[c * 2] = uv[e0 * 2];
    newTexcoord[c * 2 + 1] = uv[e0 * 2 + 1];
    newTexcoord[u * 2] = uv[e1 * 2];
    newTexcoord[u * 2 + 1] = uv[e1 * 2 + 1];
    var d = i * 6;
    newTriangles[d] = e0;
    newTriangles[d + 1] = base + u;
    newTriangles[d + 2] = e1;
    newTriangles[d + 3] = base + u;
    newTriangles[d + 4] = e0;
    newTriangles[d + 5] = base + c;
    if (r24InheritNormals) {
      // R24 C (recon T7): the curtain inherits its edge vertices' normals
      // instead of upstream's hard-coded world-up. A near-vertical wall lit as
      // flat ground is the documented "smeared cliff" half of the LOD-seam
      // artifact; with the smooth normals above it now shades as the surface
      // it hangs from, which is the cheapest honest reading of a skirt.
      var nn = attributes.normal.value;
      newNormals[d] = nn[e0 * 3];
      newNormals[d + 1] = nn[e0 * 3 + 1];
      newNormals[d + 2] = nn[e0 * 3 + 2];
      newNormals[d + 3] = nn[e1 * 3];
      newNormals[d + 4] = nn[e1 * 3 + 1];
      newNormals[d + 5] = nn[e1 * 3 + 2];
    } else {
      newNormals[d] = 0;
      newNormals[d + 1] = 0;
      newNormals[d + 2] = 1;
      newNormals[d + 3] = 0;
      newNormals[d + 4] = 0;
      newNormals[d + 5] = 1;
    }
  }
  attributes.position.value = r24Concat(attributes.position.value, newPosition);
  attributes.texcoord.value = r24Concat(attributes.texcoord.value, newTexcoord);
  attributes.normal.value = r24Concat(attributes.normal.value, newNormals);
  return { attributes: attributes, indices: r24Concat(indices, newTriangles) };
}

/*__R25_MESH_WRAP__*/
self.onmessage = function (ev) {
  var req = ev.data;
  r25Grid = null;
  var geom = __DECODE__(req.demData, req.z, req.clipBounds, req.errTable);
  if (geom.demNoData) { self.postMessage(geom); return; }
  // R25 D (R25_GROUND.relief): only when THIS request asked for it (Enhanced).
  // The grid is whatever the decode handed its mesher — the full decoded tile,
  // clipped to this tile's footprint when it was served from a parent.
  var r25Px = req.r25Relief | 0;
  if (r25Px > 1 && r25Grid && r25Grid.dem) {
    geom.r25Relief = r25ReliefMap(r25Grid.dem, r25Grid.width, r25Grid.height, req.z, r25Px);
  }
  r25Grid = null;
  // Surface bounds exclude skirts. In particular [0, negative max] was an
  // empty Tile.BBox and hid valid Hudson terrain during frustum parking.
  var surfacePos = geom.attributes.position.value;
  geom.surfaceMinZ = 0;
  for (var si = 2; si < surfacePos.length; si += 3) {
    geom.surfaceMinZ = Math.min(geom.surfaceMinZ, surfacePos[si]);
  }
  // The height formula is upstream's own, read from the tile zoom the loader
  // already sends, so no message-shape change is needed (TileGeometry
  // .setAttributes computes exactly this on the main thread today).
  var h = req.z === 0 ? 0 : 2e5 / req.z / req.z;
  // R25 D: the skirt stays in the worker ONLY when A's or C's switch spliced it
  // here (the literal below is `true` then, exactly the R24 behaviour). A
  // worker spliced for R25 relief ALONE substitutes `false`, and the main
  // thread builds the skirt as upstream does (TileGeometry.setAttributes only
  // trusts `r24Skirted` under A's skirtWorker anyway).
  var r24WorkerSkirt = true /*__R24_WORKER_SKIRT__*/;
  // R24 C (TERRAIN_LIGHT.workerNormals) — BEFORE the skirt, so the curtain can
  // inherit a normal that already means something. The literal is substituted
  // by the splice in index.js (PATCH 8), because a Blob worker cannot import
  // the switchboard; `false` leaves this whole branch dead and A's skirt output
  // element-for-element identical.
  var r24Normals = __R24_NORMALS__;
  if (r24Normals) geom.r24Normals = r24SmoothNormals(geom.attributes, geom.indices);
  if (!r24WorkerSkirt) {
    // R25-only splice: post the geometry exactly as upstream's worker builds it
    // (the main thread adds the skirt), plus the optional relief map.
    r25PostUnskirted(geom);
    return;
  }
  if (h > 0) {
    var skirted = r24AddSkirt(geom.attributes, geom.indices, h, r24Normals);
    if (skirted) {
      geom.attributes = skirted.attributes;
      geom.indices = skirted.indices;
      geom.r24Skirted = true;
    }
  } else {
    // z === 0 means "no skirt" for both paths; say so, so the main thread does
    // not re-derive it.
    geom.r24Skirted = true;
  }
  var transfer = [];
  var seen = [];
  var push = function (arr) {
    if (arr && arr.buffer && seen.indexOf(arr.buffer) < 0) {
      seen.push(arr.buffer);
      transfer.push(arr.buffer);
    }
  };
  push(geom.attributes.position.value);
  push(geom.attributes.texcoord.value);
  push(geom.attributes.normal.value);
  push(geom.indices);
  push(geom.r25Relief);
  self.postMessage(geom, transfer);
};

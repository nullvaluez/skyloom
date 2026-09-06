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
function r24AddSkirt(attributes, indices, skirtHeight) {
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
    newNormals[d] = 0;
    newNormals[d + 1] = 0;
    newNormals[d + 2] = 1;
    newNormals[d + 3] = 0;
    newNormals[d + 4] = 0;
    newNormals[d + 5] = 1;
  }
  attributes.position.value = r24Concat(attributes.position.value, newPosition);
  attributes.texcoord.value = r24Concat(attributes.texcoord.value, newTexcoord);
  attributes.normal.value = r24Concat(attributes.normal.value, newNormals);
  return { attributes: attributes, indices: r24Concat(indices, newTriangles) };
}

self.onmessage = function (ev) {
  var req = ev.data;
  var geom = __DECODE__(req.demData, req.z, req.clipBounds);
  // The height formula is upstream's own, read from the tile zoom the loader
  // already sends, so no message-shape change is needed (TileGeometry
  // .setAttributes computes exactly this on the main thread today).
  var h = req.z === 0 ? 0 : 2e5 / req.z / req.z;
  if (h > 0) {
    var skirted = r24AddSkirt(geom.attributes, geom.indices, h);
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
  self.postMessage(geom, transfer);
};

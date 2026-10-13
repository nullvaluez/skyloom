// AIRFIELD HEIGHT — one height field under every airfield ground layer.
//
// WHY ONE FIELD. The old airport ground stacked three surfaces that each found
// the terrain their own way (the operations runway at +0.025 m on its authored
// profile, the OSM sheet at +0.65 m healed per vertex, and the imagery's own
// classification), so they floated, buried and disagreed at junctions. Here a
// single regular grid is the only height any ground layer reads: the vertex
// shaders sample it as an R32F texture, the CPU copy places lights and answers
// heightAt() for the other workstreams. Layers sit a few centimetres apart
// above it, so they can never cross each other.
//
// BUILT FROM THE DRAWN MESHES. The field is rebuilt from the terrain tiles' own
// vertex buffers (what three-tile draws, after the operations layer flattened
// the runways), never from point queries:
//   1. RASTER — each node takes the highest triangle over it: exactly what a
//      vertical ground query at the node answers, for every node at once.
//   2. HOLES — nodes no triangle covers (a crack between tiles, an area whose
//      tile is still loading) keep their previous value or are inpainted from
//      known neighbours; otherwise they stay unknown and the shaders discard.
//   3. ENVELOPE — the field is planar per facet (each 16 m cell split along
//      its (0,0)-(1,1) diagonal) while the DEM mesh is metre-scale (crowned
//      pavement, swales, kerbs), so between nodes the mesh would poke through.
//      Every mesh vertex, and a point every half cell along long triangle
//      edges (creases between big flat triangles), is then a constraint: where
//      the surface passes below one, the three corners of its facet rise by
//      the minimum-norm lift (corner c by short·w_c/Σw²) — exactly enough
//      there, mostly at the nearest corner. Lifts only raise, so one pass
//      satisfies every constraint.
// Measured at KCMH against the drawn-surface query (900 x 900 m in front of
// the lounge, the bilinear variant): the drawn grass, pavement and runway
// never sat below the terrain (worst +1 mm in 33k samples) and the field's
// median was 7 cm above it.
//
// WHY A REBUILD, NOT ACCUMULATION. Terrain tiles refine and merge, and the
// operations layer re-flattens a runway after its tile loads. An envelope that
// accumulates remembers every surface it ever saw: measured 0.66 m too high at
// the median and 5 m at the 1st percentile a minute after arrival. A rebuild
// reflects exactly the tiles resident now. It is a generator so the caller can
// slice it across frames; each step is about one tile of work.
//
// Pure: no three. The caller converts its meshes into `sources` (below).
export const AF_HEIGHT_UNKNOWN = -1e5; // sentinel the shaders treat as "not known"

const UNKNOWN_MAX = AF_HEIGHT_UNKNOWN + 1;

/**
 * A terrain source for rebuild(): one tile mesh.
 *   position   raw vertex buffer (x, y, z per vertex)
 *   index      triangle indices
 *   m          12 numbers mapping a raw vertex to (local x, local z, elevation):
 *              x = m0*px + m1*py + m2*pz + m3, z = m4.. m7, e = m8.. m11
 *   skirtBelow raw z under which a vertex is a skirt (three-tile hangs skirts
 *              hundreds of metres below the tile edge), or -Infinity
 */

export class AirfieldHeightField {
  /** @param grid { x0, z0, nx, nz, step } in local metres */
  constructor(grid) {
    this.x0 = grid.x0;
    this.z0 = grid.z0;
    this.nx = grid.nx;
    this.nz = grid.nz;
    this.step = grid.step;
    this.data = new Float32Array(grid.nx * grid.nz).fill(AF_HEIGHT_UNKNOWN);
    this.version = 0; // bumps on every commit (texture/light consumers)
    this.ready = false; // a build has committed
    this.stats = { builds: 0, sources: 0, vertices: 0, triangles: 0, edgePoints: 0, lifted: 0, holes: 0, inpainted: 0, unknown: 0 };
    this._next = null;
    this._vx = this._vz = this._ve = null;
  }

  /** Raw vertices of a source -> local x/z/elevation scratch (NaN = skirt). Returns the vertex count. */
  _local(src) {
    const p = src.position;
    const n = (p.length / 3) | 0;
    if (!this._vx || this._vx.length < n) {
      const cap = Math.max(n, 4096);
      this._vx = new Float64Array(cap);
      this._vz = new Float64Array(cap);
      this._ve = new Float64Array(cap);
    }
    const { _vx: vx, _vz: vz, _ve: ve } = this;
    const m = src.m;
    const below = Number.isFinite(src.skirtBelow) ? src.skirtBelow : -Infinity;
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      if (z < below) {
        ve[i] = NaN;
        continue;
      }
      vx[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
      vz[i] = m[4] * x + m[5] * y + m[6] * z + m[7];
      ve[i] = m[8] * x + m[9] * y + m[10] * z + m[11];
    }
    return n;
  }

  /** Highest triangle over each node, into `next`. */
  _raster(src, next) {
    const { nx, nz, x0, z0, step } = this;
    const inv = 1 / step;
    const { _vx: vx, _vz: vz, _ve: ve } = this;
    const ids = src.index;
    let tris = 0;
    for (let t = 0; t + 2 < ids.length; t += 3) {
      const a = ids[t], b = ids[t + 1], c = ids[t + 2];
      const ae = ve[a], be = ve[b], ce = ve[c];
      if (!(ae === ae && be === be && ce === ce)) continue; // a skirt face
      const ax = vx[a], az = vz[a], bx = vx[b], bz = vz[b], cx = vx[c], cz = vz[c];
      const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - x0) * inv - 1e-9));
      const i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - x0) * inv + 1e-9));
      if (i0 > i1) continue;
      const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - z0) * inv - 1e-9));
      const j1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0) * inv + 1e-9));
      if (j0 > j1) continue;
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(det) < 1e-9) continue; // degenerate
      tris++;
      const id = 1 / det;
      for (let j = j0; j <= j1; j++) {
        const z = z0 + j * step;
        for (let i = i0; i <= i1; i++) {
          const x = x0 + i * step;
          const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) * id;
          const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) * id;
          if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
          const h = u * ae + v * be + (1 - u - v) * ce;
          const n = j * nx + i;
          if (!(next[n] >= h)) next[n] = h; // NaN (unset) or lower
        }
      }
    }
    return tris;
  }

  /** Raise the facet surface to at least e at (x, z): minimum-norm corner lift. */
  _lift(next, x, z, e) {
    const { nx, nz } = this;
    const gx = (x - this.x0) / this.step, gz = (z - this.z0) / this.step;
    if (!(gx >= 0 && gz >= 0 && gx < nx - 1 && gz < nz - 1)) return 0;
    const i = gx | 0, j = gz | 0;
    const fx = gx - i, fz = gz - j;
    const a = j * nx + i, d = a + nx + 1;
    if (Math.min(next[a], next[a + 1], next[a + nx], next[d]) <= UNKNOWN_MAX) return 0; // the shaders discard there anyway
    // The facet holding the point and its planar weights (see facetWeights).
    const m = fx >= fz ? a + 1 : a + nx;
    const wa = fx >= fz ? 1 - fx : 1 - fz, wm = Math.abs(fx - fz), wd = fx >= fz ? fz : fx;
    const short = e - (wa * next[a] + wm * next[m] + wd * next[d]);
    if (!(short > 0)) return 0;
    const f = short / (wa * wa + wm * wm + wd * wd);
    next[a] += f * wa;
    next[m] += f * wm;
    next[d] += f * wd;
    return 1;
  }

  /** Vertex and long-edge constraints of one source. */
  _envelope(src, next, eps) {
    const { _vx: vx, _vz: vz, _ve: ve } = this;
    const n = (src.position.length / 3) | 0;
    let lifted = 0, points = 0;
    for (let i = 0; i < n; i++) if (ve[i] === ve[i]) lifted += this._lift(next, vx[i], vz[i], ve[i] + eps);
    // Long edges: a crease between two big flat triangles runs straight
    // through cells that hold no vertex.
    const half = this.step / 2;
    const ids = src.index;
    for (let t = 0; t + 2 < ids.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const a = ids[t + k], b = ids[t + (k + 1) % 3];
        if (!(ve[a] === ve[a] && ve[b] === ve[b])) continue;
        const len = Math.hypot(vx[b] - vx[a], vz[b] - vz[a]);
        if (len <= half) continue;
        const steps = Math.ceil(len / half);
        for (let s = 1; s < steps; s++) {
          const f = s / steps;
          lifted += this._lift(next, vx[a] + (vx[b] - vx[a]) * f, vz[a] + (vz[b] - vz[a]) * f, ve[a] + (ve[b] - ve[a]) * f + eps);
          points++;
        }
      }
    }
    return { lifted, points };
  }

  /** Nodes no triangle covered: the previous value, else neighbours, else unknown. */
  _holes(next, passes = 4) {
    const { nx, nz, data } = this;
    let open = [];
    for (let n = 0; n < next.length; n++) {
      if (next[n] === next[n]) continue;
      if (data[n] > UNKNOWN_MAX) next[n] = data[n]; // the previous build's value
      else open.push(n);
    }
    const holes = open.length;
    let inpainted = 0;
    // Each pass grows the known area by one ring (a pass reads only values
    // known before it), averaging at least two known 4-neighbours.
    const known = (n) => next[n] === next[n];
    for (let pass = 0; pass < passes && open.length; pass++) {
      const fill = [], still = [];
      for (const n of open) {
        const i = n % nx, j = (n / nx) | 0;
        let s = 0, c = 0;
        if (i > 0 && known(n - 1)) (s += next[n - 1]), c++;
        if (i < nx - 1 && known(n + 1)) (s += next[n + 1]), c++;
        if (j > 0 && known(n - nx)) (s += next[n - nx]), c++;
        if (j < nz - 1 && known(n + nx)) (s += next[n + nx]), c++;
        if (c >= 2) fill.push(n, s / c);
        else still.push(n);
      }
      for (let f = 0; f < fill.length; f += 2) next[fill[f]] = fill[f + 1];
      inpainted += fill.length / 2;
      open = still;
      if (!fill.length) break;
    }
    for (const n of open) next[n] = AF_HEIGHT_UNKNOWN;
    return { holes, inpainted, unknown: open.length };
  }

  /**
   * Rebuild the field from terrain sources (see above). A generator: every
   * next() is a bounded unit of work (one source, or one whole-grid pass);
   * the field changes only at the final commit.
   */
  *rebuild(sources, { eps = 0.02 } = {}) {
    const size = this.nx * this.nz;
    if (!this._next || this._next.length !== size) this._next = new Float32Array(size);
    const next = this._next;
    next.fill(NaN);
    const stats = { sources: sources.length, vertices: 0, triangles: 0, edgePoints: 0, lifted: 0, holes: 0, inpainted: 0, unknown: 0 };
    for (const src of sources) {
      stats.vertices += this._local(src);
      stats.triangles += this._raster(src, next);
      yield;
    }
    Object.assign(stats, this._holes(next));
    yield;
    for (const src of sources) {
      this._local(src);
      const e = this._envelope(src, next, eps);
      stats.lifted += e.lifted;
      stats.edgePoints += e.points;
      yield;
    }
    this.data.set(next);
    this.version++;
    this.ready = true;
    this.stats = { ...stats, builds: this.stats.builds + 1 };
  }

  /**
   * Height at a local point, or null while unknown there: planar per facet
   * (the cell split along its (0,0)-(1,1) diagonal), exactly as the shaders'
   * afHeight and the meshes cut by clipToFacets.
   */
  heightAt(x, z) {
    const { nx, nz, data } = this;
    const gx = (x - this.x0) / this.step;
    const gz = (z - this.z0) / this.step;
    if (!(gx >= 0 && gz >= 0 && gx <= nx - 1 && gz <= nz - 1)) return null;
    const i = Math.min(nx - 2, Math.floor(gx));
    const j = Math.min(nz - 2, Math.floor(gz));
    const fx = gx - i;
    const fz = gz - j;
    const h00 = data[j * nx + i], h10 = data[j * nx + i + 1], h01 = data[(j + 1) * nx + i], h11 = data[(j + 1) * nx + i + 1];
    if (Math.min(h00, h10, h01, h11) <= UNKNOWN_MAX) return null;
    return fx >= fz ? h00 + (h10 - h00) * fx + (h11 - h10) * fz : h00 + (h11 - h01) * fx + (h01 - h00) * fz;
  }

  /** Fraction of nodes with a known height (0..1). */
  coverage() {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] > UNKNOWN_MAX) n++;
    return n / this.data.length;
  }
}

/**
 * The grid for a model extent: `stepM` unless that would exceed `maxNodes`,
 * in which case the step grows to fit. Local metres.
 */
export function airfieldGrid(extent, { stepM = 16, maxNodes = 300000, padM = 60 } = {}) {
  const minX = extent.minX - padM;
  const minZ = extent.minZ - padM;
  const w = extent.maxX + padM - minX;
  const h = extent.maxZ + padM - minZ;
  let step = stepM;
  while ((Math.ceil(w / step) + 1) * (Math.ceil(h / step) + 1) > maxNodes) step *= 1.25;
  return { x0: minX, z0: minZ, nx: Math.ceil(w / step) + 1, nz: Math.ceil(h / step) + 1, step };
}

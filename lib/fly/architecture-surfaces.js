/** Keep one owner of an identical rendered face. OSM building/part records can
 * emit the same facade or roof with different inferred styles. Depth testing
 * cannot choose a stable paint between those coplanar triangles.
 *
 * Compare the actual float32 positions AND bend anchors, independent of vertex
 * order, UVs and paint. Separate heights, nearby faces and different bends stay
 * intact. Run in the worker, before draping, normals and spatial partitioning.
 * Compact the existing index buffer and preserve the solid/detail boundary.
 */
export function uniqueArchitectureSurfaces(index, position, anchors, bodyCount = index.length) {
  const vertices = new Map(), faces = new Set(), ids = new Uint32Array(position.length / 3);
  let next = 0, write = 0, body = 0;
  for (let v = 0; v < ids.length; v++) {
    const key = `${position[v * 3]},${position[v * 3 + 1]},${position[v * 3 + 2]}:${anchors[v * 2]},${anchors[v * 2 + 1]}`;
    let id = vertices.get(key);
    if (id === undefined) { id = next++; vertices.set(key, id); }
    ids[v] = id;
  }
  for (let i = 0; i < index.length; i += 3) {
    let a = ids[index[i]], b = ids[index[i + 1]], c = ids[index[i + 2]];
    if (a > b) [a, b] = [b, a];
    if (b > c) [b, c] = [c, b];
    if (a > b) [a, b] = [b, a];
    const key = `${a},${b},${c}`;
    if (faces.has(key)) continue;
    faces.add(key);
    index[write++] = index[i]; index[write++] = index[i + 1]; index[write++] = index[i + 2];
    if (i < bodyCount) body += 3;
  }
  return { index: index.subarray(0, write), bodyCount: body, removed: (index.length - write) / 3 };
}

/** Resolve competing vertical wall rectangles before draping. Distinct OSM
 * parts can share a facade with different heights, paints and bend anchors.
 * They remain coplanar after either anchor translates them vertically, so an
 * exact triangle/anchor dedupe cannot help. Give each shared span one owner
 * and retain the uncovered height intervals (including elevated parts).
 *
 * Only complete rectangles with exactly the same horizontal endpoints qualify.
 * Slanted walls, roofs, nearby parallel faces and nonrectangular triangles are
 * untouched. Runs in the worker on its growable arrays, never during a frame.
 */
export function resolveArchitectureWalls(mesh, bodyCount = mesh.idx.length) {
  const { pos, anchor, idx } = mesh;
  const edges = new Map();
  for (let i = 0; i < idx.length; i += 3) {
    const ids = [idx[i], idx[i + 1], idx[i + 2]];
    const points = ids.map(v => `${Math.fround(pos[v * 3])},${Math.fround(pos[v * 3 + 2])}`);
    const ends = [...new Set(points)].sort();
    if (ends.length !== 2) continue;
    const lo = Math.min(...ids.map(v => pos[v * 3 + 1]));
    const hi = Math.max(...ids.map(v => pos[v * 3 + 1]));
    if (!(hi > lo)) continue;
    const key = ends.join('|');
    let faces = edges.get(key);
    if (!faces) edges.set(key, faces = new Map());
    const owner = `${anchor[ids[0] * 2]},${anchor[ids[0] * 2 + 1]}`;
    const faceKey = `${owner}:${lo}:${hi}`;
    let face = faces.get(faceKey);
    if (!face) faces.set(faceKey, face = { owner, lo, hi, triangles: [], corners: new Map(), first: i });
    face.triangles.push(i);
    for (let j = 0; j < 3; j++) face.corners.set(`${points[j] === ends[0] ? 0 : 1}:${pos[ids[j] * 3 + 1]}`, ids[j]);
  }
  const replacements = new Map();
  let removed = 0, split = 0;
  for (const faces of edges.values()) {
    if (faces.size < 2) continue;
    const rectangles = [...faces.values()].filter(f => f.triangles.length === 2 && f.corners.size === 4 &&
      [0, 1].every(e => f.corners.has(`${e}:${f.lo}`) && f.corners.has(`${e}:${f.hi}`)));
    // Stable existing emission order chooses the paint. No camera, time or
    // network completion order participates in this decision.
    const covered = [];
    for (const f of rectangles) {
      let spans = [[f.lo, f.hi]];
      for (const [lo, hi] of covered) {
        spans = spans.flatMap(([a, b]) => hi <= a || lo >= b ? [[a, b]] :
          [...(a < lo ? [[a, lo]] : []), ...(b > hi ? [[hi, b]] : [])]);
        if (!spans.length) break;
      }
      covered.push([f.lo, f.hi]);
      if (spans.length === 1 && spans[0][0] === f.lo && spans[0][1] === f.hi) continue;
      for (const at of f.triangles) replacements.set(at, []);
      removed += 2;
      if (!spans.length) continue;
      split++;
      const emit = (edge, y) => {
        const low = f.corners.get(`${edge}:${f.lo}`), high = f.corners.get(`${edge}:${f.hi}`);
        if (y === f.lo) return low;
        if (y === f.hi) return high;
        const t = (y - f.lo) / (f.hi - f.lo), v = mesh.vtx++;
        for (const [name, size] of [['pos', 3], ['col', 3], ['anchor', 2], ['uv', 2], ['style', 3]]) {
          const values = mesh[name];
          if (!values?.length) continue;
          for (let k = 0; k < size; k++) values.push(values[low * size + k] + (values[high * size + k] - values[low * size + k]) * t);
        }
        return v;
      };
      // Preserve the original winding, hence the original lighting normal.
      const original = f.triangles[0], v = [idx[original], idx[original + 1], idx[original + 2]];
      const endpoint = id => (pos[id * 3] === pos[f.corners.get(`0:${f.lo}`) * 3] && pos[id * 3 + 2] === pos[f.corners.get(`0:${f.lo}`) * 3 + 2]) ? 0 : 1;
      const sign = (endpoint(v[1]) - endpoint(v[0])) * (pos[v[2] * 3 + 1] - pos[v[0] * 3 + 1]) -
        (pos[v[1] * 3 + 1] - pos[v[0] * 3 + 1]) * (endpoint(v[2]) - endpoint(v[0]));
      const out = [];
      for (const [lo, hi] of spans) {
        const a = emit(0, lo), b = emit(1, lo), c = emit(1, hi), d = emit(0, hi);
        out.push(...(sign > 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c]));
      }
      replacements.set(f.first, out);
    }
  }
  if (!replacements.size) return { bodyCount, removed: 0, split: 0 };
  const result = [];
  let count = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const triangles = replacements.get(i) ?? [idx[i], idx[i + 1], idx[i + 2]];
    result.push(...triangles);
    if (i < bodyCount) count += triangles.length;
  }
  mesh.idx = result;
  return { bodyCount: count, removed, split };
}

/** Same indexed accumulation/normalization as BufferGeometry, on the worker.
 * Each triangle belongs to one rigidly draped building, so its normal survives
 * the main thread's vertical translation. Degenerate faces contribute zero. */
export function architectureNormals(position, index) {
  const normal = new Float32Array(position.length);
  for (let i = 0; i < index.length; i += 3) {
    const a=index[i]*3,b=index[i+1]*3,c=index[i+2]*3;
    const ux=position[c]-position[b],uy=position[c+1]-position[b+1],uz=position[c+2]-position[b+2];
    const vx=position[a]-position[b],vy=position[a+1]-position[b+1],vz=position[a+2]-position[b+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    for(const v of [a,b,c]){normal[v]+=nx;normal[v+1]+=ny;normal[v+2]+=nz;}
  }
  for(let i=0;i<normal.length;i+=3){const k=1/(Math.sqrt(normal[i]**2+normal[i+1]**2+normal[i+2]**2)||1);normal[i]*=k;normal[i+1]*=k;normal[i+2]*=k;}
  return normal;
}

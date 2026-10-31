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

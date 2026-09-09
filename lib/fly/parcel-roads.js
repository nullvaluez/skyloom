/** Spatial lookup of real residential/service road ribbon centrelines.
 * Construction is resumable so a newly streamed road ring cannot stall a frame.
 */
export function parcelRoadScan(chunks, mercatorK, previousSignature = '') {
  const sources = [];
  let signature = '';
  for (const [key, c] of chunks ?? []) {
    if (c.state !== 'ready' || c.coarse || !c.mesh) continue;
    const g = c.mesh.geometry;
    signature += `${key}:${g.id};`;
    if (g.attributes.aRoadCls && g.attributes.position) sources.push({
      p: g.attributes.position.array, cls: g.attributes.aRoadCls.array,
      x: c.mesh.position.x, z: c.mesh.position.z,
    });
  }
  if (signature === previousSignature) return null;
  return { signature, sources, source: 0, vertex: 0, cells: new Map(), cell: 128 * mercatorK, mercatorK, done: false };
}

export function stepParcelRoadScan(scan, budgetMs = 0.3, maxQuads = 192) {
  const start = performance.now();
  let examined = 0;
  while (scan.source < scan.sources.length) {
    const s = scan.sources[scan.source];
    if (scan.vertex + 3 >= s.cls.length) { scan.source++; scan.vertex = 0; continue; }
    const v = scan.vertex; scan.vertex += 4;
    const o = v * 3;
    if (s.cls[v] === 5 || s.cls[v] === 6) {
      const ax = s.x + (s.p[o] + s.p[o + 3]) * 0.5;
      const az = s.z + (s.p[o + 2] + s.p[o + 5]) * 0.5;
      const bx = s.x + (s.p[o + 6] + s.p[o + 9]) * 0.5;
      const bz = s.z + (s.p[o + 8] + s.p[o + 11]) * 0.5;
      const segment = [ax, az, bx, bz];
      for (let x = Math.floor(Math.min(ax,bx)/scan.cell); x <= Math.floor(Math.max(ax,bx)/scan.cell); x++)
        for (let z = Math.floor(Math.min(az,bz)/scan.cell); z <= Math.floor(Math.max(az,bz)/scan.cell); z++) {
          const key = `${x},${z}`;
          if (!scan.cells.has(key)) scan.cells.set(key, []);
          scan.cells.get(key).push(segment);
        }
    }
    if (++examined >= maxQuads || performance.now() - start >= budgetMs) return false;
  }
  scan.done = true;
  scan.sources = null;
  return true;
}

export function parcelRoadDistance(index, x, z) {
  if (!index?.done) return Infinity;
  let distanceSq = Infinity;
  const radius = 55 * index.mercatorK;
  for (let gx = Math.floor((x-radius)/index.cell); gx <= Math.floor((x+radius)/index.cell); gx++)
    for (let gz = Math.floor((z-radius)/index.cell); gz <= Math.floor((z+radius)/index.cell); gz++)
      for (const [ax,az,bx,bz] of index.cells.get(`${gx},${gz}`) ?? []) {
        const dx = bx-ax, dz = bz-az;
        const t = Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/Math.max(1e-8,dx*dx+dz*dz)));
        distanceSq = Math.min(distanceSq,(x-ax-t*dx)**2+(z-az-t*dz)**2);
      }
  return Math.sqrt(distanceSq)/index.mercatorK;
}

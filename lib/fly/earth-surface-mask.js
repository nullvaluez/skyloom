import { EARTH_SURFACE, STYLIZED_EARTH, surfaceClass } from './stylized-earth.js';

/** Even/odd scan conversion handles holes and either ring winding. Worker-only work. */
export function paintSurfacePolygon(target, size, rings, extent, value, padding = 0) {
  if (!rings.length) return;
  const scale = size / extent;
  const width = size + padding * 2;
  let lo = width, hi = 0;
  for (const ring of rings) for (const p of ring) { lo = Math.min(lo, p.y * scale + padding); hi = Math.max(hi, p.y * scale + padding); }
  for (let y = Math.max(0, Math.floor(lo)); y < Math.min(width, Math.ceil(hi)); y++) {
    const py = (y + 0.5 - padding) / scale, crossings = [];
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j], b = ring[i];
      if ((a.y > py) !== (b.y > py)) crossings.push((a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y)) * scale + padding);
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const start = Math.max(0, Math.ceil(crossings[i] - 0.5)), end = Math.min(width, Math.ceil(crossings[i + 1] - 0.5));
      target.fill(value, y * width + start, y * width + Math.max(start, end));
    }
  }
}

/** Inner-edge feather, computed in the worker from buffered provider geometry.
 * Never expands a classification. The halo prevents tile edges becoming biome
 * edges; radius stays inside OpenFreeMap's 64/4096 feature buffer. */
function naturalBlend(padded, size, padding) {
  const width = size + padding * 2, radius = padding - 1;
  const distance = new Float32Array(padded.length).fill(radius);
  const relax = (i, j, step) => {
    distance[i] = Math.min(distance[i], padded[i] === padded[j] ? distance[j] + step : step * .5);
  };
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x) relax(i, i - 1, 1);
    if (y) {
      relax(i, i - width, 1);
      if (x) relax(i, i - width - 1, Math.SQRT2);
      if (x + 1 < width) relax(i, i - width + 1, Math.SQRT2);
    }
  }
  for (let y = width - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x + 1 < width) relax(i, i + 1, 1);
    if (y + 1 < width) {
      relax(i, i + width, 1);
      if (x) relax(i, i + width - 1, Math.SQRT2);
      if (x + 1 < width) relax(i, i + width + 1, Math.SQRT2);
    }
  }
  const blend = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y + padding) * width + x + padding, cls = padded[i];
    // Fields, developed areas and water retain their actual mapped boundaries.
    const hard = cls === EARTH_SURFACE.farmland || cls === EARTH_SURFACE.developed || cls === EARTH_SURFACE.water;
    const t = hard ? 1 : Math.min(1, distance[i] / radius);
    blend[y * size + x] = cls ? Math.round(t * t * (3 - 2 * t) * 255) : 0;
  }
  return blend;
}

/** Compact, versioned classification. No imagery inference and no administrative parks. */
export function buildEarthSurfaceMask(vt, size = 256) {
  size = size === 128 ? 128 : 256;
  const padding = size / 64, width = size + 2 * padding;
  const padded = new Uint8Array(width * width);
  const classes = new Uint8Array(size * size), exclusion = new Uint8Array(size * size);
  let features = 0;
  for (const name of ['landuse', 'landcover', 'aeroway', 'water']) {
    const layer = vt.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i), cls = surfaceClass(name, f.properties);
      if (f.type !== 3) continue;
      // Seasonal water remains photographic, but cannot acquire inferred props
      // from an overlapping dry land classification.
      if (name === 'water') paintSurfacePolygon(exclusion, size, f.loadGeometry(), layer.extent, 255);
      if (!cls) continue;
      paintSurfacePolygon(padded, size, f.loadGeometry(), layer.extent, cls, padding);
      features++;
    }
  }
  for (let y = 0; y < size; y++) classes.set(padded.subarray((y + padding) * width + padding, (y + padding) * width + padding + size), y * size);
  const blend = naturalBlend(padded, size, padding);
  // Exclusion masks also preserve mapped buildings/roads in the material treatment.
  for (const name of ['building', 'aeroway', 'transportation']) {
    const layer = vt.layers[name];
    if (!layer) continue;
    for (let i = 0; i < layer.length; i++) {
      const f = layer.feature(i), rings = f.loadGeometry();
      if (f.type === 3) paintSurfacePolygon(exclusion, size, rings, layer.extent, 255);
      else if (f.type === 2) {
        const scale = size / layer.extent;
        for (const ring of rings) for (let j = 1; j < ring.length; j++) {
          const a = ring[j - 1], b = ring[j], steps = Math.ceil(Math.max(Math.abs(b.x-a.x), Math.abs(b.y-a.y)) * scale);
          for (let k = 0; k <= steps; k++) {
            const t = steps ? k / steps : 0, x = Math.floor((a.x + (b.x-a.x)*t)*scale), y = Math.floor((a.y + (b.y-a.y)*t)*scale);
            if (x >= 0 && y >= 0 && x < size && y < size) exclusion[y*size+x] = 255;
          }
        }
      }
    }
  }
  let waterCells = 0, classifiedCells = 0;
  for (let i = 0; i < classes.length; i++) {
    if (classes[i] === EARTH_SURFACE.water) { waterCells++; exclusion[i] = 255; }
    // 128 excludes scenery only; 255 also preserves mapped road/building imagery.
    if (!exclusion[i] && (classes[i] === EARTH_SURFACE.wetland || classes[i] === EARTH_SURFACE.tidal)) exclusion[i] = 128;
    if (classes[i]) classifiedCells++;
  }
  // Explicit water boundary metadata, in north/east/south/west order. Consumers
  // can distinguish map evidence from a failed request or an empty ocean tile.
  const waterEdges = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    waterEdges[i] = +(classes[i] === EARTH_SURFACE.water);
    waterEdges[size+i] = +(classes[i*size+size-1] === EARTH_SURFACE.water);
    waterEdges[2*size+i] = +(classes[(size-1)*size+i] === EARTH_SURFACE.water);
    waterEdges[3*size+i] = +(classes[i*size] === EARTH_SURFACE.water);
  }
  return { revision: STYLIZED_EARTH.surfaceRevision, size, classes, blend, exclusion, waterEdges, features, waterCells, classifiedCells };
}

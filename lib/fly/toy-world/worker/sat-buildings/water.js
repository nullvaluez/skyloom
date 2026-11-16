/**
 * World Pass W0 (worker split): the 'sat-buildings' water half: polygon water
 * for the specular glint (out.satWater) and the per-tile water coverage the
 * engine's ocean fill reads (out.waterCoverage).
 * Moved VERBATIM from buildSatBuildings in vector-tile.worker.js (c2bf5c06).
 */
import earcut from 'earcut';
import { SAT_WATER } from '../../../fly-constants';
import { signedArea, clipRing } from '../geom';

function buildSatWater(tileCtx, classify) {
  const { vt, tileSpan, mercX0, mercYTop, cx, cz } = tileCtx;
  // Round 13 (P4): water polygons for the specular glint (out.satWater). Filled
  // + triangulated flat at y=0 (the engine drapes the mesh to the chunk-center
  // ground); uv = tile-local XZ / rippleM so the normal map tiles at a world-
  // consistent swell size. Rivers-as-lines are left to the toy foam pass — the
  // glint targets polygon water bodies (harbors/lakes/wide rivers).
  const waterLayer = vt.layers.water;
  const satW = { pos: [], uv: [], idx: [], vtx: 0 };
  // Round 18 (A1): per-tile WATER COVERAGE (water polygon area / tile area).
  // Free here — the water layer is already fully iterated for the glint — and
  // it is what lets the engine tell "this 404 is open ocean" from "this 404 is
  // an empty desert" without a second fetch. Emitted unconditionally (0 when
  // the tile has no water layer at all) so it is never a missing-key read.
  let waterAreaTile = 0;
  if (waterLayer) {
    const scaleW = tileSpan / waterLayer.extent;
    const toLocalW = (px, py) => [mercX0 + px * scaleW - cx, -(mercYTop - py * scaleW) - cz];
    const inv = 1 / SAT_WATER.rippleM;
    for (let i = 0; i < waterLayer.length; i++) {
      const f = waterLayer.feature(i);
      if (f.type !== 3 || f.properties.class === 'swimming_pool') continue;
      const rings = f.loadGeometry().map((r) => clipRing(r, waterLayer.extent));
      const polys = classify(rings.filter((r) => r.length >= 3)); // round 18 coverage fix
      for (const poly of polys) {
        // area in TILE units (rings are already clipped to the tile square, so
        // this can never exceed extent²) — holes subtracted
        waterAreaTile += Math.abs(signedArea(poly.outer)) * 0.5;
        for (const hole of poly.holes) {
          if (hole.length < 3) continue;
          waterAreaTile -= Math.abs(signedArea(hole)) * 0.5;
        }
        const flat = [];
        const holeIdx = [];
        for (const p of poly.outer) flat.push(p.x, p.y);
        for (const hole of poly.holes) {
          if (hole.length < 3) continue;
          holeIdx.push(flat.length / 2);
          for (const p of hole) flat.push(p.x, p.y);
        }
        if (flat.length < 6) continue;
        const tris = earcut(flat, holeIdx.length ? holeIdx : null);
        if (tris.length === 0) continue;
        const base = satW.vtx;
        for (let vi = 0; vi < flat.length; vi += 2) {
          const [lx, lz] = toLocalW(flat[vi], flat[vi + 1]);
          satW.pos.push(lx, 0, lz);
          satW.uv.push(lx * inv, lz * inv);
        }
        satW.vtx += flat.length / 2;
        // MVT exteriors wind CW in y-down tile coords → flip to face up
        for (let t = 0; t < tris.length; t += 3) {
          satW.idx.push(base + tris[t], base + tris[t + 2], base + tris[t + 1]);
        }
      }
    }
  }

  const waterCoverage = waterLayer
    ? Math.min(1, Math.max(0, waterAreaTile / (waterLayer.extent * waterLayer.extent)))
    : 0;
  return { satW, waterCoverage };
}

function packWater(out, transfer, satW) {
  if (satW.idx.length > 0) {
    const pos = new Float32Array(satW.pos);
    const uv = new Float32Array(satW.uv);
    const idx = satW.vtx > 65535 ? new Uint32Array(satW.idx) : new Uint16Array(satW.idx);
    out.satWater = { pos, uv, idx };
    out.empty = false;
    transfer.push(pos.buffer, uv.buffer, idx.buffer);
  }
}

export { buildSatWater, packWater };

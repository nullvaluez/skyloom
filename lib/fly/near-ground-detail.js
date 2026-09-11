import { BufferAttribute, BufferGeometry, MeshDepthMaterial, MeshStandardMaterial, RGBADepthPacking, Vector2 } from 'three';
import { NEAR_GROUND } from './near-ground';

const WORLD = 2 * Math.PI * 6378137;
const CELL = 64;
export const DETAIL_UNIFORMS = { uGroundDetailK: { value: 0 }, uGroundDetailCenter: { value: new Vector2() }, uGroundDetailScale: { value: 1 } };
const hash = (x, z, salt = 0) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export function groundCell(gx, gz) {
  const cell = NEAR_GROUND.detail.cellWorldM;
  return { x: (gx + 0.18 + hash(gx, gz) * 0.64) * cell,
    z: (gz + 0.18 + hash(gx, gz, 319) * 0.64) * cell, seed: hash(gx, gz, 97), id: `${gx}:${gz}` };
}
export function triangleContains(t, x, z, pad = 0) {
  const [ax, az, bx, bz, cx, cz] = t;
  const det = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  if (Math.abs(det) < 1e-8) return false;
  const u = ((x - ax) * (cz - az) - (z - az) * (cx - ax)) / det;
  const v = ((bx - ax) * (z - az) - (bz - az) * (x - ax)) / det;
  if (u >= 0 && v >= 0 && u + v <= 1) return true;
  if (!pad) return false;
  for (const [px, pz, qx, qz] of [[ax, az, bx, bz], [bx, bz, cx, cz], [cx, cz, ax, az]]) {
    const dx = qx - px, dz = qz - pz;
    const s = Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / Math.max(1e-8, dx * dx + dz * dz)));
    if ((x - px - s * dx) ** 2 + (z - pz - s * dz) ** 2 <= pad * pad) return true;
  }
  return false;
}
function tileBounds(chunk) {
  const t = chunk.tile;
  if (!t || !Number.isFinite(t.z)) return null;
  const span = WORLD / 2 ** t.z;
  return [t.x * span - WORLD / 2, t.y * span - WORLD / 2, (t.x + 1) * span - WORLD / 2, (t.y + 1) * span - WORLD / 2];
}
const inBounds = (r, x, z) => x >= r[0] && z >= r[1] && x <= r[2] && z <= r[3];
const overlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
function insert(index, t, limit, pad = 0) {
  const loX = Math.max(limit[0], Math.min(t[0], t[2], t[4]) - pad), hiX = Math.min(limit[2], Math.max(t[0], t[2], t[4]) + pad);
  const loZ = Math.max(limit[1], Math.min(t[1], t[3], t[5]) - pad), hiZ = Math.min(limit[3], Math.max(t[1], t[3], t[5]) + pad);
  if (loX > hiX || loZ > hiZ) return;
  for (let x = Math.floor(loX / CELL); x <= Math.floor(hiX / CELL); x++) for (let z = Math.floor(loZ / CELL); z <= Math.floor(hiZ / CELL); z++) {
    const key = `${x}:${z}`, rows = index.get(key) ?? [];
    rows.push(t); index.set(key, rows);
  }
}
const at = (index, x, z) => index.get(`${Math.floor(x / CELL)}:${Math.floor(z / CELL)}`) ?? [];

/** Cancel shared triangulation edges: only the source polygon boundary remains. */
export function recordGroundEdges(edges, triangle) {
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    const a = [triangle[i * 2], triangle[i * 2 + 1]], b = [triangle[j * 2], triangle[j * 2 + 1]];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const forward = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const endpoints = forward ? [...a, ...b] : [...b, ...a], key = endpoints.join(':');
    const edge = edges.get(key);
    if (edge) edge.count++;
    else edges.set(key, { points: endpoints, count: 1 });
  }
}
function edgeDistance(edge, x, z) {
  const [ax, az, bx, bz] = edge, dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / Math.max(1e-8, dx * dx + dz * dz)));
  return Math.hypot(x - ax - t * dx, z - az - t * dz);
}
/** Entire oriented rectangle, sampled at <=1m spacing, including all corners. */
export function groundFootprintClear({ x, z, yaw, lengthM, widthM, mercatorK = 1 }, allowed) {
  const nx = Math.ceil(lengthM), nz = Math.ceil(widthM), c = Math.cos(yaw), s = Math.sin(yaw);
  for (let ix = 0; ix <= nx; ix++) for (let iz = 0; iz <= nz; iz++) {
    const lx = (ix / nx - 0.5) * lengthM * mercatorK, lz = (iz / nz - 0.5) * widthM * mercatorK;
    if (!allowed(x + c * lx + s * lz, z - s * lx + c * lz)) return false;
  }
  return true;
}

/** Resumable spatial build. Existing full road/water TRIANGLES are exclusions,
 * not ambient boat sample points or a residential-only centreline proxy. */
export function* buildGroundDetail({ veg, buildings, roads, x, z, mercatorK = 1, tier = 'medium' }) {
  const radius = NEAR_GROUND.detail.radiusM * mercatorK;
  const limit = [x - radius, z - radius, x + radius, z + radius];
  const land = new Map(), blocked = new Map(), roadWitness = new Map(), woodlandEdges = new Map(), edgeIndex = new Map(), buildingBounds = [], roadBounds = [];
  const columns = buildings?.queryColumns?.(x, z, radius + 80 * mercatorK) ?? [];
  if (!veg || !buildings || !roads) return [];
  let walked = 0;
  const triangles = function* (g, ox, oz, index, data, pad) {
    const pos = g?.pos, idx = g?.idx;
    if (!pos || !idx) return;
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      const cls = g.cls?.[a];
      if (!g.cls || cls === 2 || cls === 3 || cls === 5) {
        const t = [ox + pos[a * 3], oz + pos[a * 3 + 2], ox + pos[b * 3], oz + pos[b * 3 + 2], ox + pos[c * 3], oz + pos[c * 3 + 2], data, cls];
        insert(index, t, limit, pad);
        if (cls === 2) recordGroundEdges(woodlandEdges, t);
        if (g.roadCls?.[a] === 5 || g.roadCls?.[a] === 6) insert(roadWitness, t, limit, 14 * mercatorK);
      }
      if (++walked % 96 === 0) yield;
    }
  };
  const meshTriangles = function* (mesh, road = false) {
    if (!mesh?.geometry) return;
    const geometry = mesh.geometry, p = geometry.attributes.position?.array;
    const idx = geometry.index?.array;
    if (!p || !idx) return;
    yield* triangles({ pos: p, idx, roadCls: road ? geometry.attributes.aRoadCls?.array : null }, mesh.position.x, mesh.position.z, blocked, null, 3 * mercatorK);
  };
  for (const c of veg.nearest(x, z)) {
    if (!c.grid || !c.tint?.cls) continue;
    if (Number.isFinite(c.span) && !overlap([c.cx - c.span / 2, c.cz - c.span / 2, c.cx + c.span / 2, c.cz + c.span / 2], limit)) continue;
    yield* triangles(c.tint, c.cx, c.cz, land, c, 0);
  }
  for (const c of buildings.chunks?.values?.() ?? []) {
    const bounds = tileBounds(c);
    // Unknown/coarse coverage cannot promise a safe location. At medium tier,
    // water meshes may be absent: omit the entire wet tile conservatively.
    if (!bounds || !overlap(bounds, limit) || c.coarse || !['ready', 'empty'].includes(c.state) || !Number.isFinite(c.waterCoverage)) continue;
    if (c.waterCoverage > 0 && !c.water) continue;
    buildingBounds.push(bounds);
    yield* meshTriangles(c.water);
  }
  for (const c of roads.chunks?.values?.() ?? []) {
    const bounds = tileBounds(c);
    if (!bounds || !overlap(bounds, limit) || c.coarse || !['ready', 'empty'].includes(c.state)) continue;
    roadBounds.push(bounds);
    yield* meshTriangles(c.mesh, true);
  }
  for (const edge of woodlandEdges.values()) {
    if (++walked % 96 === 0) yield;
    const [ax, az, bx, bz] = edge.points;
    if (edge.count !== 1 || Math.hypot(bx - ax, bz - az) < 8 * mercatorK) continue;
    insert(edgeIndex, [ax, az, bx, bz, bx, bz, edge.points], limit, 6 * mercatorK);
  }
  const allowedAt = (px, pz, cls, h) => {
    if (!buildingBounds.some((b) => inBounds(b, px, pz)) || !roadBounds.some((b) => inBounds(b, px, pz))) return false;
    const t = at(land, px, pz).find((row) => row[7] === cls && triangleContains(row, px, pz));
    if (!t || at(blocked, px, pz).some((row) => triangleContains(row, px, pz, 3 * mercatorK))) return false;
    if (columns.some((c) => (px - c.x) ** 2 + (pz - c.z) ** 2 < (c.r + 4 * mercatorK) ** 2)) return false;
    const height = veg.groundAtLocal(t[6], px - t[6].cx, pz - t[6].cz);
    return Number.isFinite(height) && Math.abs(height - h) <= 0.3;
  };
  const rows = [], cell = NEAR_GROUND.detail.cellWorldM;
  const density = NEAR_GROUND.detail.tiers[tier] ?? NEAR_GROUND.detail.tiers.medium;
  for (let gx = Math.floor(limit[0] / cell); gx <= Math.floor(limit[2] / cell); gx++) for (let gz = Math.floor(limit[1] / cell); gz <= Math.floor(limit[3] / cell); gz++) {
    // Rejected candidates count too: a dense urban exclusion pass must yield
    // even when every candidate is covered by a building and none is placed.
    if (++walked % 24 === 0) yield;
    const p = groundCell(gx, gz);
    // In Mercator a world-unit lattice gets denser at higher latitudes. Thin
    // deterministic ranks, not spacing, so crossing latitude cannot slide it.
    if (p.seed > density / (mercatorK * mercatorK) || (p.x - x) ** 2 + (p.z - z) ** 2 > radius * radius) continue;
    if (!buildingBounds.some((b) => inBounds(b, p.x, p.z)) || !roadBounds.some((b) => inBounds(b, p.x, p.z))) continue;
    const triangle = at(land, p.x, p.z).find((t) => triangleContains(t, p.x, p.z));
    if (!triangle || at(blocked, p.x, p.z).some((t) => triangleContains(t, p.x, p.z, 3 * mercatorK))) continue;
    if (columns.some((c) => (p.x - c.x) ** 2 + (p.z - c.z) ** 2 < (c.r + 4 * mercatorK) ** 2)) continue;
    const chunk = triangle[6], h = veg.groundAtLocal(chunk, p.x - chunk.cx, p.z - chunk.cz);
    if (!Number.isFinite(h)) continue;
    const hX = veg.groundAtLocal(chunk, p.x - chunk.cx + 2 * mercatorK, p.z - chunk.cz);
    const hZ = veg.groundAtLocal(chunk, p.x - chunk.cx, p.z - chunk.cz + 2 * mercatorK);
    if (Math.abs(hX - h) > 1.2 || Math.abs(hZ - h) > 1.2) continue;
    const cls = triangle[7], variation = hash(gx, gz, 915);
    const grass = cls === 3 || cls === 5;
    const height = grass ? (cls === 5 ? 0.18 : 0.28) + variation * 0.3 : 0.65 + 0.75 * variation;
    const row = { ...p, y: h - 0.05, cls, kind: grass ? 'grass' : 'scrub', height,
      widthM: grass ? 0.25 + variation * 0.3 : height * 1.3,
      depthM: grass ? 0.19 + variation * 0.2 : height, yaw: p.seed * Math.PI * 2 };
    // Short hedge-like woodland margins require TWO witnesses: an actual
    // exterior wood boundary and a mapped minor road. Never infer hedges from
    // farmland, park labels, the lattice itself or interior triangle seams.
    if (cls === 2 && at(roadWitness, p.x, p.z).some((t) => triangleContains(t, p.x, p.z, 14 * mercatorK))) {
      const boundary = at(edgeIndex, p.x, p.z).map((e) => e[6]).find((e) => {
        const d = edgeDistance(e, p.x, p.z) / mercatorK;
        return d >= 1.1 && d <= 6;
      });
      if (boundary) {
        const yaw = -Math.atan2(boundary[3] - boundary[1], boundary[2] - boundary[0]);
        const footprint = { x: p.x, z: p.z, yaw, lengthM: 4.5, widthM: 1.25, mercatorK };
        if (groundFootprintClear(footprint, (px, pz) => allowedAt(px, pz, 2, h))) Object.assign(row, {
          kind: 'hedge', widthM: footprint.lengthM, depthM: footprint.widthM, height: 0.9 + variation * 0.4, yaw,
        });
      }
    }
    rows.push(row);
  }
  // Stable hash order, never nearest-first; an over-cap view cannot reshape
  // the near field as it moves. The fixed cap bounds both color and shadow tris.
  rows.sort((a, b) => a.seed - b.seed);
  return rows.slice(0, NEAR_GROUND.detail.pool);
}

/** Rounded opaque scrub: 18 triangles, no alpha-card edge shimmer. */
export function buildGroundScrubGeometry() {
  const pos = [], colors = [], idx = [];
  for (let ring = 0; ring < 2; ring++) for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2, r = ring ? 0.5 : 0.32;
    pos.push(Math.cos(a) * r, ring ? 0.52 : 0, Math.sin(a) * r);
    const shade = ring ? 0.88 : 0.54; colors.push(shade, shade, shade);
  }
  pos.push(0.07, 1, -0.02); colors.push(1, 1, 1);
  for (let i = 0; i < 6; i++) {
    const n = (i + 1) % 6;
    idx.push(i, i + 6, n + 6, i, n + 6, n, i + 6, 12, n + 6);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(idx); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}
export function createGroundScrubMaterial(bend, depth = false) {
  const material = depth ? new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
    : new MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0, envMapIntensity: 0.25 });
  bend(material);
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    Object.assign(shader.uniforms, DETAIL_UNIFORMS);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
uniform float uGroundDetailK;
uniform vec2 uGroundDetailCenter;
uniform float uGroundDetailScale;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec4 gdAnchor = vec4(0.0, 0.0, 0.0, 1.0);
#ifdef USE_INSTANCING
gdAnchor = instanceMatrix * gdAnchor;
#endif
gdAnchor = modelMatrix * gdAnchor;
float gdDistance = distance(gdAnchor.xz, uGroundDetailCenter) / uGroundDetailScale;
float gdFade = uGroundDetailK * (1.0 - smoothstep(130.0, 205.0, gdDistance));
transformed *= gdFade;`);
  };
  material.customProgramCacheKey = () => `${key}-ground-scrub-v1${depth ? '-depth' : ''}`;
  return material;
}

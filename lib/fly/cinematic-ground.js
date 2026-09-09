import {
  BufferAttribute, BufferGeometry, Color, DataTexture, InstancedBufferAttribute,
  MeshDepthMaterial, MeshStandardMaterial, RGBAFormat, RGBADepthPacking,
  LinearFilter, SRGBColorSpace,
} from 'three';

// First-party procedural assets. No downloaded textures and no per-frame geometry.
export const GROUND_VISUAL_UNIFORMS = { treeTime: { value: 0 } };
export const CINEMATIC_TREE_TRIANGLES = 58;
export const HOME_ATLAS_VARIANTS = 8;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export function groundHash(seed) {
  const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** Four related silhouettes share one geometry/draw; classification never adds trees. */
export function canopyForm(seed, conifer = false) {
  const type = conifer ? 3 : Math.floor(groundHash(seed) * 3);
  return [
    { width: 1.06, depth: 0.89, height: 0.94 },
    { width: 0.79, depth: 0.9, height: 1.18 },
    { width: 1, depth: 1.12, height: 1.02 },
    { width: 0.84, depth: 0.9, height: 1.13 },
  ][type];
}

/** Eight crown spokes instead of six, still exactly the legacy 58 triangles. */
export function buildCinematicTreeGeometry(pool = 1) {
  const pos = [], col = [], idx = [];
  const push = (x, y, z, c) => { pos.push(x, y, z); col.push(...c); return pos.length / 3 - 1; };
  const W = 8, H = 4;
  for (let h = 0; h <= H; h++) {
    const phi = h / H * Math.PI, v = Math.cos(phi), r = Math.sin(phi);
    for (let w = 0; w <= W; w++) {
      const a = w / W * Math.PI * 2;
      const lobes = 1 + 0.075 * Math.cos(a * 3) * r;
      const shade = 0.78 + 0.3 * (v + 1) / 2;
      push(Math.cos(a) * r * lobes, 0.67 + v * 0.33, Math.sin(a) * r * lobes, [shade, shade, shade]);
    }
  }
  for (let h = 0; h < H; h++) for (let w = 0; w < W; w++) {
    const a = h * (W + 1) + w, b = a + 1, d = a + W + 1, c = d + 1;
    if (h !== 0) idx.push(a, b, c);
    if (h !== H - 1) idx.push(a, c, d);
  }
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2, b = (i + 1) / 5 * Math.PI * 2;
    const x0 = Math.cos(a) * 0.065, z0 = Math.sin(a) * 0.065;
    const x1 = Math.cos(b) * 0.065, z1 = Math.sin(b) * 0.065;
    const p = push(x0, 0, z0, [0.5, 0.36, 0.26]);
    const q = push(x1, 0, z1, [0.5, 0.36, 0.26]);
    const r = push(x1, 0.53, z1, [0.86, 0.62, 0.44]);
    const s = push(x0, 0.53, z0, [0.86, 0.62, 0.44]);
    idx.push(p, s, r, p, r, q);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('aCanopyPhase', new InstancedBufferAttribute(new Float32Array(pool), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Match the smooth crown seam normals; UV duplicates would otherwise leave a hard seam.
  const normals = g.getAttribute('normal');
  for (let h = 0; h <= H; h++) {
    const a = h * (W + 1), b = a + W;
    const x = normals.getX(a) + normals.getX(b), y = normals.getY(a) + normals.getY(b), z = normals.getZ(a) + normals.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    normals.setXYZ(a, x / l, y / l, z / l); normals.setXYZ(b, x / l, y / l, z / l);
  }
  return g;
}

export function createCinematicTreeMaterial(bend, { depth = false } = {}) {
  const m = depth
    ? new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
    : new MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, envMapIntensity: 0.4 });
  bend(m);
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uCanopyTime = GROUND_VISUAL_UNIFORMS.treeTime;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aCanopyPhase;\nuniform float uCanopyTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
float leafK = smoothstep(0.4, 1.0, position.y);
transformed.x += sin(uCanopyTime * 0.72 + aCanopyPhase) * leafK * 0.013;
transformed.z += cos(uCanopyTime * 0.53 + aCanopyPhase * 1.37) * leafK * 0.009;`);
  };
  m.customProgramCacheKey = () => `${key}-cinematic-canopy-v1${depth ? '-depth' : ''}`;
  return m;
}

/** Eight occupancy patterns and three related interior temperatures, including a dark home. */
export function homeWindowCell(variant, row, column) {
  const v = Math.floor(clamp(variant, 0, 7));
  const lit = v !== 7 && groundHash(v * 193 + row * 47 + column * 17) > 0.32 + v * 0.025;
  return { lit, color: ['#ffd9a6', '#ffe8c4', '#d8e4ef'][v % 3] };
}

export function buildCinematicHomeAtlas() {
  const W = 512, H = 64, data = new Uint8Array(W * H * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const paint = (x0, y0, w, h, color) => {
    const c = new Color(color).convertLinearToSRGB();
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const j = (y * W + x) * 4;
      data[j] = Math.round(c.r * 255); data[j + 1] = Math.round(c.g * 255); data[j + 2] = Math.round(c.b * 255);
    }
  };
  for (let v = 0; v < HOME_ATLAS_VARIANTS; v++) {
    for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) {
      const cell = homeWindowCell(v, r, c);
      if (cell.lit) paint(v * 64 + 3 + c * 6, 13 + r * 26, 3, 12, cell.color);
    }
    // Small front door glass; all roofs occupy the black right half of each cell.
    if (v !== 7) paint(v * 64 + 16, 2, 3, 9, '#ffe5bd');
  }
  const t = new DataTexture(data, W, H, RGBAFormat);
  t.colorSpace = SRGBColorSpace; t.minFilter = LinearFilter; t.magFilter = LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function createCinematicHomeMaterial(bend) {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0,
    envMapIntensity: 0.45, emissive: 0xffffff, emissiveIntensity: 0, emissiveMap: buildCinematicHomeAtlas() });
  bend(m);
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aHomeVariant;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvEmissiveMapUv.x = (vEmissiveMapUv.x + aHomeVariant) / 8.0;');
  };
  m.customProgramCacheKey = () => `${key}-cinematic-parcel-v1`;
  return m;
}

/** Stable inferred appearance, never a replacement for mapped geometry or use.
 * Pure data/functions shared by both worker LODs and the material factory.
 */
export const BUILDING_PROFILES = [
  { name: 'house', walls: ['#c6bba4', '#b6b6ae', '#a98471', '#d5cdc0'], roofs: ['#514e48', '#685146', '#727272', '#746154'], pitch: 3.6, floor: 3.0, window: [0.36, 0.48], roughness: 0.88, occupancy: 0.55, warmth: 0.92 },
  { name: 'apartment', walls: ['#bcb9ad', '#a79b8b', '#b49c88', '#c6c4bc'], roofs: ['#666864', '#7e807b', '#585c5a', '#8c8980'], pitch: 3.1, floor: 3.1, window: [0.47, 0.58], roughness: 0.79, occupancy: 0.62, warmth: 0.76 },
  { name: 'masonry', walls: ['#ad8271', '#c1ae92', '#928b83', '#b09c88'], roofs: ['#555958', '#6c6b66', '#666c70', '#817566'], pitch: 3.0, floor: 3.6, window: [0.42, 0.66], roughness: 0.94, occupancy: 0.46, warmth: 0.64 },
  { name: 'concrete', walls: ['#bdb7a9', '#aaa9a4', '#c6beb0', '#929592'], roofs: ['#85877f', '#777b79', '#9d9b90', '#686e68'], pitch: 2.8, floor: 3.8, window: [0.66, 0.58], roughness: 0.73, occupancy: 0.40, warmth: 0.28 },
  { name: 'glass', walls: ['#b0aea7', '#a78f72', '#696c6b', '#8a9b9f'], roofs: ['#8a8b84', '#867866', '#5f6463', '#76868a'], pitch: 2.2, floor: 3.8, window: [0.88, 0.82], roughness: 0.23, occupancy: 0.51, warmth: 0.14 },
  { name: 'industrial', walls: ['#b3b7b0', '#adac9c', '#919c9e', '#b9b0a2'], roofs: ['#8d9291', '#afb0a3', '#737b7d', '#98918b'], pitch: 5.4, floor: 5.0, window: [0.66, 0.24], roughness: 0.84, occupancy: 0.17, warmth: 0.37 },
];
const INFERRED_TOWER_FAMILIES = [3, 2, 3, 1, 3, 4, 2, 1];

export function buildingHash(id) {
  let n = Number(id) >>> 0;
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}

/** Classification uses the same source facts at every LOD, never display height. */
export function buildingClassificationHeight(rawHeight, areaM2 = 100, id = 0) {
  const height = Number(rawHeight);
  if (Number.isFinite(height) && height > 0) return height;
  return areaM2 < 440 ? 7 + buildingHash(id) % 4 : areaM2 > 2000 ? 12 : 18;
}

/** Area is TRUE square metres. Tile density is features per true km². */
export function inferBuildingStyle({ id = 0, height = 10, areaM2 = 100, aspect = 1, density = 0, landuse = '', tags = '' } = {}) {
  const hash = buildingHash(id);
  const tag = String(tags).toLowerCase();
  let family;
  // Source hints precede regional/size guesses: a tagged residential tower must
  // not become a glass office just because it is tall or shares a commercial tile.
  if (/industrial|warehouse|hangar|manufactur/.test(tag)) family = 5;
  else if (/house|detached|bungalow|cabin/.test(tag)) family = 0;
  else if (/apart|residen|dorm|hotel/.test(tag)) family = 1;
  else if (/glass|curtain.?wall/.test(tag)) family = 4;
  else if (/masonry|brick|limestone|sandstone|stone/.test(tag)) family = 2;
  else if (/concrete|office|commercial/.test(tag)) family = 3;
  else if (height < 24 && (landuse === 'industrial' || areaM2 > 2000 || (aspect > 3.2 && areaM2 > 600))) family = 5;
  else if (height <= 12 && areaM2 < 440) family = 0;
  else if (landuse === 'residential' && areaM2 < 2200) family = 1;
  // Height establishes a tower, not its cladding. Stone-clad, residential and
  // concrete towers remain common; curtain walls are one of several treatments.
  // Upper hash bits keep family choice independent of the existing palette seed.
  else if (height >= 48) family = INFERRED_TOWER_FAMILIES[(hash >>> 16) & 7];
  else if (height >= 32) family = 3;
  else if (height >= 13 && height < 32 && (density > 400 || areaM2 < 700)) family = hash % 3 === 0 ? 1 : 2;
  else family = areaM2 > 1100 ? 5 : 2;
  const variant = (hash >>> 8) & 3;
  const seed = hash & 255;
  return { family, variant, seed, ...BUILDING_PROFILES[family] };
}

export function architecturalColor(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >>> 16, (n >>> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
}

/** Uniform facade metre periods retained across the worker/material contract. */
export const ARCHITECTURE_UV_PERIOD = [26.4, 27.2];

/** Explicit wall sentinel avoids filtering/UV-dependent lights on roofs. */
export function buildingStyleVertex(style, wall = false) {
  return [style.family, style.seed, wall ? 1 : 0];
}

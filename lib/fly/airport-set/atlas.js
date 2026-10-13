// The set's legend atlas: every word painted or lit on the airport set (gate
// numbers, VDGS type boards, stand numbers on the apron, hangar names,
// taxiway guidance legends) in ONE single-channel mask texture. Surfaces
// colour it themselves (SURF.SIGN boards mix a board and a legend colour by
// GLOW id; decals tint it with their paint), so one atlas serves every colour
// scheme. 2048 x 1024 R8 + mips = 2.7 MiB.
//
// The layout is pure and deterministic (cells are sized from character
// counts and each entry's intended aspect), so geometry can be built - and
// gated in node - before any canvas exists. Drawing fits the text into its
// cell with fillText's maxWidth.
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RedFormat, UnsignedByteType } from 'three';

export const ATLAS_W = 2048;
export const ATLAS_H = 1024;
const ROW = 128;

/**
 * Collect every legend the plan needs. `aspect` = width / height of the quad
 * the legend is drawn on, so the cell has the same shape and nothing smears.
 */
export function atlasEntries(plan) {
  const out = [];
  const add = (key, text, aspect, style = 'sign') => { if (!out.some((e) => e.key === key)) out.push({ key, text, aspect, style }); };
  for (const s of plan.stands) {
    add(`${plan.gateLetter}${s.number}`, `${plan.gateLetter}${s.number}`, 2.4, 'sign');
    add(`stand:${s.number}`, String(s.number), 1.25, 'paint');
  }
  for (const t of ['A320', 'B777', 'E175']) add(t, t, 2.8, 'display');
  for (const h of plan.hangars) add(`HANGAR ${h.number}`, `HANGAR ${h.number}`, 6.5, 'sign');
  for (const g of plan.signs) {
    add(g.taxiway, g.taxiway, 1.45, 'sign');
    add(g.runway, g.runway, 3.25, 'sign');
    add(g.direction, g.direction, 2.35, 'sign');
  }
  return out;
}

/** Pack entries into rows; returns { entries, rect(key) } with GL uvs (v up). */
export function planAtlas(entries) {
  const cells = new Map();
  let x = 0, row = 0;
  for (const e of entries) {
    const w = Math.min(ATLAS_W, Math.ceil(ROW * e.aspect));
    if (x + w > ATLAS_W) { x = 0; row++; }
    if ((row + 1) * ROW > ATLAS_H) break; // full: later legends render blank boards
    cells.set(e.key, { ...e, px: x, py: row * ROW, pw: w, ph: ROW });
    x += w + 4;
  }
  return {
    entries: [...cells.values()],
    rect(key) {
      const c = cells.get(key);
      if (!c) return null;
      // CanvasTexture-style flipY: canvas row py maps to v = 1 - py / H.
      const pad = 2;
      return {
        u0: (c.px + pad) / ATLAS_W, u1: (c.px + c.pw - pad) / ATLAS_W,
        v0: 1 - (c.py + c.ph - pad) / ATLAS_H, v1: 1 - (c.py + pad) / ATLAS_H,
      };
    },
  };
}

/**
 * Draw the atlas (browser only) and return an R8 DataTexture. White legend on
 * black; flipY matches rect().
 */
export function drawAtlas(layout) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = ATLAS_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const c of layout.entries) {
    const cx = c.px + c.pw / 2, cy = c.py + c.ph / 2 + 4;
    if (c.style === 'paint') {
      // Painted stand numbers: tall condensed numerals.
      ctx.font = `800 ${Math.round(c.ph * 0.9)}px "Arial Narrow", "Roboto Condensed", Arial, sans-serif`;
      ctx.fillText(c.text, cx, cy, c.pw * 0.9);
    } else if (c.style === 'display') {
      // LED board: dotted-matrix feel via a bold mono face.
      ctx.font = `700 ${Math.round(c.ph * 0.62)}px "Consolas", "Courier New", monospace`;
      ctx.fillText(c.text, cx, cy, c.pw * 0.9);
    } else {
      ctx.font = `700 ${Math.round(c.ph * 0.68)}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(c.text, cx, cy, c.pw * 0.86);
    }
  }
  const rgba = ctx.getImageData(0, 0, ATLAS_W, ATLAS_H).data;
  const mask = new Uint8Array(ATLAS_W * ATLAS_H);
  // Flip rows here (DataTexture has no flipY for R8 uploads in WebGL2).
  for (let y = 0; y < ATLAS_H; y++) {
    const src = (ATLAS_H - 1 - y) * ATLAS_W * 4, dst = y * ATLAS_W;
    for (let x = 0; x < ATLAS_W; x++) mask[dst + x] = rgba[src + x * 4];
  }
  const tex = new DataTexture(mask, ATLAS_W, ATLAS_H, RedFormat, UnsignedByteType);
  tex.generateMipmaps = true;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.anisotropy = 4;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  tex.name = 'airport-set-atlas';
  return tex;
}

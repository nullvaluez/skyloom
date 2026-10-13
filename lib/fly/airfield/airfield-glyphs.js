// AIRFIELD GLYPHS — the runway designator atlas (0-9, L, R, C).
//
// Runway numbers are tall, narrow, uniform-stroke figures (FAA: 60 x 20 ft,
// ICAO: 9 x 3 m). A bold condensed sans stretched into a 1:3 cell reads the
// same from a lounge, so the atlas is drawn once with Canvas 2D from the first
// installed face in a short list and mip-mapped with anisotropy; the runway
// shader samples it in runway metres (airfield-materials.js rGlyph()).
//
// Layout: 8 x 2 cells of 128 x 256 px (1024 x 512), glyph art in the middle
// 96 x 224 px of each cell so mips never bleed between neighbours. Cell g sits
// at column g % 8, row floor(g / 8), row 0 at the BOTTOM (texture v = 0).
import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, LinearMipmapLinearFilter, NoColorSpace } from 'three';

export const GLYPH_INDEX = Object.freeze({ 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, L: 10, R: 11, C: 12 });
const FONT = '"Bahnschrift SemiBold Condensed", "Bahnschrift", "DIN Condensed", "DIN Alternate", "Roboto Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';

/** Glyph indices for one designator: [tens or -1, ones, letter or -1]. */
export function designatorGlyphs(des, style) {
  if (!des) return [-1, -1, -1];
  const tens = Math.floor(des.num / 10);
  const ones = des.num % 10;
  // FAA paints "4L" for runway 04L; ICAO keeps the leading zero.
  const first = tens === 0 && style === 'faa' ? -1 : tens;
  const letter = des.side ? GLYPH_INDEX[des.side] : -1;
  return [first, ones, letter ?? -1];
}

export function createGlyphAtlas(anisotropy = 8) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `700 200px ${FONT}`;
  for (const [ch, g] of Object.entries(GLYPH_INDEX)) {
    const col = g % 8;
    const row = Math.floor(g / 8);
    const cx = col * 128 + 16;
    const cy = (1 - row) * 256 + 16; // row 0 drawn in the lower half (flipY)
    const m = ctx.measureText(ch);
    const left = m.actualBoundingBoxLeft ?? 0;
    const right = m.actualBoundingBoxRight ?? m.width;
    const asc = m.actualBoundingBoxAscent ?? 150;
    const desc = m.actualBoundingBoxDescent ?? 0;
    const gw = Math.max(1, left + right);
    const gh = Math.max(1, asc + desc);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(96 / gw, 224 / gh);
    ctx.fillText(ch, left, asc);
    ctx.restore();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = NoColorSpace;
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  tex.name = 'airfield-runway-glyphs';
  return tex;
}

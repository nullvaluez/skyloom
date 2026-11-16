/**
 * World Pass W0 (worker split): every per-vertex COLOUR decision the worker
 * makes for satellite buildings. Stream D (LOOK) owns this file; the roof
 * colour sampled from the Esri photo and the wall material by tag / typology /
 * region land here behind the look stream's request (tileCtx.worldPass.look).
 *
 *   colourOf(item, style, tileCtx, 'near', hash2)
 *       -> { wall, wallBase, wallTop, roofCol, parapetCol }   (sat-buildings/index.js)
 *   colourOf(item, style, tileCtx, 'far')
 *       -> { wall, roof }                                     (sat-skyline.js)
 *   buildingTones()   the ROOFS_SAT tone resolver (R18 re-tune or the legacy arrays)
 *   clutterTones()    the per-tile roof clutter / treatment tones
 *
 * `style` is typology.js architectureStyle() in Enhanced (`visuals`), else null.
 * Moved VERBATIM from vector-tile.worker.js (c2bf5c06): same expressions,
 * same order. The far roof used to be resolved per polygon inside the
 * extrusion loop; architecturalColor is pure, so resolving it once per
 * building gives the same numbers.
 */
import { architecturalColor } from '../../../building-profiles';
import { ROOFS_SAT, SAT_BUILDINGS, SAT_SKYLINE } from '../../../fly-constants';
import { hexToRGB, pickByHash } from '../../toy-palette';
import { clamp01Range } from './height';
import { prepareRoofLook } from '../photo-sampler';
import { architectureContext, architectureStyle } from './typology';
import { seamId } from './structures';
import { architectureRegion } from '../../../living-regions';

/**
 * Round 18 tone resolver. The re-tune rides the SAME flag as the geometry so
 * ROOFS_SAT.enabled:false restores pre-R18 PIXELS, not just pre-R18 shapes.
 * The legacy arrays are frozen historical data in ROOFS_SAT.legacyTone —
 * duplicated on purpose so the revert never depends on retyping a comment.
 */
function buildingTones() {
  const S = SAT_BUILDINGS;
  const RS = ROOFS_SAT;
  return RS.enabled
    ? { wallTones: S.wallTones, wallBaseMul: S.wallBaseMul, roofMid: S.roofTones.mid, roofTall: S.roofTones.tall }
    : {
        wallTones: RS.legacyTone.wallTones,
        wallBaseMul: RS.legacyTone.wallBaseMul,
        roofMid: RS.legacyTone.roofMid,
        roofTall: RS.legacyTone.roofTall,
      };
}

/**
 * Round 18 clutter/treatment tones (constant per chunk — hoisted out of the
 * per-building loop). All plain daylight materials: brick, timber, painted
 * steel, galvanized. Nothing here is ever emissive.
 */
function clutterTones() {
  const S = SAT_BUILDINGS;
  const RS = ROOFS_SAT;
  const hvacCol = hexToRGB(S.hvacTone).map((c) => c * S.hvacGain); // galvanized clutter
  const chimneyCol = hexToRGB(RS.small.chimney.tone);
  const tankCol = hexToRGB(RS.mid.tankTone);
  const penthouseCol = hexToRGB(RS.mid.penthouse.tone);
  const mastCol = hexToRGB(RS.tall.antenna.tone);
  const spireCol = hexToRGB(RS.super.spire.tone);
  const spireTipCol = hexToRGB(RS.super.spire.tipTone);
  return { hvacCol, chimneyCol, tankCol, penthouseCol, mastCol, spireCol, spireTipCol };
}

// ± jitter so two neighbours that hash to the SAME palette entry still differ.
const jit = (amt, h) => 1 + (h - 0.5) * 2 * amt;

function nearColour(item, style, hash2) {
  const S = SAT_BUILDINGS;
  const TONE = buildingTones();
  const RT = S.roofTones;
  const clamp = clamp01Range;
  const wall = style ? architecturalColor(style.walls[style.variant]) : hexToRGB(pickByHash(TONE.wallTones, item.id)).map((c) => c * jit(S.wallJitter, hash2));
  // Fake AO, zero extra verts: bottom ring dark (ground grime), top ring lifted
  // (sky bounce). Towers ease toward the weak end — a full-height ramp on a
  // 200m box reads as a gradient, not as contact shading.
  const aoT = clamp(item.h / S.wallBaseRefM, 0, 1);
  const baseMul = TONE.wallBaseMul[0] + (TONE.wallBaseMul[1] - TONE.wallBaseMul[0]) * aoT;
  const wallBase = wall.map((c) => c * baseMul);
  const wallTop = wall.map((c) => c * S.wallTopGain);
  // Roofs own their palette (own hash seed → decorrelated from the wall pick),
  // banded by height: houses = shingle/terracotta, mid = tar/gravel, tall = membrane.
  // Round 19: a typology-inferred building picks its roof palette by BAND
  // HINT, not by height. Every typology band now lands 6-14 m, i.e. under
  // roofTones.lowMaxH (16) — so without this a big-box store and a
  // warehouse would both wear the HOUSE palette and the suburb would grow
  // terracotta Walmarts. The palettes themselves are R15/R18 checkpointed
  // values and are untouched; only the selection moves, and only for
  // buildings whose height this round invented.
  const tyRoof = item.typo?.roofBand;
  const band =
    tyRoof === 'mid'
      ? TONE.roofMid
      : item.h <= RT.lowMaxH
        ? RT.low
        : item.h >= RT.tallMinH
          ? TONE.roofTall
          : TONE.roofMid;
  const roofCol = style ? architecturalColor(style.roofs[style.variant]) : hexToRGB(pickByHash(band, (item.id ^ 0x5bf03635) >>> 0)).map(
    (c) => c * jit(S.roofJitter, item.hash)
  );
  const parapetCol = roofCol.map((c) => c * S.parapetGain); // the lip catches sun
  return { wall, wallBase, wallTop, roofCol, parapetCol };
}

function farColour(item, style, tileCtx) {
  const SK = SAT_SKYLINE;
  const S = SAT_BUILDINGS;
  const frame = tileCtx;
  const haze = hexToRGB(SK.hazeColor);
  // SHIP PASS CITY (CT-1): `premix: false` (the skylinePremix: 0 diagnosis
  // pin) skips the baked haze. Only the Classic (non-`visuals`) colour is
  // premixed at all: the Enhanced palette below never was.
  const wall = style ? architecturalColor(style.walls[style.variant]) : frame.premix === false ? hexToRGB(pickByHash(S.wallTones, item.id)) : hexToRGB(pickByHash(S.wallTones, item.id)).map(
    (c, i) => c + (haze[i] - c) * SK.hazeMix
  );
  const roof = style ? architecturalColor(style.roofs[style.variant]) : wall;
  return { wall, roof };
}

/**
 * @param item    the building (near: after heightOf, so item.h / item.hash / item.typo are set)
 * @param style   typology.js architectureStyle() result, or null
 * @param tileCtx the build's context (worker/tile-ctx.js)
 * @param ring    'near' | 'far'
 * @param hash2   near only: the building's second hash (wall jitter)
 */
function colourOf(item, style, tileCtx, ring, hash2) {
  if (ring === 'far') {
    // World Pass D: a far body cut by a tile seam takes the same look id as its near twin.
    const lookOn = !!(style && tileCtx && tileCtx.worldPass && tileCtx.worldPass.look.on && tileCtx.visuals === true);
    if (lookOn && tileCtx.worldPass.look.structures) lookFarStyle(item, style, tileCtx);
    const far = farColour(item, style, tileCtx);
    return lookOn && tileCtx.worldPass.look.walls ? lookFar(item, style, tileCtx, far) : far;
  }
  // World Pass D: a structure's parts (and both halves of a seam building)
  // share one look: the style is re-derived from the root under the shared
  // look id BEFORE any colour is read from it. `style` is the object the caller
  // goes on to write into the vertices, so family and seed follow too.
  if (tileCtx && tileCtx.look && style && tileCtx.look.lookOf) lookStyle(item, style, tileCtx);
  const base = nearColour(item, style, hash2);
  // World Pass D (LOOK): tileCtx.look exists only while the look stream is on
  // in the request (structures.js), so the flag-off build returns `base` as is.
  return tileCtx && tileCtx.look && style ? lookNear(item, style, tileCtx, base) : base;
}

function restyle(style, root, id, tileCtx) {
  if (!tileCtx.lookArch) tileCtx.lookArch = architectureContext(tileCtx.vt, tileCtx);
  Object.assign(style, architectureStyle({ ...root, id }, tileCtx.lookArch, tileCtx.extent, tileCtx.kA));
}

function lookStyle(item, style, tileCtx) {
  const lo = tileCtx.look.lookOf(item);
  if (lo && (lo.rootItem !== item || lo.root !== item || lo.id !== item.id)) restyle(style, lo.root, lo.id, tileCtx);
}

function lookFarStyle(item, style, tileCtx) {
  if (!tileCtx.extent || !item.polys) return;
  const id = item.sid ?? seamId(item, tileCtx);
  if (id != null && id !== item.id) restyle(style, item, id, tileCtx);
}

/** The per-tile look prep, once, on the first near call (every item.h is known by then). */
function lookPrep(tileCtx) {
  const L = tileCtx.look;
  if (!L.prep) {
    const roofs = tileCtx.worldPass.look.roofPhoto ? prepareRoofLook(tileCtx, L.items, L.photo, L.structOf) : null;
    L.prep = { roofs };
    if (tileCtx.stages && roofs) tileCtx.stages.look = { roof: roofs.stats };
    L.stats = roofs ? roofs.stats : null;
  }
  return L.prep;
}

/**
 * World Pass D: the near colours with the look stream's evidence. M1: the roof
 * takes the photo read (own pixels, structure mates, block median); without
 * one it keeps the typology palette roof `base` already chose.
 */
function lookNear(item, style, tileCtx, base) {
  const prep = lookPrep(tileCtx);
  const S = SAT_BUILDINGS;
  let { wall, wallBase, wallTop, roofCol, parapetCol } = base;
  const r = prep.roofs ? prep.roofs.roofOf(item) : null;
  if (r) {
    roofCol = r.rgb.slice();
    parapetCol = roofCol.map((c) => c * S.parapetGain);
  }
  const WP = tileCtx.worldPass.look;
  if (WP.walls) {
    const lo = tileCtx.look.lookOf ? tileCtx.look.lookOf(item) : null;
    const w = lookWall(lo ? lo.rootItem : item, style, lo ? lo.id : item.sid ?? item.id, tileCtx);
    // The same fake AO the legacy colour bakes (dark base, lifted roofline).
    const TONE = buildingTones();
    const aoT = clamp01Range(item.h / S.wallBaseRefM, 0, 1);
    const baseMul = TONE.wallBaseMul[0] + (TONE.wallBaseMul[1] - TONE.wallBaseMul[0]) * aoT;
    wall = w.rgb;
    wallBase = wall.map((c) => c * baseMul);
    wallTop = wall.map((c) => c * S.wallTopGain);
    if (WP.authority && w.mode) {
      const off = w.mode === 1 ? GLASS_OFFSET : OPAQUE_OFFSET;
      wallBase[0] += off;
      wallTop[0] += off;
    }
    if (tileCtx.stages) {
      const st = (tileCtx.stages.look ??= {});
      st.walls ??= { tagGlass: 0, tagOpaque: 0, region: 0, key: wallContext(tileCtx).key };
      st.walls[w.mode === 1 ? 'tagGlass' : w.mode === 2 ? 'tagOpaque' : 'region'] += 1;
    }
  }
  return { wall, wallBase, wallTop, roofCol, parapetCol };
}

/** World Pass D: the far ring's wall from the same rule as the near ring (no photo there). */
function lookFar(item, style, tileCtx, far) {
  const id = item.sid ?? (tileCtx.extent && item.polys ? seamId(item, tileCtx) : null) ?? item.id;
  const w = lookWall(item, style, id, tileCtx);
  const wall = w.rgb.slice();
  if (tileCtx.worldPass.look.authority && w.mode) wall[0] += w.mode === 1 ? GLASS_OFFSET : OPAQUE_OFFSET;
  return { wall, roof: far.roof };
}

// --- World Pass D (LOOK, M3 walls): the wall material of a building -------------
//
// The colour tag is a WALL material fact (critique-realism 1.3: OpenMapTiles
// writes building:material as a colour, `#5a81a0` is glass; tagged colour vs
// photo roof luma r = 0.03 / 0.23). So a tagged colour sets the wall and
// whether it is curtain glass, never the roof. Per-polygon reach: Midtown
// 33-38 %, London 19-27 %, Paris ~1 %, Tokyo 1.6 %, Phoenix 0.
//
// Everything untagged takes a palette that belongs to the place: a small
// offline region table (no keys) picked by the tile centre, by typology group
// (domestic / residential / masonry / modern / industrial), block-coherent
// (one draw per world-anchored block cell, a share of buildings drawing their
// own) with a small per-building value jitter, and in the arid table the
// photo's lit-ground colour pulls the stucco toward the local earth.
//
// Glass mode. The shader keeps deciding curtain walls for untagged office
// families (Midtown's glass variety stays). A tagged wall says it itself: the
// worker adds GLASS_OFFSET (4) to the red channel of a forced-glass wall and
// OPAQUE_OFFSET (8) to a forced-opaque wall, on wallBase / wallTop only (and the
// far ring's wall), only while look.authority is on. The architecture shader
// (satellite-architecture-material.js applyWorldLook) decodes and removes it
// before any pass reads the colour. A caller that scales a wall colour must
// decode first: lookWallMode(rgb).

const GLASS_OFFSET = 4;
const OPAQUE_OFFSET = 8;

const srgbLin = (s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4);
const lin = (hex) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map((c) => srgbLin(c / 255));
};

/**
 * Region palettes (sRGB hex; decoded once). Groups: dom = houses and terraces
 * (families 0, 6), res = apartments (1), mas = masonry (2), mod = concrete and
 * offices (3, 4), ind = industrial and airport (5, 7). `block` = the share of
 * buildings that take their block's draw. `earth` = how far the photo's
 * lit-ground colour pulls the hue (arid only).
 */
const REGIONS = {
  // Haussmann limestone; modern blocks in pale render and concrete.
  paris: {
    dom: ['#d8ccb2', '#cfc1a4', '#e1d6c0', '#c7b89b'],
    res: ['#dacfb7', '#d0c4a9', '#e2d8c4', '#c9bc9f', '#d5cab3'],
    mas: ['#d3c6aa', '#c9ba9c', '#ddd1ba', '#bfb196'],
    mod: ['#cdc9be', '#bdbab1', '#d8d5cc', '#a9aaa5'],
    block: 0.75,
  },
  // London stock brick, red brick, Portland stone, white stucco.
  london: {
    dom: ['#b29c7a', '#a48d6c', '#9a5a44', '#e3dfd3', '#8c4f3d'],
    res: ['#b19a77', '#9c5b45', '#c9c1ae', '#a38c6b', '#8b4e3c'],
    mas: ['#ddd6c4', '#d2c9b3', '#b29c7a', '#9a5a44', '#c9bfa8'],
    mod: ['#c8c8c0', '#a9aca9', '#d9d6cc', '#8f9595'],
    block: 0.55,
  },
  // Midtown: limestone, buff and red brick, granite, white glazed brick; keep the variety.
  manhattan: {
    dom: ['#94523f', '#7f4636', '#b9a07c', '#c9bea8'],
    res: ['#b9a07c', '#94523f', '#c9bea8', '#a68c6a', '#dedbd2', '#7f4636'],
    mas: ['#c9bea8', '#d6ccb6', '#b9a07c', '#94523f', '#6e6a64', '#a68c6a'],
    mod: ['#c3c0b8', '#a9a8a3', '#dedbd2', '#5f5d5b', '#8d8b86', '#b8ad98'],
    block: 0.2,
  },
  // Brownstone rows and brick.
  brooklyn: {
    dom: ['#6d4a3a', '#7b5542', '#5e3f33', '#8f4a3a', '#9e5a45', '#cdc2ab'],
    res: ['#8f4a3a', '#9e5a45', '#a3664e', '#7b5542', '#b7ab95', '#6d4a3a'],
    mas: ['#9e5a45', '#8f4a3a', '#cdc2ab', '#7b5542'],
    mod: ['#b8b5ac', '#9fa09c', '#cfccc3'],
    block: 0.6,
  },
  // Pale tile and concrete.
  japan: {
    dom: ['#d9d7cf', '#cfcdc5', '#e3e0d7', '#c3c4bf', '#d6d2c4', '#b7b2a6'],
    res: ['#dcdad2', '#cfcfc8', '#e4e2da', '#c6c8c3', '#d3cfc1'],
    mas: ['#d1cdc1', '#c4c1b6', '#dbd7cc', '#b9b7af'],
    mod: ['#d4d4cf', '#c2c5c2', '#b2b7b5', '#e0dfd9', '#a9aeac'],
    block: 0.3,
  },
  // Hong Kong / south China: pale tile, concrete, faded pastel.
  hongkong: {
    dom: ['#d4d2ca', '#c9c4b5', '#d9d3c3', '#bfc3be'],
    res: ['#d4d2ca', '#c4c7c2', '#d9d3c3', '#c8beb0', '#b9bdb9', '#d6cfc0'],
    mas: ['#cfcabd', '#c2bfb5', '#d6d2c6'],
    mod: ['#c7cac7', '#b0b6b6', '#d6d8d4', '#9ea7a8'],
    block: 0.3,
  },
  // US south-west: stucco in sand, cream and adobe.
  southwest: {
    dom: ['#dccaa8', '#d2bb93', '#e4d7be', '#c9ad86', '#d8c3a0', '#bfa27c'],
    res: ['#dac8a6', '#cfb892', '#e2d5bc', '#c6ab85'],
    mas: ['#d4c09c', '#c8b08b', '#ddcdb0'],
    mod: ['#d3cdbf', '#c4beb0', '#ddd8cc', '#b3b0a7'],
    block: 0.7,
    earth: 0.25,
  },
  // Fallbacks by the worker's Natural Earth style (living-regions.js).
  europe: {
    dom: ['#d8d2c4', '#cfc5b0', '#b29070', '#9c6a52', '#e2ddd0'],
    res: ['#d6d0c2', '#c9bfa9', '#b7a68b', '#e0dbcf', '#a77c63'],
    mas: ['#cfc4ac', '#b9a68a', '#a5735b', '#ddd4c0'],
    mod: ['#cbc9c1', '#b4b5b0', '#d9d8d1', '#9da1a0'],
    block: 0.55,
  },
  mediterranean: {
    dom: ['#e6e1d4', '#dccfb4', '#d9c39e', '#e9e4d8', '#cdb89a'],
    res: ['#e3ddd0', '#d8cbb0', '#cfb995', '#e8e3d6'],
    mas: ['#d8c9a9', '#cdb995', '#e0d4bb'],
    mod: ['#d6d3ca', '#c4c3bb', '#e0dfd8'],
    block: 0.55,
  },
  arid: {
    dom: ['#d9c8a8', '#cdb994', '#e2d6be', '#c4ab88'],
    res: ['#d7c6a6', '#cbb793', '#e0d3ba'],
    mas: ['#d0bd9b', '#c3ad89', '#dccbaf'],
    mod: ['#d2cdbf', '#c0bbad', '#dcd8cc'],
    block: 0.65,
    earth: 0.25,
  },
  'east-asia': {
    dom: ['#d6d4cc', '#c9c8c1', '#dfddd4', '#b9bbb6'],
    res: ['#d9d7cf', '#cbccc6', '#e0ded6', '#bfc2be'],
    mas: ['#cdc9be', '#c0bdb3', '#d6d3c8'],
    mod: ['#d2d3cf', '#bfc3c1', '#adb3b2', '#dedfda'],
    block: 0.35,
  },
  tropical: {
    dom: ['#e0ddd2', '#d6cdb8', '#cfc6b0', '#e6e3d9', '#c2b7a2'],
    res: ['#dedbd0', '#d0c8b4', '#c7c3b5', '#e4e1d7'],
    mas: ['#d2c8b2', '#c4b9a3', '#dad3c1'],
    mod: ['#d3d3cd', '#c1c3bf', '#dfdfda'],
    block: 0.5,
  },
  temperate: {
    dom: ['#c9c2b2', '#b9b4a8', '#9b6150', '#d8d4ca', '#a78e75', '#8b5546'],
    res: ['#b9a184', '#9b6150', '#c8c3b6', '#a7988a', '#d4d0c6'],
    mas: ['#a96f5a', '#c3b49a', '#94604f', '#b8aa94'],
    mod: ['#c7c6bf', '#b0b2ae', '#d6d5cf', '#979c9c'],
    block: 0.5,
  },
};
const INDUSTRIAL = ['#b3b6b1', '#a6aaa7', '#c2c3bb', '#9aa1a2', '#bab4a6'];
const GLASS_WALL = ['#56636a', '#4b5558', '#606a6c'];
const REGION_LIN = {};
for (const [k, r] of Object.entries(REGIONS)) {
  REGION_LIN[k] = { ...r };
  for (const g of ['dom', 'res', 'mas', 'mod']) REGION_LIN[k][g] = r[g].map(lin);
}
const INDUSTRIAL_LIN = INDUSTRIAL.map(lin);
const GLASS_LIN = GLASS_WALL.map(lin);

/** Manhattan's shoreline as two lines of longitude against latitude. */
function inManhattan(lat, lon) {
  if (lat < 40.7 || lat > 40.88) return false;
  const t = (lat - 40.7) / 0.18;
  const west = -74.02 + t * 0.08; // Hudson
  const east = -73.972 + t * 0.06; // East River / Harlem River
  return lon > west && lon < east;
}

/** The region palette key for a tile centre. */
function regionKey(lat, lon, geography) {
  if (lat > 48.75 && lat < 48.95 && lon > 2.2 && lon < 2.5) return 'paris';
  if (lat > 51.35 && lat < 51.65 && lon > -0.45 && lon < 0.25) return 'london';
  if (inManhattan(lat, lon)) return 'manhattan';
  if (lat > 40.56 && lat < 40.8 && lon > -74.05 && lon < -73.78) return 'brooklyn';
  if (lat > 24 && lat < 46 && lon > 122.5 && lon < 146) return 'japan';
  if (lat > 22.1 && lat < 22.6 && lon > 113.8 && lon < 114.45) return 'hongkong';
  if (lat > 31 && lat < 37.5 && lon > -120 && lon < -103) return 'southwest';
  const g = geography && geography.style;
  if (g === 'europe') return 'europe';
  if (g === 'mediterranean') return 'mediterranean';
  if (g === 'arid') return 'arid';
  if (g === 'east-asia') return 'east-asia';
  if (g === 'tropical-asia' || g === 'south-asia' || g === 'latin') return 'tropical';
  return 'temperate';
}

/** Tagged colour -> { rgb (linear), mode: 1 glass | 2 opaque } or null. */
function tagMaterial(tags) {
  const m = typeof tags === 'string' ? tags.match(/#([0-9a-f]{6}|[0-9a-f]{3})\b/i) : null;
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const s = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
  const mx = Math.max(...s), mn = Math.min(...s);
  const sat = mx > 0 ? (mx - mn) / mx : 0;
  // Blue-cyan, not too pale: OpenMapTiles' glass (#5a81a0) and its kin.
  const glass = s[2] > s[0] + 0.05 && s[2] >= s[1] - 0.03 && sat >= 0.12 && mx <= 0.8;
  let rgb = s.map(srgbLin);
  // Saturated tags (Tokyo: #ff0000 x 20) are map symbology, not paint.
  const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  if (sat > 0.45) rgb = rgb.map((c) => y + (c - y) * (0.45 / sat));
  const y2 = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const t = y2 < 0.04 ? 0.04 / Math.max(1e-4, y2) : y2 > 0.65 ? 0.65 / y2 : 1;
  return { rgb: rgb.map((c) => Math.min(1, c * t)), mode: glass ? 1 : 2 };
}

const hashU = (a, b) => {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b >>> 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

/** The look's wall colour (linear) and glass mode for one building. */
function lookWall(item, style, lookId, tileCtx) {
  const tagged = tagMaterial(item.archTags);
  if (tagged) return tagged;
  const W = wallContext(tileCtx);
  const fam = style.family;
  const group = fam === 0 || fam === 6 ? 'dom' : fam === 1 ? 'res' : fam === 2 ? 'mas' : fam === 3 || fam === 4 ? 'mod' : 'ind';
  const pal = group === 'ind' ? INDUSTRIAL_LIN : W.region[group];
  // Block-coherent: one draw per world-anchored block cell, a share own.
  const o = item.polys[0].outer;
  let ax = 0, ay = 0;
  for (const p of o) {
    ax += p.x;
    ay += p.y;
  }
  const wx = tileCtx.mercX0 + (ax / o.length) * W.scale;
  const wy = tileCtx.mercYTop - (ay / o.length) * W.scale;
  const cell = (Math.imul(Math.floor(wx / W.cellM), 73856093) ^ Math.imul(Math.floor(wy / W.cellM), 19349663)) >>> 0;
  const own = hashU(lookId, 0x51ed270b) >= W.region.block;
  const pick = own ? hashU(lookId, group.charCodeAt(2)) : hashU(cell, group.charCodeAt(0));
  let rgb = pal[Math.floor(pick * pal.length) % pal.length].slice();
  if (fam === 4) rgb = GLASS_LIN[Math.floor(hashU(lookId, 7) * GLASS_LIN.length)].slice();
  // The local earth (arid): pull the hue toward the photo's lit ground, keep the value.
  if (W.earth && W.region.earth) {
    const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    const ye = 0.2126 * W.earth[0] + 0.7152 * W.earth[1] + 0.0722 * W.earth[2];
    if (ye > 1e-3) rgb = rgb.map((c, i) => c + ((W.earth[i] * y) / ye - c) * W.region.earth);
  }
  const v = 0.94 + 0.12 * hashU(lookId, 0x2545f491);
  return { rgb: rgb.map((c) => Math.min(1, c * v)), mode: 0 };
}

function wallContext(tileCtx) {
  if (tileCtx.lookWalls) return tileCtx.lookWalls;
  const lon = (tileCtx.cx / 6378137) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(-tileCtx.cz / 6378137)) - Math.PI / 2) * (180 / Math.PI);
  const key = regionKey(lat, lon, architectureRegion(lat, lon));
  const photo = tileCtx.lookPhoto;
  tileCtx.lookWalls = {
    key,
    region: REGION_LIN[key],
    scale: tileCtx.tileSpan / tileCtx.extent,
    cellM: 96,
    earth: photo && photo.ground ? photo.ground : null,
  };
  return tileCtx.lookWalls;
}

/** Decode (and strip) the glass-mode offset of a wall colour: { rgb, mode }. */
function lookWallMode(rgb) {
  const mode = rgb[0] >= OPAQUE_OFFSET - 0.5 ? 2 : rgb[0] >= GLASS_OFFSET - 0.5 ? 1 : 0;
  return { rgb: [rgb[0] - (mode === 2 ? OPAQUE_OFFSET : mode === 1 ? GLASS_OFFSET : 0), rgb[1], rgb[2]], mode };
}


export { colourOf, buildingTones, clutterTones, lookWallMode, tagMaterial, regionKey, GLASS_OFFSET, OPAQUE_OFFSET };

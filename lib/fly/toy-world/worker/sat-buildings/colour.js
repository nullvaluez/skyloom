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
  return ring === 'far' ? farColour(item, style, tileCtx) : nearColour(item, style, hash2);
}

export { colourOf, buildingTones, clutterTones };

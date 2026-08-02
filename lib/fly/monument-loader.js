import { BufferAttribute, BufferGeometry, Color } from 'three';
import { GLTFLoader } from 'three-stdlib';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANDMARKS_3D, MONUMENT_MODELS } from './fly-constants';
import { MONUMENT_BUILDERS } from './monument-builders';
import { MONUMENT_MANIFEST } from './monument-models';
import { PALETTE, hexToRGB } from './toy-world/toy-palette';

/**
 * Round 20 (C ICONS) — marquee monument GLB → unit-space graded geometry.
 *
 * WHY NOT lib/fly/model-loader.js: that loader normalises to the AIRCRAFT rig
 * (longest horizontal axis onto Z, nose at -Z from an end-slab taper test,
 * scaled by LENGTH, nav-light octahedra appended). Every one of those is wrong
 * for a monument, which is scaled by HEIGHT, stands on the ground, has no nose
 * and emits no nav lights. The only thing the two share is the COLOUR BAKE
 * lesson (R15): the runtime reads `material.color` × an optional COLOR_0, so a
 * textured GLB renders flat white — which is why scripts/r20-monument-bake.mjs
 * resolves every marquee model's albedo into COLOR_0 offline and ships a single
 * white-factor material. This loader therefore reads COLOR_0 as REAL ALBEDO and
 * grades it, per style.
 *
 * UNIT SPACE (the contract this file exports): y ∈ [0, 1] with the base plane
 * at y = 0, XZ centred on the footprint, real proportions preserved. It is
 * exactly the convention landmarks-3d.js uses for the procedural archetypes, so
 * MonumentModels can scale a marquee model by `hM × LANDMARKS_3D.scaleBoost` the
 * same way LandmarkMonuments scales an archetype — which is what keeps the POI
 * letter contract (`letterLiftM = hM × 1.35 + 30` floats above the top) true for
 * both kinds of monument.
 *
 * THE TWO GRADES (one geometry set per map style; MonumentModels is keyed by
 * mapStyle so a style flip is a clean rebuild, the LandmarkMonuments idiom):
 *  • TOY — palette-quantised REAL accents. The model's own albedo keeps its hue
 *    and chroma but adopts the INK+ICE monument family's VALUE, so Liberty stays
 *    verdigris and the Empire State stays warm limestone while both sit in the
 *    Neon world's value range instead of blowing it out. The round-13 floodlight
 *    ramp (baseBoost at the base → topMul at the top) and the round-8 EMIT ×3.2
 *    accent boost are baked in HERE, because a GLB gets no free floodlight —
 *    landmarks-3d bakes exactly the same two things into its part() painter.
 *  • SATELLITE — muted real albedo, saturation-capped (FLY_ROUND20_PLAN §5.5,
 *    sanctioned taste evolution by explicit user ask: "the right colors"). The
 *    R18 value-only lock still governs the PROCEDURAL archetypes — this file
 *    never touches those.
 */

const _loader = new GLTFLoader();
const _color = new Color();
const EPS = 1e-4;

const LIN = {
  dark: hexToRGB(PALETTE.monumentDark),
  body: hexToRGB(PALETTE.monumentBody),
  trim: hexToRGB(PALETTE.monumentTrim),
};
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const L_DARK = luma(...LIN.dark);
const L_BODY = luma(...LIN.body);
const L_TRIM = luma(...LIN.trim);

// ROUND 20 (C2) — THE SATELLITE STONE KEY.
//
// The satellite MONUMENT material is MeshToon (both here and in
// LandmarkMonuments), and MeshToon takes no environment map — so at night a
// monument is lit by the moon directional and the ambient/hemi ONLY, while the
// streamed satellite buildings (MeshLambert) also take the HDRI. Whatever hue
// the key light carries therefore lands on a monument undiluted.
//
// That is fine for the procedural archetypes: their material colour IS
// LANDMARKS_3D.satStyle.color, a WARM weathered stone (#d7d0c2, blue/red 0.90),
// which pushes back against the cool key. A marquee model has no such key — it
// carries real albedo — and the Taj Mahal's source marble is COOL white
// (blue/red ≈ 1.16, derived from the measurements below). Cool albedo × cool key
// is the reported blue Taj.
//
// So the achromatic part of a marquee model's albedo is RE-KEYED onto that same
// weathered stone hue, AT ITS OWN LUMA (value is untouched — this is a hue
// rotation, not a tint that darkens). It is applied in inverse proportion to how
// much colour the vertex actually has: a near-white vertex has no hue identity
// to protect and takes the full key, while Liberty's verdigris and the Eiffel's
// iron keep theirs completely. That is what makes this compatible with
// FLY_ROUND20_PLAN §5.5's "the right colors" instead of a reversal of it.
//
// MEASURED (scripts/r20-c2-nighthue.js — Agra 27.1695N/78.0421E, 200 m, sun
// pinned to 22:00 UTC = 03:30 IST deep night, one crop on the silhouette,
// blue-minus-red on the monument's own pixels):
//
//   procedural dome, extrusion excluded   +18.4   ← the certified R13/R18 look
//   marquee, stoneKey 0                   +33.5   ← the reported blue Taj
//   marquee, stoneKey 1 (shipped)         +25.0
//
// i.e. the key removes 8.5 of the 15.1-unit excess over the certified look.
// TWO honest limits. (1) It does not reach the procedural number: what is left
// is the model's own remaining cool cast. (2) The procedural number is itself
// +18.4 — A DEEP-NIGHT SATELLITE MONUMENT REALLY IS BLUE, because MeshToon sees
// only the cold moon key, and agent C's own pre-marquee capture
// (scripts/r20-c-taj-satellite-before.png) shows exactly that. So ~55% of the
// "blue Taj" was never the marquee's to fix; taking it out means changing the
// satellite monument LIGHTING for both kinds at once, which moves
// verify-monuments-sat and is not this agent's to spend. The DAYLIGHT frame is
// correct pale warm off-white either way
// (scripts/r20-c-taj-satellite-day-after.png). stoneKey 0 reverts this exactly.
const STONE = hexToRGB(LANDMARKS_3D.satStyle.color);
const STONE_L = luma(...STONE);

/**
 * Does this vertex fall in one of the model's authored ACCENT bands? Bands are
 * unit-height slabs with an optional radial floor (`rMin`, a fraction of the
 * footprint's half-extent) so an off-axis feature — Liberty's torch, a corner
 * mast — can be named without naming the whole slab. Returns the band or null.
 */
function accentAt(bands, yUnit, rFrac) {
  if (!bands) return null;
  for (const b of bands) {
    if (yUnit < b.yMin || yUnit > b.yMax) continue;
    if (b.rMin != null && rFrac < b.rMin) continue;
    if (b.rMax != null && rFrac > b.rMax) continue;
    return b;
  }
  return null;
}

/** TOY grade — see the header. Input and output are LINEAR rgb. */
function gradeToy(out, r, g, b, yUnit, band, cfg) {
  if (band) {
    const [ar, ag, ab] = hexToRGB(band.color);
    const k = band.emit ?? cfg.accentEmit;
    out[0] = ar * k;
    out[1] = ag * k;
    out[2] = ab * k;
    return;
  }
  const L = luma(r, g, b);
  // Which palette tone does this vertex's own value belong to? The cuts are on
  // the SOURCE luma, so a model's internal light/dark structure survives the
  // quantisation — a dark plinth lands on monumentDark, a sunlit facade on
  // monumentTrim — instead of the whole model collapsing to one tone.
  const tone = L < cfg.darkCut ? LIN.dark : L > cfg.trimCut ? LIN.trim : LIN.body;
  const toneL = L < cfg.darkCut ? L_DARK : L > cfg.trimCut ? L_TRIM : L_BODY;
  // Adopt the palette's VALUE while keeping the real hue/chroma, then mix back
  // toward the flat palette tone by (1 - realMix). realMix 0 == the pure
  // procedural palette; 1 == real albedo at palette value.
  const s = toneL / Math.max(L, EPS);
  const m = cfg.realMix;
  const im = 1 - m;
  // Round 13 P5 FLOODLIGHT, verbatim in law (landmarks-3d.js part()): a
  // bottom-up brightness gradient that reads as "lit from the plaza".
  const ff = cfg.floodTopMul + (cfg.floodBaseBoost - cfg.floodTopMul) * (1 - yUnit);
  out[0] = (tone[0] * im + r * s * m) * ff;
  out[1] = (tone[1] * im + g * s * m) * ff;
  out[2] = (tone[2] * im + b * s * m) * ff;
}

/** SATELLITE grade — muted real albedo, saturation-capped. LINEAR rgb. */
function gradeSat(out, r, g, b, yUnit, band, cfg) {
  let cr = r;
  let cg = g;
  let cb = b;
  if (band) {
    const [ar, ag, ab] = hexToRGB(band.color);
    // No EMIT here: the toy ×3.2 would blow out against daylight imagery and
    // there is no bloom ramp in satellite to catch it (the R18 accentTone
    // reasoning, applied to a real albedo instead of a grey).
    cr = ar * cfg.accentMul;
    cg = ag * cfg.accentMul;
    cb = ab * cfg.accentMul;
  }
  const L = luma(cr, cg, cb);
  if (cfg.valueLock) {
    cr = L;
    cg = L;
    cb = L;
  } else {
    const mx = Math.max(cr, cg, cb);
    const mn = Math.min(cr, cg, cb);
    const sat = mx > EPS ? (mx - mn) / mx : 0;
    if (sat > cfg.saturationCap) {
      // Pull toward the vertex's own luma until HSV S lands on the cap. This
      // keeps HUE exactly (that is the whole point of "the right colors") and
      // only removes the chroma that would fight Esri imagery.
      const k = cfg.saturationCap / sat;
      cr = L + (cr - L) * k;
      cg = L + (cg - L) * k;
      cb = L + (cb - L) * k;
    }
    // Round 20 (C2) — the stone key (see STONE above). Full strength on an
    // achromatic vertex, zero once the vertex carries real colour, and it never
    // changes a vertex's value: STONE is normalised by its own luma, so the
    // target is exactly "this vertex's brightness, in weathered-stone hue".
    if (cfg.stoneKey > 0) {
      const k = cfg.stoneKey * (1 - Math.min(1, sat / Math.max(cfg.stoneKeySatRef, EPS)));
      if (k > 0) {
        const s = L / Math.max(STONE_L, EPS);
        cr += (STONE[0] * s - cr) * k;
        cg += (STONE[1] * s - cg) * k;
        cb += (STONE[2] * s - cb) * k;
      }
    }
  }
  // Contact grime at the base → sky bounce at the roofline (the R18 vertical
  // term, same numbers' role, applied to albedo rather than to a grey).
  const v = cfg.baseMul + (cfg.topMul - cfg.baseMul) * yUnit;
  out[0] = cr * v * cfg.valueMul;
  out[1] = cg * v * cfg.valueMul;
  out[2] = cb * v * cfg.valueMul;
}

/**
 * Flatten a loaded GLTF scene into ONE indexed BufferGeometry carrying
 * position / normal / color, with every node transform applied. Mirrors
 * model-loader's bakeMeshGeometry in law (material.color × optional COLOR_0)
 * but keeps the geometry INDEXED — a monument is static, merged once, and never
 * needs the per-face split an aircraft's nav-light append forced.
 */
function flattenScene(scene) {
  const parts = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const count = g.attributes.position.count;
    const src = g.attributes.color;
    _color.set(o.material?.color ?? 0xffffff);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = (src ? src.getX(i) : 1) * _color.r;
      colors[i * 3 + 1] = (src ? src.getY(i) : 1) * _color.g;
      colors[i * 3 + 2] = (src ? src.getZ(i) : 1) * _color.b;
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    const clean = new BufferGeometry();
    clean.setAttribute('position', g.attributes.position);
    clean.setAttribute('normal', g.attributes.normal);
    clean.setAttribute('color', new BufferAttribute(colors, 3));
    if (g.index) clean.setIndex(g.index);
    else {
      const seq = new Uint32Array(count);
      for (let i = 0; i < count; i++) seq[i] = i;
      clean.setIndex(new BufferAttribute(seq, 1));
    }
    parts.push(clean);
    g.dispose();
  });
  if (parts.length === 0) throw new Error('no meshes');
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
  if (parts.length > 1) for (const p of parts) p.dispose();
  return merged;
}

/**
 * Normalise to UNIT SPACE and apply the style grade in place. `entry.yawFixRad`
 * is an ABSOLUTE spin about +Y applied BEFORE the bbox is measured — there is no
 * orientation heuristic here on purpose: an aircraft has a nose to find, a
 * monument has an authored facing, measured once with scripts/inspect-glb.mjs
 * and written down.
 */
function normalizeAndGrade(geometry, entry, variant) {
  if (entry.yawFixRad) geometry.rotateY(entry.yawFixRad);
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const h = Math.max(bb.max.y - bb.min.y, EPS);
  const cx = (bb.min.x + bb.max.x) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  geometry.translate(-cx, -bb.min.y, -cz);
  geometry.scale(1 / h, 1 / h, 1 / h);
  geometry.computeBoundingBox();
  const halfX = Math.max(geometry.boundingBox.max.x, -geometry.boundingBox.min.x, EPS);
  const halfZ = Math.max(geometry.boundingBox.max.z, -geometry.boundingBox.min.z, EPS);

  const pos = geometry.attributes.position;
  const col = geometry.attributes.color;
  const n = pos.count;
  const isToy = variant !== 'sat';
  const cfg = isToy
    ? { ...MONUMENT_MODELS.toy, accentEmit: MONUMENT_MODELS.toy.accentEmit }
    : MONUMENT_MODELS.satAlbedo;
  const out = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const y = Math.min(1, Math.max(0, pos.getY(i)));
    const rf = Math.max(Math.abs(pos.getX(i)) / halfX, Math.abs(pos.getZ(i)) / halfZ);
    const band = accentAt(entry.accents, y, rf);
    if (isToy) gradeToy(out, col.getX(i), col.getY(i), col.getZ(i), y, band, cfg);
    else gradeSat(out, col.getX(i), col.getY(i), col.getZ(i), y, band, cfg);
    col.setXYZ(i, out[0], out[1], out[2]);
  }
  col.needsUpdate = true;
  geometry.computeBoundingSphere();
  return geometry;
}

async function loadOne(entry, variant) {
  // Two sources, ONE downstream path. A bespoke first-party builder
  // (lib/fly/monument-builders.js) hands back exactly what flattenScene does —
  // position/normal/color in real metres, colour = REAL LINEAR ALBEDO — so it
  // normalises and grades through the same code as a downloaded GLB and cannot
  // drift from it. Bespoke is what a monument gets when no acceptable FREE
  // model exists; it is never a substitute for scouting.
  if (entry.build) {
    const builder = MONUMENT_BUILDERS[entry.build];
    if (!builder) throw new Error(`no builder '${entry.build}'`);
    return normalizeAndGrade(builder(), entry, variant);
  }
  const gltf = await _loader.loadAsync(entry.file);
  const merged = flattenScene(gltf.scene);
  return normalizeAndGrade(merged, entry, variant);
}

/**
 * Load every enabled marquee monument for one map style. Resolves to a Map of
 * POI NAME → { entry, geometry } holding only the models that actually
 * loaded — a failed download degrades to that POI's procedural archetype
 * (which is already on screen; nothing is ever suppressed until its model is
 * in hand). NEVER rejects, and never gates boot: MonumentModels calls this in
 * an effect AFTER mount, so `runtime.modelsReady` and the __flyBoot contract
 * are untouched.
 */
export async function loadMonumentGeometries(variant = 'toy') {
  const out = new Map();
  await Promise.all(
    MONUMENT_MANIFEST.map(async (entry) => {
      if (entry.enabled === false) return;
      try {
        const geometry = await loadOne(entry, variant);
        out.set(entry.poi, { entry, geometry });
      } catch (err) {
        console.warn(
          `[fly-monuments] ${entry.file ?? entry.build} failed, keeping the procedural archetype:`,
          err
        );
      }
    })
  );
  return out;
}

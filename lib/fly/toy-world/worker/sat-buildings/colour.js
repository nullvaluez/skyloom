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
import { prepareRoofLook, regionalAt, regionalFrame, regionalLoad, regionalGround, regionalCorr, photoConfig, toAlbedo, tallRoof, lumaOf, hashUnit, NEUTRAL_ROOFS } from '../photo-sampler';
import { architectureContext, architectureStyle } from './typology';
import { seamId, relateParts } from './structures';
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
    // World Pass D: THE far colour (lookFarColour): the near ring's key, its
    // wall and its fallback roof rule. Flag off: today's far colour.
    const lookOn = !!(style && tileCtx && tileCtx.worldPass && tileCtx.worldPass.look.on && tileCtx.visuals === true);
    if (!lookOn) return farColour(item, style, tileCtx);
    const f = lookFarColour(item, style, tileCtx);
    const wall = f.wall.slice();
    if (tileCtx.worldPass.look.authority && f.mode) wall[0] += f.mode === 1 ? GLASS_OFFSET : OPAQUE_OFFSET;
    return { wall, roof: f.roof };
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

/**
 * World Pass D (round 2): every roof of one tile, decided once by ONE rule, at
 * build time and again when the late photo lands (look-roofs.js), so a rebuild
 * after the photo draws exactly the colours the patch faded to.
 *   tileCtx.lookPhoto     the z16 photo (the patch, or a node probe), or absent
 *   tileCtx.lookCached    this tile's finished roofs (item.id -> { rgb, src }), or absent
 *   tileCtx.lookFallback  { regional, corr, neighbour } (look-roofs.js lookBegin)
 * A roof of a tall structure (its own height or its structure's top at
 * photo.maxH or more, terraces and podium parts included) takes the neutral
 * family tinted by the photo's luma; every other roof the photo, its mates,
 * its block, then the fallback below. Returns prepareRoofLook's { roofOf, stats }.
 */
function lookRoofDecisions(tileCtx) {
  const L = tileCtx.look;
  const cfg = L.photo;
  const F = tileCtx.lookFallback || null;
  const lookOf = L.lookOf || null;
  const opts = {
    tallOf(it) {
      const lo = lookOf ? lookOf(it) : null;
      const top = lo && lo.root ? Math.max(it.h, lo.root.rawH || 0) : it.h;
      return !(top < cfg.maxH);
    },
    idOf(it) {
      const lo = lookOf ? lookOf(it) : null;
      return lo ? lo.id : it.sid ?? it.id;
    },
    fallback(it, wx, wy) {
      let rgb = null;
      let src = 'neutral';
      if (F && F.regional) {
        const r = regionalAt(F.regional, wx, wy);
        if (r) {
          rgb = F.corr ? r.map((v, i) => v * F.corr[i]) : r;
          src = 'regional';
        }
      }
      if (!rgb && F && F.neighbour) {
        rgb = F.neighbour.slice();
        src = 'neighbour';
      }
      if (!rgb) return { rgb: NEUTRAL_ROOFS[Math.floor(hashUnit(it.id, 0xfa12) * NEUTRAL_ROOFS.length) % NEUTRAL_ROOFS.length].slice(), src };
      rgb = toAlbedo(rgb, { ...cfg, satMax: cfg.fallbackSat });
      const j = 1 + (hashUnit(it.id, 0xfa11) - 0.5) * 2 * cfg.fallbackJitter;
      return { rgb: rgb.map((c) => Math.min(1, c * j)), src };
    },
  };
  const dec = prepareRoofLook(tileCtx, L.items, cfg, L.structOf, opts);
  const cached = !tileCtx.lookPhoto ? tileCtx.lookCached : null;
  if (!cached) return dec;
  // A rebuild of a tile this worker already recoloured: its finished roofs.
  const stats = { ...dec.stats, photo: 0, structure: 0, block: 0, tall: 0, tallFallback: 0, regional: 0, neighbour: 0, neutral: 0 };
  const map = new Map();
  let all = true;
  for (const it of L.items) {
    const c = cached.get(it.id);
    const r = c || dec.roofOf(it);
    if (!c) all = false;
    map.set(it, r);
    stats[r.src] = (stats[r.src] || 0) + 1;
  }
  L.cachedAll = all;
  return { roofOf: (it) => map.get(it) || null, stats };
}

/** The per-tile look prep, once, on the first near call (every item.h is known by then). */
function lookPrep(tileCtx) {
  const L = tileCtx.look;
  if (!L.prep) {
    const roofs = tileCtx.worldPass.look.roofPhoto ? lookRoofDecisions(tileCtx) : null;
    L.prep = { roofs };
    if (tileCtx.stages && roofs) tileCtx.stages.look = { roof: roofs.stats };
    L.stats = roofs ? roofs.stats : null;
  }
  return L.prep;
}

/**
 * World Pass D: the near colours with the look stream's evidence. Roof: the
 * decision of lookRoofDecisions (photo, mates, block, tall neutral family, or
 * the regional fallback until the late photo lands). Wall: lookWall.
 * Every building is recorded (tileCtx.look.rec) with the colours it was built
 * with, so the late photo can find and recolour its vertices (look-roofs.js).
 */
function lookNear(item, style, tileCtx, base) {
  const prep = lookPrep(tileCtx);
  const S = SAT_BUILDINGS;
  let { wall, wallBase, wallTop, roofCol, parapetCol } = base;
  const r = prep.roofs ? prep.roofs.roofOf(item) : null;
  const entry = { item, roof: null, wall: null, z: 1, wb: null, wt: null };
  if (r) {
    roofCol = r.rgb.slice();
    parapetCol = roofCol.map((c) => c * S.parapetGain);
    entry.roof = roofCol;
  }
  const WP = tileCtx.worldPass.look;
  if (WP.walls) {
    const lo = tileCtx.look.lookOf ? tileCtx.look.lookOf(item) : null;
    const lookItem = lo ? lo.rootItem : item;
    const lookId = lo ? lo.id : item.sid ?? item.id;
    const w = lookWall(lookItem, style, lookId, tileCtx);
    // The same fake AO the legacy colour bakes (dark base, lifted roofline).
    const TONE = buildingTones();
    const aoT = clamp01Range(item.h / S.wallBaseRefM, 0, 1);
    const baseMul = TONE.wallBaseMul[0] + (TONE.wallBaseMul[1] - TONE.wallBaseMul[0]) * aoT;
    ({ wall, wallBase, wallTop } = wallSet(w, baseMul));
    // The wall's material for the shader (round 2: in the style byte, look-roofs.js
    // encodeWallModes, so the colour stays in [0, 1]): 2 curtain glass, 3 opaque,
    // 1 the shader's own choice (an untagged office may still be curtain glass,
    // except where the region says its offices are not: Hong Kong).
    if (WP.authority) {
      entry.z = w.mode === 1 ? 2 : w.mode === 2 ? 3 : wallContext(tileCtx).region.officeGlass === false && style.family !== 4 && style.family !== 0 && style.family !== 6 ? 3 : 1;
      entry.wb = wallBase;
      entry.wt = wallTop;
    }
    // A wall whose local earth was not known at build time (the regional photo
    // had not landed): the late photo patch recolours it once it is.
    const Wc = wallContext(tileCtx);
    if (!Wc.earth && Wc.region.earth && !w.mode) entry.wall = { item: lookItem, id: lookId, family: style.family, baseMul, base: wallBase, top: wallTop };
    if (tileCtx.stages) {
      const st = (tileCtx.stages.look ??= {});
      st.walls ??= { tagGlass: 0, tagOpaque: 0, region: 0, key: Wc.key };
      st.walls[w.mode === 1 ? 'tagGlass' : w.mode === 2 ? 'tagOpaque' : 'region'] += 1;
    }
  }
  if (entry.roof || entry.wall || entry.z !== 1) (tileCtx.look.rec ??= []).push(entry);
  return { wall, wallBase, wallTop, roofCol, parapetCol };
}

/** Wall, base and top colours from a lookWall answer (the fake AO of the legacy colour). */
function wallSet(w, baseMul) {
  const S = SAT_BUILDINGS;
  const wall = w.rgb;
  return { wall, wallBase: wall.map((c) => c * baseMul), wallTop: wall.map((c) => c * S.wallTopGain) };
}

// --- World Pass D (round 2): THE far colour ------------------------------------
//
// One function for every far consumer: REACH's stand-ins and the far mass
// (colourOf(..., 'far')). The far body takes the SAME look key as the near
// ring (its structure root's look id and facts, structures.js relateParts over
// the tile's admitted footprints), the same wall (lookWall), and for the roof
// the near ring's own fallback rule (the regional photo at the building,
// corrected by this worker's finished tiles; a tall structure's roof the
// neutral family with that luma). Then the wall is pulled toward the photo's
// colour at the building and desaturated, both by `far01`: at 0 (the near
// ring's edge) the far wall IS the near wall, so the handover has no step.
//
//   lookFarPrepare(admitted, tileCtx)
//       Once per far tile, with the tile's admitted footprints (admission.js
//       admitFootprints: the near ring's set). Relates the parts; nothing is
//       dropped. Without it a far body keys on its own part id (seam id).
//   lookFarColour(item, style, tileCtx, far01?) -> { wall, roof, mode }
//       item: an admitted footprint or a copy of one (item.polys[0] is the key),
//       item.h set. style: architectureStyle(item, ...), restyled in place to
//       the root's (write it into the vertices after this call). far01: 0 at
//       the near ring's edge, 1 at the horizon (default look.worker.far.far01).
//       wall and roof are linear [0, 1] with NO glass offset; mode is the
//       tagged material (0 none, 1 curtain glass, 2 opaque), for a consumer
//       that wants it (colourOf adds the offset for the architecture shader).

const FAR_DEFAULTS = { photoPull: 0.7, valueLift: 1.6, desat: 0.45, far01: 0.6 };

function farConfig(tileCtx) {
  const w = tileCtx.worldPass.look.worker;
  const f = w && w.far && typeof w.far === 'object' ? w.far : null;
  return f ? { ...FAR_DEFAULTS, ...f } : FAR_DEFAULTS;
}

const polySig = (p) => {
  const o = p.outer;
  const m = o[o.length >> 1];
  return `${o.length}|${o[0].x}|${o[0].y}|${m.x}|${m.y}`;
};

function lookFarPrepare(admitted, tileCtx) {
  const look = tileCtx && tileCtx.worldPass ? tileCtx.worldPass.look : null;
  if (!look || !look.on || !look.structures || tileCtx.visuals !== true || !tileCtx.extent || tileCtx.lookFarRel) return;
  const rel = admitted.length ? relateParts(admitted, tileCtx) : null;
  const map = new Map();
  if (rel) {
    const ids = new Map();
    const idOf = (i) => {
      if (!ids.has(i)) {
        const it = admitted[i];
        ids.set(i, it.sid ?? seamId(it, tileCtx) ?? it.id);
      }
      return ids.get(i);
    };
    for (let i = 0; i < admitted.length; i++) {
      const it = admitted[i];
      const ri = rel.root[i];
      const root = admitted[ri];
      const top = rel.top[i];
      map.set(polySig(it.polys[0]), { rootItem: root, root: top > 0 && top !== root.rawH ? { ...root, rawH: top } : root, id: idOf(ri), top, self: ri === i });
    }
  }
  tileCtx.lookFarRel = map;
}

function lookFarColour(item, style, tileCtx, far01) {
  const WP = tileCtx.worldPass.look;
  const F = farConfig(tileCtx);
  const k = Number.isFinite(far01) ? Math.max(0, Math.min(1, far01)) : F.far01;
  let lookItem = item;
  let lookId = item.sid ?? (tileCtx.extent && item.polys ? seamId(item, tileCtx) : null) ?? item.id;
  let top = 0;
  const r = WP.structures && tileCtx.lookFarRel && item.polys ? tileCtx.lookFarRel.get(polySig(item.polys[0])) : null;
  if (r) {
    lookItem = r.rootItem;
    lookId = r.id;
    top = r.top || 0;
    // As the near ring (lookStyle): restyle unless the body is its own root, with its own facts and id.
    if (style && WP.structures && !(r.self && r.root === r.rootItem && lookId === item.id)) restyle(style, r.root, lookId, tileCtx);
  } else if (style && WP.structures && tileCtx.extent && item.polys && lookId !== item.id) restyle(style, item, lookId, tileCtx);
  const base = farColour(item, style, tileCtx);
  const W = wallContext(tileCtx);
  const centre = itemCentre(item, tileCtx);
  const photoAt = W.reg && centre ? regionalAt(W.reg, centre[0], centre[1]) : null;
  let wall = base.wall;
  let mode = 0;
  if (WP.walls && style) {
    const w = lookWall(lookItem, style, lookId, tileCtx);
    wall = w.rgb.slice();
    mode = w.mode;
    // A far body has no curtain wall to show its glass: a tagged glass tower is
    // its tag colour mostly greyed, at the value of tinted glass seen at a
    // distance (never the flat saturated slab of round 1).
    if (mode === 1) wall = desaturate(wall, 0.6).map((c, i, a) => c * (0.11 / Math.max(1e-3, lumaOf(a))));
    // Into the photo: toward the photo's colour at the building (its hue, and
    // its value lifted at most valueLift x: a far wall shows no windows and no
    // lit detail, the near wall's facade reads darker than its albedo), then
    // less chroma, both growing with distance from the near ring.
    if (photoAt) wall = towardPhoto(wall, photoAt, F.photoPull * k, F.valueLift);
    wall = desaturate(wall, F.desat * k);
  }
  let roof = base.roof;
  if (WP.roofPhoto) {
    const cfg = photoConfig(WP);
    const corr = W.reg ? regionalCorr(W.reg.key) : null;
    const fb = photoAt ? toAlbedo(corr ? photoAt.map((v, i) => v * corr[i]) : photoAt, { ...cfg, satMax: cfg.fallbackSat }) : null;
    const tall = !(Math.max(item.h ?? 0, top) < cfg.maxH);
    if (tall) roof = tallRoof(lookId, item.id, fb ? lumaOf(fb) : null, cfg);
    else if (fb) {
      const j = 1 + (hashUnit(item.id, 0xfa11) - 0.5) * 2 * cfg.fallbackJitter;
      roof = fb.map((c) => Math.min(1, c * j));
    } else roof = NEUTRAL_ROOFS[Math.floor(hashUnit(item.id, 0xfa12) * NEUTRAL_ROOFS.length) % NEUTRAL_ROOFS.length].slice();
  }
  return { wall, roof, mode };
}

/** World-Mercator centre of an item's first ring, or null. */
function itemCentre(item, tileCtx) {
  if (!item.polys || !tileCtx.extent) return null;
  const o = item.polys[0].outer;
  let ax = 0, ay = 0;
  for (const p of o) {
    ax += p.x;
    ay += p.y;
  }
  const scale = tileCtx.tileSpan / tileCtx.extent;
  return [tileCtx.mercX0 + (ax / o.length) * scale, tileCtx.mercYTop - (ay / o.length) * scale];
}

/** rgb moved toward the hue of `ref` at rgb's own luma, by t. */
function towardHue(rgb, ref, t) {
  const y = lumaOf(rgb), yr = lumaOf(ref);
  if (!(yr > 1e-4) || !(t > 0)) return rgb;
  return rgb.map((c, i) => Math.max(0, Math.min(1, c + ((ref[i] * y) / yr - c) * t)));
}

/** rgb moved toward the photo colour `ref` by t: ref's hue at a value of ref's luma x lift, never above rgb's. */
function towardPhoto(rgb, ref, t, lift) {
  const y = lumaOf(rgb), yr = lumaOf(ref);
  if (!(yr > 1e-4) || !(t > 0)) return rgb;
  const yt = Math.min(y, yr * lift);
  return rgb.map((c, i) => Math.max(0, Math.min(1, c + ((ref[i] * yt) / yr - c) * t)));
}

/** rgb moved toward its own luma (grey), by t. */
function desaturate(rgb, t) {
  if (!(t > 0)) return rgb;
  const y = lumaOf(rgb);
  return rgb.map((c) => c + (y - c) * t);
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
// own) with a small per-building value jitter. Round 2: every region but the
// four curated cities pulls the hue toward the regional photo's lit ground
// (`earth`, from the z11 photo the build already holds), so a city the table
// does not name still sits in its own imagery; and an untagged office tower is
// curtain glass only in the region's `glass` share (Hong Kong's residential
// towers are tile and concrete, not glass), else a concrete tower (family 3).
//
// Glass mode. The shader keeps deciding curtain walls for untagged office
// families (Midtown's glass variety stays), except where the region says its
// offices are not glass. A tagged wall says it itself. Round 2: the near ring
// writes it in the wall vertices' style byte (2 curtain glass, 3 opaque, 1 the
// shader's choice; look-roofs.js encodeWallModes), so a wall colour stays in
// [0, 1] and ARRIVAL's Uint8 colour packing holds. The far mass
// (colourOf(..., 'far')) still adds GLASS_OFFSET (4) or OPAQUE_OFFSET (8) to
// the red channel of its wall while look.authority is on. The architecture
// shader (satellite-architecture-material.js applyWorldLook) decodes both
// before any pass reads the colour; any other consumer of a far colour must
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
 * buildings that take their block's draw. `earth` = how far the regional
 * photo's lit ground pulls the hue (0 for the four curated cities). `glass` =
 * the share of untagged office towers (family 4) kept as curtain glass.
 */
const REGIONS = {
  // Haussmann limestone; modern blocks in pale render and concrete.
  paris: {
    dom: ['#d8ccb2', '#cfc1a4', '#e1d6c0', '#c7b89b'],
    res: ['#dacfb7', '#d0c4a9', '#e2d8c4', '#c9bc9f', '#d5cab3'],
    mas: ['#d3c6aa', '#c9ba9c', '#ddd1ba', '#bfb196'],
    mod: ['#cdc9be', '#bdbab1', '#d8d5cc', '#a9aaa5'],
    block: 0.75,
    earth: 0,
    glass: 0.5,
  },
  // London stock brick, red brick, Portland stone, white stucco.
  london: {
    dom: ['#b29c7a', '#a48d6c', '#9a5a44', '#e3dfd3', '#8c4f3d'],
    res: ['#b19a77', '#9c5b45', '#c9c1ae', '#a38c6b', '#8b4e3c'],
    mas: ['#ddd6c4', '#d2c9b3', '#b29c7a', '#9a5a44', '#c9bfa8'],
    mod: ['#c8c8c0', '#a9aca9', '#d9d6cc', '#8f9595'],
    block: 0.55,
    earth: 0,
    glass: 0.85,
  },
  // Midtown: limestone, buff and red brick, granite, white glazed brick; keep the variety.
  manhattan: {
    dom: ['#94523f', '#7f4636', '#b9a07c', '#c9bea8'],
    res: ['#b9a07c', '#94523f', '#c9bea8', '#a68c6a', '#dedbd2', '#7f4636'],
    mas: ['#c9bea8', '#d6ccb6', '#b9a07c', '#94523f', '#6e6a64', '#a68c6a'],
    mod: ['#c3c0b8', '#a9a8a3', '#dedbd2', '#5f5d5b', '#8d8b86', '#b8ad98'],
    block: 0.2,
    earth: 0,
    glass: 1,
  },
  // Brownstone rows and brick.
  brooklyn: {
    dom: ['#6d4a3a', '#7b5542', '#5e3f33', '#8f4a3a', '#9e5a45', '#cdc2ab'],
    res: ['#8f4a3a', '#9e5a45', '#a3664e', '#7b5542', '#b7ab95', '#6d4a3a'],
    mas: ['#9e5a45', '#8f4a3a', '#cdc2ab', '#7b5542'],
    mod: ['#b8b5ac', '#9fa09c', '#cfccc3'],
    block: 0.6,
    earth: 0,
    glass: 0.5,
  },
  // Japan: pale tile and concrete, with the tan and brown tile of the mansions.
  japan: {
    dom: ['#d9d7cf', '#cfc8b8', '#b9a58a', '#e3e0d7', '#c3c4bf', '#a8927a', '#d6d2c4'],
    res: ['#dcdad2', '#cdbfa6', '#b49c80', '#e4e2da', '#c6c8c3', '#9c8b78', '#d3cfc1'],
    mas: ['#d1cdc1', '#bba98f', '#a38b70', '#dbd7cc'],
    mod: ['#d4d4cf', '#c2c5c2', '#b2b7b5', '#e0dfd9', '#a9aeac', '#8f9493', '#c8bfae'],
    block: 0.25,
    earth: 0.1,
    glass: 0.55,
  },
  // Hong Kong / south China: pale tile, concrete, faded pastel; residential towers are not glass.
  hongkong: {
    dom: ['#d4d2ca', '#d9cdb6', '#c9c4b5', '#bfc3be', '#e0dccf'],
    res: ['#d8d4c8', '#cbc7bd', '#dcd2bf', '#c8beb0', '#b9bdb9', '#e2ddd0', '#cfc0a8', '#b3b9b7'],
    mas: ['#cfcabd', '#c9bea9', '#d6d2c6'],
    mod: ['#d0d1cc', '#bcc0bd', '#dddcd5', '#aeb3b2', '#c9c2b3'],
    block: 0.3,
    earth: 0.1,
    glass: 0.3,
    officeGlass: false, // an untagged mid-rise or tower is tile and concrete, not a curtain wall
  },
  // US south-west: stucco in sand, cream and adobe.
  southwest: {
    dom: ['#dccaa8', '#d2bb93', '#e4d7be', '#c9ad86', '#d8c3a0', '#bfa27c'],
    res: ['#dac8a6', '#cfb892', '#e2d5bc', '#c6ab85'],
    mas: ['#d4c09c', '#c8b08b', '#ddcdb0'],
    mod: ['#d3cdbf', '#c4beb0', '#ddd8cc', '#b3b0a7'],
    block: 0.7,
    earth: 0.25,
    glass: 0.5,
  },
  // San Francisco and coastal California: painted wood and stucco in white,
  // cream, pale grey and muted pastel; little brick.
  pacific: {
    dom: ['#e6e1d6', '#d9d0bd', '#c9c6bb', '#d8cbb0', '#b9c0bd', '#cfc2ae', '#e9e4da', '#bcae98'],
    res: ['#e3ddd1', '#d4cbb8', '#c7c4ba', '#d9cfb9', '#b8bdb9', '#e6e2d8'],
    mas: ['#d8cfbd', '#cdbfa5', '#c2b8a6', '#a58a73'],
    mod: ['#cfccc4', '#bdbcb6', '#dad8d1', '#a9aba8'],
    block: 0.4,
    earth: 0.15,
    glass: 0.6,
  },
  // Australia and New Zealand: sandstone, cream render, white, some face brick.
  oceania: {
    dom: ['#d9cdb4', '#c9a57f', '#e3ddd0', '#b5714f', '#cfc8ba', '#ddd3bf'],
    res: ['#d8cbb2', '#e1dbcf', '#c4b59a', '#b8735a', '#cbc8bf'],
    mas: ['#cfb48c', '#c4a47c', '#ddd2bb', '#b07552'],
    mod: ['#d0cec7', '#bdbdb7', '#dcdbd4', '#a5a8a6'],
    block: 0.5,
    earth: 0.2,
    glass: 0.6,
  },
  // Latin America: white and cream concrete, pastel render, grey.
  latam: {
    dom: ['#e4e0d6', '#d9cdb5', '#cfc3ab', '#e8e5dc', '#c9b8a0', '#d6c7b9'],
    res: ['#e0dcd2', '#d2c9b8', '#c8c5bc', '#e6e3da', '#bfb8aa'],
    mas: ['#d5c9b2', '#c9bba1', '#ddd4c2'],
    mod: ['#d3d2cc', '#c0c1bc', '#dedfd9', '#aeb1ae'],
    block: 0.45,
    earth: 0.25,
    glass: 0.45,
  },
  // Sub-Saharan Africa: off-white and beige render, faded paint, grey concrete.
  africa: {
    dom: ['#d9d2c3', '#cbbfa6', '#d4c5a4', '#c2b9a8', '#b9a586', '#ddd6c8'],
    res: ['#d6cfbf', '#c9bfaa', '#bfb8a9', '#d1c3a2', '#b4ab9b'],
    mas: ['#cbbd9f', '#bfae8e', '#d3c8b2'],
    mod: ['#c9c8c1', '#b5b6b0', '#d4d3cc', '#a3a5a2'],
    block: 0.5,
    earth: 0.35,
    glass: 0.4,
  },
  // Fallbacks by the worker's Natural Earth style (living-regions.js).
  europe: {
    dom: ['#d8d2c4', '#cfc5b0', '#b29070', '#9c6a52', '#e2ddd0'],
    res: ['#d6d0c2', '#c9bfa9', '#b7a68b', '#e0dbcf', '#a77c63'],
    mas: ['#cfc4ac', '#b9a68a', '#a5735b', '#ddd4c0'],
    mod: ['#cbc9c1', '#b4b5b0', '#d9d8d1', '#9da1a0'],
    block: 0.55,
    earth: 0.2,
    glass: 0.5,
  },
  mediterranean: {
    dom: ['#e6e1d4', '#dccfb4', '#d9c39e', '#e9e4d8', '#cdb89a'],
    res: ['#e3ddd0', '#d8cbb0', '#cfb995', '#e8e3d6'],
    mas: ['#d8c9a9', '#cdb995', '#e0d4bb'],
    mod: ['#d6d3ca', '#c4c3bb', '#e0dfd8'],
    block: 0.55,
    earth: 0.2,
    glass: 0.45,
  },
  arid: {
    dom: ['#d9c8a8', '#cdb994', '#e2d6be', '#c4ab88'],
    res: ['#d7c6a6', '#cbb793', '#e0d3ba'],
    mas: ['#d0bd9b', '#c3ad89', '#dccbaf'],
    mod: ['#d2cdbf', '#c0bbad', '#dcd8cc'],
    block: 0.65,
    earth: 0.25,
    glass: 0.55,
  },
  'east-asia': {
    dom: ['#d6d4cc', '#c9c8c1', '#dfddd4', '#b9bbb6', '#cdbfa6'],
    res: ['#d9d7cf', '#cbccc6', '#e0ded6', '#bfc2be', '#c9bba3'],
    mas: ['#cdc9be', '#c0bdb3', '#d6d3c8'],
    mod: ['#d2d3cf', '#bfc3c1', '#adb3b2', '#dedfda'],
    block: 0.35,
    earth: 0.2,
    glass: 0.45,
  },
  tropical: {
    dom: ['#e0ddd2', '#d6cdb8', '#cfc6b0', '#e6e3d9', '#c2b7a2'],
    res: ['#dedbd0', '#d0c8b4', '#c7c3b5', '#e4e1d7'],
    mas: ['#d2c8b2', '#c4b9a3', '#dad3c1'],
    mod: ['#d3d3cd', '#c1c3bf', '#dfdfda'],
    block: 0.5,
    earth: 0.3,
    glass: 0.45,
  },
  // North America and anything the table does not name: render, siding and
  // concrete first, one brick in six (round 1 was brick-heavy; San Francisco
  // came out a red-brick city).
  temperate: {
    dom: ['#c9c2b2', '#b9b4a8', '#d8d4ca', '#a78e75', '#c4b9a6', '#9b6150'],
    res: ['#c8c3b6', '#b9a184', '#a7988a', '#d4d0c6', '#bdb6a9'],
    mas: ['#c3b49a', '#b8aa94', '#a96f5a', '#cdc4b2'],
    mod: ['#c7c6bf', '#b0b2ae', '#d6d5cf', '#979c9c'],
    block: 0.5,
    earth: 0.3,
    glass: 0.5,
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
  if (lat > 36.8 && lat < 38.4 && lon > -123.2 && lon < -121.4) return 'pacific'; // the Bay Area
  if (lat > 31 && lat < 37.5 && lon > -120 && lon < -103) return 'southwest';
  if (lat > 32 && lat < 42 && lon > -124.5 && lon < -117) return 'pacific'; // the rest of coastal and central California
  const g = geography && geography.style;
  if (g === 'arid') return 'arid';
  if (g === 'oceania' || (lat < -10 && lat > -48 && lon > 112 && lon < 179)) return 'oceania';
  if (g === 'latin' || (lat < 24 && lat > -56 && lon > -118 && lon < -34)) return 'latam';
  if (lat > -35 && lat < 16 && lon > -18 && lon < 52) return 'africa';
  if (g === 'europe') return 'europe';
  if (g === 'mediterranean') return 'mediterranean';
  if (g === 'east-asia') return 'east-asia';
  if (g === 'tropical-asia' || g === 'south-asia') return 'tropical';
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
  // Curtain glass: blue-cyan at any value (OpenMapTiles' #5a81a0, the Shard's
  // #8db2b9, lightblue #add8e6), or a dark near-neutral (1 Penn Plaza #1e2320,
  // #4d4a46: a tag that dark is tinted glass or dark metal, never paint).
  const blue = s[2] > s[0] + 0.05 && s[2] >= s[1] - 0.03 && sat >= 0.12;
  const dark = mx <= 0.32 && sat < 0.4;
  const glass = blue || dark;
  let rgb = s.map(srgbLin);
  // Saturated tags (Tokyo: #ff0000 x 20) are map symbology, not paint.
  const y = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  if (sat > 0.3) rgb = rgb.map((c) => y + (c - y) * (0.3 / sat));
  const y2 = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const lo = glass ? 0.04 : 0.08;
  const t = y2 < lo ? lo / Math.max(1e-4, y2) : y2 > 0.6 ? 0.6 / y2 : 1;
  return { rgb: rgb.map((c) => Math.min(1, c * t)), mode: glass ? 1 : 2 };
}

const hashU = (a, b) => {
  let h = Math.imul((a >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b >>> 0) + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

/**
 * The look's wall colour (linear) and glass mode for one building. May set
 * style.family 4 -> 3 (an untagged office tower outside the region's glass
 * share is a concrete tower): the caller writes `style` into the vertices after.
 */
function lookWall(item, style, lookId, tileCtx) {
  const tagged = tagMaterial(item.archTags);
  if (tagged) return tagged;
  const W = wallContext(tileCtx);
  if (style.family === 4 && hashU(lookId, 0x91a5) >= (W.region.glass ?? 0.5)) style.family = 3;
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
  // The local earth: pull the hue toward the regional photo's lit ground, keep the value.
  else if (W.earth && W.region.earth) rgb = towardHue(rgb, W.earth, W.region.earth);
  const v = 0.94 + 0.12 * hashU(lookId, 0x2545f491);
  return { rgb: rgb.map((c) => Math.min(1, c * v)), mode: 0 };
}

/** The per-tile wall context: region, scale, the regional photo frame and its lit ground. */
function wallContext(tileCtx) {
  if (tileCtx.lookWalls) return tileCtx.lookWalls;
  const lon = (tileCtx.cx / 6378137) * (180 / Math.PI);
  const lat = (2 * Math.atan(Math.exp(-tileCtx.cz / 6378137)) - Math.PI / 2) * (180 / Math.PI);
  const key = regionKey(lat, lon, architectureRegion(lat, lon));
  // The regional (z11) photo: what the build already holds (lookFallback), else
  // this worker's decoded copy (the far ring), never a wait.
  let reg = tileCtx.lookFallback ? tileCtx.lookFallback.regional : undefined;
  if (reg === undefined && Number.isInteger(tileCtx.z)) {
    const cfg = photoConfig(tileCtx.worldPass.look);
    reg = regionalFrame(tileCtx.z, tileCtx.x, tileCtx.y, cfg);
    if (!reg) regionalLoad(tileCtx.z, tileCtx.x, tileCtx.y, cfg);
  }
  tileCtx.lookWalls = {
    key,
    region: REGION_LIN[key],
    scale: tileCtx.tileSpan / tileCtx.extent,
    cellM: 96,
    reg: reg || null,
    earth: reg ? regionalGround(reg, tileCtx.z, tileCtx.x, tileCtx.y) : null,
  };
  return tileCtx.lookWalls;
}

/** Decode (and strip) the glass-mode offset of a wall colour: { rgb, mode }. */
function lookWallMode(rgb) {
  const mode = rgb[0] >= OPAQUE_OFFSET - 0.5 ? 2 : rgb[0] >= GLASS_OFFSET - 0.5 ? 1 : 0;
  return { rgb: [rgb[0] - (mode === 2 ? OPAQUE_OFFSET : mode === 1 ? GLASS_OFFSET : 0), rgb[1], rgb[2]], mode };
}

/** look-roofs.js: a recorded wall recomputed with the walls context as it stands now (or null: unchanged). */
function lookWallAgain(entry, tileCtx) {
  const W = wallContext(tileCtx);
  if (!W.earth || !entry.wall) return null;
  const w = lookWall(entry.wall.item, { family: entry.wall.family }, entry.wall.id, tileCtx);
  return wallSet(w, entry.wall.baseMul);
}

export { colourOf, buildingTones, clutterTones, lookWallMode, tagMaterial, regionKey, lookRoofDecisions, lookFarPrepare, lookFarColour, lookWallAgain, GLASS_OFFSET, OPAQUE_OFFSET };

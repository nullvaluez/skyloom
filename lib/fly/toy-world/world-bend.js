/**
 * Mini-planet world curvature (airloom reference, user 2026-07-16): every
 * ground-bound vertex drops by d²·k where d is XZ distance from the player
 * — the world falls away into the void like a tiny globe. Visual only:
 * flight, DEM queries, traffic positions and picking all stay flat-earth.
 *
 * One shared uniforms object patches MANY materials (toy chunk materials +
 * every three-tile tile material); update once per frame via setBend().
 * Curvature strength is a live uniform so non-toy styles run with k=0
 * (flat) without re-compiling or re-patching materials.
 *
 * PROGRAM CACHE KEY REGISTRY (round-4 lesson: the patch closures stringify
 * identically, so every variant MUST carry its own key or three serves the
 * wrong cached program silently):
 *
 * Round 8 (P4) regeneration: the SHARED base fade patch gained a DEPTH-HAZE
 * mix (before the rim edge-fade), so every fade-family FINAL key was bumped
 * with an '-r8' suffix (fade, foam, pulse-rwy, hill). The P3 building key
 * building key was already -r8 (its program is unique to round 8 — the base
 * haze folds in under the same key, no collision, so it was NOT
 * double-suffixed then; the FIX round later bumped it to '-r8b' for the crown
 * emissive floor). The anchor variant took the same '-r8' marker for
 * generation hygiene even though its body is unchanged. The INTERMEDIATE
 * pulse/beacon keys are overwritten by the rwy/grid wrap before any compile,
 * so they keep their round-7 names.
 *
 *   'world-bend'             applyBend — bend only. GROUND-ANCHORED objects
 *                            outside the tile/chunk materials (cloud
 *                            shadows); no fade, no haze.
 *   'world-bend-air'         applyBendAir — AIRCRAFT bend (tracer ribbons/
 *                            streaks — per-VERTEX): full drop near the
 *                            ground, capped for airborne targets so a
 *                            plane above the player never renders below
 *                            eye level (GLOBE.trafficBend). No base fade/haze.
 *   'world-bend-air-anchor'  applyBendAirAnchor — same air formula but
 *                            evaluated ONCE at the instance origin (traffic
 *                            models + far billboards). Per-vertex air-drop
 *                            SHEARED rigid objects: a distance-grown rim
 *                            billboard straddling the AGL blend band had
 *                            its bottom verts ground-glued (km drop) and
 *                            its top verts eye-capped — the "vertical
 *                            contrail" bars (round-6 user report). Still the
 *                            FINAL key for the far-LOD BILLBOARD material.
 *   'world-bend-air-anchor-nav' (round 8, P6) applyNavLights — + baked
 *                            aircraft nav lights on aEmissive (vec4: rgb ×
 *                            intensity, mode in w — 0 steady, (0,0.5]
 *                            wingtip strobe, (0.5,1] belly beacon; phases
 *                            hashed per model+light in model-loader.js).
 *                            Emissive is dimmed by the instance tint's luma
 *                            so the stale-ghost ladder fades lights for
 *                            free. Wraps the air-anchor-patched traffic
 *                            MODEL material (FINAL key for it); a missing
 *                            aEmissive (primitive geometries pre-GLB-swap)
 *                            reads 0 → dark, the safe direction.
 *   'world-bend-fade-r8'     applyBendFade — bend + radial GROUND fade into
 *                            the style's void color (WORLD_EDGE.fade) + the
 *                            round-8 depth haze (setDepthHaze), mixed BEFORE
 *                            the edge fade. Base fade for tiles + every toy
 *                            chunk material; tree/grass materials END here,
 *                            everything else is wrapped further below.
 *   'world-bend-fade-foam-r13'  + shoreline foam dash (toy WATER material). Round
 *                            13 P5 folded in a value-only MOONLIGHT streak
 *                            (moonglade aligned to TOY.moonDirection, reading
 *                            uBendCenter + a new vFoamXZ varying) — a generated-
 *                            GLSL change, FINAL key bumped '-r8' → '-r13'. Reaches
 *                            ONLY the toy water material (satellite has no toy
 *                            water); off at boost 0 (byte-identical).
 *   'world-bend-fade-pulse'  + road traffic pulses on aArc — INTERMEDIATE: the
 *                            LAND material is immediately re-wrapped by
 *                            applyRunwayGlow, so this key never reaches a
 *                            compile (kept only as the userData marker).
 *   'world-bend-fade-beacon' + rooftop beacon blink on aBeacon — INTERMEDIATE:
 *                            the BUILDING material is immediately re-wrapped by
 *                            applyFacadeGrid (same reason as pulse).
 *   'world-bend-fade-pulse-rwy-r8'  (round 7) + runway edge lights on aGlow —
 *                            wraps the pulse-patched LAND material (FINAL LAND
 *                            key; -r8 inherits the base-fade haze change).
 *   'world-bend-fade-beacon-grid-r13' (round 8, P3; -r8b in the round-8 FIX
 *                            round; -r13 in round 13 P5 — added a ROOF-CONTENT
 *                            branch: up-facing roof caps (new vRoofUp/vRoofXZ
 *                            varyings) get a dim skylight LATTICE + luminance
 *                            FLOOR, so the FINAL key bumped '-r8b' → '-r13'.
 *                            Reaches ONLY the toy building material; off at
 *                            roofGridBoost/roofFloor 0 = byte-identical) + STRUCTURED facade window
 *                            GRID (edge-centered columns × 3m floors ×
 *                            contiguous lit/dark floors × office runs × corner
 *                            boost × dark-glass × street AO) + emissive crown/
 *                            spire-tip dispatch (aFacade.x ≤ -1.5) + reduced
 *                            parapet glow, reading aFacade + the new aEdge
 *                            (edgeLenM, litBias). Replaces round-7
 *                            'world-bend-fade-beacon-win' (random-dot lights).
 *                            Wraps the beacon-patched BUILDING material (FINAL
 *                            BUILDING key). The fix-round '-r8b' bump adds a
 *                            crown/spire-tip emissive FLOOR (uCrownFloor via
 *                            emissivemap_fragment) so skyline crowns clear the
 *                            bloom threshold instead of riding the toon ramp
 *                            down to near-black at range.
 *   'world-bend-anchor-r8'   (round 7; -r8 in round 8, P4) applyBendAnchor —
 *                            GROUND bend + rim dissolve evaluated at the
 *                            INSTANCE ORIGIN (rigid instanced ground objects:
 *                            town glow domes; P5 landmark monuments). Per-vertex
 *                            ground bend would shear them (round-6 lesson 2).
 *                            Body UNCHANGED — it does NOT use the base fade
 *                            patch (its additive rim-dissolve stays haze-free so
 *                            the horizon town-glow isn't dimmed); '-r8' is the
 *                            fade-family generation marker only.
 *   'world-bend-anchor-monument-r20' (round 20, C) applyBendAnchorMonument —
 *                            MARQUEE MONUMENT bend. The anchor-r8 contract
 *                            (rigid ground drop + rim dissolve on uEdgeFade)
 *                            evaluated at a per-vertex `aAnchor` attribute
 *                            instead of the instance origin, because the
 *                            marquee layer is ONE merged mesh holding every
 *                            placed monument (an InstancedMesh per model would
 *                            cost a draw per model; the batch costs exactly 1).
 *                            Every vertex of a given monument carries that
 *                            monument's ground anchor, so the whole model
 *                            translates down by one d²k with NO shear — the R6
 *                            lesson-2 rule, solved the way anchor-satbldg
 *                            solves it for streamed building chunks and
 *                            'world-bend-air-anchor' solves it for contrails.
 *                            The rim dissolve is the toy half (marquee
 *                            monuments live inside LANDMARKS_3D.maxRangeM =
 *                            the toy fade band's END, so an OPAQUE body past
 *                            the band would read as a black silhouette — the
 *                            round-8 finding); in satellite the band starts at
 *                            60 km so the same term is a no-op there. Reaches
 *                            no existing variant (new attribute + new varying),
 *                            so no other FINAL key moves. FINAL MARQUEE key.
 *   'world-bend-fade-hill-r19'  (round 7; -r13 in round 13 P4; -r19 in round 19 B) applyHillshade —
 *                            DEM-normal hillshade multiplier on the TILE
 *                            materials, sun-direction driven by the day cycle.
 *                            Strength is a live uniform (0 outside satellite —
 *                            the same hook patches toy's solid-tan tiles).
 *                            Round 13 P4 folded in HILLSHADE v2 (slope AO +
 *                            slope saturation, both INSIDE the uHillStrength
 *                            mix so a strength-0 A/B captures them and toy stays
 *                            byte-identical) AND low-AGL procedural micro-detail
 *                            (value-noise luma grain on a NEW live uMicroStrength
 *                            + vUp/vWorldXZ varyings) — a generated-GLSL change,
 *                            so the FINAL key bumped '-r8' → '-r13'. This is the
 *                            ONLY existing key the P4 tile pass moves; it reaches
 *                            satellite AND toy tiles (both recompile; toy stays
 *                            pixel-stable via the 0 gates). FINAL TILE key.
 *                            Round 19 (B) folded in SAT_QUILT — an altitude-keyed
 *                            desaturation + additive luma-flatten pair masking the
 *                            Esri CAPTURE-DATE mosaic seams at cruise (new live
 *                            uQuiltDesat/uQuiltFlat + apply-time uQuiltAnchor,
 *                            the setMicroDetail idiom) — a generated-GLSL change,
 *                            so the FINAL key bumped '-r13' → '-r19'.
 *                            ROUND 24 (C LIGHT): '-r19' → '-r19-c24' WHEN AND
 *                            ONLY WHEN `ONE_SUN` or `TERRAIN_LIGHT` is on (the
 *                            key and the injected GLSL are both derived from
 *                            `hillElevOn()`, one predicate, so they cannot
 *                            disagree). It adds `uHillElev` — the live
 *                            sun-elevation weight, kept OUT of uHillStrength
 *                            because that uniform is the style/tier gate and
 *                            carries verify-sat-depth's frozen 0.55 assertion.
 *                            0-identity condition: uHillElev 1.0 (its default,
 *                            and what every non-ONE_SUN frame writes) ⇒ the mix
 *                            factor is `uHillStrength * 1.0`. Toy is identical
 *                            regardless: the whole block sits inside the
 *                            uHillStrength envelope, which is 0 there.
 *                            REACH: this
 *                            key is the tile material in BOTH styles, so toy tiles
 *                            recompile; both quilt uniforms are 0 outside
 *                            satellite AND the whole term sits behind its own
 *                            `> 0.001` branch, so toy is pixel-identical (the R13
 *                            precedent, re-proven with an A/B toy pair).
 *   'world-bend-anchor-satbldg-r19' (round 13, P3; -r16 in round 16 A2; -r19 in round 19 B)
 *                            applyBendAnchorSat — SATELLITE
 *                            3D building bend: rigid box drop evaluated at a
 *                            per-vertex FOOTPRINT-CENTROID attribute
 *                            (aBendAnchor) so a merged non-instanced chunk mesh
 *                            drops each building as a unit (per-vertex bend
 *                            shears — R6 lesson; anchor-r8 needed instancing).
 *                            PURE vertex bend, no fade/haze (sat buildings stream
 *                            within ~3km, far inside the 60km fade) — the
 *                            MeshLambert material's SCENE lighting shades them.
 *                            Round 16 (A2) added a FRAGMENT term — a Bayer-4
 *                            screen-door `discard` on uSatBldgFade (the cull-pop
 *                            fix, SAT_BLDG_FADE) — so the FINAL key bumped
 *                            'world-bend-anchor-satbldg' → '-r16'. Off at the
 *                            uniform default 1 (the branch is gated < 0.999 and
 *                            the dither maximum is 15/16), i.e. byte-identical
 *                            R15 pixels until the layer writes a fade.
 *                            Round 19 (B) added the CONTENT HAZE — a new vSatDist
 *                            varying + a fragment mix toward uSatHazeColor across
 *                            [uSatHaze.x, uSatHaze.y], injected in the SAME
 *                            after-fog output slot the base fade patch uses for
 *                            the tile haze and fed the SAME live _atmoRim triple,
 *                            so a building and the ground under it recede on ONE
 *                            law instead of the building reading as a cut-out.
 *                            0-identity condition: uSatHazeMax 0 (setSatContentHaze
 *                            default) — the mix sits behind `if (uSatHazeMax > 0.0)`
 *                            so the branch never runs and R18 pixels are exact.
 *                            REACH: sat buildings only. Ships OFF in R19 (the depth
 *                            post pass already covers high tier — see
 *                            AERIAL_PERSPECTIVE.content). FINAL key bumped
 *                            '-r16' → '-r19'.
 *                            Reaches no existing variant; FINAL SAT-BUILDING key.
 *   'world-bend-anchor-satskyline-r19' (round 18, A2; -r19 in round 19 B) applyBendAnchorSatSkyline
 *                            — SATELLITE DISTANT BLOCK-MASS bend. The
 *                            anchor-satbldg body verbatim (rigid per-building
 *                            drop off aBendAnchor; one merged mesh per streamed
 *                            GROUP of z14 tiles), plus TWO independent Bayer-4
 *                            screen-door terms on the SAME dither the near ring
 *                            uses: (a) a NEAR-FIELD HOLE — fragments whose
 *                            ANCHOR sits inside uSkyHole.x dissolve out,
 *                            feathered over uSkyHole.y, so the mass shows only
 *                            BEYOND the detail bubble (no double-draw, no
 *                            z-fight) and the hole EASES to 0 as the detail ring
 *                            fades, and (b) the ring's own far AGL cull on
 *                            uSkyFade. Both are 0-gated to identity: hole radius
 *                            0 + fade 1 ⇒ no branch runs ⇒ pixel-identical to a
 *                            plain anchor-sat bend. It is a SEPARATE variant (a
 *                            new varying + two uniforms) so no existing key
 *                            moves. Round 19 (B) added the SAME content-haze mix
 *                            the near ring got, on the SAME uniforms — the mass
 *                            and the detail city must recede on ONE law or the
 *                            R18 hole crossfade reveals a colour step exactly
 *                            where it is meant to hide. No new varying: the haze
 *                            rides the hole's existing vSkyDist. 0-identity
 *                            condition: uSatHazeMax 0 ⇒ branch never runs.
 *                            FINAL key bumped '-r18' → '-r19'.
 *                            FINAL SAT-SKYLINE key.
 *   'world-bend-road-satnight-r19' (round 16, A2; -r19 in round 19 C) applyBendRoadSat — SATELLITE
 *                            ground-light NETWORK: per-vertex d²k bend (flat
 *                            draped ribbons follow the curve exactly like the
 *                            tiles and the sat water — an anchor bend would keep
 *                            a 9 km chunk rigid and float its edges) + vArc /
 *                            vCls varyings, and an 8-entry class-weight LUT
 *                            (index 0 → 0: a missing aRoadCls reads 0 = DARK)
 *                            gating five independent fragment terms: night
 *                            steady glow, streetlight dots (cls 4-6), headlight
 *                            dash trains (cls 1-3), day glint dashes (cls 1-2)
 *                            and steady runway edge lights (cls 7). The sun
 *                            drives UNIFORMS ONLY (setSatRoadMix) — the draw
 *                            count is identical day and night. MeshBasic +
 *                            additive, so writing black IS invisibility.
 *                            Round 19 (C) added the two SUBURB_NIGHT terms —
 *                            the round's FOURTH and FINAL budgeted key move.
 *                            (F) a cls 5-6 STREETLIGHT ENVELOPE: the class
 *                            weight rw multiplies every term, so a 9 m
 *                            residential minor rendered at 0.35 of the gain
 *                            the R16 sweep calibrated on 26 m arteries —
 *                            Powell's night suburbia was multiplied into the
 *                            floor (field study P10). uStreet56 ADDS to the
 *                            weight for exactly those two classes; the
 *                            R16-swept night.intensity is untouched (it is a
 *                            pending user checkpoint). (G) a DAYLIGHT SEAM on
 *                            cls 1-4: a pale steady term so the network reads
 *                            as concrete by day, where R16 shipped only a
 *                            glint dash on cls 1-2. REACH: satellite roads
 *                            only — this key is not shared.
 *                            0-identity condition: uStreet56 (0,0) AND
 *                            uRoadDaySeam 0 (their uniform defaults, and what
 *                            SUBURB_NIGHT.enabled false leaves them at) —
 *                            rwEff = rw + 0.0 is bit-identical to rw and the
 *                            seam adds literally nothing to `gain`.
 *                            FINAL key bumped '-r16' → '-r19'.
 *                            Reaches no existing variant; FINAL SAT-ROAD key.
 *   'cloud-lit-c24'          (ROUND 24, C LIGHT — CLOUD_LIT) NOT a world-bend
 *                            variant, listed here because this header is the
 *                            one place that inventories shader identities.
 *                            lib/fly/cloud-material.js subclasses the material
 *                            CLASS drei's <Clouds> instantiates and injects a
 *                            fake-hemisphere normal + Henyey-Greenstein
 *                            back-scatter into the sprite fragment. Its
 *                            onBeforeCompile source IS its identity, so it
 *                            carries its own customProgramCacheKey. Reaches
 *                            ONLY the satellite cumulus/cirrus decks (toy is
 *                            MeshBasic and never sees the class), costs 0 extra
 *                            draws, and early-outs at uCloudMix 0 = the plain
 *                            Lambert deck bit-for-bit. NOT in the PREWARM warm
 *                            set, deliberately: it compiles once at boot with
 *                            the deck it belongs to and introduces NO new
 *                            mid-flight state flip (the style flip that swaps
 *                            Lambert↔Basic already existed), and prewarm exists
 *                            for mid-flight flips (recon WB-4), not for boot.
 *   ── R24 C: TWO KEY-NEUTRAL SHADER-TEXT EDITS, listed because this header is
 *      the inventory and a reader must not conclude from its absence that no
 *      other shader text moves. Neither takes a cache key, and in both cases
 *      that is CORRECT rather than an omission — three's key is derived from
 *      material state, and neither edit changes any material's state.
 *   (no key) THE SHADOW KERNEL — lib/fly/shadow-kernel.js, behind
 *                            SHADOW_CALM. Two string edits to three's SHARED
 *                            `ShaderChunk.shadowmap_pars_fragment`, installed
 *                            ONCE from FlyScene's module body before any
 *                            material in the app compiles: (a) the PCF branch
 *                            gets the reversed-depth `#ifdef` three already
 *                            ships in its VSM and BASIC branches and omits
 *                            here, (b) the 5-tap Vogel rotation hashes the
 *                            SHADOW-MAP texel instead of `gl_FragCoord`, so
 *                            camera motion cannot change a fragment's kernel.
 *                            NO KEY because no MATERIAL is touched: every
 *                            shadow receiver simply compiles a different chunk
 *                            body, and three's program cache key is a function
 *                            of material state, not of chunk contents. That is
 *                            exactly the property three's CSM.js lacks — it
 *                            patches through `onBeforeCompile`, the hook all
 *                            15 variants above already own, and would re-key
 *                            every one of them. Flag off: the module returns
 *                            before reading the chunk at all, so the text is
 *                            three's verbatim and every shadow program is the
 *                            R21 program.
 *   (no key) THE CoC DEPTH PATCH — components/fly/Effects.jsx
 *                            `patchDofDepth`, behind DEPTH_FIX. Deletes
 *                            postprocessing's own `depth=1.0-depth;` from ONE
 *                            DepthOfFieldEffect INSTANCE's CoC material, so
 *                            the raw reversed value reaches three's
 *                            reversed-aware `perspectiveDepthToViewZ` instead
 *                            of being converted twice (recon L2 / FL-07). NO
 *                            KEY because the CoC material is postprocessing's,
 *                            not a world-bend variant, and it carries no
 *                            `customProgramCacheKey` at all — its identity IS
 *                            its instance. The el()/raw() twin rule covers it
 *                            instead: `patchDofDepth` is called from BOTH, so
 *                            the pre-warm cannot compile a different program
 *                            than production binds. The AerialPerspective sky
 *                            early-out moves under the same flag and is part
 *                            of the same merged EffectPass text, which the
 *                            pre-warm rebuilds from the same descriptor list.
 *   'world-bend-water-satglint-r13' (round 13, P4) applyBendWaterSat — SATELLITE
 *                            water-glint bend: a PER-VERTEX d²k drop on the flat
 *                            water polygons (they follow the bent ground like the
 *                            tiles do — an anchor bend would float a big harbor's
 *                            edges off the curve). MeshPhong transparent-additive
 *                            base + animated normal map = sun sparkle; the bend
 *                            injection is vertex-only, no fade. Reaches no existing
 *                            variant; FINAL SAT-WATER key.
 * A material gets exactly ONE base variant (first call wins); the foam/
 * pulse/beacon/window/runway layers wrap an already-patched material and
 * re-key it.
 *
 * ── R24 C (LINEAR_HAZE): READ THIS BEFORE "FIXING" getRimColor ────────────
 * Every "OUTPUT-space (raw sRGB)" claim in the uniform comments below is a
 * PRE-R13 statement. Since the EffectComposer owns the render, materials draw
 * into a linear HalfFloat target and three selects the WORKING color space for
 * any bound render target (three.module.js:7585), so <colorspace_fragment> is
 * an identity and the injection slot is LINEAR. The haze/fade SETTERS therefore
 * decode their authored sRGB (see `hazeC`/`srgbToLinear` above the uniforms).
 *
 * THE FLAG IS READ THROUGH ONE ACCESSOR, `linearHazeOn()`, never off the
 * constant: it carries the `window.__flyLinearHazeOverride` dev pin so the
 * decode can be A/B'd on one machine in one build (a two-build A/B cannot be
 * compared frame-for-frame). `AerialPerspective`'s `uHazeColor` — the only
 * reader outside this file — imports the same accessor, so a pin can never
 * leave the tree half-decoded. verify-c-flagoff gates that there is no second
 * reader on the raw constant.
 *
 * `getRimColor()` deliberately does NOT follow: its contract is the AUTHORED
 * sRGB triple, and it has exactly one consumer — SatVegLayer's canopy haze —
 * which decodes with SRGBColorSpace itself (SatVegLayer.jsx:421-425). Handing
 * it the decoded uniform would DOUBLE-decode the one content layer that already
 * got the color space right. That is why the setters stash `_rimRaw` and
 * getRimColor reads the stash rather than the uniform. Do not "simplify" it
 * back to the uniform read without moving SatVegLayer's decode in the same
 * commit.
 */

import {
  AERIAL_LAW,
  LINEAR_HAZE,
  ONE_SUN,
  SHADOW_CALM,
  SURFACE_CALM,
  TERRAIN_LIGHT,
} from '@/lib/fly/fly-constants';
// R24 D (AERIAL_LAW): the ONE atmosphere law, as a shared GLSL string + a
// shared uniform block. `scripts/verify-atmo-law.mjs` parses that very string
// and proves it equals the JS mirror at 4,160 points, so the per-material term
// injected below and the post pass in AerialPerspective.jsx cannot drift.
import {
  ATMO_GLSL_DECL,
  ATMO_GLSL_VERTEX,
  ATMO_GLSL_FRAGMENT,
  atmoUniforms,
} from '@/lib/fly/atmo-law';

// ---------------------------------------------------------------------------
// R24 C (LINEAR_HAZE — recon L1). THE COLOR SPACE OF THE HAZE TARGETS.
//
// The registry comments below still say "OUTPUT-space (raw sRGB)" and that was
// TRUE when the fade patch was written: the mix lands after three's
// <colorspace_fragment>, which converted linear→sRGB when the frame was drawn
// straight to the canvas. Since R13 the EffectComposer owns the render, so the
// material writes into a linear HalfFloat render target, and three picks
// `ColorManagement.workingColorSpace` for any bound render target
// (three.module.js:7585) — <colorspace_fragment> is an IDENTITY there. The
// slot is therefore LINEAR, and the raw sRGB components these setters write
// are ~2.2x too bright relative to the fog (FlyScene: setRGB(...,SRGBColorSpace))
// and the SkyDome (SkyDome.jsx:30, same) that the terrain is supposed to melt
// into. That is the horizon band that "can never match by construction".
//
// The fix is entirely at the SETTERS — no GLSL, no cache-key move, no draw:
// decode the authored sRGB to the working (linear) space, exactly the way
// Color.setRGB(r, g, b, SRGBColorSpace) does. `srgbToLinear` below is three's
// SRGBToLinear transfer function verbatim (three.module.js ColorManagement).
//
// getRimColor()'s contract ("raw sRGB 0..1") is preserved by stashing the
// AUTHORED triple: SatVegLayer converts it with SRGBColorSpace itself, and
// handing it an already-linear value would double-decode the canopy haze.
// With the flag off the stash and the uniform hold the same numbers, so the
// stash read is byte-identical to the previous uniform read.
const _rimRaw = { r: 0, g: 0, b: 0 };

// ---------------------------------------------------------------------------
// R24 C (recon T11) — THE ONE polygonOffset UNITS HELPER.
//
// three negates only the polygonOffset FACTOR under a reversed depth buffer
// (WebGLState.js:860-876) and leaves the UNITS alone, so an authored (-f, -u)
// reaches GL as (+f, -u) with the two terms pushing opposite ways. R21 (P8)
// fixed that at exactly TWO call sites — SatTintLayer and the shadow catcher —
// each with its own inline copy of the test, which is how a sign trap survives:
// the next overlay author copies a material, not a lesson. This is now the only
// implementation, and `scripts/verify-depth-offset.mjs` fails the build if a
// raw `polygonOffsetUnits:` literal appears anywhere outside it.
//
// `gl` is optional. Components have a renderer and pass it (unchanged
// behaviour, and the live capability is always the honest source — three
// silently falls back to an ordinary depth buffer when EXT_clip_control is
// missing). The streaming ENGINES build materials with no renderer in scope, so
// they pass null and read the value FlyCanvas latched at context creation.
let _depthReversed = null;

/** Latched once from the live renderer (FlyCanvas onCreated). */
export function setDepthReversed(v) {
  _depthReversed = v === true;
}

/** The authored units, sign-corrected for the live depth convention. */
export function offsetUnits(gl, units) {
  const reversed =
    gl?.capabilities?.reversedDepthBuffer === true || (!gl && _depthReversed === true);
  return SURFACE_CALM.enabled && SURFACE_CALM.depthOffsetFix && reversed ? -units : units;
}

/**
 * R24 C (recon T11): the ground-overlay offset for layers that had NONE.
 * Roads and satellite water are `depthWrite:false, depthTest:true` additives
 * draped on a bilinear grid that disagrees with the tile mesh by metres on
 * relief (recon T8), so on slopes tilted away from the camera they simply lose
 * the depth test and vanish. Returns a no-op descriptor with the flag off, so
 * the material literal is byte-identical there.
 */
export function groundOverlayOffset(factor = -1, units = -1) {
  if (!SHADOW_CALM.enabled) return null;
  return {
    polygonOffset: true,
    polygonOffsetFactor: factor,
    polygonOffsetUnits: offsetUnits(null, units),
  };
}

/**
 * R24 (Fable ruling, C proposal) — THE SHARED VARIANT-KEY HELPER.
 *
 * Round 24 is the first round in which TWO owners inject GLSL into the SAME
 * patch function: C's `uHillElev` / fragment-stage N.L and D's per-material
 * atmosphere term both land inside `applyHillshade`. Two independent key
 * expressions ('-c24' and '-d24') are mutually exclusive branches, so with both
 * flags on the surviving branch would name a key that does not describe the
 * emitted text -- and three would then serve a program compiled from different
 * GLSL. That is exactly the round-4 defect this registry exists to prevent,
 * arriving for the first time from a MERGE rather than from one author.
 *
 * The rule, for any key more than one owner bumps: build the suffix from ONE
 * token per contributing flag, in a FIXED order, so every combination is
 * distinct and no owner needs to know another's tokens -- each adds one entry.
 * Reserved tokens, in this FIXED order: e = ONE_SUN (C), f = TERRAIN_LIGHT (C),
 * a = AERIAL_LAW (D), l = LOD_CROSSFADE (D), b = CHUNK_FADE (B, deferred --
 * B's toy uBirth is not in this tree yet). All off => the base key, character
 * for character.
 *
 * Entries are PLAIN BOOLEANS, never flag objects, because a contributor's
 * predicate is not always a constants read: D's 'l' is "the lodFade argument
 * to applyHillshade is non-null", decided by the app, and world-bend is
 * deliberately constants-free about that. Each owner evaluates its own
 * predicate at its own call site.
 *
 * @param {string} base the R-round key, e.g. 'world-bend-fade-hill-r19'
 * @param {Array<Array>} tokens [[boolean, token], ...] in FIXED order
 */
export function r24VariantKey(base, tokens) {
  let t = '';
  for (const [on, tok] of tokens) if (on) t += tok;
  return t ? base + '-' + t + '24' : base;
}

/** three's sRGB -> linear-sRGB transfer function (ColorManagement, verbatim). */
function srgbToLinear(c) {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

/**
 * R24 C — the ONE reader of `LINEAR_HAZE.enabled`, anywhere.
 *
 * DEV-ONLY OVERRIDE (`window.__flyLinearHazeOverride`, the R16 weather-pin
 * idiom as it stands in R24 — lod-crossfade.js `cfg()` / step-safe.js
 * `resolveStepSafe()`):
 *
 *   absent            → the constant, so flag-off identity is untouched BY
 *                       CONSTRUCTION (the branch is not even evaluated)
 *   { enabled: false } → the sRGB-authored path (the R21 numbers)
 *   { enabled: true }  → the decoded path
 *   a partial object   → merged over the constant, like every other R24 pin
 *
 * A/B-ing this flag needs a RUNTIME pin: the alternative is two builds, and
 * two builds cannot be compared frame-for-frame on one machine. Fleet pins are
 * installed by `addInitScript` before any module runs, and BOTH readers of this
 * accessor evaluate at SETTER/FRAME time — nothing here decodes an authored
 * triple at module init — so a pin set at boot governs the whole tree, with no
 * mixed half where one channel already baked the constant in.
 *
 * `process.env.NODE_ENV` leads the condition so production compiles the pin
 * out entirely and this is a plain constant read again.
 */
export function linearHazeOn() {
  if (
    process.env.NODE_ENV === 'development' &&
    typeof window !== 'undefined' &&
    window.__flyLinearHazeOverride != null
  ) {
    const p = window.__flyLinearHazeOverride;
    return typeof p === 'object' ? !!{ ...LINEAR_HAZE, ...p }.enabled : !!p;
  }
  return LINEAR_HAZE.enabled;
}

/** Decode one authored sRGB component into the buffer's space. Flag off = identity. */
function hazeC(c) {
  return linearHazeOn() ? srgbToLinear(c) : c;
}

const uniforms = {
  uBendCenter: { value: { x: 0, y: 0, isVector2: true } },
  uBendK: { value: 0 },
  // Edge fade (fade variant only): start/end in meters of XZ distance from
  // the bend center. Defaults sit beyond the far plane = disabled until
  // setEdgeFade() styles them.
  uEdgeFade: { value: { x: 1e9, y: 2e9, isVector2: true } },
  // OUTPUT-space (raw sRGB) color: the fade mixes AFTER three's
  // tonemapping/colorspace/fog chunks — exactly where and how fog blends —
  // so raw hex components make terrain melt seamlessly into fog/void.
  uEdgeColor: { value: { r: 0, g: 0, b: 0 } },
  // Round 8 (P4) DEPTH HAZE (aerial perspective): the GROUND (fade variant)
  // mixes toward uHazeColor across [uHaze.x, uHaze.y] of XZ distance, BEFORE
  // the rim edge fade. OUTPUT-space (raw sRGB) like uEdgeColor — the mix lands
  // in the same after-fog slot. Off (max 0) until setDepthHaze() styles it
  // (0 outside toy). endM must sit UNDER the style's fade start so the rim
  // gates hold (toy: 13km haze end < 14km fade start).
  uHaze: { value: { x: 1e9, y: 2e9, isVector2: true } },
  uHazeColor: { value: { r: 0, g: 0, b: 0 } },
  uHazeMax: { value: 0 },
  // Air variant (traffic): the player's absolute eye altitude + ground
  // elevation (setBendEye per frame) and the GLOBE.trafficBend shape
  // (aglLo, aglHi, capFrac — set once via applyBendAir's cfg).
  uEyeY: { value: 0 },
  uRefGroundY: { value: 0 },
  uAirAgl: { value: { x: 150, y: 900, isVector2: true } },
  uAirCapFrac: { value: 0.8 },
  // Round 7 altitude lift (user: "aircraft ABOVE us appear below/at the
  // horizon"): the cap fraction ramps from uAirCapFrac (near, physical) to
  // uAirCapFar (far) across uAirLiftRange — a NEGATIVE far value turns the
  // cap into an exaggeration, so distant high traffic reads visibly UP.
  uAirLiftRange: { value: { x: 3000, y: 20000, isVector2: true } },
  uAirCapFar: { value: -1.5 }, // = 1 - GLOBE.trafficBend.farLiftBoost
};

// Replaces three's <project_vertex>: bend in WORLD space, then continue the
// pipeline manually. Keeps instancing; drops batching (unused here).
const bendProject = (fade) => /* glsl */ `
vec4 wPos = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  wPos = instanceMatrix * wPos;
#endif
wPos = modelMatrix * wPos;
float bendD = distance( wPos.xz, uBendCenter );
wPos.y -= bendD * bendD * uBendK;
${fade ? 'vBendDist = bendD;' : ''}
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

function patchMaterial(material, fade) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = fade ? 'fade' : 'bend';
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBendCenter = uniforms.uBendCenter;
    shader.uniforms.uBendK = uniforms.uBendK;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;${
          fade ? '\nvarying float vBendDist;' : ''
        }`
      )
      .replace('#include <project_vertex>', bendProject(fade));
    if (fade) {
      shader.uniforms.uEdgeFade = uniforms.uEdgeFade;
      shader.uniforms.uEdgeColor = uniforms.uEdgeColor;
      shader.uniforms.uHaze = uniforms.uHaze;
      shader.uniforms.uHazeColor = uniforms.uHazeColor;
      shader.uniforms.uHazeMax = uniforms.uHazeMax;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vBendDist;\nuniform vec2 uEdgeFade;\nuniform vec3 uEdgeColor;\nuniform vec2 uHaze;\nuniform vec3 uHazeColor;\nuniform float uHazeMax;'
        )
        .replace(
          '#include <fog_fragment>',
          '#include <fog_fragment>\n' +
            '// round-8 depth haze (aerial perspective): recede toward the haze\n' +
            '// tone with distance BEFORE the rim fade eats the terrain\n' +
            'gl_FragColor.rgb = mix( gl_FragColor.rgb, uHazeColor, uHazeMax * smoothstep( uHaze.x, uHaze.y, vBendDist ) );\n' +
            'gl_FragColor.rgb = mix( gl_FragColor.rgb, uEdgeColor, smoothstep( uEdgeFade.x, uEdgeFade.y, vBendDist ) );'
        );
    }
  };
  // Explicit per-variant cache keys: both variants' onBeforeCompile
  // closures stringify identically (shared body, captured flag), so the
  // default toString()-based key would let three serve a bend-only program
  // to a fade material. Hundreds of tiles still share one program per
  // material type per variant.
  material.customProgramCacheKey = () => (fade ? 'world-bend-fade-r8' : 'world-bend');
  material.needsUpdate = true;
}

/** Patch a material to bend with the world (no edge fade). Idempotent. */
export function applyBend(material) {
  patchMaterial(material, false);
}

/** Patch a GROUND material to bend AND fade into the void at the rim. */
export function applyBendFade(material) {
  patchMaterial(material, true);
}

// AIRCRAFT bend (traffic models / billboards / tracers): the raw d²k drop
// pulled distant HIGH traffic below the horizon (a FL210 jet 25nm out
// dropped ~13km — "planes higher than us render below us"). Near the
// ground the full drop stays (grounded/landing traffic hugs the drawn
// terrain); airborne, the drop is capped at (y − eye) × capFrac so a
// target above the player asymptotes toward the horizon line at range —
// like real distant traffic — and can never sink below eye level.
const airProject = /* glsl */ `
vec4 wPos = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  wPos = instanceMatrix * wPos;
#endif
wPos = modelMatrix * wPos;
float bendD = distance( wPos.xz, uBendCenter );
float dropRaw = bendD * bendD * uBendK;
float airborne = smoothstep( uAirAgl.x, uAirAgl.y, wPos.y - uRefGroundY );
float capF = mix( uAirCapFrac, uAirCapFar, smoothstep( uAirLiftRange.x, uAirLiftRange.y, bendD ) );
float capped = min( dropRaw, max( 0.0, wPos.y - uEyeY ) * capF );
wPos.y -= mix( dropRaw, capped, airborne );
vAirDist = bendD;
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Patch an AIRCRAFT material with the altitude-aware bend. cfg (once,
 * shared): { aglLoM, aglHiM, keepFrac } from GLOBE.trafficBend.
 */
export function applyBendAir(material, cfg) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = 'air';
  if (cfg) {
    uniforms.uAirAgl.value.x = cfg.aglLoM;
    uniforms.uAirAgl.value.y = cfg.aglHiM;
    uniforms.uAirCapFrac.value = 1 - cfg.keepFrac;
    if (cfg.liftNearM != null) {
      uniforms.uAirLiftRange.value.x = cfg.liftNearM;
      uniforms.uAirLiftRange.value.y = cfg.liftFarM;
      uniforms.uAirCapFar.value = 1 - cfg.farLiftBoost;
    }
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBendCenter = uniforms.uBendCenter;
    shader.uniforms.uBendK = uniforms.uBendK;
    shader.uniforms.uEyeY = uniforms.uEyeY;
    shader.uniforms.uRefGroundY = uniforms.uRefGroundY;
    shader.uniforms.uAirAgl = uniforms.uAirAgl;
    shader.uniforms.uAirCapFrac = uniforms.uAirCapFrac;
    shader.uniforms.uAirLiftRange = uniforms.uAirLiftRange;
    shader.uniforms.uAirCapFar = uniforms.uAirCapFar;
    shader.uniforms.uEdgeFade = uniforms.uEdgeFade;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;\nuniform float uEyeY;\nuniform float uRefGroundY;\nuniform vec2 uAirAgl;\nuniform float uAirCapFrac;\nuniform vec2 uAirLiftRange;\nuniform float uAirCapFar;\nvarying float vAirDist;'
      )
      .replace('#include <project_vertex>', airProject);
    // Rim dissolve (round 6): trails PAST the ground's edge-fade band drew
    // over the void — and a trail pointing radially away foreshortens its
    // drop gradient into a floating vertical bar. Additive material: fading
    // the color to black IS transparency. Rides the same style-driven
    // uEdgeFade band as the ground, so trails and terrain agree per style.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vAirDist;\nuniform vec2 uEdgeFade;'
      )
      .replace(
        '#include <fog_fragment>',
        '#include <fog_fragment>\n' +
          'gl_FragColor.rgb *= 1.0 - smoothstep( uEdgeFade.x, uEdgeFade.y, vAirDist );'
      );
  };
  material.customProgramCacheKey = () => 'world-bend-air';
  material.needsUpdate = true;
}

// Anchor variant: the SAME air formula, but the drop is computed at the
// instance origin and applied uniformly — rigid objects (aircraft models,
// camera-facing billboards) translate down as a unit instead of shearing.
const airAnchorProject = /* glsl */ `
vec4 wPos = vec4( transformed, 1.0 );
vec4 wRef = vec4( 0.0, 0.0, 0.0, 1.0 );
#ifdef USE_INSTANCING
  wPos = instanceMatrix * wPos;
  wRef = instanceMatrix * wRef;
#endif
wPos = modelMatrix * wPos;
wRef = modelMatrix * wRef;
float bendD = distance( wRef.xz, uBendCenter );
float dropRaw = bendD * bendD * uBendK;
float airborne = smoothstep( uAirAgl.x, uAirAgl.y, wRef.y - uRefGroundY );
float capF = mix( uAirCapFrac, uAirCapFar, smoothstep( uAirLiftRange.x, uAirLiftRange.y, bendD ) );
float capped = min( dropRaw, max( 0.0, wRef.y - uEyeY ) * capF );
wPos.y -= mix( dropRaw, capped, airborne );
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Patch a RIGID aircraft material (instanced models/billboards) with the
 * altitude-aware bend evaluated once per instance. cfg as applyBendAir.
 */
export function applyBendAirAnchor(material, cfg) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = 'air-anchor';
  if (cfg) {
    uniforms.uAirAgl.value.x = cfg.aglLoM;
    uniforms.uAirAgl.value.y = cfg.aglHiM;
    uniforms.uAirCapFrac.value = 1 - cfg.keepFrac;
    if (cfg.liftNearM != null) {
      uniforms.uAirLiftRange.value.x = cfg.liftNearM;
      uniforms.uAirLiftRange.value.y = cfg.liftFarM;
      uniforms.uAirCapFar.value = 1 - cfg.farLiftBoost;
    }
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBendCenter = uniforms.uBendCenter;
    shader.uniforms.uBendK = uniforms.uBendK;
    shader.uniforms.uEyeY = uniforms.uEyeY;
    shader.uniforms.uRefGroundY = uniforms.uRefGroundY;
    shader.uniforms.uAirAgl = uniforms.uAirAgl;
    shader.uniforms.uAirCapFrac = uniforms.uAirCapFrac;
    shader.uniforms.uAirLiftRange = uniforms.uAirLiftRange;
    shader.uniforms.uAirCapFar = uniforms.uAirCapFar;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;\nuniform float uEyeY;\nuniform float uRefGroundY;\nuniform vec2 uAirAgl;\nuniform float uAirCapFrac;\nuniform vec2 uAirLiftRange;\nuniform float uAirCapFar;'
      )
      .replace('#include <project_vertex>', airAnchorProject);
  };
  material.customProgramCacheKey = () => 'world-bend-air-anchor';
  material.needsUpdate = true;
}

// --- Round 8 (P6): aircraft nav lights (traffic model material) -------------
// model-loader.js bakes aEmissive (vec4) into every merged fleet geometry:
// rgb = emissive color × intensity on nav-light octahedra (and any source-
// model emissive), (0,0,0,0) on hull verts. This layer animates them on one
// clock — zero extra draws, the lights live inside the instanced meshes.

const navUniforms = {
  uNavT: { value: 0 }, // seconds; advanced once per frame by TrafficLayer
  uStrobeHz: { value: 1.2 },
  uStrobeDuty: { value: 0.06 },
  uBeaconHz: { value: 0.9 },
};

/**
 * Wrap the (already applyBendAirAnchor-patched) traffic MODEL material with
 * the baked nav-light emissive. cfg: NAV_LIGHTS (strobeHz/strobeDuty/
 * beaconHz). Mode dispatch on aEmissive.w: ≤0 steady, ≤0.5 strobe
 * (phase = w×2), else beacon (phase = (w−0.5)×2, 35% ember between blinks).
 * The luma-of-vColor factor rides the EXISTING instance-tint stale ladder
 * (white → fog) so ghosting traffic dims its lights without any new
 * per-instance data; it is compiled out until the material actually has
 * vertex/instance colors (the primitive-geometry boot frames).
 */
export function applyNavLights(material, cfg) {
  if (!material || material.userData.__navLights) return;
  material.userData.__navLights = true;
  if (cfg) {
    navUniforms.uStrobeHz.value = cfg.strobeHz;
    navUniforms.uStrobeDuty.value = cfg.strobeDuty;
    navUniforms.uBeaconHz.value = cfg.beaconHz;
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uNavT = navUniforms.uNavT;
    shader.uniforms.uStrobeHz = navUniforms.uStrobeHz;
    shader.uniforms.uStrobeDuty = navUniforms.uStrobeDuty;
    shader.uniforms.uBeaconHz = navUniforms.uBeaconHz;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aEmissive;\nvarying vec4 vEmissive;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvEmissive = aEmissive;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec4 vEmissive;\nuniform float uNavT;\nuniform float uStrobeHz;\nuniform float uStrobeDuty;\nuniform float uBeaconHz;'
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float navOn = vEmissive.w <= 0.0 ? 1.0
  : vEmissive.w <= 0.5 ? step( fract( uNavT * uStrobeHz + vEmissive.w * 2.0 ), uStrobeDuty )
  : 0.35 + 0.65 * step( fract( uNavT * uBeaconHz + ( vEmissive.w - 0.5 ) * 2.0 ), 0.4 );
float navTint = 1.0;
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  // stale-fade rides along: the instance tint dims toward fog, so do lights
  navTint = clamp( ( vColor.r + vColor.g + vColor.b ) * 0.5, 0.0, 1.0 );
#endif
totalEmissiveRadiance += vEmissive.rgb * navOn * navTint;`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-air-anchor-nav';
  material.needsUpdate = true;
}

/** Per-frame (TrafficLayer): advance the nav-light strobe/beacon clock. */
export function setNavTime(t) {
  navUniforms.uNavT.value = t;
}

/** Per-frame: bend center (rebased world XZ) + strength k = 1/(2R). */
export function setBend(cx, cz, k) {
  uniforms.uBendCenter.value.x = cx;
  uniforms.uBendCenter.value.y = cz;
  uniforms.uBendK.value = k;
}

/** Per-frame (with setBend): player eye altitude + ground elevation. */
export function setBendEye(eyeY, groundY) {
  uniforms.uEyeY.value = eyeY;
  uniforms.uRefGroundY.value = groundY;
}

// --- Shoreline foam animation (water material only) -------------------------
// The vector worker bakes an `aFoam` per-vertex attribute into the water
// group: accumulated arc-length (m) along foam ribbons, -1 sentinel on
// plain water. This layer scrolls a bright dash train along that arc —
// zero extra draws (the foam lives inside the merged water geometry).

const foamUniforms = {
  uFoamT: { value: 0 },
  uFoamLenM: { value: 180 },
  // Round 13 Phase 5: toy water MOONLIGHT streak (all inert until armed).
  uMoonDir2: { value: { x: 0.52, y: -0.85, isVector2: true } }, // moon azimuth (xz unit)
  uMoonStreakHalfW: { value: 260 },
  uMoonStreakNear: { value: 400 },
  uMoonStreakFar: { value: 9000 },
  uMoonStreakBoost: { value: 0 }, // 0 → streak off (byte-identical water)
  uMoonShimmer: { value: 0.006 },
};

/**
 * Wrap a (already bend-fade-patched) water material with the scrolling
 * foam dash. MUST carry its own program cache key — a foam-less material
 * sharing 'world-bend-fade-r8' would be served the wrong program.
 */
export function applyFoamLayer(material, lenM, moonCfg) {
  if (!material || material.userData.__foamLayer) return;
  material.userData.__foamLayer = true;
  if (lenM != null) foamUniforms.uFoamLenM.value = lenM;
  if (moonCfg) {
    if (moonCfg.dir) {
      const n = Math.hypot(moonCfg.dir[0], moonCfg.dir[1]) || 1;
      foamUniforms.uMoonDir2.value.x = moonCfg.dir[0] / n;
      foamUniforms.uMoonDir2.value.y = moonCfg.dir[1] / n;
    }
    if (moonCfg.enabled) {
      foamUniforms.uMoonStreakHalfW.value = moonCfg.halfWidthM;
      foamUniforms.uMoonStreakNear.value = moonCfg.nearM;
      foamUniforms.uMoonStreakFar.value = moonCfg.farM;
      foamUniforms.uMoonStreakBoost.value = moonCfg.boost;
      foamUniforms.uMoonShimmer.value = moonCfg.shimmer;
    }
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uFoamT = foamUniforms.uFoamT;
    shader.uniforms.uFoamLenM = foamUniforms.uFoamLenM;
    shader.uniforms.uBendCenter = uniforms.uBendCenter; // player XZ (moonglade origin)
    shader.uniforms.uMoonDir2 = foamUniforms.uMoonDir2;
    shader.uniforms.uMoonStreakHalfW = foamUniforms.uMoonStreakHalfW;
    shader.uniforms.uMoonStreakNear = foamUniforms.uMoonStreakNear;
    shader.uniforms.uMoonStreakFar = foamUniforms.uMoonStreakFar;
    shader.uniforms.uMoonStreakBoost = foamUniforms.uMoonStreakBoost;
    shader.uniforms.uMoonShimmer = foamUniforms.uMoonShimmer;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aFoam;\nvarying float vFoam;\nvarying vec2 vFoamXZ;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFoam = aFoam;\nvFoamXZ = ( modelMatrix * vec4( position, 1.0 ) ).xz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vFoam;\nvarying vec2 vFoamXZ;\nuniform float uFoamT;\nuniform float uFoamLenM;\nuniform vec2 uBendCenter;\nuniform vec2 uMoonDir2;\nuniform float uMoonStreakHalfW;\nuniform float uMoonStreakNear;\nuniform float uMoonStreakFar;\nuniform float uMoonStreakBoost;\nuniform float uMoonShimmer;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vFoam >= 0.0 ) {
  float ph = fract( vFoam / uFoamLenM - uFoamT );
  float dash = smoothstep( 0.30, 0.48, ph ) * ( 1.0 - smoothstep( 0.60, 0.82, ph ) );
  diffuseColor.rgb *= 0.55 + 0.75 * dash;
}
// Round 13 P5 moonglade: a shimmering bright band through the player along the
// moon azimuth, brightest near, fading out. Value-only (no hue). Off at boost 0.
if ( uMoonStreakBoost > 0.001 ) {
  vec2 rel = vFoamXZ - uBendCenter;
  float perp = abs( rel.x * uMoonDir2.y - rel.y * uMoonDir2.x );
  float band = 1.0 - smoothstep( 0.0, uMoonStreakHalfW, perp );
  float reach = 1.0 - smoothstep( uMoonStreakNear, uMoonStreakFar, length( rel ) );
  float shim = 0.8 + 0.2 * sin( length( rel ) * uMoonShimmer + uFoamT * 6.2831 );
  diffuseColor.rgb *= 1.0 + uMoonStreakBoost * band * reach * shim;
}`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-fade-foam-r13';
  material.needsUpdate = true;
}

/** Per-frame (ToyWorldLayer): advance the foam dash train. */
export function setFoamTime(t) {
  foamUniforms.uFoamT.value = t;
}

// --- Road pulses + rooftop beacons (toy land/building materials) ------------
// Same worker-baked-attribute technique as the foam: the LAND group carries
// aArc (arc length along motorway/trunk/primary ribbons, -1 elsewhere; the
// worker flips arc direction per feature for two-way traffic), the BUILDING
// group carries aBeacon (per-beacon blink phase 0..1, -1 elsewhere). Both
// scroll/blink on shared clocks — zero extra draw calls.

const pulseUniforms = {
  uPulseT: { value: 0 }, // road dash clock, in wavelengths
  uPulseLen: { value: 420 },
  uPulseDuty: { value: 0.12 },
  uPulseBoost: { value: 1.35 },
  uBeaconT: { value: 0 }, // beacon clock, in blink cycles
  uBeaconDuty: { value: 0.3 },
  uBeaconDim: { value: 0.35 },
  uBeaconBoost: { value: 1.8 },
};

/**
 * Wrap the (already bend-fade-patched) toy LAND material with the scrolling
 * road-pulse dash. Every geometry drawn with this material MUST supply the
 * aArc attribute (a missing attribute reads 0 → the whole surface pulses).
 */
export function applyRoadPulse(material, cfg) {
  if (!material || material.userData.__roadPulse) return;
  material.userData.__roadPulse = true;
  if (cfg) {
    pulseUniforms.uPulseLen.value = cfg.lenM;
    pulseUniforms.uPulseDuty.value = cfg.duty;
    pulseUniforms.uPulseBoost.value = cfg.boost;
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uPulseT = pulseUniforms.uPulseT;
    shader.uniforms.uPulseLen = pulseUniforms.uPulseLen;
    shader.uniforms.uPulseDuty = pulseUniforms.uPulseDuty;
    shader.uniforms.uPulseBoost = pulseUniforms.uPulseBoost;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aArc;\nvarying float vArc;'
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvArc = aArc;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vArc;\nuniform float uPulseT;\nuniform float uPulseLen;\nuniform float uPulseDuty;\nuniform float uPulseBoost;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vArc >= 0.0 ) {
  float ph = fract( vArc / uPulseLen - uPulseT );
  float dash = smoothstep( 0.0, uPulseDuty * 0.4, ph ) * ( 1.0 - smoothstep( uPulseDuty * 0.7, uPulseDuty, ph ) );
  diffuseColor.rgb *= 1.0 + uPulseBoost * dash;
}`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-fade-pulse';
  material.needsUpdate = true;
}

/**
 * Wrap the (already bend-fade-patched) toy BUILDING material with the slow
 * rooftop-beacon blink. Every geometry drawn with it MUST supply aBeacon.
 */
export function applyBeaconBlink(material, cfg) {
  if (!material || material.userData.__beaconBlink) return;
  material.userData.__beaconBlink = true;
  if (cfg) {
    pulseUniforms.uBeaconDuty.value = cfg.duty;
    pulseUniforms.uBeaconDim.value = cfg.dim;
    pulseUniforms.uBeaconBoost.value = cfg.boost;
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBeaconT = pulseUniforms.uBeaconT;
    shader.uniforms.uBeaconDuty = pulseUniforms.uBeaconDuty;
    shader.uniforms.uBeaconDim = pulseUniforms.uBeaconDim;
    shader.uniforms.uBeaconBoost = pulseUniforms.uBeaconBoost;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aBeacon;\nvarying float vBeacon;'
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBeacon = aBeacon;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vBeacon;\nuniform float uBeaconT;\nuniform float uBeaconDuty;\nuniform float uBeaconDim;\nuniform float uBeaconBoost;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vBeacon >= 0.0 ) {
  float ph = fract( uBeaconT + vBeacon );
  float on = smoothstep( 0.0, 0.12, ph ) * ( 1.0 - smoothstep( uBeaconDuty, uBeaconDuty + 0.15, ph ) );
  diffuseColor.rgb *= uBeaconDim + uBeaconBoost * on;
}`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-fade-beacon';
  material.needsUpdate = true;
}

/** Per-frame (ToyWorldLayer): advance the road-pulse + beacon clocks. */
export function setPulseTime(pulseT, beaconT) {
  pulseUniforms.uPulseT.value = pulseT;
  pulseUniforms.uBeaconT.value = beaconT;
}

// --- Round 7 "Electric Night City" layers -----------------------------------
// Facade window lights (building) + runway edge lights (land): the same
// worker-baked-attribute technique — aFacade (vec4: arc-along-wall m,
// height m, building H, hash01) and aGlow (0..1 runway arc, -1 sentinel).
// All static config lands in uniforms at apply-time; the only animated
// inputs reuse the EXISTING pulse/beacon clocks — zero new per-frame sites.

const cityUniforms = {
  // Round 8 (P3) facade window GRID (replaces round-7 uWin* random-dot set).
  uGrid: { value: { x: 2.6, y: 3.0, isVector2: true } }, // (colPitchM, floorHM)
  uLitFloorFrac: { value: 0.72 }, // fraction of floors lit (× per-building litBias)
  uLitCellFrac: { value: 0.55 }, // fraction of office-runs lit within a lit floor
  uRunLen: { value: 3 }, // adjacent windows sharing one lit/dark decision
  uCornerBoost: { value: 0.35 }, // corner-column brightness bump
  uWinBoost: { value: 1.7 }, // lit-cell brightness
  uGroundRows: { value: 1 }, // dark floors at street level
  uWinFlickerFrac: { value: 0.015 }, // slow cell toggling on the beacon clock
  uFootAO: { value: { x: 0.45, y: 12, isVector2: true } }, // (strength, falloffM)
  uWinColorA: { value: { x: 1, y: 0.6, z: 0.35, isVector3: true } },
  uWinColorB: { value: { x: 0.6, y: 0.75, z: 1, isVector3: true } },
  uWinEdgeColor: { value: { x: 0.75, y: 0.85, z: 1, isVector3: true } },
  uWinEdgeBoost: { value: 0.5 }, // reduced parapet glow (geometric parapet exists)
  uWinEdgeStart: { value: 0.9 },
  uCrownFloor: { value: 0.7 }, // crown/spire-tip emissive floor (F5 fix)
  // Round 13 Phase 5: roof CONTENT (up-facing roof caps get a dim skylight
  // lattice + luminance floor — the "hollow rooftops" fix). All 0 → inert.
  uRoofUpMin: { value: 0.6 },
  uRoofCellM: { value: 6.5 },
  uRoofPaneEdge: { value: 0.4 },
  uRoofGridBoost: { value: 0 }, // 0 until applyFacadeGrid's cfg arms it
  uRoofFloor: { value: 0 },
  uRwyColor: { value: { x: 1, y: 0.93, z: 0.78, isVector3: true } },
  uRwyBoost: { value: 2.0 },
  uRwyChase: { value: 0.35 },
};

const setV3 = (u, rgb) => {
  u.value.x = rgb[0];
  u.value.y = rgb[1];
  u.value.z = rgb[2];
};

/**
 * Wrap the (already beacon-patched) toy BUILDING material with the round-8
 * STRUCTURED facade window grid (replaces round-7 applyWindowLights, which
 * lit random dots the user rejected). Reads aFacade (role-dispatched:
 * x ≥ 0 = wall EDGE-LOCAL arc; x == -1 = plain roof/detail; x ≤ -1.5 =
 * emissive crown/spire tip, boost in aFacade.y) + the new aEdge
 * (edgeLenM, litBias). A missing aEdge reads 0 → zero window columns → DARK
 * walls (the safe direction; missing-attribute-reads-0 trap avoided).
 * cfg: WINDOW_GRID constants + { colorA, colorB, edgeColor } as linear RGB.
 * The flicker term reads uBeaconT, declared by the beacon layer that always
 * patches this material first (engine order) — do NOT re-declare it here.
 */
export function applyFacadeGrid(material, cfg) {
  if (!material || material.userData.__facadeGrid) return;
  material.userData.__facadeGrid = true;
  if (cfg) {
    cityUniforms.uGrid.value.x = cfg.colPitchM;
    cityUniforms.uGrid.value.y = cfg.floorHM;
    cityUniforms.uLitFloorFrac.value = cfg.litFloorFrac;
    cityUniforms.uLitCellFrac.value = cfg.litCellFrac;
    cityUniforms.uRunLen.value = cfg.runLen;
    cityUniforms.uCornerBoost.value = cfg.cornerBoost;
    cityUniforms.uWinBoost.value = cfg.boost;
    cityUniforms.uGroundRows.value = cfg.groundRows;
    cityUniforms.uWinFlickerFrac.value = cfg.flickerFrac;
    cityUniforms.uFootAO.value.x = cfg.footAO;
    cityUniforms.uFootAO.value.y = cfg.footAOFalloffM;
    cityUniforms.uWinEdgeStart.value = cfg.edgeStartFrac;
    cityUniforms.uWinEdgeBoost.value = cfg.edgeBoost;
    if (cfg.crownFloor !== undefined) cityUniforms.uCrownFloor.value = cfg.crownFloor;
    // Round 13 Phase 5 roof content (0 default keeps it inert / byte-identical)
    if (cfg.roofUpMin !== undefined) cityUniforms.uRoofUpMin.value = cfg.roofUpMin;
    if (cfg.roofCellM !== undefined) cityUniforms.uRoofCellM.value = cfg.roofCellM;
    if (cfg.roofPaneEdge !== undefined) cityUniforms.uRoofPaneEdge.value = cfg.roofPaneEdge;
    if (cfg.roofGridBoost !== undefined) cityUniforms.uRoofGridBoost.value = cfg.roofGridBoost;
    if (cfg.roofFloor !== undefined) cityUniforms.uRoofFloor.value = cfg.roofFloor;
    if (cfg.colorA) setV3(cityUniforms.uWinColorA, cfg.colorA);
    if (cfg.colorB) setV3(cityUniforms.uWinColorB, cfg.colorB);
    if (cfg.edgeColor) setV3(cityUniforms.uWinEdgeColor, cfg.edgeColor);
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uGrid = cityUniforms.uGrid;
    shader.uniforms.uLitFloorFrac = cityUniforms.uLitFloorFrac;
    shader.uniforms.uLitCellFrac = cityUniforms.uLitCellFrac;
    shader.uniforms.uRunLen = cityUniforms.uRunLen;
    shader.uniforms.uCornerBoost = cityUniforms.uCornerBoost;
    shader.uniforms.uWinBoost = cityUniforms.uWinBoost;
    shader.uniforms.uGroundRows = cityUniforms.uGroundRows;
    shader.uniforms.uWinFlickerFrac = cityUniforms.uWinFlickerFrac;
    shader.uniforms.uFootAO = cityUniforms.uFootAO;
    shader.uniforms.uWinColorA = cityUniforms.uWinColorA;
    shader.uniforms.uWinColorB = cityUniforms.uWinColorB;
    shader.uniforms.uWinEdgeColor = cityUniforms.uWinEdgeColor;
    shader.uniforms.uWinEdgeBoost = cityUniforms.uWinEdgeBoost;
    shader.uniforms.uWinEdgeStart = cityUniforms.uWinEdgeStart;
    shader.uniforms.uCrownFloor = cityUniforms.uCrownFloor;
    shader.uniforms.uRoofUpMin = cityUniforms.uRoofUpMin;
    shader.uniforms.uRoofCellM = cityUniforms.uRoofCellM;
    shader.uniforms.uRoofPaneEdge = cityUniforms.uRoofPaneEdge;
    shader.uniforms.uRoofGridBoost = cityUniforms.uRoofGridBoost;
    shader.uniforms.uRoofFloor = cityUniforms.uRoofFloor;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aFacade;\nattribute vec2 aEdge;\nvarying vec4 vFacade;\nvarying vec2 vEdge;\nvarying float vRoofUp;\nvarying vec2 vRoofXZ;'
      )
      .replace(
        '#include <begin_vertex>',
        // Round 13 P5: roof-content inputs. vRoofUp = world-up-facing (defaultnormal_vertex
        // runs before begin_vertex so transformedNormal is set); vRoofXZ = rebased world XZ
        // (the skylight lattice domain; buildings are un-instanced merged chunk meshes).
        '#include <begin_vertex>\nvFacade = aFacade;\nvEdge = aEdge;\nvRoofUp = dot( normalize( transformedNormal ), normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) );\nvRoofXZ = ( modelMatrix * vec4( position, 1.0 ) ).xz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec4 vFacade;\nvarying vec2 vEdge;\nvarying float vRoofUp;\nvarying vec2 vRoofXZ;\nuniform vec2 uGrid;\nuniform float uLitFloorFrac;\nuniform float uLitCellFrac;\nuniform float uRunLen;\nuniform float uCornerBoost;\nuniform float uWinBoost;\nuniform float uGroundRows;\nuniform float uWinFlickerFrac;\nuniform vec2 uFootAO;\nuniform vec3 uWinColorA;\nuniform vec3 uWinColorB;\nuniform vec3 uWinEdgeColor;\nuniform float uWinEdgeBoost;\nuniform float uWinEdgeStart;\nuniform float uCrownFloor;\nuniform float uRoofUpMin;\nuniform float uRoofCellM;\nuniform float uRoofPaneEdge;\nuniform float uRoofGridBoost;\nuniform float uRoofFloor;\nfloat hash11( float n ) { return fract( sin( n ) * 43758.5453123 ); }'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vFacade.x <= -1.5 ) {
  // emissive tower crown / spire tip: steady neon, boost in aFacade.y
  diffuseColor.rgb *= vFacade.y;
} else if ( vFacade.x >= 0.0 ) {
  // window column grid CENTERED on this facade's edge (aEdge.x = edgeLenM)
  float nCols = floor( vEdge.x / uGrid.x );
  float pad = 0.5 * ( vEdge.x - nCols * uGrid.x );
  float u = vFacade.x - pad;
  float col = floor( u / uGrid.x );
  float row = floor( vFacade.y / uGrid.y );
  float inGrid = step( 0.0, u ) * step( col, nCols - 1.0 )
    * step( uGrid.y * uGroundRows, vFacade.y ) * step( vFacade.y, vFacade.z - 0.4 );
  // contiguous lit/dark FLOORS (density × district litBias) × office RUNS
  float floorLit = step( hash11( row * 7.13 + vFacade.w * 91.7 ), uLitFloorFrac * vEdge.y );
  float run = floor( col / uRunLen );
  float cellLit = step( hash11( run * 3.71 + row * 17.9 + vFacade.w * 57.3 ), uLitCellFrac );
  float corner = 1.0 + uCornerBoost * ( step( col, 0.5 ) + step( nCols - 1.5, col ) );
  float lit = floorLit * cellLit;
  // ≤1.5% of cells slowly toggle on the shared beacon clock (subtle life)
  float flick = step( abs( hash11( col * 2.13 + row * 5.7 + vFacade.w * 13.0 ) - fract( uBeaconT * 0.13 ) ), uWinFlickerFrac );
  lit = abs( lit - flick );
  vec2 cuv = vec2( fract( u / uGrid.x ), fract( vFacade.y / uGrid.y ) );
  float wx = smoothstep( 0.18, 0.30, cuv.x ) * ( 1.0 - smoothstep( 0.70, 0.82, cuv.x ) );
  float wy = smoothstep( 0.16, 0.28, cuv.y ) * ( 1.0 - smoothstep( 0.78, 0.90, cuv.y ) );
  float win = wx * wy * inGrid;
  vec3 winCol = mix( uWinColorA, uWinColorB, step( 0.72, fract( vFacade.w * 7.31 ) ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, winCol * uWinBoost * corner, win * lit );
  // even UNLIT windows darken 25% so the dark-glass grid reads everywhere
  diffuseColor.rgb *= 1.0 - 0.25 * win * ( 1.0 - lit );
  // street-level ambient occlusion: exponential foot darkening (per fragment)
  diffuseColor.rgb *= 1.0 - uFootAO.x * exp( -vFacade.y / uFootAO.y );
  // parapet edge glow (reduced — a geometric parapet now exists)
  diffuseColor.rgb += uWinEdgeColor * ( uWinEdgeBoost * smoothstep( uWinEdgeStart * vFacade.z, vFacade.z, vFacade.y ) );
} else if ( uRoofGridBoost > 0.001 && vRoofUp > uRoofUpMin ) {
  // Round 13 P5 roof CONTENT: up-facing roof caps/details get a dim skylight
  // LATTICE (world-XZ grid of lit panes) so they read as lit panels, not
  // hollow black caps. Value-only — rides the existing roof diffuse tone.
  vec2 rc = abs( fract( vRoofXZ / uRoofCellM ) - 0.5 );
  float pane = 1.0 - smoothstep( uRoofPaneEdge, uRoofPaneEdge + 0.06, max( rc.x, rc.y ) );
  diffuseColor.rgb *= 1.0 + uRoofGridBoost * pane;
}`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
if ( vFacade.x <= -1.5 ) {
  // round 8 fix (F5) crown emissive FLOOR: the diffuse-only multiply above
  // rides the moonlit toon ramp down to ~68/255 at range (skyline crowns
  // unreadable). True emissive adds AFTER lighting — diffuseColor here is
  // already crownColor × boost, so × uCrownFloor clears bloomThreshold 0.56.
  totalEmissiveRadiance = max( totalEmissiveRadiance, diffuseColor.rgb * uCrownFloor );
} else if ( uRoofFloor > 0.001 && vRoofUp > uRoofUpMin ) {
  // Round 13 P5: dim roof-cap luminance FLOOR (crownFloor pattern) — a fraction
  // of the (lattice-lit) roof color written as TRUE emissive so caps clear
  // near-black and read as lit-from-within panels from above.
  totalEmissiveRadiance = max( totalEmissiveRadiance, diffuseColor.rgb * uRoofFloor );
}`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-fade-beacon-grid-r13';
  material.needsUpdate = true;
}

/**
 * Wrap the (already pulse-patched) toy LAND material with the runway edge
 * lights. Every geometry drawn with it MUST supply aGlow (-1 sentinel).
 * cfg: RUNWAY_LIGHTS constants + { color } linear RGB.
 */
export function applyRunwayGlow(material, cfg) {
  if (!material || material.userData.__runwayGlow) return;
  material.userData.__runwayGlow = true;
  if (cfg) {
    cityUniforms.uRwyBoost.value = cfg.boost;
    cityUniforms.uRwyChase.value = cfg.chase;
    if (cfg.color) setV3(cityUniforms.uRwyColor, cfg.color);
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uRwyColor = cityUniforms.uRwyColor;
    shader.uniforms.uRwyBoost = cityUniforms.uRwyBoost;
    shader.uniforms.uRwyChase = cityUniforms.uRwyChase;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlow;\nvarying float vGlow;'
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vGlow;\nuniform vec3 uRwyColor;\nuniform float uRwyBoost;\nuniform float uRwyChase;'
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
if ( vGlow >= 0.0 ) {
  float rab = 1.0;
  if ( uRwyChase > 0.001 ) {
    float rph = fract( vGlow * 24.0 - uPulseT * uRwyChase );
    rab = 0.72 + 0.55 * smoothstep( 0.82, 1.0, rph );
  }
  diffuseColor.rgb = uRwyColor * uRwyBoost * rab;
}`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-fade-pulse-rwy-r8';
  material.needsUpdate = true;
}

// --- Round 7: satellite hillshade layer (tile materials) --------------------
// The DEM meshes already carry real per-vertex normals and the tile
// material is a MeshStandardMaterial — relief reads flat only because the
// ambient wash (hemi + HDRI env + a fixed high sun) direction-washes it.
// Rather than re-balancing Day's authored lighting, multiply the diffuse by
// a slope term against a live sun direction. transformedNormal is used
// (normalMatrix-corrected — tile local frames carry non-uniform scale).

const hillUniforms = {
  uHillDir: { value: { x: 0.5, y: 0.6, z: 0.62, isVector3: true } },
  uHillStrength: { value: 0 }, // live style gate: 0 = layer inert (envelopes v2 too)
  uHillAmbient: { value: 0.55 },
  uHillLift: { value: 0.15 },
  // Round 13 (P4) hillshade v2 — live tier gate (0 outside satellite). Both
  // ride INSIDE the uHillStrength mix so the harness A/B (set 0) turns them off.
  uHillAO: { value: 0 }, // slope ambient occlusion (valley/canyon deepening)
  uHillSat: { value: 0 }, // slope saturation nudge
  // Round 13 (P4) low-AGL micro-detail — uMicroStrength is LIVE (AGL ramp ×
  // tier, written per-frame by setMicroDetail; 0 outside satellite / above the
  // AGL band → the whole term compiles out to a ×1.0 no-op, toy pixel-stable).
  uMicroStrength: { value: 0 },
  uMicroScale: { value: 1 / 5.5 }, // 1 / cell period (m); apply-time from cfg.micro
  uMicroAmp: { value: 0.1 },
  // Round 19 (B) SAT_QUILT — Esri capture-date seam masking. Esri World
  // Imagery is a MOSAIC of captures flown in different seasons and different
  // years; at cruise you see many patches at once and the rectangular
  // exposure/colour steps between them are the single most artificial thing
  // in the frame. Both terms are LIVE (written per frame by setQuiltGrade:
  // AGL ramp × tier × style × the __flyAerialOverride pin) and both are
  // EXACTLY 0 at rest, so the whole block is skipped by its own branch and
  // toy tiles — which compile this same program — stay pixel-identical.
  uQuiltDesat: { value: 0 }, // pull chroma toward luma (seams are colour steps)
  uQuiltFlat: { value: 0 }, // pull luma toward the anchor (seams are level steps)
  uQuiltAnchor: { value: 0.22 }, // LINEAR mid-grey (~sRGB 0.5); apply-time from cfg
  // R24 C (ONE_SUN, recon L3 fix 4 / L8 fix c) — the hillshade's ELEVATION
  // weight, as its OWN uniform rather than folded into uHillStrength.
  //
  // That separation is not tidiness. `uHillStrength` is the STYLE/TIER gate and
  // `verify-sat-depth` has a frozen assertion on it ("strength gated to
  // satellite default", |strength − 0.55| < 0.01) — a legitimate contract that
  // says "satellite high tier runs the certified hillshade". Multiplying an
  // elevation term into that value would have broken a frozen number to express
  // something it never meant, and worse, the harness's own A/B (`__flyHill.set`)
  // would then have restored a value the day cycle did not choose. One uniform
  // per fact: strength says WHICH STYLE AND TIER, elev says WHERE THE SUN IS.
  //
  // 1.0 is the identity and what every non-ONE_SUN frame writes, so the term is
  // an exact `* 1.0`; toy is byte-identical regardless because the whole block
  // is inside the `mix(..., uHillStrength)` envelope, which is 0 there.
  uHillElev: { value: 1 },
};

/**
 * Wrap a (already bend-fade-patched) TILE material with the DEM hillshade.
 * cfg { ambient, lift } is apply-time; strength/direction are live
 * (setHillshade / setHillDir — style-change and day-cycle time only).
 */
export function applyHillshade(material, cfg, lodFade = null) {
  if (!material || material.userData.__hillshade) return;
  material.userData.__hillshade = true;
  // Round 24 (D): the LOD crossfade slot. `lodFade` is null unless
  // LOD_CROSSFADE is on (lib/fly/lod-crossfade.js attachLodFade returns null
  // when the flag is off), and NOTHING below reads it in that case — so the
  // generated GLSL, the uniform set and the FINAL key are all byte-for-byte
  // the R19 ones. It carries three per-MATERIAL uniform holders (each tile
  // blends independently while sharing one program) plus `chunk`, three's own
  // ShaderChunk.map_fragment read at runtime: the blend has to land INSIDE the
  // map chunk, on `sampledDiffuseColor` BEFORE it multiplies into
  // diffuseColor, or the material's own colour/vertex factors would be divided
  // out of the blend. Taking the chunk from the installed three rather than
  // transcribing it is what keeps that surgery version-proof.
  const lod = lodFade ?? null;
  if (cfg) {
    hillUniforms.uHillAmbient.value = cfg.ambient;
    hillUniforms.uHillLift.value = cfg.lift;
    if (cfg.micro) {
      hillUniforms.uMicroScale.value = 1 / cfg.micro.scaleM;
      hillUniforms.uMicroAmp.value = cfg.micro.amp;
    }
    if (cfg.quiltAnchor != null) hillUniforms.uQuiltAnchor.value = cfg.quiltAnchor;
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uHillDir = hillUniforms.uHillDir;
    shader.uniforms.uHillStrength = hillUniforms.uHillStrength;
    shader.uniforms.uHillAmbient = hillUniforms.uHillAmbient;
    shader.uniforms.uHillLift = hillUniforms.uHillLift;
    shader.uniforms.uHillAO = hillUniforms.uHillAO;
    shader.uniforms.uHillSat = hillUniforms.uHillSat;
    shader.uniforms.uMicroStrength = hillUniforms.uMicroStrength;
    shader.uniforms.uMicroScale = hillUniforms.uMicroScale;
    shader.uniforms.uMicroAmp = hillUniforms.uMicroAmp;
    shader.uniforms.uQuiltDesat = hillUniforms.uQuiltDesat;
    shader.uniforms.uQuiltFlat = hillUniforms.uQuiltFlat;
    shader.uniforms.uQuiltAnchor = hillUniforms.uQuiltAnchor;
    if (hillElevOn()) shader.uniforms.uHillElev = hillUniforms.uHillElev;
    // R24 D (AERIAL_LAW): the shared law block, by REFERENCE — the same holder
    // objects the post pass copies from, so the two evaluators read one set of
    // numbers rather than two that agree.
    if (AERIAL_LAW.enabled) for (const k in atmoUniforms) shader.uniforms[k] = atmoUniforms[k];
    if (lod) {
      shader.uniforms.uLodFadeMix = lod.mix;
      shader.uniforms.uLodFadeUV = lod.uv;
      shader.uniforms.uLodFadeMap = lod.map;
    }
    // Round 13 (P4): vUp = surface normal vs world-up (slope AO term); vWorldXZ
    // = rebased world XZ (micro-noise domain). defaultnormal_vertex runs BEFORE
    // begin_vertex, so `transformed` is not yet set — use `position` (tiles are
    // undisplaced/unskinned, so position == transformed for the XZ we need).
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
          (hillFragOn()
            ? 'varying vec3 vHillNW;\n'
            : 'uniform vec3 uHillDir;\nvarying float vHill;\nvarying float vUp;\n') +
          'varying vec2 vWorldXZ;'
      )
      .replace(
        '#include <common>',
        '#include <common>' +
          (AERIAL_LAW.enabled
            ? `${ATMO_GLSL_DECL}${ATMO_GLSL_VERTEX}varying vec3 vAtmoDHC;\n`
            : '')
      )
      .replace(
        '#include <defaultnormal_vertex>',
        '#include <defaultnormal_vertex>\n' +
          // R24 D (AERIAL_LAW): pack (distance-from-eye through the RENDERED
          // geometry, TRUE height above the datum, cos to the sun) into one
          // varying. `position` is pre-bend and pre-drop; the bend is exactly
          // d^2k about uAtmoEye's XZ neighbourhood, so the drop is re-applied
          // here rather than read back out of a stage that runs later. Tiles
          // are undisplaced and unskinned, so position == transformed.
          (AERIAL_LAW.enabled
            ? 'vec3 wA = ( modelMatrix * vec4( position, 1.0 ) ).xyz;\n' +
              'float dA = distance( wA.xz, uBendCenter );\n' +
              'vAtmoDHC = atmoPack( vec3( wA.x, wA.y - dA * dA * uBendK, wA.z ), wA.y );\n'
            : '') +
          (hillFragOn()
            ? // R24 C (TERRAIN_LIGHT, recon L8/T6): carry the NORMAL, not the
              // dot. R21 evaluated N.L per VERTEX and Gouraud-interpolated the
              // scalar, and three-tile's Martini mesh has LAST-WRITER face
              // normals (index.js: t[n] = t[s] = t[o] = g * w -- every shared
              // vertex takes one arbitrary triangle's normal), so the relief
              // facets by construction. transformedNormal is VIEW space;
              // vec4(n,0) * viewMatrix is the transpose product, i.e. back to
              // WORLD, which lets the fragment dot it against uHillDir and
              // world-up directly with no per-fragment matrix work.
              'vHillNW = normalize( ( vec4( transformedNormal, 0.0 ) * viewMatrix ).xyz );\n'
            : 'vHill = clamp( dot( normalize( transformedNormal ), normalize( ( viewMatrix * vec4( uHillDir, 0.0 ) ).xyz ) ), 0.0, 1.0 );\n' +
              'vUp = clamp( dot( normalize( transformedNormal ), normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) ), 0.0, 1.0 );\n') +
          'vWorldXZ = ( modelMatrix * vec4( position, 1.0 ) ).xz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n' +
          (hillFragOn()
            ? 'varying vec3 vHillNW;\nuniform vec3 uHillDir;\n'
            : 'varying float vHill;\nvarying float vUp;\n') +
          'varying vec2 vWorldXZ;\nuniform float uHillStrength;\nuniform float uHillAmbient;\nuniform float uHillLift;\nuniform float uHillAO;\nuniform float uHillSat;\nuniform float uMicroStrength;\nuniform float uMicroScale;\nuniform float uMicroAmp;\nuniform float uQuiltDesat;\nuniform float uQuiltFlat;\nuniform float uQuiltAnchor;\n' +
          (hillElevOn() ? 'uniform float uHillElev;\n' : '') +
          // R24 D (LOD_CROSSFADE): the parent-texture blend's three per-material
          // uniforms. Absent (and the key token 'l' unset) when the slot is null.
          (lod ? 'uniform float uLodFadeMix;\nuniform vec4 uLodFadeUV;\nuniform sampler2D uLodFadeMap;\n' : '') +
          (AERIAL_LAW.enabled ? `varying vec3 vAtmoDHC;${ATMO_GLSL_DECL}${ATMO_GLSL_FRAGMENT}` : '') +
          'float hillHash21( vec2 p ){ p = fract( p * vec2( 123.34, 345.45 ) ); p += dot( p, p + 34.345 ); return fract( p.x * p.y ); }\n' +
          'float hillVNoise( vec2 p ){ vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f ); float a = hillHash21( i ); float b = hillHash21( i + vec2( 1.0, 0.0 ) ); float c = hillHash21( i + vec2( 0.0, 1.0 ) ); float d = hillHash21( i + vec2( 1.0, 1.0 ) ); return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ); }'
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n' +
          '// Round 13 (P4) hillshade v2: base sun-slope shade × slope AO × slope\n' +
          '// saturation, ALL enveloped by uHillStrength (0 outside satellite →\n' +
          '// toy tiles byte-identical: mix(rgb, shaded, 0.0) == rgb exactly).\n' +
          '{\n' +
          (hillFragOn()
            ? // R24 C (TERRAIN_LIGHT): the SAME two scalars R21 interpolated,
              // recomputed here from the interpolated NORMAL. Identical algebra,
              // ~4 ALU, and the facets are gone because a normal interpolates
              // smoothly across a triangle where a clamped dot product does not.
              '  vec3 nW = normalize( vHillNW );\n' +
              '  float vHill = clamp( dot( nW, normalize( uHillDir ) ), 0.0, 1.0 );\n' +
              '  float vUp = clamp( nW.y, 0.0, 1.0 );\n'
            : '') +
          '  float slope = 1.0 - clamp( vUp, 0.0, 1.0 );\n' +
          '  float lit = uHillAmbient + ( 1.0 + uHillLift - uHillAmbient ) * vHill;\n' +
          '  float ao = 1.0 - uHillAO * slope;\n' +
          '  vec3 shaded = diffuseColor.rgb * lit * ao;\n' +
          '  float l = dot( shaded, vec3( 0.2126, 0.7152, 0.0722 ) );\n' +
          '  shaded = mix( vec3( l ), shaded, 1.0 + uHillSat * slope );\n' +
          (hillElevOn()
            ? // R24 C (ONE_SUN): the live sun-elevation weight. 1.0 = identity.
              '  diffuseColor.rgb = mix( diffuseColor.rgb, shaded, uHillStrength * uHillElev );\n'
            : '  diffuseColor.rgb = mix( diffuseColor.rgb, shaded, uHillStrength );\n') +
          '}\n' +
          '// Round 13 (P4) low-AGL micro-detail: high-freq value-noise luma grain,\n' +
          '// faded in below ~1.5km AGL via the live uMicroStrength (0 → no-op).\n' +
          'if ( uMicroStrength > 0.001 ) {\n' +
          '  vec2 mp = vWorldXZ * uMicroScale;\n' +
          '  float n = hillVNoise( mp ) * 0.62 + hillVNoise( mp * 2.7 ) * 0.38;\n' +
          (hillFragOn() && TERRAIN_LIGHT.microFwidth
            ? // R24 C (TERRAIN_LIGHT, recon T13): a 5.5 m value-noise cell that
              // covers less than ~2 px cannot be resolved and SMAA cannot help
              // (it is a geometric-edge filter, not a texture filter), so at
              // grazing angles the grain aliases into the crawling shimmer the
              // user reported as tearing. fwidth of the noise coordinate IS
              // cells-per-pixel; fade the term out above the threshold. The
              // second octave runs at 2.7x, so the WIDER of the two decides.
              '  float mw = max( fwidth( mp.x ), fwidth( mp.y ) ) * 2.7;\n' +
              `  float mAtt = 1.0 - smoothstep( ${TERRAIN_LIGHT.microFadeLo.toFixed(3)}, ${TERRAIN_LIGHT.microFadeHi.toFixed(3)}, mw );\n` +
              '  diffuseColor.rgb *= 1.0 + ( n - 0.5 ) * 2.0 * uMicroAmp * uMicroStrength * mAtt;\n'
            : '  diffuseColor.rgb *= 1.0 + ( n - 0.5 ) * 2.0 * uMicroAmp * uMicroStrength;\n') +
          '}\n' +
          '// Round 19 (B) SAT_QUILT: mask the Esri capture-date mosaic at cruise.\n' +
          '// The seams are (a) chroma steps between seasons and (b) exposure steps\n' +
          '// between flights, so the grade is exactly those two inverses: pull\n' +
          '// chroma toward the pixel luma, then pull the LEVEL toward a fixed\n' +
          '// anchor. The level term is ADDITIVE (not a ratio) on purpose — a\n' +
          '// luma-ratio rescale multiplies dark pixels (water, shadowed canyon)\n' +
          '// by an unbounded factor and blows them out. Both uniforms are 0 below\n' +
          '// the AGL band / off satellite / on toy, and the branch is skipped\n' +
          '// entirely there, so this is an exact no-op at rest.\n' +
          'if ( uQuiltDesat > 0.001 || uQuiltFlat > 0.001 ) {\n' +
          '  float ql = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );\n' +
          '  vec3 qc = mix( diffuseColor.rgb, vec3( ql ), uQuiltDesat );\n' +
          '  diffuseColor.rgb = max( vec3( 0.0 ), qc + ( uQuiltAnchor - ql ) * uQuiltFlat );\n' +
          '}'
      );
    // Round 24 (D) AERIAL_LAW: the atmosphere, applied LAST.
    //
    // WHERE, and why here. The base fade patch owns the after-fog slot (tile
    // haze then rim melt) and C's LINEAR_HAZE owns the space those two mix in,
    // so this term deliberately does NOT touch either line — it lands one chunk
    // later, immediately before <dithering_fragment>, which is the last thing
    // in three's fragment. Two consequences, both wanted:
    //   • the 16-55 km tile band is retired by AMPLITUDE (FlyScene writes its
    //     max to 0 under this flag) rather than by editing another owner's
    //     injection, so a merge in either order composes;
    //   • the 60-120 km rim melt is absorbed: by the time the edge fade has
    //     mixed to uEdgeColor the law's transmittance is already ~0, so the
    //     final colour is the law's LINEAR inscatter either way. That is what
    //     "fold the rim melt into extinction -> 1" means in code.
    //
    // 0-identity: uAtmoStrength 0 (toy, non-satellite, the fleet pin, high tier
    // where the post pass owns the law, or the flag off) skips the branch, and
    // atmoApply would return its input bit-exactly even if it ran.
    if (AERIAL_LAW.enabled) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        'if ( uAtmoStrength > 0.0 ) {\n' +
          '\tgl_FragColor.rgb = atmoApply( gl_FragColor.rgb, vAtmoDHC );\n' +
          '}\n\t#include <dithering_fragment>'
      );
    }
    // Round 24 (D) LOD_CROSSFADE: blend this tile's own texel toward its
    // PARENT's texel, sampled through the clip-UV rectangle the tile occupies
    // in the parent's [0,1] map. It replaces three's map chunk with the SAME
    // chunk (read from the installed three, never transcribed) carrying one
    // extra mix on `sampledDiffuseColor` — i.e. on the sample, before the
    // material's colour/opacity/vertex factors multiply it, so the blend is
    // exact for any material rather than only for a white one.
    // uLodFadeMix 0 (the resting value of every tile that is not mid-swap)
    // skips the branch entirely: a session with the flag ON but nothing
    // fading is pixel-identical to R19.
    if (lod) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        lod.chunk.replace(
          'diffuseColor *= sampledDiffuseColor;',
          'if ( uLodFadeMix > 0.0 ) {\n' +
            '\t\tsampledDiffuseColor = mix( sampledDiffuseColor, texture2D( uLodFadeMap, vMapUv * uLodFadeUV.xy + uLodFadeUV.zw ), uLodFadeMix );\n' +
            '\t}\n' +
            '\tdiffuseColor *= sampledDiffuseColor;'
        )
      );
    }
  };
  // Round 19 (B): '-r13' → '-r19'. The SAT_QUILT terms are generated GLSL in
  // this same fragment, so the FINAL TILE key moves. Toy tiles recompile and
  // stay pixel-identical (both quilt uniforms are 0 outside satellite — the
  // R13 micro-detail precedent, proven again by an A/B toy screenshot pair).
  // R24: the FINAL TILE key is the FIRST key two owners bump, so it goes
  // through the shared helper. Token order is fixed (e ONE_SUN, f
  // TERRAIN_LIGHT, a AERIAL_LAW, l LOD_CROSSFADE) and D's flag is read here, so a merged tree
  // needs no second key expression -- D adds its GLSL under its own flag inside
  // this same function body and this line does not move again.
  material.customProgramCacheKey = () => hillKey(lodFade);
  material.needsUpdate = true;
}

/**
 * R24 C: does the tile fragment carry the elevation-weight term? The FINAL key
 * and the injected GLSL are both derived from this ONE predicate, so they can
 * never disagree (the R4 lesson that started the cache-key registry).
 */
function hillElevOn() {
  return ONE_SUN.enabled || TERRAIN_LIGHT.enabled;
}

/** R24 C: does the tile fragment carry the fragment-stage relief terms? */
function hillFragOn() {
  return TERRAIN_LIGHT.enabled && TERRAIN_LIGHT.fragmentHill;
}

/**
 * R24: the FINAL TILE key, one token per contributing owner, fixed order.
 * `lodFade` is D's predicate and arrives as applyHillshade's third argument —
 * a per-MATERIAL fact (a sampler + three uniforms + a swapped map_fragment),
 * not a global flag, which is why the helper takes booleans rather than flags.
 */
function hillKey(lodFade) {
  return r24VariantKey('world-bend-fade-hill-r19', [
    [hillElevOn(), 'e'], // C -- uHillElev (the sun-elevation weight)
    [hillFragOn(), 'f'], // C -- fragment-stage N.L + fwidth micro attenuation
    [AERIAL_LAW.enabled, 'a'], // D -- the per-material atmosphere term
    [!!lodFade, 'l'], // D -- the parent-texture LOD crossfade sampler
  ]);
}

/**
 * R24 C (ONE_SUN): the live sun-elevation weight on the hillshade. Written by
 * FlyScene's day-cycle cadence; 1.0 is the identity every other frame writes.
 */
export function setHillElev(w) {
  hillUniforms.uHillElev.value = w;
}

/** Round 13 (P4): hillshade v2 tier gate — AO + slope saturation (0 = off). */
export function setHillV2(ao, sat) {
  hillUniforms.uHillAO.value = ao;
  hillUniforms.uHillSat.value = sat;
}

/** Round 13 (P4): live low-AGL micro-detail strength (AGL ramp × tier; 0 = off). */
export function setMicroDetail(strength) {
  hillUniforms.uMicroStrength.value = strength;
}

/**
 * Round 19 (B): live SAT_QUILT grade — desaturation + luma flattening that
 * fades IN with eye AGL (the quilt is a CRUISE artifact; low AGL keeps full
 * imagery colour and the whole hillshade/micro contract). Written per frame
 * by FlyScene's -50 block; (0, 0) is the identity state, which is what every
 * non-satellite / non-high-tier / pinned frame writes.
 */
export function setQuiltGrade(desat, flatten) {
  hillUniforms.uQuiltDesat.value = desat;
  hillUniforms.uQuiltFlat.value = flatten;
}

/** Dev/harness introspection (verify-aerial reads the live quilt grade). */
export function getQuiltGrade() {
  return {
    desat: hillUniforms.uQuiltDesat.value,
    flatten: hillUniforms.uQuiltFlat.value,
  };
}

/** Style-change-time: hillshade strength (0 outside satellite). */
export function setHillshade(strength) {
  hillUniforms.uHillStrength.value = strength;
}

/** Day-cycle-time: sun direction (world frame, FROM ground TO sun). */
export function setHillDir(x, y, z) {
  hillUniforms.uHillDir.value.x = x;
  hillUniforms.uHillDir.value.y = y;
  hillUniforms.uHillDir.value.z = z;
}

/** Dev/harness introspection. */
export function getHillshade() {
  const d = hillUniforms.uHillDir.value;
  return {
    strength: hillUniforms.uHillStrength.value,
    dir: [d.x, d.y, d.z],
    // R24 C: reported separately, never folded into `strength` — see the
    // uHillElev comment. `effective` is what the fragment actually applies.
    elev: hillUniforms.uHillElev.value,
    effective: hillUniforms.uHillStrength.value * hillUniforms.uHillElev.value,
  };
}

// Anchored GROUND bend (round 7): the plain d²k drop + rim dissolve, both
// evaluated at the INSTANCE ORIGIN — rigid instanced ground objects (town
// glow domes) translate down as a unit and melt out with the terrain.
const anchorProject = /* glsl */ `
vec4 wPos = vec4( transformed, 1.0 );
vec4 wRef = vec4( 0.0, 0.0, 0.0, 1.0 );
#ifdef USE_INSTANCING
  wPos = instanceMatrix * wPos;
  wRef = instanceMatrix * wRef;
#endif
wPos = modelMatrix * wPos;
wRef = modelMatrix * wRef;
float bendD = distance( wRef.xz, uBendCenter );
wPos.y -= bendD * bendD * uBendK;
vAnchorDist = bendD;
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Patch a RIGID instanced GROUND material (additive town-glow domes):
 * anchor-evaluated bend + rim dissolve on the shared uEdgeFade band.
 * Additive material: multiplying the color toward black IS transparency.
 */
export function applyBendAnchor(material) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = 'anchor';
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBendCenter = uniforms.uBendCenter;
    shader.uniforms.uBendK = uniforms.uBendK;
    shader.uniforms.uEdgeFade = uniforms.uEdgeFade;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;\nvarying float vAnchorDist;'
      )
      .replace('#include <project_vertex>', anchorProject);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vAnchorDist;\nuniform vec2 uEdgeFade;'
      )
      .replace(
        '#include <fog_fragment>',
        '#include <fog_fragment>\n' +
          'gl_FragColor.rgb *= 1.0 - smoothstep( uEdgeFade.x, uEdgeFade.y, vAnchorDist );'
      );
  };
  material.customProgramCacheKey = () => 'world-bend-anchor-r8';
  material.needsUpdate = true;
}

// Round 20 (C): MARQUEE MONUMENT bend. Same law as anchorProject, but the
// reference point comes from a per-vertex `aAnchor` attribute rather than the
// instance origin — the marquee layer merges every placed monument into ONE
// mesh (1 draw for the whole set instead of 1 per model), so there is no
// instanceMatrix to read the origin from. Each vertex carries ITS monument's
// ground anchor, which makes the drop rigid per monument exactly the way
// aBendAnchor makes it rigid per building in the satellite chunk mesh.
const monumentAnchorProject = /* glsl */ `
vec4 wPos = modelMatrix * vec4( transformed, 1.0 );
vec4 wRef = modelMatrix * vec4( aAnchor, 1.0 );
float bendD = distance( wRef.xz, uBendCenter );
wPos.y -= bendD * bendD * uBendK;
vMonumentDist = bendD;
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Patch the RIGID merged MARQUEE MONUMENT material (MeshToon, vertexColors —
 * one mesh holding every placed marquee monument): anchor-evaluated ground bend
 * off the per-vertex `aAnchor`, plus the anchor-r8 rim dissolve on the shared
 * uEdgeFade band so an opaque monument body never survives past the toy fade as
 * a black silhouette (the round-8 maxRangeM finding). Its own program cache key
 * — the closure body differs from every other variant (new attribute, new
 * varying), so it reaches no existing material and moves no other FINAL key.
 */
export function applyBendAnchorMonument(material) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = 'anchor-monument';
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBendCenter = uniforms.uBendCenter;
    shader.uniforms.uBendK = uniforms.uBendK;
    shader.uniforms.uEdgeFade = uniforms.uEdgeFade;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;\nattribute vec3 aAnchor;\nvarying float vMonumentDist;'
      )
      .replace('#include <project_vertex>', monumentAnchorProject);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vMonumentDist;\nuniform vec2 uEdgeFade;'
      )
      .replace(
        '#include <fog_fragment>',
        '#include <fog_fragment>\n' +
          'gl_FragColor.rgb *= 1.0 - smoothstep( uEdgeFade.x, uEdgeFade.y, vMonumentDist );'
      );
  };
  material.customProgramCacheKey = () => 'world-bend-anchor-monument-r20';
  material.needsUpdate = true;
}

// Round 13 Phase 3: SATELLITE building anchor bend. Rigid extruded boxes must
// drop as a UNIT (per-vertex bend shears them — R6 lesson), but they are NOT
// instanced — each streamed chunk is ONE merged mesh of many buildings. So the
// drop is evaluated at a per-vertex FOOTPRINT-CENTROID attribute (aBendAnchor,
// baked by the worker): every vertex of a given building shares its centroid, so
// the whole box translates down by that one d²k with no shear. No rim fade (sat
// buildings stream only within ~3km — the 60km satellite fade band is out of
// reach), so this is a PURE vertex bend; the MeshLambert material's own scene
// lighting (day sun + hemi + env) does the shading. aBendAnchor is chunk-local
// (tile-center origin) like `transformed`, and the chunk mesh sits inside
// worldRoot at its tile center, so modelMatrix maps both into the SAME rebased
// frame uBendCenter lives in — identical to how the toy chunk bend resolves.
const satBldgAnchorProject = /* glsl */ `
vec4 wPos = modelMatrix * vec4( transformed, 1.0 );
vec4 wAnchor = modelMatrix * vec4( aBendAnchor.x, 0.0, aBendAnchor.y, 1.0 );
float bendD = distance( wAnchor.xz, uBendCenter );
wPos.y -= bendD * bendD * uBendK;
vSatDist = bendD;
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

// Round 19 (B): the CONTENT haze — the fragment half of AERIAL_PERSPECTIVE for
// extruded satellite content. The tile band (uHaze, 16 km) never reached these
// meshes ("PURE vertex bend, no fade/haze"), so a building has always been an
// un-atmosphered cut-out standing on ground that IS atmosphered (field study
// P1/P6). This is the same mix, in the same after-fog output slot, fed the same
// live _atmoRim triple, so content and ground recede together by construction.
//
// SHIPS OFF (AERIAL_PERSPECTIVE.content.enabled false) — see the constants
// header: at the only tier R19 permits, the depth post pass already hazes these
// exact pixels, and running both double-hazes. uSatHazeMax 0 skips the branch,
// so this is an exact no-op until someone turns it on for medium/low.
const satHazeUniforms = {
  uSatHaze: { value: { x: 1e9, y: 2e9, isVector2: true } }, // (startM, endM)
  uSatHazeColor: { value: { r: 0, g: 0, b: 0 } },
  uSatHazeMax: { value: 0 },
};

// Shared declaration + mix. `vSatContentDist` is whichever distance varying the
// host variant already computes, passed in by name so neither variant gains a
// second one (the skyline's vSkyDist is the near-field HOLE's varying too).
const satHazeDecl = /* glsl */ `
uniform vec2 uSatHaze;
uniform vec3 uSatHazeColor;
uniform float uSatHazeMax;
`;
const satHazeMix = (distVarying) => /* glsl */ `
if ( uSatHazeMax > 0.0 ) {
  gl_FragColor.rgb = mix( gl_FragColor.rgb, uSatHazeColor, uSatHazeMax * smoothstep( uSatHaze.x, uSatHaze.y, ${distVarying} ) );
}
`;

// Round 16 (A2): SAT_BLDG_FADE — the cull-pop fix. R13 hard-evicted the whole
// building ring in ONE frame at ~2.8 km AGL. A screen-door DITHER is the only
// dissolve that costs nothing here: the buildings are an OPAQUE merged mesh, and
// turning the shared material transparent would cost sorting, depthWrite games
// and a second program. An ordered Bayer-4 `discard` thins them out per pixel at
// full opacity instead. Default 1 = the branch never runs (and the dither
// maximum is 15/16 < 1 anyway, so even an ungated 1.0 discards nothing).
const satBldgFadeUniforms = {
  uSatBldgFade: { value: 1 },
};

// 4×4 ordered dither, built recursively from M2 = [[0,2],[3,1]] with the closed
// form m2(x,y) = 2x + 3y − 4xy (no array indexing — GLSL ES 1.0 safe). Range
// 0 … 15/16, so `>= uSatBldgFade` discards EVERYTHING at fade 0 and NOTHING at
// fade 1. (The plan sketched `>`; `>=` is the correct comparison — with `>` a
// 1/16 residue of the city survives at fade 0 and would still pop at eviction.)
const bayerDitherGLSL = /* glsl */ `
float wbM2( float x, float y ) { return 2.0 * x + 3.0 * y - 4.0 * x * y; }
float wbBayer4( vec2 p ) {
  vec2 q = floor( mod( p, 4.0 ) );
  vec2 lo = mod( q, 2.0 );
  vec2 hi = floor( q * 0.5 );
  return ( 4.0 * wbM2( hi.x, hi.y ) + wbM2( lo.x, lo.y ) ) / 16.0;
}
`;

/**
 * Patch a RIGID satellite-building material (MeshLambert, DoubleSide, one merged
 * mesh per streamed chunk) with the anchor-evaluated ground bend. Reads the
 * per-vertex aBendAnchor (footprint centroid, chunk-local XZ). Its own program
 * cache key — the closure body differs from every other variant (per-vertex
 * anchor attribute, no fade, no instancing). Reaches NO existing variant, so no
 * other FINAL keys move.
 *
 * Round 16 (A2) also injects the screen-door cull fade at the TOP of main
 * (beside the clipping-plane discard, the one place a discard belongs). It is
 * value-gated: at the uniform default 1 nothing is discarded, so a session where
 * SAT_BLDG_FADE.enabled is false is pixel-identical to R15.
 */
/*
 * R24 B (CHUNK_FADE) — `fadeUniform` is the ONE addition: a caller may hand in
 * its OWN `{ value }` object for uSatBldgFade instead of sharing the module's.
 * three only re-uploads a material's uniforms when the MATERIAL changes
 * between draws, so a per-MESH ramp is impossible on a shared material; a
 * fading chunk therefore wears a twin material with its own uniform. NOTHING
 * about the generated GLSL changes — same declarations, same discard, same
 * cache key — so this is a uniform-plumbing change, NOT a key move, and a
 * caller that omits the argument gets the R21 behaviour verbatim.
 */
export function applyBendAnchorSat(material, fadeUniform) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = 'anchor-sat';
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBendCenter = uniforms.uBendCenter;
    shader.uniforms.uBendK = uniforms.uBendK;
    shader.uniforms.uSatBldgFade = fadeUniform ?? satBldgFadeUniforms.uSatBldgFade;
    shader.uniforms.uSatHaze = satHazeUniforms.uSatHaze;
    shader.uniforms.uSatHazeColor = satHazeUniforms.uSatHazeColor;
    shader.uniforms.uSatHazeMax = satHazeUniforms.uSatHazeMax;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;\nattribute vec2 aBendAnchor;\nvarying float vSatDist;'
      )
      .replace('#include <project_vertex>', satBldgAnchorProject);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform float uSatBldgFade;\nvarying float vSatDist;${satHazeDecl}${bayerDitherGLSL}`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n' +
          'if ( uSatBldgFade < 0.999 && wbBayer4( gl_FragCoord.xy ) >= uSatBldgFade ) discard;'
      )
      // Output slot, exactly where the base fade patch puts the tile haze —
      // after tonemapping/colorspace/fog — so the two mixes land in the SAME
      // space on the SAME colour and cannot disagree at the seam.
      .replace('#include <fog_fragment>', `#include <fog_fragment>\n${satHazeMix('vSatDist')}`);
  };
  // Round 19 (B): '-r16' → '-r19' — the content-haze fragment mix + the new
  // vSatDist varying are generated GLSL. Off at uSatHazeMax 0 (the branch does
  // not run) ⇒ byte-identical R18 pixels until the layer writes a haze.
  material.customProgramCacheKey = () => 'world-bend-anchor-satbldg-r19';
  material.needsUpdate = true;
}

/**
 * Round 16 (A2): satellite building cull-fade, 1 = solid, 0 = fully dithered
 * away. Written per frame by SatBuildingEngine.update() (a single uniform write;
 * no material/geometry churn, no draw-count change). Left at 1 forever when
 * SAT_BLDG_FADE.enabled is false.
 */
export function setSatBldgFade(v) {
  satBldgFadeUniforms.uSatBldgFade.value = v;
}

/** Dev/harness introspection (verify-sat-night gate E reads the live fade). */
export function getSatBldgFade() {
  return satBldgFadeUniforms.uSatBldgFade.value;
}

// --- Round 18 (A2 "SKYLINE"): the DISTANT BLOCK-MASS bend -------------------
// Geometrically this is the near ring's anchor bend: one merged mesh per
// streamed chunk, every vertex stamped with its building's footprint centroid,
// so each block drops rigidly by that one d²k (a per-vertex bend would shear a
// 4.9 km chunk — R6 lesson 2). What is NEW is a fragment pair, both riding the
// SAME ordered Bayer-4 dither the near ring already compiles (an opaque merged
// mesh cannot go transparent without sorting + a second program; a screen-door
// `discard` costs nothing):
//
//   HOLE  — the mass must not draw where the DETAIL ring already stands, or the
//           two co-located cities z-fight and the near blocks double-draw. So
//           fragments whose ANCHOR (not their own position — a tall block leans
//           across the boundary otherwise) sits inside uSkyHole.x dissolve out,
//           feathered over the next uSkyHole.y. The layer then EASES the radius
//           to 0 across the detail ring's own dissolve band, which is the whole
//           trick: the city does not vanish at 2.4 km AGL, it BECOMES mass.
//   FADE   — the ring's own altitude cull (uSkyFade, 1 → 0 across the AGL band),
//           so the skyline thins out at ~30k ft instead of popping.
//
// Both terms are value-gated to identity (hole radius 0, fade 1): with the
// uniforms at their defaults this variant renders EXACTLY the anchor-sat bend.
const satSkylineUniforms = {
  uSkyHole: { value: { x: 0, y: 1, isVector2: true } }, // (radiusM, featherM)
  uSkyFade: { value: 1 }, // 1 = solid, 0 = fully dithered away
};

const satSkylineAnchorProject = /* glsl */ `
vec4 wPos = modelMatrix * vec4( transformed, 1.0 );
vec4 wAnchor = modelMatrix * vec4( aBendAnchor.x, 0.0, aBendAnchor.y, 1.0 );
float bendD = distance( wAnchor.xz, uBendCenter );
wPos.y -= bendD * bendD * uBendK;
vSkyDist = bendD;
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Patch the SATELLITE skyline material (MeshLambert, vertexColors, DoubleSide,
 * one merged mesh per streamed group). NOTE the material must NOT enable `map`:
 * the worker's 'sat-skyline' bundle carries NO uv array, and a missing
 * attribute reads (0,0) — the R15 window-on-every-roof trap. Reaches no
 * existing variant, so no other FINAL keys move.
 */
/*
 * R24 B (CHUNK_FADE) — same seam as applyBendAnchorSat: `fadeUniform` lets a
 * fading group wear a twin material with its OWN uSkyFade. uSkyHole stays
 * module-shared on purpose — the near-field hole is a GEOMETRIC law about
 * where the detail ring stands, identical for every group, and forking it per
 * mesh would let two co-located groups disagree about the same boundary. No
 * GLSL text change, no cache-key move.
 */
export function applyBendAnchorSatSkyline(material, fadeUniform) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = 'anchor-satskyline';
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBendCenter = uniforms.uBendCenter;
    shader.uniforms.uBendK = uniforms.uBendK;
    shader.uniforms.uSkyHole = satSkylineUniforms.uSkyHole;
    shader.uniforms.uSkyFade = fadeUniform ?? satSkylineUniforms.uSkyFade;
    shader.uniforms.uSatHaze = satHazeUniforms.uSatHaze;
    shader.uniforms.uSatHazeColor = satHazeUniforms.uSatHazeColor;
    shader.uniforms.uSatHazeMax = satHazeUniforms.uSatHazeMax;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;\nattribute vec2 aBendAnchor;\nvarying float vSkyDist;'
      )
      .replace('#include <project_vertex>', satSkylineAnchorProject);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying float vSkyDist;\nuniform vec2 uSkyHole;\nuniform float uSkyFade;${satHazeDecl}${bayerDitherGLSL}`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n' +
          'float skyA = uSkyFade;\n' +
          'if ( uSkyHole.x > 0.0 ) skyA *= smoothstep( uSkyHole.x, uSkyHole.x + uSkyHole.y, vSkyDist );\n' +
          'if ( skyA < 0.999 && wbBayer4( gl_FragCoord.xy ) >= skyA ) discard;'
      )
      // Same output slot / same uniforms as the near ring: the mass and the
      // detail city must recede on ONE law, or the crossfade between them
      // (the R18 hole) would reveal a colour step exactly where it hides best.
      .replace('#include <fog_fragment>', `#include <fog_fragment>\n${satHazeMix('vSkyDist')}`);
  };
  // Round 19 (B): '-r18' → '-r19' — the content-haze fragment mix is generated
  // GLSL. Off at uSatHazeMax 0 ⇒ byte-identical R18 pixels. No new varying
  // here: the haze rides vSkyDist, which the hole term already computes.
  material.customProgramCacheKey = () => 'world-bend-anchor-satskyline-r19';
  material.needsUpdate = true;
}

/**
 * Round 18 (A2): the skyline's near-field hole + far cull, written ONCE per
 * frame by SatSkylineEngine.update() (the layer's frame callback is its only
 * caller). Pure uniform writes — no material churn, no draw-count change.
 * (0, *, 1) is the identity state the engine hands back on dispose.
 */
export function setSatSkyline(holeRadiusM, holeFeatherM, fade) {
  satSkylineUniforms.uSkyHole.value.x = holeRadiusM;
  satSkylineUniforms.uSkyHole.value.y = Math.max(1, holeFeatherM);
  satSkylineUniforms.uSkyFade.value = fade;
}

/**
 * Round 19 (B): the satellite CONTENT haze band + colour, shared by the
 * sat-building and sat-skyline variants (one law for the detail city and the
 * distant mass). Takes the raw sRGB rim components like setDepthHazeRGB does,
 * so FlyScene can hand it the SAME live _atmoRim triple the tiles get.
 * max 0 ⇒ the fragment branch never runs ⇒ exact R18 pixels.
 */
export function setSatContentHaze(startM, endM, r, g, b, max) {
  satHazeUniforms.uSatHaze.value.x = startM;
  satHazeUniforms.uSatHaze.value.y = endM;
  // R24 C (LINEAR_HAZE): decoded at the setter (see the header note). The
  // content haze mixes in the SAME after-fog slot as the tile haze, so it must
  // move with it or the building and the ground under it separate again.
  satHazeUniforms.uSatHazeColor.value.r = hazeC(r);
  satHazeUniforms.uSatHazeColor.value.g = hazeC(g);
  satHazeUniforms.uSatHazeColor.value.b = hazeC(b);
  satHazeUniforms.uSatHazeMax.value = max;
}

/** Dev/harness introspection (verify-aerial reads the live content haze). */
export function getSatContentHaze() {
  return {
    startM: satHazeUniforms.uSatHaze.value.x,
    endM: satHazeUniforms.uSatHaze.value.y,
    max: satHazeUniforms.uSatHazeMax.value,
  };
}

/** Dev/harness introspection (verify-skyline reads the live choreography). */
export function getSatSkyline() {
  return {
    holeRadiusM: satSkylineUniforms.uSkyHole.value.x,
    holeFeatherM: satSkylineUniforms.uSkyHole.value.y,
    fade: satSkylineUniforms.uSkyFade.value,
  };
}

// Round 13 Phase 4: SATELLITE water-glint bend. The specular glint overlay is a
// flat water polygon draped near sea level; a PER-VERTEX d²k drop curves it to
// follow the bent ground exactly (an anchor bend would keep a large harbor plane
// rigid and float its edges off the curved terrain — the OPPOSITE of what a flat
// water body needs; this matches how the toy WATER material and the base tiles
// bend). No fade/haze (sat water streams within ~3km, far inside the 60km fade),
// so this is a pure vertex bend; the MeshPhong material's own scene lighting +
// animated normal map do the sun sparkle. Its own program cache key — a Phong
// base + a bend-only injection reaches NO existing variant, so no other FINAL
// keys move (the plan wrote "anchored bend"; per-vertex is the correct choice
// here — see the inline rationale above).
const waterSatProject = /* glsl */ `
vec4 wPos = modelMatrix * vec4( transformed, 1.0 );
float bendD = distance( wPos.xz, uBendCenter );
wPos.y -= bendD * bendD * uBendK;
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Patch a SATELLITE water-glint material (MeshPhong, transparent additive, one
 * merged mesh per streamed chunk) with the per-vertex ground bend. Pure vertex
 * bend, no fade — reaches no existing variant. FINAL SAT-WATER key.
 */
export function applyBendWaterSat(material) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = 'water-sat';
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBendCenter = uniforms.uBendCenter;
    shader.uniforms.uBendK = uniforms.uBendK;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;'
      )
      .replace('#include <project_vertex>', waterSatProject);
  };
  material.customProgramCacheKey = () => 'world-bend-water-satglint-r13';
  material.needsUpdate = true;
}

// --- Round 16 (A2 "GND-W"): the SATELLITE ground-light network --------------
// One additive merged ribbon mesh per streamed chunk carries the WHOLE road
// network; every light on it is a fragment term on that ONE draw. The bend is
// PER-VERTEX (the waterSat model): flat draped ribbons must follow the curved
// ground exactly like the tiles do — an anchor bend would hold a 9 km chunk
// rigid and float its far edges off the curve.
//
// Fail-dark contract: the geometry supplies aRoadArc (cumulative TRUE meters
// along its chain) and aRoadCls (1-7). A MISSING aRoadCls reads 0 → LUT index 0
// → weight 0 → the whole term multiplies to black, and black on an ADDITIVE
// material is invisible. A missing aRoadArc reads 0 (every dash phase pinned),
// but it can never show: the cls gate is what turns the pixel on.
//
// The sun is a UNIFORM, never a branch on geometry: the same vertices are drawn
// at noon and at midnight (verify-sat-depth's draw count cannot move with the
// wall clock), only their gain changes.
const roadSatUniforms = {
  uRoadT: { value: 0 }, // seconds (dash trains scroll on it)
  uRoadNight: { value: 0 }, // nightK — the SAT_BUILDINGS.night γ ramp shape
  uRoadDay: { value: 1 }, // dayK = 1 − nightK
  // 8-entry class-weight LUT. Index 0 is RESERVED at 0 (see the fail-dark note);
  // 1-6 are the road classes (width-normalized), 7 is the runway.
  uClsW: { value: new Float32Array(8) },
  uRoadGlow: { value: 1.15 }, // steady network glow at full night
  uStreetSpacing: { value: 42 }, // lamp-post period (m) on cls 4-6
  uStreamBoost: { value: 1.8 }, // headlight dash brightness on cls 1-3
  uRoadDash: { value: { x: 420, y: 0.3, z: 0.1, isVector3: true } }, // (lenM, duty, speed)
  uRoadDayDash: { value: { x: 160, y: 0.05, z: 0.15, isVector3: true } },
  uRoadDayGlint: { value: 0.35 },
  uRwySat: { value: { x: 2.2, y: 0, isVector2: true } }, // (boost, chase)
  // Round 19 (C GROUNDTRUTH) — SUBURB_NIGHT. Both default to the additive
  // identity, so a material patched WITHOUT a night cfg (or with
  // SUBURB_NIGHT.enabled false) compiles the same terms and computes exactly
  // the R16 result: uStreet56 (0,0) leaves the class weight untouched, and
  // uRoadDaySeam 0 adds literally nothing to `gain`.
  uStreet56: { value: { x: 0, y: 0, isVector2: true } }, // (cls5, cls6) weight lift
  uRoadDaySeam: { value: 0 }, // pale steady daytime seam on cls 1-4
};

// The night ramp's shape (kept here so world-bend stays constants-free — the
// horizonFade/groundHorizonTarget precedent: cfg is passed IN at apply time).
const roadNightRamp = { dayFrac: 0.3, gamma: 1.5 };

// Streetlight dots: a lamp post is a POINT, so the term is a narrow gaussian on
// the distance to the nearest lamp rather than a duty-cycle dash — a dash reads
// as a dotted line, an exp dot reads as a lamp. Sharpness is in period² units
// (260 ⇒ visible over ≈ 12% of a 42 m span ≈ a 5 m pool of light).
const STREET_DOT_GAIN = 1.6;
const STREET_DOT_SHARP = 260.0;

const roadSatProject = /* glsl */ `
vec4 wPos = modelMatrix * vec4( transformed, 1.0 );
float bendD = distance( wPos.xz, uBendCenter );
wPos.y -= bendD * bendD * uBendK;
vec4 mvPosition = viewMatrix * wPos;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * Patch the SATELLITE road-network material (MeshBasic, vertexColors, additive,
 * depthWrite off / depthTest on, one merged mesh per streamed chunk).
 * cfg = SAT_ROADS (widths → class weights, plus every night/day/runway knob).
 * night = SUBURB_NIGHT (round 19, OPTIONAL): the cls 5-6 streetlight envelope
 * and the daylight seam. Omitting it leaves both uniforms at their additive
 * identity, i.e. the exact R16 fragment result.
 * Reaches NO existing variant, so no other FINAL keys move.
 */
export function applyBendRoadSat(material, cfg, night) {
  if (!material || material.userData.__worldBend) return;
  material.userData.__worldBend = 'road-sat';
  if (cfg) {
    // Class weight = ribbon width / widest ribbon: a motorway reads brightest,
    // a residential minor dimmest, with ONE source of truth (SAT_ROADS.classes)
    // for both the geometry and the light. Index 0 stays 0 = the dark sentinel.
    const W = roadSatUniforms.uClsW.value;
    W.fill(0);
    let maxW = 0;
    for (const spec of Object.values(cfg.classes)) maxW = Math.max(maxW, spec.w);
    if (maxW <= 0) maxW = 1;
    for (const spec of Object.values(cfg.classes)) {
      if (spec.cls >= 1 && spec.cls <= 7) W[spec.cls] = spec.w / maxW;
    }
    W[7] = 1; // runway edge lights carry their own boost, not a width weight
    roadSatUniforms.uRoadGlow.value = cfg.night.intensity;
    roadSatUniforms.uStreetSpacing.value = cfg.night.streetSpacingM;
    roadSatUniforms.uStreamBoost.value = cfg.night.streamBoost;
    roadSatUniforms.uRoadDash.value.x = cfg.night.dashLenM;
    roadSatUniforms.uRoadDash.value.y = cfg.night.dashDuty;
    roadSatUniforms.uRoadDash.value.z = cfg.night.dashSpeed;
    roadSatUniforms.uRoadDayDash.value.x = cfg.day.dashLenM;
    roadSatUniforms.uRoadDayDash.value.y = cfg.day.dashDuty;
    roadSatUniforms.uRoadDayDash.value.z = cfg.day.dashSpeed;
    roadSatUniforms.uRoadDayGlint.value = cfg.day.glintIntensity;
    roadSatUniforms.uRwySat.value.x = cfg.runway.boost;
    roadSatUniforms.uRwySat.value.y = cfg.runway.chase;
    roadNightRamp.dayFrac = cfg.night.dayFrac;
    roadNightRamp.gamma = cfg.night.gamma;
  }
  // Round 19 (C): the suburban terms. Guarded on `enabled` so the one-flag
  // rollback restores the R16 uniforms exactly (the values are never written).
  if (night?.enabled) {
    roadSatUniforms.uStreet56.value.x = night.streetGain.c5;
    roadSatUniforms.uStreet56.value.y = night.streetGain.c6;
    roadSatUniforms.uRoadDaySeam.value = night.daySeam;
  }
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.uniforms.uBendCenter = uniforms.uBendCenter;
    shader.uniforms.uBendK = uniforms.uBendK;
    for (const name of Object.keys(roadSatUniforms)) {
      shader.uniforms[name] = roadSatUniforms[name];
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec2 uBendCenter;\nuniform float uBendK;\nattribute float aRoadArc;\nattribute float aRoadCls;\nvarying float vRoadArc;\nvarying float vRoadCls;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRoadArc = aRoadArc;\nvRoadCls = aRoadCls;'
      )
      .replace('#include <project_vertex>', roadSatProject);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vRoadArc;
varying float vRoadCls;
uniform float uRoadT;
uniform float uRoadNight;
uniform float uRoadDay;
uniform float uClsW[ 8 ];
uniform float uRoadGlow;
uniform float uStreetSpacing;
uniform float uStreamBoost;
uniform vec3 uRoadDash;
uniform vec3 uRoadDayDash;
uniform float uRoadDayGlint;
uniform vec2 uRwySat;
uniform vec2 uStreet56;
uniform float uRoadDaySeam;
// Loop-indexed LUT read: a constant loop bound with the loop counter as the
// index is the GLSL-ES-1.0-safe way to index a uniform array by a varying.
float wbRoadClsW( float c ) {
  int ci = int( c + 0.5 );
  float w = 0.0;
  for ( int i = 0; i < 8; i++ ) { if ( i == ci ) w = uClsW[ i ]; }
  return w;
}
float wbDash( float ph, float duty ) {
  return smoothstep( 0.0, duty * 0.4, ph ) * ( 1.0 - smoothstep( duty * 0.7, duty, ph ) );
}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  float rc = vRoadCls;
  float rw = wbRoadClsW( rc );
  float ra = vRoadArc;
  float mArtery = step( 0.5, rc ) * step( rc, 3.5 );  // motorway/trunk/primary
  float mStreet = step( 3.5, rc ) * step( rc, 6.5 );  // secondary/tertiary/minor
  float mGlint  = step( 0.5, rc ) * step( rc, 2.5 );  // motorway/trunk
  float mRwy    = step( 6.5, rc );                    // runway edge lights
  // (F) round 19 - SUBURBAN STREETLIGHT ENVELOPE (cls 5-6, SUBURB_NIGHT).
  //     rw is the class weight = ribbon width / widest ribbon, and it
  //     multiplies EVERYTHING below - so Powell's tertiary (12m) and minor
  //     (9m) streets were rendered at 0.46/0.35 of the gain the R16 night
  //     sweep calibrated on 26m downtown arteries. rw does double duty there
  //     (per-pixel brightness AND, via width, pixel COUNT), so a narrow road
  //     was dimmed twice for being narrow. These two terms lift the per-pixel
  //     half back toward parity and leave the width to differentiate.
  //     uStreet56 (0,0) => rwEff is bit-identical to rw (a + 0.0 == a).
  float m5 = step( 4.5, rc ) * step( rc, 5.5 );
  float m6 = step( 5.5, rc ) * step( rc, 6.5 );
  float rwEff = rw + m5 * uStreet56.x + m6 * uStreet56.y;
  // (A) steady network glow - the city as a lit web
  float gain = uRoadGlow * uRoadNight;
  // (B) streetlights: discrete lamp pools along the residential grid
  float sp = fract( ra / uStreetSpacing );
  float sd = min( sp, 1.0 - sp );
  gain += mStreet * uRoadNight * uRoadGlow * ${STREET_DOT_GAIN.toFixed(2)} * exp( -sd * sd * ${STREET_DOT_SHARP.toFixed(1)} );
  // (C) headlight dash trains streaming down the arteries
  gain += mArtery * uRoadNight * uStreamBoost * wbDash( fract( ra / uRoadDash.x - uRoadT * uRoadDash.z ), uRoadDash.y );
  // (D) DAY: a faint fast glint on the biggest classes (the only daytime motion
  //     - a steady glow over sunlit imagery would just read as haze)
  gain += mGlint * uRoadDay * uRoadDayGlint * wbDash( fract( ra / uRoadDayDash.x - uRoadT * uRoadDayDash.z ), uRoadDayDash.y );
  // (E) runway edge lights: steady (optional chase on uRwySat.y)
  float rab = 1.0;
  if ( uRwySat.y > 0.001 ) {
    float rph = fract( ra * 24.0 - uRoadT * uRwySat.y );
    rab = 0.72 + 0.55 * smoothstep( 0.82, 1.0, rph );
  }
  gain += mRwy * uRoadNight * uRwySat.x * rab;
  // (G) round 19 - DAYLIGHT SEAM (cls 1-4, SUBURB_NIGHT.daySeam). By day the
  //     network carried ONLY the fast glint dash on cls 1-2, so a suburb's
  //     roads were invisible over washed-out imagery. A pale STEADY term on
  //     the four biggest classes reads as concrete catching the sun, not as
  //     painted lines. The material is ADDITIVE: this can only ever add
  //     light, never darken a daylight frame. 0 => IEEE identity.
  gain += step( 0.5, rc ) * step( rc, 4.5 ) * uRoadDay * uRoadDaySeam;
  diffuseColor.rgb *= rwEff * gain;
}`
      );
  };
  material.customProgramCacheKey = () => 'world-bend-road-satnight-r19';
  material.needsUpdate = true;
}

/** Per-frame (SatRoadEngine.update): advance the road dash/glint clock. */
export function setSatRoadClock(t) {
  roadSatUniforms.uRoadT.value = t;
}

/**
 * Per-frame (SatRoadEngine.update): the day/night mix from satellite's R13 day
 * cycle (runtime.sun.frac — 1 = noon, 0 = night). This is the EXACT γ ramp
 * SatBuildingEngine.setNightMix uses, so the road network and the building
 * windows come up together at dusk; dayK is its complement.
 */
export function setSatRoadMix(sunFrac) {
  const t = Math.min(1, Math.max(0, 1 - (sunFrac ?? 1) / roadNightRamp.dayFrac));
  const n = t ** roadNightRamp.gamma;
  roadSatUniforms.uRoadNight.value = n;
  roadSatUniforms.uRoadDay.value = 1 - n;
}

/** Dev/harness introspection (verify-sat-night gate B: day vs night mix). */
export function getSatRoadMix() {
  return { night: roadSatUniforms.uRoadNight.value, day: roadSatUniforms.uRoadDay.value };
}

/**
 * Round 19 (C): the live SUBURB_NIGHT road terms, read back off the uniforms
 * the GPU is actually using — the getBend()/getEdgeFade() discipline.
 * verify-groundlife gates the daylight seam through THIS rather than through
 * pixels. Measured: the seam brightens road pixels by up to +129 luma, but
 * only ~2% of any crop IS road, and live cloud-shadow drift moves the same
 * number of pixels by the same amount in the 1.6 s an A/B pair takes (control
 * 0.5502% of pixels vs signal 0.5630% at a +15 threshold). A gate whose noise
 * floor equals its signal is a coin flip — the R17 §7.1 trap — so the wiring
 * is asserted exactly here and the LOOK ships as evidence
 * (scripts/r19-c-dayseam-diff.png).
 */
export function getSatRoadNight() {
  return {
    street5: roadSatUniforms.uStreet56.value.x,
    street6: roadSatUniforms.uStreet56.value.y,
    daySeam: roadSatUniforms.uRoadDaySeam.value,
  };
}

/**
 * Where the ground fade band sits and the raw-sRGB color it melts into
 * (match the style's fog/void family). Called at style-change time for the
 * static styles; in TOY, round 12's altitude horizon calls it PER FRAME
 * from FlyScene's -50 block with the smoothed altitude-scaled band (pure
 * uniform writes — cheap). getEdgeFade() reads the live values back.
 */
export function setEdgeFade(startM, endM, hex) {
  uniforms.uEdgeFade.value.x = startM;
  uniforms.uEdgeFade.value.y = endM;
  const n = parseInt(hex.slice(1), 16);
  // R24 C (LINEAR_HAZE): stash the AUTHORED sRGB, write the DECODED value.
  _rimRaw.r = ((n >> 16) & 255) / 255;
  _rimRaw.g = ((n >> 8) & 255) / 255;
  _rimRaw.b = (n & 255) / 255;
  uniforms.uEdgeColor.value.r = hazeC(_rimRaw.r);
  uniforms.uEdgeColor.value.g = hazeC(_rimRaw.g);
  uniforms.uEdgeColor.value.b = hazeC(_rimRaw.b);
}

/**
 * Round-8 depth haze — distant ground recedes toward a cool haze tone
 * across [startM, endM] BEFORE the rim fade. Pass max 0 to disable (every
 * style but toy). endM must sit UNDER the style's fade start so the rim
 * gates hold (toy: 13km < 14km at the floor; round 12's per-frame writer
 * preserves the ratio as the band extends with altitude).
 */
export function setDepthHaze(startM, endM, hex, max) {
  uniforms.uHaze.value.x = startM;
  uniforms.uHaze.value.y = endM;
  uniforms.uHazeMax.value = max;
  const n = parseInt(hex.slice(1), 16);
  // R24 C (LINEAR_HAZE): decoded at the setter (see the header note).
  uniforms.uHazeColor.value.r = hazeC(((n >> 16) & 255) / 255);
  uniforms.uHazeColor.value.g = hazeC(((n >> 8) & 255) / 255);
  uniforms.uHazeColor.value.b = hazeC((n & 255) / 255);
}

/**
 * Round 13 Phase 1: raw-component variants of setEdgeFade / setDepthHaze for
 * the satellite atmosphere writer (FlyScene -50 block), which interpolates a
 * LIVE rim color every frame — passing already-decoded sRGB components (0..1)
 * avoids a per-frame hex build + parse. r/g/b are OUTPUT-space raw sRGB, the
 * same space the hex setters decode into (the mix lands after three's
 * tonemap/colorspace/fog chunks). Toy keeps calling the hex setters (its rim
 * color is a constant literal — no per-frame decode there either).
 */
export function setEdgeFadeRGB(startM, endM, r, g, b) {
  uniforms.uEdgeFade.value.x = startM;
  uniforms.uEdgeFade.value.y = endM;
  // R24 C (LINEAR_HAZE): stash the AUTHORED sRGB, write the DECODED value.
  _rimRaw.r = r;
  _rimRaw.g = g;
  _rimRaw.b = b;
  uniforms.uEdgeColor.value.r = hazeC(r);
  uniforms.uEdgeColor.value.g = hazeC(g);
  uniforms.uEdgeColor.value.b = hazeC(b);
}

export function setDepthHazeRGB(startM, endM, r, g, b, max) {
  uniforms.uHaze.value.x = startM;
  uniforms.uHaze.value.y = endM;
  uniforms.uHazeMax.value = max;
  // R24 C (LINEAR_HAZE): decoded at the setter (see the header note).
  uniforms.uHazeColor.value.r = hazeC(r);
  uniforms.uHazeColor.value.g = hazeC(g);
  uniforms.uHazeColor.value.b = hazeC(b);
}

/**
 * The live bend state (rebased center + k) for CPU-side consumers (letters,
 * label projections). Reading the SAME uniform FlyScene writes guarantees
 * DOM overlays and discrete objects agree with the GPU exactly.
 */
export function getBend() {
  return {
    cx: uniforms.uBendCenter.value.x,
    cz: uniforms.uBendCenter.value.y,
    k: uniforms.uBendK.value,
  };
}

/** CPU-side drop for discrete GROUND objects (POI letters) at distance d. */
export function bendDrop(d, k) {
  return d * d * k;
}

/**
 * CPU-side drop for an AIRCRAFT at distance d and absolute altitude y —
 * the exact mirror of the 'world-bend-air' vertex formula, reading the
 * SAME live uniforms, so DOM label/reticle projections and harness aim
 * agree with the GPU to the pixel.
 */
/**
 * Round 11: per-aircraft horizon visibility, 1 → fully visible, 0 → past the
 * horizon. Reads the SAME live uniforms as airDrop (uBendK is the altitude-
 * flattened k FlyScene writes; uEyeY is the player's eye), so the fade radius
 * breathes with the player's altitude exactly like the terrain does. The
 * combined horizon D = sqrt(eye/k)·playerFrac + sqrt(alt/k)·planeMul is the
 * mini-globe analogue of the real-world "sum of both horizon distances"
 * visibility rule; planeMul mirrors trafficBend.farLiftBoost so deliberately
 * lifted high traffic never fades while visible. Smoothstep band, no hard cut.
 * cfg = TRAFFIC_HORIZON (passed in — world-bend stays constants-free).
 */
export function horizonFade(d, y, cfg) {
  if (!cfg.enabled) return 1;
  const k = uniforms.uBendK.value;
  if (k <= 1e-9) return 1;
  const D =
    Math.sqrt(Math.max(0, uniforms.uEyeY.value) / k) * cfg.playerFrac +
    Math.sqrt(Math.max(0, y) / k) * cfg.planeMul;
  const a = Math.max(cfg.minVisM, D * cfg.fadeStartFrac);
  const b = Math.max(a + 1, D * cfg.fadeEndFrac);
  let t = Math.min(1, Math.max(0, (d - a) / (b - a)));
  t = t * t * (3 - 2 * t); // smoothstep
  return 1 - t;
}

export function airDrop(d, y, k = uniforms.uBendK.value) {
  const dropRaw = d * d * k;
  const agl = y - uniforms.uRefGroundY.value;
  const { x: lo, y: hi } = uniforms.uAirAgl.value;
  let t = Math.min(1, Math.max(0, (agl - lo) / (hi - lo)));
  t = t * t * (3 - 2 * t); // smoothstep
  // Round 7 altitude lift — the exact GPU formula (cap ramps to uAirCapFar)
  const lr = uniforms.uAirLiftRange.value;
  let lt = Math.min(1, Math.max(0, (d - lr.x) / (lr.y - lr.x)));
  lt = lt * lt * (3 - 2 * lt);
  const capF =
    uniforms.uAirCapFrac.value * (1 - lt) + uniforms.uAirCapFar.value * lt;
  const capped = Math.min(dropRaw, Math.max(0, y - uniforms.uEyeY.value) * capF);
  return dropRaw * (1 - t) + capped * t;
}

/**
 * Round 12 "Neon Planet": target GROUND fade END distance for the current
 * eye/bend state — the terrain twin of horizonFade's player term. Reads the
 * SAME live uniforms (uEyeY − uRefGroundY = eye AGL, uBendK = the altitude-
 * flattened k), so the band grows exactly as altFlatten flattens the globe.
 * cfg = WORLD_EDGE.altHorizon (passed in — world-bend stays constants-free);
 * floorM = the style's static fade end (the low-altitude clamp that keeps
 * verify-neon-city's certified look byte-identical); maxM = the ceiling.
 * FlyScene damps this target and writes it via setEdgeFade — consumers must
 * read the SMOOTHED band through getEdgeFade(), never call this directly.
 */
export function groundHorizonTargetM(cfg, floorM, maxM) {
  const k = uniforms.uBendK.value;
  if (k <= 1e-9) return floorM;
  const agl = Math.max(0, uniforms.uEyeY.value - uniforms.uRefGroundY.value);
  return Math.max(floorM, Math.min(maxM, Math.sqrt(agl / k) * cfg.frac));
}

/**
 * Round 12: the LIVE ground fade band — the exact values the GPU is fading
 * with this frame (smoothed by FlyScene in toy; the static style constants
 * everywhere else). THE single source of truth for every altitude-scaled
 * consumer (sky dip, ultra ring radius, VoidFloor depth/grid, TownGlow
 * range, cloud spread, harness stats): reading the rendered uniform means
 * no consumer can drift from what's on screen. Mirrors getBend().
 */
export function getEdgeFade() {
  return {
    startM: uniforms.uEdgeFade.value.x,
    endM: uniforms.uEdgeFade.value.y,
  };
}

/**
 * Round 19 (C GROUNDTRUTH): the LIVE rim colour — raw sRGB 0..1, the exact
 * triple FlyScene's -50 block last handed setEdgeFadeRGB / setDepthHazeRGB
 * (satellite: the weather-mixed _atmoRim; toy: the style literal). Reading the
 * uniform back is the getBend()/getEdgeFade() discipline: a CPU-side consumer
 * that fades toward "the horizon colour" cannot drift from the one the GPU is
 * actually fading toward. Read by SatVegLayer's per-instance canopy haze —
 * shaderless aerial perspective for the one content layer whose material is
 * shared, bend-anchored and therefore un-patchable without moving a key.
 * Returns the shared object's components by value (no allocation per call).
 */
export function getRimColor(out) {
  // R24 C (LINEAR_HAZE): the AUTHORED sRGB stash, not the uniform — the
  // uniform now carries the decoded value and this contract is "raw sRGB".
  // With LINEAR_HAZE off the two hold identical numbers.
  const c = _rimRaw;
  if (out) {
    out.r = c.r;
    out.g = c.g;
    out.b = c.b;
    return out;
  }
  return { r: c.r, g: c.g, b: c.b };
}

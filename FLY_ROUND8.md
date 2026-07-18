# Fly Round 8 — "Stylized-Premium Night City"

> STATUS: COMPLETE + SWEPT GREEN (2026-07-17). Fix rounds + 8.5 all landed;
> targeted 12-harness sweep 12/12 PASS (user complaints verified fixed on
> screenshots: horizon band gone, trails read in neon, roofs/crowns read,
> statue + letter, inspect card, Ann Arbor church). Committed `eaee8bf`+
> follow-up; soak deferred to Round 9's full migrated sweep. Original build
> record: P1–P8 all landed (P1/P2+P3 on Opus,
> rest on Fable per user directive); review gates A+B PASS (0 blockers, 9 minors
> — see workflow journal). Sweep round 1: window grids/heights/shadows/fleet
> CONFIRMED GOOD; 4 harness fails (3 calibration + statue-letter suppression),
> plus 2 real visual issues: hard dark horizon band (rim/haze/fade interplay)
> and monument legibility (dark palette + black-silhouette past fade band).
> Sweep agent fixed a latent data bug: tileset ALWAYS emits synthetic
> render_height 5 → district inference was dead code until treated as missing.
> Draw budget: measured 461 (Levittown, high tier) vs 450 budget — the +50
> shadow estimate was low. FIX ROUND + Round 8.5 running; post-build tree
> tagged `round8-swept` (bef0560). Detailed design doc (full GLSL, tables):
> `C:/Users/bfecho/.claude/plans/look-over-fly-round7-md-to-unified-moonbeam-agent-ab5cb3cb2ded39983.md`.
> Pre-round-8 tree snapshot: git tag `round8-baseline`.

## Context

Post-round-7 user review: the neon world's buildings are rudimentary — roofs read as missing (flat featureless caps), everything is nearly the same height, the blinking-dot look (random facade window dots + red rooftop blinkers) "looks horrible", plane models are weak, and the 123 landmarks in the POI DB render zero geometry (just a floating text label). The ask: a comprehensive visual upgrade — world, buildings, shading, lighting — truly immersive, with landmarks actually displayed.

**Root cause of "same height"**: `vector-tile.worker.js:589` clamps real OSM `render_height` to [9, 90] m and boosts small buildings ×1.6 — a 541 m supertall renders at 90 m. `render_min_height` is unread. Roofs DO exist (earcut caps, worker :627-643) but are featureless single-color faces.

**User decisions (locked via AskUserQuestion):**
1. Neon (toy) world first; satellite keeps round-7 hillshade.
2. Building direction: **stylized-premium** — keep the arcade identity but rich (varied roofs, real height spread + district logic, window GRIDS not dots, street-level AO).
3. Planes: player + full traffic fleet upgraded (models + materials + emissive nav lights).
4. Landmarks: **procedural stylized monuments** (parameterized archetypes, no external assets).
5. Rooftop beacons: keep but subtle — 150 m+ absolute threshold, smaller/slower/dimmer.
6. Perf: raise draw budget to ~450 on medium/high tiers (shadows allowed); low tier holds ~350 and auto-disables extras.
7. Neon stays perpetual night, made richer (moonlight, deeper sky, depth haze).
8. Model sourcing: poly.pizza CC-BY direct downloads (uuid → `static.poly.pizza/<uuid>.glb`) + NASA public-domain where GLB-convertible ≤1 MB. CC0/CC-BY only, everything registered in `lib/fly/assets.js` FLY_ASSETS (CREDITS.md regens via `scripts/gen-credits.mjs`). No Sketchfab, no API keys.

**Verified facts that shape the plan:**
- No persistent geometry cache — worker rebuilds chunks per session (only raw .pbf rides browser HTTP cache). New baked attributes need NO cache purge; risks are HMR/stale-tab skew only (round-7 lesson 7).
- Buildings are ONE merged draw per chunk; per-vertex attrs today: position, color, anchor(vec2), aBeacon(float, −1 sentinel), aFacade(vec4: wallArcM, heightM, buildingH, hash).
- `building.vtx > 65535` already promotes to Uint32 indices — roof detail is safe.
- Shadow rig fully wired but `TOY.shadows=false`; the `qualityTier !== 'low'` gate already exists at FlyScene.jsx:646.
- `BEACONS.heightFrac 0.8` against maxH 330 would mean 264 m+ → beacons near-extinct; the absolute-threshold rewrite is mandatory.
- world-bend.js cache-key registry: every new uniform/patch combo needs a NEW key (round-4 lesson); rigid instanced objects must use anchor-bend variants (round-6 lesson).

## Phases (dependency-ordered; P5/P6 parallelizable with P1–P4)

### P1 — Height realism + district logic
Files: `lib/fly/toy-world/vector-tile.worker.js` (~:576-600), `lib/fly/fly-constants.js` (TOY_WORLD.buildings).
- New mapping: `minH 9, smallBoostH 15, smallBoost 1.35, kneeM 110, kneeSlope 0.75, maxH 330`. Soft knee above 110 m compresses supertalls instead of flat-clamping (541 m WTC → ~330).
- Read `render_min_height`: if `1 < minY < h−3`, extrude walls minY→h (elevated skyways stop being ground slabs).
- **District logic** per chunk from items[] before emit: `districtK = clamp(tall40/25,0,1)*0.6 + clamp(footprintCover/0.25,0,1)*0.4`. Missing-height inference (the real same-height fix — `render_height ?? 12` today): `inferH = mix(9+hash*6, 18+hash*46, districtK * clamp(areaM2/1200,0,1))` — suburbs get jittered houses, downtown big footprints get inferred mid-rises.
- Bake `litBias = 0.6 + districtK*0.8` into new `aEdge.y` (used by P3). Mid ring keeps ≥30 gate but tests MAPPED h.

### P2 — Roof detail system (worker-baked, zero extra draws)
Files: worker (helpers `pushBox/pushGable/pushParapet/pushSpire/pushCrown`), fly-constants (`ROOFS` block + `BEACONS` rewrite), toy-palette (roof/crown colors).
- h<16 & area<400 & 4-edge ring → gable (ridge on long axis). h≥16 flat → geometric parapet (walls to h+1.1, inset cap). 18≤h<120 (hash ~60%) → 1–3 HVAC boxes via existing point-in-poly rejection sampling. h≥90 → emissive crown band. h≥120 (alternating) → 4-sided spire mast + emissive tip.
- Emissive crowns/tips encode via aFacade role: `aFacade.x ≤ −1.5` = steady emissive, `aFacade.y` = boost (1.2–2.6). Zero new attributes for crowns.
- Per-chunk caps (`ROOFS.*.maxPerChunk`: parapet 240, hvac 160, gable 320) — tri-budget throttle. Est. +22 k verts/+14 k tris per full chunk worst case → buildings ~0.9 M tris in Manhattan; drives tri budget 1.5 M → 2.2 M (P7). Mid ring (z13): spires+crowns only.
- **Beacon redesign**: `BEACONS = { minHeightM: 150, sizeM: 1.1, rate: 0.18, duty: 0.25, dim: 0.15, boost: 1.3 }` (absolute threshold replaces heightFrac); beacon rides spire tip when present.

### P3 — Window grids + street AO (lands as ONE coordinated change with P2 — single buffer-layout change)
Files: `world-bend.js` (`applyWindowLights` → **`applyFacadeGrid`**, new key **`world-bend-fade-beacon-grid-r8`**), worker (edge-local arc + new `aEdge` vec2 attr + transferable), `toy-world-engine.js` (attach aEdge with fill(0) dark fallback), fly-constants (`WINDOW_GRID` replaces `WINDOWS`).
- Worker: wall arc becomes EDGE-local (0..edgeLenM); every wall vert pushes `aEdge = (edgeLenM, litBias)`. Attr layout final: 52 → 60 bytes/vert.
- Shader: centered columns per facade (`pitch 2.6 m`), rows = 3.0 m floors; **contiguous lit/dark floors** × office runs (3 adjacent windows) × corner-office boost; unlit windows still darken 25% (dark-glass grid reads everywhere); per-fragment street AO `diffuse *= 1 − footAO·exp(−heightM/12)`; parapet glow retained at 0.5; flicker ≤1.5 %. Net lit ≈0.40 (≈ today's approved 0.38, but structured).
- Ground contact skirts: worker bakes dark footprint ×1.15 skirt per building h≥20 into LAND at lift **0.15** (deliberately BELOW the road liftEps stack — inverse of the runway-light lesson), aArc/aGlow sentinels pushed, cap 200/chunk.
- Engine-side fallbacks for every new attr fail DARK (missing-attribute-reads-0 must never light the world). Add `WORKER_PROTOCOL = 8` on buildTile results; engine dev-warns on mismatch.

### P4 — Neon night richness
Files: FlyScene.jsx (MOODS + light pos + shadow-follow :574-583), SkyDome.jsx, world-bend.js (haze in base fade patch), fly-constants (TOY), toy-palette, Effects.jsx.
- **Moonlight**: `TOY.moonDirection [0.42, 0.60, −0.68]`, sunColor `#c8d4ff`, intensity 1.05→1.25, hemi 0.55→0.42. MOODS gains `lightDir`; directional light + shadow-follow read it for toy instead of SKY.sunDirection.
- **Shadows ON**: `TOY.shadows: true` (low-tier auto-disable already exists). `shadowMapSize { medium: 1024, high: 2048 }`. ~50 draws — fits the 450 gate. Watch toon+DoubleSide acne (bias/normalBias retune if striping).
- **Depth haze**: in the BASE fade patch after fog: `mix(color, uHazeColor, uHazeMax·smoothstep(start,end,vBendDist))`; `TOY.haze { startM 4000, endM 13000, color '#1a2246', max 0.45 }` — ends before the 14 km fade band so rim gates hold. **This changes shared fade GLSL → bump EVERY fade-family cache key with `-r8`** (`world-bend-fade-r8`, `-foam-r8`, `-pulse-rwy-r8`, `-beacon-grid-r8`, `-hill-r8`, `world-bend-anchor-r8`) + registry comment.
- Sky: optional mid-stop `PALETTE.skyMid '#1a2350'`, zenith deepened `#05070f`; fog density 0.000016→0.000020 (fog/edge-fade/rim move together per round-6 rim lesson).
- Bloom retune: toy 1.05/0.52 → 0.9/0.56 (many more emitters), gated by skyline 0.3–14 % band.

### P5 — Landmark monuments (procedural)
New: `lib/fly/landmarks-3d.js`, `components/fly/LandmarkMonuments.jsx`. Touched: `poi/landmarks.js`, `poi/index.js`, `PoiLetters.jsx`, FlyScene (toy-only mount), fly-constants (`LANDMARKS_3D`).
- Data extension (backward-compatible positional): `[name, lat, lon, archetype|null, heightM, opts?]` — author metadata for all 123 (~35–40 naturals get `null` = no monument). E.g. `['Statue of Liberty', 40.6892, −74.0445, 'statue', 93]`; bridge opts `{ spanM, headingDeg }`.
- 8 archetypes, each ONE merged unit-height BufferGeometry ≤ ~800 verts, vertex-colored with emissive-bright accents: `spire, obelisk, statue, dome, arch, bridge, castle, crownTower`.
- Rendering = TownGlow.jsx precedent verbatim: one InstancedMesh per archetype (pool 8), MeshToonMaterial + engine ramp + `applyBendAnchor` (**anchor-bend — rigid instanced ground objects never ride per-vertex bend**), 2 s cadence + immediate re-place on rebase, ground via getGroundAt×terrainExaggeration+groundLift, y-scale `hM × 1.35`, range 0–45 km, shared additive hero-halo mesh (medium/high). **+9 draws.** POI landmark letters lift by `hM×1.35 + 30`.

### P6 — Plane fleet + traffic emissive bake
Files: `assets.js`, `model-loader.js`, `TrafficLayer.jsx`, `world-bend.js` (`applyNavLights`), `PlayerPlane.jsx`, fly-constants (`NAV_LIGHTS`), public/models, CREDITS.md regen.
- Sourcing: poly.pizza search — player "fighter jet / stunt plane" (hero pick), airliner "airliner/boeing", jet "private/business jet" (**replaces the 1.74 MB traffic-jet outlier; ≤1 MB**), prop "cessna", helicopter, military (+ NASA 3D Resources PD if convertible), cargo "cargo plane/747". Conventions: nose −Z, +Y up, origin CG, real meters; verify with `scripts/inspect-glb.mjs`, set absolute `yawFixRad`; run `scripts/verify-fly-models.js`; register all in FLY_ASSETS + `node scripts/gen-credits.mjs`.
- **Emissive bake (trickiest bit)**: `bakeMeshGeometry` outputs `aEmissive = vec4(rgb = material.emissive×intensity, w = mode)` on every vert (hull=0; mergeGeometries needs attribute uniformity). Procedural nav lights appended in `loadOne` AFTER orientAndScale: wingtip octahedra (port `#ff3b30` / starboard `#2eff6a` steady), tail white, belly beacon blink, wingtip strobes. Mode in w: 0 steady; (0,0.5] strobe (duty 0.06); (0.5,1] beacon; phase hashed per model+light.
- Shader: `applyNavLights` wraps the air-anchor-patched traffic material — key **`world-bend-air-anchor-nav`** (+registry). Fragment: `totalEmissiveRadiance += vEmissive.rgb · navOn(mode, uNavT) · clamp((vColor.r+g+b)·0.5, 0, 1)` — the vColor term rides the existing stale-ghost tint so fading traffic dims its lights free. `uNavT` written once/frame in TrafficLayer.
- Materials: traffic roughness 0.55→0.35, metalness 0.15→0.5, keep flatShading. Player keeps GLTF materials + `PlayerLights` additive Points strobe (+1 draw) + glossy canopy on the mounted clone only (**never mutate useGLTF cached materials** — shared with ModelTurntable).

### P7 — Perf tiers + budgets
- `PERF_BUDGET = { drawCalls: 450, drawCallsLow: 350, triangles: 2_200_000, … }`. All tier gates arming-side (shadows/DOF/bloom-scale exist; shadowMapSize 2048 high; monument halo medium/high new); **no worker detail flag** — baked geometry stays tier-independent; documented fallback = halve ROOFS caps globally.
- Draw accounting: 312–350 measured + 50 shadows + 9 monuments + 1 halo + 1 player lights ≈ **~410 worst case** vs 450 gate.

### P8 — Verification
New harnesses (verify-neon-city Playwright pattern, `window.__flyStats` + pixel gates):
- **verify-roofs** — height histogram from buffers (max ≥250 m, ≥4 bands, suburb stdev >3), crown verts present (`aFacade.x ≤ −1.5`), top-down roof-crop luminance variance ≥2× round-7 baseline, draws ≤450.
- **verify-window-grids** — per-row lit-pixel spikiness max/mean ≥3 (dots fail, floors pass), skyline band 0.3–14 % holds, 2-frame flicker ≤2 %.
- **verify-monuments** — Statue of Liberty geometry present, center-crop bright gate, letter above monument, rebase round-trip, draws Δ ≤ +12.
- **verify-fleet** — all GLBs ≤1 MB, no primitive fallbacks, aEmissive present, nav key armed, uNavT advances, turntable renders, CREDITS.md complete.
Updated: verify-neon-city (draws 360→460, shadow probe, beacon 150 m rule), globe/globe2/style-retire toy gates 350→460, freelook/tracers/edge-fx/sun screenshot refresh (moonlight changes shading everywhere), inspect-actions (new player model crop), poi (letter lift). Run **sequentially, never during the user's live session**; finish with the 15-min soak (watch shadow-pass p95 on iGPU — fallback: shadowMapSize 512 on medium or shadows-high-only; warp-leg heap watch carries over).

## Mid-build live observation (user, 2026-07-17) — RESOLVED
Fresh-server sweep screenshots show NO geometry wedge: the "large black region"
in the top-down frame is ink-black Hudson water beside a bright interchange
(by design), and the mid-build wedge was HMR skew (armed-but-unwired shadow
pass + partial fade-key bumps), as suspected. The related-but-distinct HARD
DARK HORIZON BAND in neon-01-manhattan IS real and is being fixed in the fix
round (rim/haze/fade handoff).

## Mid-build live observation (original note, kept for the record)
User flew the neon world mid-P4 (shadows constants landed, FlyScene light/shadow-follow wiring not yet, world-bend haze/key bumps mid-redo, HMR-hot server) and saw a large black clipping wedge across the ground + a black horizon band. Consistent with expected mid-build skew (armed-but-unwired shadow pass; partial fade-family patch; dark-by-design attribute fallbacks) — but MUST be explicitly re-checked on the fresh-server verification screenshots (neon-city + roofs top-down). If any black wedge survives the fresh boot, treat as a real P4 bug (shadow camera/frustum first suspect).

## Queued follow-up — Round 8.5 (user request 2026-07-17, runs AFTER the round-8 sweep)
> Diagnosis COMPLETE — full findings + per-file fix plan in [FLY_ROUND8_5.md](FLY_ROUND8_5.md).
1. **Inspect-card actions must never dead-click.** Known causes found in code: WARP `disabled={!live}` can sit at "ACQUIRING…" forever (InspectModal.jsx:456); runtime handles null after FlyScene remount (documented failure mode, comment at :184-186) with only a 10px shake notice; fix = handles resolved at call time from a remount-surviving source + loud failure/disabled states.
2. **Inspect-card redesign**: right-docked (not centered), taller, more data; planespotters photo (already integrated via useAircraftPhoto, currently tab-buried) becomes prominent. Keep testids / update verify-inspect-actions.
3. **Toy-vs-satellite feel parity**: user reports satellite "STILL feels better and works better with contrails and the height of planes." Read-only diagnosis in flight (fork agent) comparing airDrop/trafficBend/contrail/terrain-Y paths per style; fixes land in 8.5.

## Live-review feedback round 1 (user, 2026-07-17, mid-fix-round — tab possibly stale)
1. Contrails DISAPPEAR on satellite→neon style switch (repro/diagnosis in flight; suspect style-switch material re-arm path vs stale tab).
2. "Still no roofs" — roof geometry exists + harness-verified, but likely does NOT READ at gameplay altitude (2-4k ft): 1.1 m parapets / small HVAC / same-color caps are invisible at that scale. Readability pass needed (cap color contrast, silhouette scale), not more geometry.
3. Neon "still feels flat / looks the same" — suspects: qualityTier degraded → shadows OFF on user's machine (harnesses pin high tier; real sessions may not hold it), plus roof readability, plus AO skirts hidden under landuse (review A), plus no tier visibility in UI.
Ground-truth fork running; fixes land as F5 before/with the sweep.

## Post-build taste checkpoints (user sign-off, all live-tunable in fly-constants.js)
1. Height knee/max + inferred downtown heights. 2. Window grid pitch + lit fractions (the #1 taste item again). 3. Moon/shadow presence + direction. 4. Haze + deepened sky palette. 5. Crown vs subtle-beacon balance. 6. Monument scale/halo. 7. Fleet picks + strobe rates. 8. Bloom 0.9/0.56.

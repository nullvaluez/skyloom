# Fly Round 15 — "Ground Truth" (2026-07-24) · PLAN

User-driven round, four asks from live flying on R14: (1) the new warbird
models "look absolutely terrible, are shaded purple"; (2) flight data is wrong
in the inspect card (a Cirrus shows as a helicopter); (3) rework the inspect
panel — accurate aircraft identity, real photo, more data, desktop + mobile
friendly; (4) satellite 3D buildings are "dull and boring, no immersion, no
roofs". Executed by **four Opus 5 subagents in parallel under Fable
orchestration** (Fable diagnoses, briefs, reviews, gates, commits). User
granted model-download access (license-clean only).

Branch: `claude/flight-inspect-panel-shading-56e336` (worktree). Baseline:
main @ `8bb2b6d` (R14 record commit).

## 0. Diagnosis (Fable, pre-plan — all confirmed in source)

- **Purple planes:** warbirds mostly fly private N-numbers → worker
  `classifyAircraft` → `private` → `AIRCRAFT_COLORS.private = '#a78bfa'`
  (violet). GLB archetypes tint white (vertex colors); the three R14 primitive
  archetypes are classification-tinted → flat violet blobs with
  metalness 0.5. The primitives themselves are single-color part stacks with
  zero livery detail.
- **Cirrus = helicopter:** `heliTypes` substring list contains `R22`
  (Robinson); `'SR22'.includes('R22')` → true, and the heli check precedes the
  prop check. Live in FOUR places: worker `isHelicopter` (:72), worker
  `getAircraftIconType` (:350), `lib/classify.js` (:108, :312).
- **Cessna 172 = military (found during diagnosis):** `militaryTypes` contains
  `C17`, checked before `propTypes` — `'C172'.includes('C17')` → true. The most
  common GA type in the sky renders as a fighter with a red accent.
- **Inspect card:** planespotters photo hero + credit already exist and the
  route/photo APIs are keyless proxies; the card's CLASS/name/model lie because
  classification lies. No registry (owner/manufacturer/real model name) source
  is wired.
- **Buildings:** worker DOES bake flat roof caps + gables/parapets/HVAC, but
  ONE shared `MeshLambertMaterial`, six near-identical concrete-gray wall
  tones, and roofs at 0.82× the same gray → roofs don't read, cities render as
  one extruded slab. Zero facade detail in satellite (windows are Neon-only).

## 1. Phase ownership (all four agents run in PARALLEL — disjoint files)

### A1 — Classification ground truth
**Owns:** `lib/workers/aircraft-processor.worker.js`, `lib/classify.js`, new
`lib/aircraft-type-tables.js` (canonical exact maps), `scripts/verify-classify.mjs` (new gate).
- Exact-first modern-type classification: an exact CODE → class map consulted
  BEFORE any substring loop (the R14 warbird pattern, §7 lesson 1, now applied
  to the modern lists that still carry the trap). Substring lists survive only
  as a curated fallback tail (airliner families by prefix are legitimate).
- Fix all four trap sites; keep worker logic inlined (established worker
  pattern) with the canonical copy in `lib/aircraft-type-tables.js`, sync
  proven by the new source-parsing gate (verify-warbirds precedent).
- Corpus sim in the gate: every common GA/heli/airliner/bizjet code asserts
  its expected class (SR22→prop not helicopter, C172→prop not military,
  R22→helicopter, A109→helicopter, EC35→helicopter, F16→military, …), plus
  "warbird exact-first unchanged" and "B738/A320 fleet byte-unchanged".

### A2 — Fleet models & liveries (the purple fix)
**Owns:** `lib/fly/traffic-geometries.js`, `lib/fly/assets.js`,
`lib/fly/model-loader.js`, `components/fly/TrafficLayer.jsx`,
`public/models/*`, CREDITS regen. Does NOT touch the worker or hud/.
- Scout + download license-clean GLBs (CC0/CC-BY, direct download, NO account
  creation): Quaternius, Kenney, OpenGameArt, poly.pizza re-check; targets =
  warbird-prop, warbird-heavy, classic-transport first, then audit all 13
  slots (glider/drone/unknown are also primitives) and the existing 8 GLBs for
  quality. ≤1MB, uncompressed (no Draco/meshopt/KTX2), nose −Z, +Y up, real
  meters via `computeModelCorrection`. Register in `FLY_ASSETS`; regenerate
  CREDITS.md via `scripts/gen-credits.mjs` (never hand-edit).
- Any slot still primitive gets a PREMIUM rebuild: per-part baked
  vertex-color liveries (olive/silver/bomber green/bare-metal + trim), better
  silhouettes. Baked-color primitives are tinted WHITE in TrafficLayer
  (extend the `_isModel` white-tint mechanism to a per-geometry baked-color
  flag) so classification violet can never tint a hull again. Billboards/far
  dots stay class-colored (unchanged).
- NO shader/material-type changes (R13 fill-rate lesson); the 13 InstancedMesh
  pools and append-only index contract are untouched.

### A3 — Inspect panel "the actual real plane"
**Owns:** `components/fly/hud/**`, `hooks/use-aircraft-photo.js` + new hooks,
`app/api/aircraft/**` (photo hardening + new `info` route), `lib/api.js`,
`lib/aircraft-type-names.js` + `lib/aircraft-silhouettes.js` coverage,
`INSPECT` block of `lib/fly/fly-constants.js`.
- EVOLVE the INK CODEX identity (user choice) — same holo INK+ICE voice,
  reworked hierarchy + responsiveness. Desktop right dock; mobile bottom
  sheet with proper safe-area/drag affordance. ALL wiring + testids preserved:
  `inspect-card/-warp/-chase/-hex/-action-notice/-photo-credit/-spot-log`,
  store.inspectHex open/close, Esc, 1s stale auto-close, 500ms telemetry
  cadence, zero per-frame React.
- Registry info (keyless, NO API keys — hard rule): new
  `app/api/aircraft/[hex]/info` proxy with the multi-source failover pattern
  (adsbdb.com → hexdb.io), long cache; card shows manufacturer + full model
  name, registered owner/operator, country. Graceful null degradation.
- Richer route: origin/destination airport names + progress polish on the
  existing useRoute data.
- Photo pipeline hardening: live-test the planespotters proxy, fix whatever
  drops photos (endpoint shape/UA/cache), keep photographer credit + link
  (planespotters requirement).

### A4 — Satellite buildings: roofs that read + night windows
**Owns:** `lib/fly/toy-world/vector-tile.worker.js` (buildSatBuildings +
protocol bump), `lib/fly/toy-world/sat-building-engine.js`,
`components/fly/SatBuildingLayer.jsx`, `SAT_BUILDINGS`/`SAT_WATER` blocks of
`lib/fly/fly-constants.js`.
- Roof READ: dedicated roof palette (tar/gravel/terracotta/painted), decoupled
  from wall tones, hash-picked per building; parapet/HVAC contrast; keep the
  geometric detail already baked.
- Wall depth: richer tone spread + per-vertex base-darkening (fake AO) +
  edge accents — all vertex-color work, zero material-count change.
- Facade windows (daylight): worker emits facade UVs (WORKER_PROTOCOL bump,
  sentinel-safe: stale worker → layer renders nothing + one dev warn, the
  established pattern); ONE shared procedural CanvasTexture window atlas on
  the existing Lambert `map`. Tier-gated ≥ medium.
- NIGHT windows: emissiveMap on the same material, `emissiveIntensity` driven
  per-frame from `runtime.sun.frac` (satellite's R13 night cycle) — windows
  light up as the sun sets. High-tier only. Zero extra draws.
- Same merged-mesh-per-chunk contract: draw count unchanged;
  `verify-sat-depth` gate 261 must hold; `SAT_BUILDINGS.enabled:false` stays a
  one-line revert.

## 2. Hard rules (all agents)
- NO API keys anywhere. NO account creation for downloads. License-clean
  assets only (CC0/CC-BY + attribution via FLY_ASSETS/gen-credits).
- Zero harness gate re-baselines unless measured + sanctioned by Fable.
- Do not run browser harnesses or dev servers (Fable runs the sweep
  post-integration); node-only gates (verify-warbirds/verify-classify) OK.
- No commits/pushes — Fable commits after review.
- fly-constants.js is shared: each agent edits ONLY its designated block;
  re-read before editing.

## 3. Acceptance
- verify-classify (NEW) + verify-warbirds + verify-fleet + verify-fly-models +
  verify-spicy + verify-contracts + verify-sat-depth (261) + verify-boot +
  verify-inspect-actions all green post-integration.
- Browser evidence: warbird + GA archetypes in-scene (no violet), inspect card
  desktop + mobile viewports, satellite buildings day + night.
- FLY_ROUND15.md record + user checkpoint table (tier feel, livery taste,
  building night intensity, panel data density).

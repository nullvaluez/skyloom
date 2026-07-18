# Fly Round 9 — "Fly-Only" pivot (delete AR + flat tracker, boot into a toy-world loading screen)

> STATUS: COMPLETE (2026-07-18). App is FLY-ONLY: boots into the BootScreen
> (real-progress __flyBoot contract; toy 9.2s / satellite 5.4s goto→reveal vs
> the old 22s fixed waits), flat tracker + AR deleted (~30 files, 4 stores,
> 6 deps incl. deck.gl/maplibre; ~120 fewer packages), branding rewritten as a
> night-flying game (NAME still "ShadowADSB" — user taste checkpoint), all
> harnesses migrated to scripts/_boot.js bootFly. Review pass (3 minors, all
> fixed post-round: stray zips, dead maplibre/deck CSS, stale eslint-disable).
> Migrated sweep 24/25 green (verify-contracts fixed post-sweep: synthetic-track
> template + a defensive renderLift guard in traffic-engine; verify-chase-cam
> range-band is an environmental flake — all functional gates pass). Soak 15min:
> p50 4.2ms / p95 8.4ms typical, heap sawtooth healthy, draws ≤380/470.
> Original plan follows. User decisions (AskUserQuestion): (1) COMMIT the
> full rounds-6→8.5 tree BEFORE any deletion — the stash-tags do NOT cover
> untracked new files; (2) scope = AR mode + flat 2D tracker deleted, satellite
> FLY style + ADS-B plumbing KEPT; (3) targeted ~12-harness sweep after F5,
> full migrated sweep at the end of this round. Read-only inventory below is
> agent-verified (2026-07-17).

## Sequencing
1. F5 + Review F5 complete (running) → INTERCEPT: safety commit of everything,
   retarget sweep to the targeted set (neon-city, roofs, window-grids,
   monuments, fleet, inspect-actions, tracers, airbend, chase-cam, edge-fx,
   rim, atlas — no soak), resume.
2. Round 9 workflow (Fable agents, sequential): R9-1 loading screen/boot →
   R9-2 deletion + extraction pass → R9-3 harness migration → review gate →
   full migrated sweep + 15-min soak.

## R9-1 Loading screen + boot
- `app/page.js`: mount FlyMode directly (no ui-store gate, no Header).
- Pre-render: FlyCanvas mounts immediately UNDER a full-screen INK+ICE loading
  overlay (in FlyMode, not a dynamic() spinner). Reveal gates: (a) ring-0 toy
  chunks finalized with `pendingFinalize===0` held ~1 s (engine.stats(),
  toy-world-engine:621-625); (b) `loadTrafficGeometries()` promise resolved
  (model-loader:320); (c) ≥2 rendered frames post-Suspense (shader warm).
- Real progress bar from chunks/expectedRing0 + models + DEM tiles; expose
  `window.__flyBoot = {phase, pct}` (harness contract). "Sweet": INK+ICE
  tokens + WarpFlash-style streak over the hidden canvas as it reveals.
- Spawn: replace map-store read (FlyMode.jsx:50) with `getSpawnLatLon()` —
  geolocation → localStorage `fly-last-pos` → NYC default.
- Keep dev globals: `__toyWorld`, `__flyStats`, `__flyRuntimeBus`, `__flyBoot`.

## R9-2 Deletion + extraction (agent-verified lists)
DELETE: components/map/**, components/panels/**, components/layout/**,
components/aircraft/AircraftIcon.jsx, components/dev/PerformanceHUD.jsx,
components/ar/ARSpotter.jsx; hooks use-filters, use-keyboard-shortcuts,
use-gestures, use-haptics, use-share, use-debounce, use-media-query,
use-geolocation, use-aircraft-worker (grep first — starred ones need a final
no-import check); stores filter-store, dev-store, aircraft-store, map-store;
deps maplibre-gl, react-map-gl, @deck.gl/*, nuqs, rbush (grep, then remove +
lockfile).
EXTRACT/EDIT: `useAircraftPhoto` → hooks/use-aircraft-photo.js (rest of
use-aircraft.js dies); providers.jsx drops the aircraft-store cleanup effect,
KEEPS QueryClient + TooltipProvider; ui-store pruned of flyModeOpen/AR fields
(check remaining consumers before deleting the store outright).
KEEP: components/fly/**, lib/fly/**, lib/workers/aircraft-processor.worker.js,
fly/atlas/contracts/passport stores, use-fly-traffic, use-fly-audio,
use-route, ALL app/api/aircraft/* routes (fly uses ?lat, /photo, /route,
/search, /military, /[hex]), lib api/airports/airlines/format/rarity/
aircraft-type-names/aircraft-silhouettes/constants/utils, ui/button+tooltip,
ErrorBoundary + FlyErrorBoundary, layout.js+globals.css+error.js.
BRANDING: layout.js metadata + PWA manifest still market "ShadowADSB" AR/2D
tracking — rewrite copy for the fly game (product naming = user taste
checkpoint; placeholder: keep name, fly-game description).
VERIFY: `npm run build` must pass post-deletion (the real no-stray-import
check).

## R9-3 Harness migration
34 scripts click `button[aria-label="Fly Mode"]` after waitForSelector
('header') (107 boot-assumption hits). ONE shared scripts/_boot.js:
`bootFly(page, {style})` → goto, wait `__flyBoot.pct===100` (replaces header
wait AND the fixed 22 s stream-in sleeps — faster + deterministic). Swap
per-file; keep `fly-controls-seen`/`fly-map-style-2` localStorage (still
used); update verify-fly-style.js (style switch UI moved); re-baseline
screenshots that included the old header in the same pass.

## Safety
Commit BEFORE deletion (user-approved). Unrecoverable-if-deleted untracked
files include: lib/fly/{airport-buzz,cinema-camera,contracts,landmarks-3d,
runtime-bus}.js, components/fly/{LandmarkMonuments,TownGlow}.jsx,
components/fly/hud/Contracts.jsx, stores/fly-contracts-store.js, FLY_ROUND*.md,
16 new verify scripts. After the commit, tag `round9-pre-delete`.

# SKYLOOM Game Trailer — Satellite-Only Capture Brief

> Working brief for the trailer agent. Goal: a ~60–75 s marketing trailer of
> the game **in the satellite ("Day") style only**, captured from the real
> running app, with styled feature-text overlays, composed into a single
> video committed to this branch (`claude/game-trailer-satellite-view-fbfcax`).
> **Zero source-code changes** — everything under `components/`, `lib/`,
> `stores/`, `app/`, `hooks/`, `public/` is certified tree (see CLAUDE.md
> round records) and must not move. New files live ONLY under
> `scripts/trailer/` (pipeline) and `marketing/trailer/` (deliverables).

## 0. Hard constraints

- **Satellite style only.** Seed `localStorage['fly-map-style-2'] = 'satellite'`
  pre-mount (see `lib/fly/map-style.js`, `scripts/_boot.js`). No Neon footage.
- **No source edits.** Text overlays are DOM-injected at capture time via
  Playwright (`page.evaluate` / `addStyleTag`), never committed into app code.
- **No copyrighted music.** The recording is silent (Playwright video has no
  audio track). Ship silent; do not download audio.
- **Attribution is part of the deliverable.** End card must credit imagery
  (Esri), map data (OpenFreeMap / OpenMapTiles / OpenStreetMap), and live
  flight data (adsb.lol / adsb.fi). Mirror the strings used by
  `components/fly/hud/AttributionBar.jsx` and the `PhotoCapture.jsx` credit
  plate ("SKYLOOM over the active style's data credits").
- **Branding:** title card wordmark is **SKYLOOM** (matches the photo-mode
  credit plate and the repo). Note: `app/layout.js` metadata still says
  "ShadowADSB" — that is stale branding; do not use it in the trailer.
- Do not run captures while the user is live-testing (FLY_ROUND7 §6 lesson).

## 1. Environment facts (verified 2026-08-09 in this container)

- Deps installed (`npm install` done). Dev server: `npx next dev -p 3100`
  and pass `FLY_URL=http://localhost:3100` — NEVER assume :3000
  (R19 lesson in `scripts/_boot.js`).
- Playwright **1.56.1 is a GLOBAL install** — run capture scripts with
  `NODE_PATH=/opt/node22/lib/node_modules`. Browsers at
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (chromium-1194 — matches).
- Launch idiom: `chromium.launch({ headless: true, args: ['--enable-gpu',
  '--ignore-gpu-blocklist'] })`. **Drop the fleet's `channel: 'chrome'`** —
  no Google Chrome exists in this container; default resolution finds the
  Playwright chromium. WebGL2 works but renders on **SwiftShader
  (software)** — expect FAR lower fps than the round ledgers (they ran on
  GPU boxes). Measure before recording (see §5).
- **ffmpeg:** no system ffmpeg. Playwright's
  `/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux` muxes/encodes **VP8/WebM only —
  NO drawtext, NO libx264** (verified). For an MP4 final: `npm i ffmpeg-static`
  in a scratch dir OUTSIDE the repo (downloads from GitHub releases) and use
  that binary; if it can't download, ship WebM and say so.
- Overlay font: the game's own `public/fonts/ArchivoBlack-Regular.ttf`
  (served at `/fonts/ArchivoBlack-Regular.ttf`) — the 3D POI-letter font, so
  overlays match the game's own typography.
- **Network egress is policy-gated in this environment.** As of writing, the
  gateway 403-denies `tiles.openfreemap.org`, `server.arcgisonline.com`,
  `api.adsb.lol` (and friends) — the trailer CANNOT be captured until the
  session runs with a network policy that allows at least:
  `tiles.openfreemap.org`, `server.arcgisonline.com`, `api.adsb.lol`,
  `opendata.adsb.fi`, `api.open-meteo.com`, `aviationweather.gov`
  (plus optional `api.adsbdb.com`, `hexdb.io` for the inspect card).
  Verify with `curl -sS "$HTTPS_PROXY/__agentproxy/status"` before starting.

## 2. Boot recipe (per shot)

Write a trailer-local boot helper in `scripts/trailer/` modeled on
`scripts/_boot.js` (do NOT edit `_boot.js` — it is a sanctioned-edit file).
Differences from the harness fleet, deliberately:

- Seed `fly-controls-seen=1`, `fly-map-style-2='satellite'`.
- **Do NOT pin `__flyAerialOverride`/`__flySatShadowOverride` to 0** — those
  fleet pins exist to freeze pixel gates; the trailer WANTS depth-based
  aerial perspective and satellite shadows ON (the beauty features).
- Keep `window.__flyGovPin = 'hold'` (freezes boot DPR/tier — no mid-shot
  composer rebuilds) and `window.__flyBoostInfinite = true` (speed shots).
- Weather: default `window.__flyWeatherOverride = 'baseline'` for clean
  clear-sky shots; clear the override only if a deliberate live-weather shot
  is wanted.
- Quality: pin tier high with BOTH pins (R16 §10 lesson — a store-only pin
  is reverted by PerformanceMonitor within seconds): the persisted pick via
  `lib/fly/fly-settings.js`'s key (read that file for the exact shape; see
  `scripts/verify-skyline.js` ~line 110 for the idiom) AND post-boot
  `window.__flyStore.getState().setQualityTier('high')`
  (`scripts/r20-c2-probe.js` idiom). If SwiftShader can't hold it, see §5.
- Readiness contract: `window.__flyBoot?.pct === 100`, then canvas present,
  then `[data-testid="boot-screen"]` gone, then settle (copy `_boot.js`).
- Time of day per shot: `window.__flySunOverride` (59 uses across the
  harness fleet) — read `scripts/verify-dusk.js` / `scripts/verify-sat-night.js`
  for the exact accepted shape (elevation-keyed since R19: night below −8°,
  dusk ≈ +2°, `__flyDuskOverride` also exists). Never guess the shape.
- Warping: read `scripts/verify-monuments-sat.js` / `scripts/verify-atlas.js`
  for the exact `runtime.warpToGeo` / store invocation. After a warp, wait
  out the arrival transient (R10: 8–14 s; watch `__flyStats` draws/tris
  plateau) before recording.
- Camera: photo mode (`P`, `components/fly/PhotoCapture.jsx` +
  `hud/PhotoModeBar.jsx`) hides the HUD but keeps AttributionBar — ideal for
  clean beauty shots, and it has orbit+zoom while the flight keeps flying.
  RMB-drag is a full 360° orbit in normal flight; `C` is the cinema wing-cam
  during chases. Read the components/harnesses for keys before scripting.

## 3. Shot list (≈9 shots ≈6–8 s each + end card)

| # | Scene | Where (lat, lon) | Sun | Overlay text (Archivo Black, all-caps) |
|---|-------|------------------|-----|-----------------------------------------|
| 1 | Title: slow orbit over Lower Manhattan, ~800 m | 40.7128, −74.0060 | golden | **SKYLOOM** / "FLY THE REAL WORLD" |
| 2 | Skyline mass from altitude (~2,500 m, z14 ring + fade) | Manhattan | noon | "REAL CITIES. REAL BUILDINGS." |
| 3 | Live traffic: chase/intercept nearest airliner, tracers + contrails (JFK approach) | 40.64, −73.78 | day | "EVERY AIRCRAFT IS REAL — LIVE ADS-B" |
| 4 | Monument montage, 3 quick cuts: Eiffel / Liberty / Colosseum | 48.8584, 2.2945 · 40.6892, −74.0445 · 41.8902, 12.4922 | day | "TEN REAL LANDMARKS" |
| 5 | Dusk golden lobe, Big Ben / Thames | 51.5007, −0.1246 | dusk (el ≈ +2°) | "REAL SUN. REAL TIME." |
| 6 | Night city: road glow, runway edge lights, window atlas, beacons | NYC or Chicago | night (el < −8°) | "THE WORLD AT NIGHT" |
| 7 | Low pass over suburbs (streamed footprints + parcel homes) | Powell OH 40.158, −83.075 (alt: Melton AU) | day | "EVERY TOWN. EVERY HOME." |
| 8 | Boost run through Owens Valley mountains, speed lines + FOV punch | 36.601, −118.06 | day | "FEEL THE SPEED" |
| 9 | (Optional) real weather if it reads well live | — | — | "REAL WEATHER" |
| 10 | End card over dimmed scene or `#09090b` | — | — | SKYLOOM / "A LIVING PLANET · LIVE AIR TRAFFIC · REAL WEATHER · NINE AIRCRAFT · FLY ANYWHERE" + attribution credits |

Feature claims must stay honest — every line above is a shipped feature
(rounds 11–21). Don't invent claims; don't show Neon.

## 4. Overlay + compose pipeline

- **Overlays are DOM, recorded live** (no post drawtext): fixed-position,
  `pointer-events: none`, Archivo Black via `@font-face`, CSS keyframe
  fade/slide in-out, subtle bottom gradient for legibility, styling in the
  game's HUD language (see `.hud-glass` in `app/globals.css`). Inject per
  shot with a timed script; remove before shot end if the cut needs it.
- **Record:** one fresh context per shot,
  `recordVideo: { dir, size: { width: 1600, height: 900 } }` (the certified
  fleet viewport). Log wall-clock offsets (`shotStart`, `actionStart`) so
  the boot/settle can be trimmed off. Close the context to flush the .webm.
- **Compose:** trim each clip (`-ss` offset), normalize fps, hard cuts (or
  xfade if using ffmpeg-static), concat, encode final:
  - Preferred: ffmpeg-static → `skyloom-trailer.mp4` (H.264, CRF ~21,
    1600×900, ≤60 MB).
  - Fallback: Playwright ffmpeg → VP8 `skyloom-trailer.webm`.
- **Deliverables committed to the branch:**
  - `marketing/trailer/skyloom-trailer.mp4` (or `.webm`)
  - `marketing/trailer/stills/` — 6–10 hero PNG frames
  - `marketing/trailer/README.md` — shot ledger (location, sun, overlay
    text, clip timestamps) + exact regeneration commands
  - `scripts/trailer/` — the capture/compose scripts
  - Check `.gitignore` (`git check-ignore -v <file>`) before assuming media
    will commit.

## 5. Perf + honesty guardrails

- SwiftShader is slow. Before any real capture, boot one scene and read
  `window.__flyStats` (shape: see `scripts/soak-fly.js`) for fps. Hold
  ≥ ~20–24 fps for smooth-enough footage: first try 1600×900 high; if it
  sags, drop viewport to 1280×720 before dropping tier (tier gates the
  night-window/bloom look — prefer high tier at a smaller viewport).
- Recorded video is wall-clock: low fps = judder. If a shot judders, slow
  the camera motion instead of faking it.
- **Prove the world actually streamed** before recording each shot: satellite
  imagery visible (sample pixels — not the grey fallback), buildings present
  (`__flyStats` tris/draws plateau at plausible numbers). If tiles or
  traffic fail to load, STOP and report — do not ship footage of a broken
  world.
- Run ONE full end-to-end vertical slice first (boot → record → trim →
  encode → eyeball frames) before capturing all shots.
- Live traffic density varies by hour; pick the busiest of JFK/LHR/ORD at
  capture time for shot 3 (the `/api/aircraft` proxy answers locally).

## 6. Status ledger

- [x] Container prepped: `npm install` done; Playwright 1.56.1 + chromium
      launch + WebGL2 verified; ffmpeg capabilities mapped (2026-08-09).
- [ ] **BLOCKED: network egress** — tile/ADS-B hosts 403-denied by the
      session's network policy (see §1). Waiting on the user to run this in
      an environment whose policy allows those hosts.
- [ ] Capture pipeline built (`scripts/trailer/`)
- [ ] 9 shots captured + composed
- [ ] Trailer + stills + README committed and pushed

# SKYLOOM trailer — satellite ("Day") style

A ~60–75 s marketing trailer captured from the real running game, satellite
style only, with text overlays injected into the live page at capture time.

**Current state: the capture pipeline is complete and proven; the nine
gameplay shots have NOT been captured.** The world-streaming hosts are blocked
by network policy in the environment this was built in, so no gameplay footage
exists yet. What is here is real and final: the two card segments, and a
pipeline that produces the rest in one command once those hosts are reachable.

Nothing in this directory is named `skyloom-trailer.*` yet, deliberately — that
name is reserved for a file that contains real gameplay footage.

---

## 1. What exists today

| Path | What it is | Status |
|---|---|---|
| `segments/title-card.webm` + `.png` | SKYLOOM wordmark / "FLY THE REAL WORLD", real Archivo Black | **final** |
| `segments/end-card.webm` + `.png` | SKYLOOM, five feature lines, full data attribution | **final** |
| `segments/*.json` | per-segment timing sidecars (trim offsets) | final |
| `../../scripts/trailer/` | the whole capture + compose pipeline | complete |
| `stills/` | 6–10 hero gameplay frames | **awaits network** |
| `skyloom-trailer.mp4` | the trailer | **awaits network** |

The two cards are legitimate final trailer material: neither needs the streamed
world (the end card is an opaque plate, the title plate is the wordmark on
`#09090b`), so they were captured at final quality.

## 2. The one command that finishes the trailer

With the tile/ADS-B hosts reachable and a dev server running:

```bash
# 0. dev server on a free port (never :3000 — see scripts/_boot.js R19 note)
npx next dev -p 3100

# 1. confirm the network gate + measure this host's fps (exit 0 = clear)
NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
FLY_URL=http://localhost:3100 node scripts/trailer/preflight.js

# 2. capture all nine gameplay shots (add --with-optional for the weather shot)
NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
FLY_URL=http://localhost:3100 node scripts/trailer/capture.js --all

# 3. the two cards (already committed; re-run only if you change them)
NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
FLY_URL=http://localhost:3100 node scripts/trailer/cards.js

# 4. compose: cards bookend the shots
node scripts/trailer/compose.js \
  --from-raw=<scratch>/raw \
  --cards=marketing/trailer/segments \
  --stills=marketing/trailer/stills \
  --out=marketing/trailer/skyloom-trailer.mp4
```

`compose.js` needs a full ffmpeg. There is none on the system; install one
**outside the repo** and it is found automatically, or point at it explicitly:

```bash
cd <scratch> && npm i ffmpeg-static
# then: TRAILER_FFMPEG=<scratch>/node_modules/ffmpeg-static/ffmpeg node scripts/trailer/compose.js ...
```

## 3. Shot ledger

Locations, altitudes, sun elevations, camera moves and overlay copy all live in
`scripts/trailer/shots.js` — that file is the source of truth; this table is a
readable copy. Every overlay line carries a `claim` field in `shots.js` naming
the shipped mechanism behind it.

| # | Scene | Where | Sun | Overlay | Status |
|---|---|---|---|---|---|
| — | Title plate | — | — | SKYLOOM / FLY THE REAL WORLD | **captured** |
| 1 | Slow orbit, ~800 m | Lower Manhattan | golden, el +6° | SKYLOOM / FLY THE REAL WORLD | pending |
| 2 | Skyline mass, ~2,500 m | Manhattan | solar noon | REAL CITIES. REAL BUILDINGS. | pending |
| 3 | Intercept + wing-cam | JFK approach | el +28° | EVERY AIRCRAFT IS REAL | pending |
| 4 | Monument montage ×3 | Eiffel · Liberty · Colosseum | el +22° | TEN REAL LANDMARKS | pending |
| 5 | Dusk golden lobe | Big Ben / Thames | **el +2°** | REAL SUN. REAL TIME. | pending |
| 6 | Night city | Chicago | **el −12°** | THE WORLD AT NIGHT | pending |
| 7 | Low pass, 420 m | Powell OH | el +34° | EVERY TOWN. EVERY HOME. | pending |
| 8 | Boost run | Owens Valley | el +40° | FEEL THE SPEED | pending |
| 9 | Live weather (optional) | Manhattan | el +24° | REAL WEATHER | pending |
| — | End card | — | — | 5 feature lines + credits | **captured** |

`--all` captures shots 1–8. Shots 9 (live weather) and 10 (end card over live
gameplay) are marked optional — add `--with-optional` to include them. The
committed end card comes from `cards.js`, which renders it with no WebGL at
all: smooth, HUD-free, and independent of the network.

Sun times are **solved per location**, not borrowed: R19 re-keyed every sky
bucket on true solar elevation, so a timestamp that is dusk in London is
mid-afternoon in Los Angeles. `scripts/trailer/sun.js` inverts the app's own
elevation formula; run it standalone to print the solved times.

## 4. How it works

- **Boot** (`boot.js`) seeds satellite style pre-mount and pins the trailer's
  own set: governor `hold`, infinite boost, baseline weather, quality tier high
  **double-pinned** (persisted key + post-boot store call — a store-only pin is
  reverted by PerformanceMonitor within seconds). It deliberately does **not**
  pin `__flyAerialOverride` / `__flySatShadowOverride` to 0 the way the harness
  fleet does: those pins exist to freeze pixel gates, and the features they
  freeze — depth-based aerial perspective and satellite shadows — are exactly
  what the trailer wants to show.
- **Overlays** (`overlay.js`) are DOM, injected into the live page and recorded
  in-frame. Typeface is the game's own `/fonts/ArchivoBlack-Regular.ttf`;
  palette is the INK CODEX vocabulary (`inspect-tokens.js`). Post-production
  text was never an option — see §6.
- **Honesty gate** (`probe.js`) runs before any footage is kept: the frame must
  be chromatically busy (a streamed satellite frame is; the offline fallback
  ground measured 218 distinct colours against a 400 threshold) and the scene
  must carry plausible geometry (measured 59.6 k triangles offline against a
  120 k threshold). A shot that fails is **refused, not shipped**.
- **Compose** (`compose.js`) trims each clip to its action window, normalizes,
  concatenates, and encodes once.

## 5. Attribution

The end card carries, mirrored from `lib/fly/tile-sources.js` and the
`PhotoCapture.jsx` credit plate:

```
© Esri, Maxar, Earthstar Geographics
Terrain © Esri
Map data © OpenFreeMap · OpenMapTiles · © OpenStreetMap contributors
Flight data © adsb.lol · adsb.fi
```

The satellite `AttributionBar` lists only the Esri and flight-data lines, but
the satellite world also streams OpenFreeMap vector tiles for its buildings and
roads (`lib/fly/toy-world/vector-tile.worker.js`), so the ODbL line belongs on
the card. The in-game bar stays visible in every captured frame regardless —
photo mode hides the HUD but never the attribution.

Branding is **SKYLOOM**. The boot screen still reads "ShadowADSB" (stale
metadata in `app/layout.js`); it is not used anywhere in the trailer.

The trailer is **silent** — Playwright video has no audio track and no music
was sourced.

## 6. Environment facts measured while building this

These decide what is possible; they are recorded because they are not obvious
and they cost real time to discover.

- **Rendering is software.** The container's WebGL runs on
  `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader
  driver)`. Measured frame rates, at quality tier high, on the *fallback*
  world (59.6 k triangles — a real streamed scene is 845 k–1.9 M):

  | viewport | fps |
  |---|---|
  | 1600×900 | **1.2** |
  | 1280×720 | 2.25 |
  | 960×540 | 3.26 |
  | 640×360 | 7.12 |

  The brief's floor is ~20–24 fps. **No viewport reaches it, and a real
  streamed world is an order of magnitude heavier.** Capturing usable gameplay
  footage needs a GPU-backed host; this is not a tuning problem. `preflight.js`
  measures and warns before anything is recorded.

- **Wall-clock offsets cannot locate the cut, so the cut is made findable in
  the picture.** Playwright records a context from creation, so every raw clip
  opens with ~2 minutes of boot, warp and settle that must be trimmed off.
  Video time and wall-clock time do not agree closely enough to do that
  arithmetically: a clip whose context lived 169.5 s wall was written as a
  177.8 s container (**1.049×** measured), and even correcting by that ratio
  still placed the cut ~7 s early — the mapping is not a linear stretch through
  the origin.

  So `capture.js` holds an opaque `#000` plate over everything from just after
  the world-streamed gate until the shot begins, then fades off it;
  `compose.js` finds the end of that black run with ffmpeg's `blackdetect` and
  trims there. The ratio survives only as a coarse locator (to pick the right
  black run when a night scene also reads as black) and as the fallback for
  clips with no plate. Every shot therefore opens from black, which is what a
  trailer wants anyway. Verified end-to-end: the trimmed clip runs black (Y=16)
  → fade (Y=83) → full scene (Y=109).

  Two traps inside that mechanism, both measured, both worth knowing:
  - **`pix_th` must be ≥ ~0.063.** VP8 stores limited-range luma, so a pure
    `#000` plate comes back as Y=16 → 16/255 = 0.0627. A "tighter" 0.06
    threshold excludes true black by a hair and detects *nothing*. ffmpeg's own
    default of 0.10 is correct; do not lower it.
  - **`ffmpeg -f null -` exits 0**, and `blackdetect` reports on **stderr**.
    `execFileSync` only surfaces stderr when the process throws, so on the
    success path the entire report was being discarded and every clip reported
    "no black anchor". `compose.js` uses `spawnSync` and reads `stderr`
    directly.

- **Playwright's bundled ffmpeg cannot concatenate.**
  `/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux` is built `--disable-everything`
  plus a short allowlist: filters `crop, format, hflip, null, pad, scale,
  transpose, trim, vflip` only; demuxers `image2pipe` and `matroska/webm` only;
  encoders `png` and `libvpx` only. **No concat demuxer, no concat filter**, and
  no PNG *decoder*, so a frame-sequence round trip is not available either. It
  can trim/scale/pad a single clip into WebM and nothing more. A multi-segment
  trailer therefore requires `ffmpeg-static`; `compose.js` probes for the
  capability and refuses with instructions rather than emitting a truncated
  file. (This contradicts the working brief, which assumed a WebM fallback was
  available.)

- **No `drawtext` on the Playwright build** — which is why overlays are DOM.
  That turned out to be the better design anyway: the text is composited at
  native resolution on real frames and costs no extra encode generation.

- **The app boots fine with the world blocked.** `__flyBoot.pct` reaches 100 in
  ~47 s with every tile request failing; it renders sky, water, POI letters,
  HUD and the player aircraft over a flat fallback ground. This is precisely why
  the pixel gate in §4 exists — "it booted" and "the world streamed" are
  different questions, and only the second one licenses footage.

- Playwright 1.56.1 is a **global** install: run scripts with
  `NODE_PATH=/opt/node22/lib/node_modules` and
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Launch without
  `channel: 'chrome'` — there is no Google Chrome in the container.

## 7. Blocked hosts

Capture needs these reachable (all currently 403 at the proxy CONNECT):

```
tiles.openfreemap.org      vector tiles: buildings, roads, landuse
server.arcgisonline.com    Esri World Imagery
api.adsb.lol               live ADS-B  ) either one
opendata.adsb.fi           live ADS-B  ) satisfies shot 3
api.open-meteo.com         live weather (shot 9 only)
```

`preflight.js` checks all of them and exits 3 if the gate is shut.

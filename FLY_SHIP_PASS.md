# Ship Pass — plan and record (2026-10-30)

Status: **MERGED to `main` 2026-10-30 with every flag ON, at the owner's
request, while the streams were still verifying (section 8.5 is the merge
record). No look flag has had its 5080 motion check: the section 9 run list is
the first real-hardware read.** W0 landed in the cloud venue (section 4.1). This file is the plan, the requirements
and (as the pass runs) the record for a five-agent parallel pass, in the
FLY_PLAY_PASS.md format. Each stream adds its report under "Stream reports"
in its first commit and updates it on every landing.

### Ultra terrain regression repair (2026-10-30)

The owner reported terrain disappearing only at Ultra. Reproduced on the local
RTX 5080 through ANGLE D3D11: the terrain fragment failed to link with
`FRAGMENT shader texture image units count exceeds MAX_TEXTURE_IMAGE_UNITS(16)`.
The actual count was **17**, not the 16 recorded below: the static census omitted
Three r185's `dfgLUT`. The software smoke also omitted `TERRAIN_SHADOW` because
its device policy refuses software renderers, so it never exercised the failing
combination of that sampler and three cascades.

Repair: `terrain-dfg.js` carries the upstream 16x16 RG16F lighting table in
64 packed `uvec4` uniforms for terrain with `TERRAIN_SHADOW`, with the same
clamped bilinear lookup. The terrain now uses **16 samplers** while retaining
terrain shadows, all three cascades, reflections, relief, colour reference,
LOD crossfade and night lighting. Flag-off shader text and keys stay unchanged.

Verification on the RTX 5080: fresh production build; saved-Ultra boot and
Ultra → High → Low → Ultra all link, with zero page or shader errors. The GPU
lookup test preserves all 512 half-float values exactly and compares 13,568
samples with the original texture (texel-centre error 0; worst interpolation
error 0.0002443). LIGHT gate **67/67**, critical terrain prewarm **18/18**.
Live Manhattan also passed in installed Chrome on the RTX 5080 at Ultra:
164 visible terrain materials, a linked terrain program, three cascades and
zero page/shader errors. The local capture and report are
`.graphics-review/terrain-regression/manhattan-ultra-live.{png,json}`.
This is a rendering-correctness check, not a frame-time or iPhone certificate.

The regression test now forces the desktop LIGHT policy even in software CI,
requires the terrain-shadow sampler and three Ultra cascades, checks shader
console errors, and enforces a portable 16-unit ceiling even if the host exposes
more. `verify-terrain-dfg.mjs` is part of `test:shaders`.

### Production follow-up (2026-10-31)

The repair above had remained uncommitted, so release `8d067a1` still carried
the 17-sampler terrain program. Reproduced directly at
`https://shadowads.netlify.app/` in Chrome and Edge on the RTX 5080 / ANGLE
D3D11: Ultra terrain fails to link against the driver's 16-unit limit.
The owner's Edge report names that release, Ultra with three cascades, one
link failure, and a Manhattan arrival revealed by the time cap while terrain,
surfaces, buildings and roads were still missing.

The repair is now included in the release change. Verification uses a fresh
**Turbopack production build**, matching Netlify, rather than only the local
Webpack preview. The fixture gate now includes Medium. The new
`scripts/verify-manhattan-render.cjs` launches through Free Flight and the
Manhattan destination with real provider tiles, starts at saved Ultra, and
checks Ultra / High / Medium / Low / Ultra. It inspects terrain shader links
and texture counts, and requires actual ordinary-building and skyline draws
with linked programs. It holds the governor and aircraft for repeatability;
this is rendering correctness, not a performance certificate.

Local results: all five real-provider stages pass in installed Chrome and Edge
on the RTX 5080, with zero page/shader errors. Ultra terrain uses 16 samplers;
its ordinary buildings and skyline use 8 and 7. The exact GPU lookup comparison
passes 13,568 samples; LIGHT remains 67/67. Reports and screenshots are under
`.graphics-review/building-regression/` (`manhattan-render` and `repair-edge`).

Release `1dafd23a` was pushed to main and deployed to Netlify. The same five
stages pass against the live site in Edge, with linked terrain and actual
building/skyline draws, zero page/shader errors and no failed tile requests
(`live-edge-after.json`). The live check waits for visible skyline draws:
the first completed tile can be behind the camera or masked by the detailed
ring, so an arbitrary eight-second dwell was not a valid readiness condition.

The missing-building report is not independently attributed yet: clean desktop
sessions do generate the city, including on the old release. Device reports
now include the live building, skyline and road streamers' counts plus the
fragment texture limit, so a remaining affected session can distinguish failed
requests, unfinished terrain placement and rendering. The existing flags and
landmark exclusion areas are unchanged.

## 0. Context

The owner asked for a deep gap analysis across features, modes, lighting,
mobile and desktop, then detailed requirements for the next pass, written for
five agents working at once. Two read-only agents audited the repo on 2026-10-29: one on product and
play, one on look, tech and devices. Together they found about 115 gaps, each
tied to a file or record. Section 12 condenses them, and the appendix lists
every one with its evidence and where it goes.

Skyloom is visually rich and technically deep, but it cannot ship yet:
- **CI fails on every push.** next 16.4.0 has critical advisories, so the
  `npm audit` step stops the job before any gate runs.
- **The first minute freezes.** About 20 s goes to first-use shader links, and
  a 20-minute soak on the RTX 5080 recorded 62 stalls over 100 ms.
- **No real device has ever reported.** Every phone, tablet and laptop number
  so far is emulation on the 5080.
- **The hero city goes grey at altitude.** Manhattan turns to a grey veil from
  about 8,000 ft. Detailed buildings dither out at 2,400–3,000 m
  (`fly-constants.js:1311`).
- **The arcade layer contradicts the calm explorer the game sells.**
- **Nothing is commerce-ready.**

The owner chose a **polish and certify** pass: make what exists beautiful,
fast and shippable on the RTX 5080 and the iPhone, and fold in the
identity and commerce scaffolding. New modes, content and Takeoff & Landing
are backlogged (section 11).

Everything not chosen is in the backlog (section 11) with its gap IDs, so the
next pass starts from this list.

## 1. Owner decisions (2026-10-30, Q&A with the owner)

| # | Decision | Ruling |
|---|---|---|
| D1 | Pass shape | **Polish and certify.** Streams: FRAME, SKY, CITY, LIGHT, RELEASE |
| D2 | Identity | **Calm explorer by default, opt-in Challenge layer.** New profiles never crash. Combos, near-miss, buzz contracts, crashes and the run summary are opt-in. |
| D3 | Commerce | **Scaffolding only.** Free core plus a future "Skyloom Pass". Analytics, consent, error telemetry, deep links and entitlement seams; no accounts or checkout. |
| D4 | Where identity and commerce work lands | **All of it in RELEASE.** Device policy and the boot benchmark move to FRAME. |
| D5 | Venue | **Local on the owner's RTX 5080 machine** (Windows, PowerShell, CRLF checkouts), as in the Play Pass. The owner tests phones with an iPhone on the LAN dev server. |
| D6 | New flag defaults | **ON everywhere.** A flag lands ON after the stream's own RTX 5080 still and motion check. `?flags=-NAME` restores the previous look for one page load. |
| D7 | Devices that define done | **RTX 5080 and the owner's iPhone.** iGPU, Android and iPad remain emulation-only; the record says so. |
| D8 | Dependencies | **Minimal patch bump** of next and eslint-config-next to 16.4.3, dompurify fixed transitively, CI audit step kept. |
| D9 | City at altitude | **Diagnose first, then raise on High and Ultra** (detailed city to about 4,500 m eye height). Medium and phones get a better skyline mass. |
| D10 | Rays and flare | **Delete the lens-flare code.** Light shafts stay off until a later pass, after cirrus and real weather layers. |
| D11 | Looks offered to players | **Enhanced only:** PLAYER_SURFACE turns ON, and saved Classic or Neon choices migrate once. |
| D12 | Frame rate | **60 by default, with choices.** Desktop gets an opt-in "Match display"; phones get "Battery saver (30)". A 30 Hz browser cap is never read as overload. |
| D13 | Weather data | **Switch provider first.** No new weather fields this pass. Cirrus rebuild, snow and wet surfaces, storms and humidity-driven effects wait for the provider. |
| D14 | Flag cleanup | **Delete superseded code only:** LENS_FLARE, SKY_PROCEDURAL, the AERIAL_LAW law path (its live `nightRamp` is preserved) and NIGHT_CITY_R23. Long-shipped flags keep their A/B. |
| D15 | Real moon | **Art floor.** Real position and phase; moonlight never drops below roughly today's quarter-moon level. |
| D16 | Budgets | **Re-derived from real reports** (RTX 5080 and iPhone) in week 1 into one table. A census gate fails on regressions over 5%. |

Defaulted (the owner can override in review):
- the site domain comes from `NEXT_PUBLIC_SITE_URL`, which the owner sets;
- analytics stays on the existing posthog-js integration, opt-in only;
- the service worker never caches provider tiles or live data;
- the pass is named "Ship Pass".

## 2. Pass-level definition of done

The pass is done when every row is green and recorded in `FLY_SHIP_PASS.md`.

| Area | Acceptance (measured) |
|---|---|
| CI | The `Explorer beta` workflow is green on `main`: audit, verify:beta, build:beta, smoke:beta and smoke:ultra all pass. Known reds are allowlisted with an owner, a reason and a date, and printed separately. |
| First minute (5080, Ultra, production build) | No frame over 250 ms in the first 60 s after reveal. The program census lists 0 programs first used after reveal on the reference route, or only allowlisted ones. Lounge entry stalls under 500 ms. |
| Endurance (5080, Ultra, 20-minute urban/mountain/airport/photo route, uninstrumented) | Steady p95 ≤ 16.7 ms and p99 ≤ 33.3 ms. At most 1 interval over 100 ms per minute, and none over 1 s. Transfers p50 ≤ 6 s and p95 ≤ 10 s. Draws within the D16 table. |
| Turning | Scripted 360° yaw at Manhattan, 900 m: longest interval under 50 ms on desktop and under 67 ms in phone emulation. |
| iPhone (physical) | Graded device reports at Medium and High: city turn, mountain, night, and a 15-minute lounge session in Watch for me. In Low Power Mode the target is 30 fps with no tier step. Photo export is at least 2,560 px on the long side. No context loss. |
| Grey veil | In pinned clear noon over Midtown, block-to-street luma contrast at 8,000 and 10,000 ft is within 15% of the 6,000 ft value. Draws stay in budget. The owner signs off on the 5080. |
| Look flags | Every new look flag has a 5080 still-camera diff (equal to the flag-off arm in ground and sky bands away from the change) and a magnified flying burst on record, plus an owner iPhone glance. |
| Identity | A fresh profile cannot crash and sees no combo, near-miss or buzz content. Turning Challenge on restores today's behaviour exactly. |
| Debt | Zero new ESLint errors. FlyScene.jsx's 28 pre-existing errors are fixed in the close. `verify-ops-golden` stays byte-identical. |

## 3. How the five agents work (operating model)

### 3.1 Venue and isolation (one machine, five agents)
- **Worktrees.** Each stream works in its own git worktree,
  `..\skyloom-<stream>`, on branch `ship/<stream>`, created from `main` after
  W0. One `.next` per worktree.
- **Dev servers.** Each stream runs its own on a fixed port: FRAME 3131,
  SKY 3132, CITY 3133, LIGHT 3134, RELEASE 3135. The owner's live server stays
  on 3123 (`skyloom-dev-3123` in `.claude/launch.json`).
- **Production previews.** Use `FLY_BUILD_DIR=.next-<stream>` with
  `node node_modules/next/dist/bin/next build --webpack`.
- **GPU lock.** Any soak, benchmark, frame-time capture or motion check first
  creates `.graphics-review/ship-pass/gpu.lock` holding the stream name and
  start time, and deletes it afterwards. A stream never measures while another
  holds the lock, or while the owner holds `owner.lock` (live-testing on 3123).
  This applies the R7 lesson: never run harnesses while the user live-tests.
- **AGENTS.md.** `next dev` rewrites it. Run `git checkout AGENTS.md` before
  every commit and never commit it.
- **Evidence.** Captures and reports go to `.graphics-review/ship-pass/<stream>/`
  (gitignored).

### 3.2 Flags
- **Where blocks live.** Every new block sits after the TRUE EARTH marker
  (`fly-constants.js:7230`), under one `SHIP PASS (2026-10-30;
  FLY_SHIP_PASS.md)` header, appended after `MOBILE_ENHANCED`. Each block is
  `export const NAME = { enabled, ... }`, seeded multi-line by W0.
  `verify-true-earth-flags.mjs` rules (5) and (7) still hold.
- **One reader.** Blocks are read only through `lib/fly/ship-pass.js`
  (`shipPassOn(name)`, `shipPassBlock(name)`, `shipPassFlags()`), which copies
  the `play-pass.js` pattern exactly: a literal `pinned(BLOCK,
  '__fly<Name>Override')` per block, resolved at module load.
- **Defaults (D6).** W0 seeds every block `enabled:false`. A stream flips its
  own block to `true` in the same commit that lands the consumer, after its
  5080 checks. A flag that reads nothing must not claim to be on.
- **Flag-off identity.** With the flag off, shader text and program keys are
  byte-identical. Shader edits are anchored substitutions in the stream's own
  modules that throw on a missing or repeated anchor (the `city-facades.js`
  idiom). New tunables go only in the new blocks; pre-marker constants (e.g.
  `SAT_BLDG_FADE`, `SAT_SKYLINE`, `cinema-profile.js` numbers) are never
  edited.
- **Prewarm.** Every new program variant is registered in
  `lib/fly/prewarm-registry.js`, in the stream's own block, so it never
  compiles after reveal.
- **Device gating.** New features gate on devices through
  `lib/fly/device-policy.js` (`deviceFeature(name)`), never raw
  `isPhoneClass()` or `isMobileGraphicsClass()` calls.

### 3.3 Seam rule (inherited from Gate to Gate and the Play Pass)
- **Hot files.** Never edit `FlyScene.jsx`, `FlyMode.jsx`, `PlayerPlane.jsx`,
  `TrafficLayer.jsx`, `operations-runtime.js`, `fly-constants.js`,
  `device-report.js` (FLAGS and imports), `world-bend.js` or `stores/fly-store.js`
  outside your own marked block. Section 7 lists every block. If a change
  outside a block is unavoidable, stop and report it, or make the smallest
  change in its own commit and name it in your report.
- **Ownership.** Nobody edits another stream's owned files. Read them freely.
  A needed change goes to the owner as a contract request, recorded in
  section 6.
- **Frozen files.** `world-bend.js` is frozen for the pass, and
  `TrafficLayer.jsx` is never edited.
- **Stores.** Add fields only; never rename or remove.

### 3.4 Rules every stream keeps
- Every existing `data-testid` stays, and every gate that indexes the HUD keeps
  passing.
- Phones and tablets keep working: `verify-mobile-layout.js`, and
  `lounge-pass-gates.mjs` for anything near the lounge.
- No per-frame `console.*`, no new network providers or API keys, no new
  runtime dependencies. Icons come from lucide-react.
- Reduced motion is respected.
- Rendering rules: no new `THREE.Light`; chain `onBeforeCompile` and
  `customProgramCacheKey`; anything transparent against the sky is a
  `registerSkyOverlay`; respect TRUE_SCALE and reversed depth.
- Gates normalize CRLF, because the owner's checkout is Windows.

### 3.5 Gates before every landing on `main`
`node scripts/ship-pass-gates.mjs`, written in W0, runs the shared node
battery and prints known reds separately:
- `verify-true-earth-flags` and `verify-import-integrity`;
- `verify-ops-golden` (28/28, byte-identical with the pass flags off);
- `FLY_TILE_FIXTURE=1 verify-worker-window` for anything a worker imports;
- `graphics-unit`, and `beta-checks source|gameplay|world`;
- every stream's `verify-ship-<stream>.mjs`;
- a marker check that each stream's diff touches hot files only inside its
  own blocks.

On top of the battery, each landing needs:
- scoped ESLint with no new errors;
- the existing gates the stream touches;
- a browser smoke on the stream's own port with zero page or shader errors,
  flag on and off;
- for look flags, the 5080 motion bar (section 3.6).

### 3.6 The motion bar (look flags)
On the RTX 5080, under the GPU lock:
1. A still camera with flag on vs off: the frame-to-frame diff energy in ground
   and sky bands matches the flag-off arm.
2. A 10-second flying burst at the flag's poses, compared magnified for
   crawl, sparkle and popping.

Captures go to `.graphics-review/ship-pass/<stream>/motion/`. The Living
World SKY build that glitched in motion is the reason this bar exists.

### 3.7 Landing, cadence, reporting
- **Landing.** A stream rebases on `main`, runs the battery, then lands with
  `git merge --no-ff ship/<stream>` on the owner's local `main`, so the owner
  can live-test as each piece lands. Push to `origin` only when the owner asks.
- **Reporting.** Each stream writes its report section in `FLY_SHIP_PASS.md`
  in its FIRST commit and updates it on every landing. In the Play Pass, two
  streams lost their reports to session ends.
- **Cross-review** (Lounge Mobile precedent), once P0 has landed:
  - FRAME reviews RELEASE's analytics `perf_summary` contract;
  - SKY reviews CITY's veil half and CITY reviews SKY's;
  - LIGHT reviews FRAME's prewarm registry entries for its variants;
  - RELEASE reviews everyone's Settings and deep-link touchpoints.

### 3.8 This run's venue (2026-10-30): the cloud container, not the RTX 5080

The owner started the pass from a Claude Code cloud session, so it runs in the
cloud container instead of on the owner's machine (a deviation from D5,
recorded here rather than hidden). What that changes, and what it does not:

- **What the venue cannot do.** No RTX 5080 and no iPhone: WebGL is
  ANGLE/SwiftShader (correct pixels, about 1–3 fps), the tile, imagery and
  ADS-B hosts are blocked, and the app runs on the R24 offline world fixture
  (`scripts/_fixture.js`, `FLY_TILE_FIXTURE=1`). Every fps, frame-time,
  stall, soak, motion and device number in section 2 belongs to the owner's
  machines; nothing here certifies one.
- **Look flags ship OFF.** D6 lands a flag ON *after* its 5080 still and
  motion check (3.6), and CLAUDE.md's standing rule is that no look flag
  ships on without that check. So every look flag (AERIAL_CLARITY,
  REAL_MOON, SKY_LITE, CITY_RANGE, NIGHT_LITE, NIGHT_RHYTHM, TERRAIN_SHADOW,
  TRAFFIC_SHADOWS, AIRFRAME_SHADOW, SHADOW_REACH, HANGAR_EXPOSURE,
  ULTRA_SUPERSAMPLE, MOBILE_ENHANCED) is built, gated (node gates, flag-off
  identity, a SwiftShader smoke flag on and off, fixture stills) and left
  `enabled:false`; the owner previews each with `?flags=NAME` and flips it
  after the motion bar (run list, section 9). Flags whose acceptance is
  measurable here (behaviour, not pixels) land ON per D6 when their gates
  pass; each stream report says which and why.
- **Worktrees and ports.** `/home/user/skyloom-<stream>` on branch
  `ship/<stream>`, created from the W0 commit; dev servers on the section
  3.1 ports. `node_modules` is a hard-linked copy of the lead checkout's
  (`cp -al`), so the five trees share disk; nobody runs `npm install` in a
  stream tree (RELEASE owns `package.json`; no stream adds a dependency).
- **The heavy lock replaces the GPU lock.** The container has 4 CPUs and
  15 GB, so any `next build`, `next dev` session or browser harness runs
  under `flock /home/user/ship-pass-shared/heavy.lock` (one at a time,
  across all five streams), and a dev server is stopped when its run ends.
- **Landing.** Streams commit only to their own branch. The lead merges each
  `--no-ff` into `main` after the battery (8.1) and pushes the integration
  branch for durability; `main` on origin moves only when the owner asks.
- **Browser builds.** The project's Playwright (1.61.1) expects browser build
  1228; the container ships 1243, aliased under `/opt/pw-browsers` so the
  harnesses launch unchanged. With that alias the GPU halves of
  `verify-phys-sky`, `verify-hdr-guard` and `verify-night-ground-gpu` pass.

## 4. W0 — the lead, before any stream branches

| ID | Task | Acceptance |
|---|---|---|
| W0.1 | Bump `next` and `eslint-config-next` to exactly 16.4.3, fix `dompurify` transitively, and regenerate `package-lock.json`. Confirm the target versions exist (`npm view`) before pinning. | `npm audit --omit=dev --audit-level=high` exits 0. `build:beta` and `smoke:beta` pass locally. Lockfile drift is limited to those packages. |
| W0.2 | Seed the SHIP PASS flag blocks (section 5, all `enabled:false`, tunables multi-line), `lib/fly/ship-pass.js`, and the names in `device-report.js` (one import line plus FLAGS). Reformat the FLAGS literal to one line per pass; gate (6)'s `[^}]*` already spans newlines. | `verify-true-earth-flags` 8/8 with 73 blocks listed (53 today plus 20 new). |
| W0.3 | Seed every marked block in section 7 (empty). | A grep gate lists every expected marker exactly once. |
| W0.4 | Stub `lib/fly/prewarm-registry.js` with the API frozen and per-stream blocks: `registerPrewarm({stream, key, build(gl,scene), when:{tiers?, devices?, flags?}})`, `prewarmEntries()`. Stub `lib/fly/device-policy.js` with today's equivalents behind a frozen API: `deviceFeature(name) → {allowed, budget}` and `deviceClassOf() → 'phone'\|'tablet'\|'igpu'\|'dgpu'\|'software'`. | Both import cleanly. `verify-import-integrity` passes. Nothing consumes them yet. |
| W0.5 | Write `scripts/ship-pass-gates.mjs` and `scripts/ship-pass-known-reds.json` (`{gate, failure, owner, reason, since}`), seeded with the reds in section 12.3. | One command prints PASS / KNOWN-RED / FAIL. |
| W0.6 | Baselines on the 5080 under the GPU lock: a 20-minute uninstrumented `soak:beta` at Ultra and at High, and a 5080 device report. Ask the owner for an iPhone report at Medium and High through the LAN dev route (`app/api/dev/device-report`, `?diag=1` → Benchmark → Send). | Reports filed in `.graphics-review/ship-pass/baseline/`; numbers copied into the record. |
| W0.7 | Write this document to `FLY_SHIP_PASS.md`, add the CLAUDE.md banner entry, create the five worktrees, ports and lock convention, and write the five kickoff prompts (section 10). | Every stream starts from the same `main` SHA. |

## 5. The streams

The stream that owns each block flips it ON when its consumer lands (D6).

| Flag | Stream | One line |
|---|---|---|
| `SHADER_READY` | FRAME | Program census, prewarm registry, `checkShaderErrors:false` in production |
| `PACE_ADAPT` | FRAME | 30 Hz cadence lock, frame-rate modes, turn-hitch budgets, soak fixes |
| `DEVICE_POLICY` | FRAME | Boot micro-benchmark start tier, device classes, policy table |
| `ULTRA_SUPERSAMPLE` | FRAME | Render scale up to 1.5× on DPR-1 displays at Ultra |
| `AERIAL_CLARITY` | SKY | The atmosphere half of the grey-veil fix |
| `REAL_MOON` | SKY | Ephemeris moon, real phase, art floor |
| `SKY_LITE` | SKY | Cheap aerial perspective and far-cloud lite for Medium and phones |
| `CITY_RANGE` | CITY | Detailed city to about 4,500 m on High/Ultra; better skyline mass elsewhere |
| `NIGHT_LITE` | CITY | City light from altitude on phones and Low |
| `NIGHT_RHYTHM` | CITY | Night handoff seam, sun-keyed twilight, local-time window occupancy |
| `TERRAIN_SHADOW` | LIGHT | Mountains shadow valleys (a terrain map on desktop, a horizon map on phones) |
| `TRAFFIC_SHADOWS` | LIGHT | Live aircraft cast shadows (or contact blobs) |
| `AIRFRAME_SHADOW` | LIGHT | The player aircraft receives shadows on High/Ultra |
| `SHADOW_REACH` | LIGHT | Medium-desktop shadow range follows altitude |
| `PHOTO_HIRES` | LIGHT | Supersampled photo export |
| `HANGAR_EXPOSURE` | LIGHT | Light liveries no longer blow out; cheaper reflector on Medium |
| `CHALLENGE_LAYER` | RELEASE | Calm default; arcade systems opt-in |
| `DEEP_LINKS` | RELEASE | `?watch=` / `?fly=` / `?at=` / `?journey=` entry links and Copy link |
| `ANALYTICS_V2` | RELEASE | Product event schema, consent prompt, opt-in error telemetry |
| `OFFLINE_SHELL` | RELEASE | Production service worker for first-party static assets, install hint |
| `PLAYER_SURFACE` (existing) | RELEASE | Turned ON (D11) |
| `MOBILE_ENHANCED` (existing) | LIGHT | Turned ON (D6) after the owner's iPhone glance |

Each stream lists P0 (week 1, blocking), P1 (core) and P2 (if time).
Acceptance is measured unless marked "owner".

### 4.1 W0 record (2026-10-30, the lead, cloud venue)

| ID | Result |
|---|---|
| W0.1 | `next` and `eslint-config-next` pinned to **16.4.3** (`npm view` confirmed both), `dompurify` 3.4.16 → **3.4.17** through `posthog-js` (`npm update dompurify`). `npm audit --omit=dev --audit-level=high`: **0 vulnerabilities** (was 2 critical). Lockfile drift: the next / @next/* / eslint-config-next / dompurify / sharp entries plus npm's own metadata for them (`peer` flags that next 16.4.3 no longer implies, `libc` on the @next/swc-linux builds, devDependency order). `build:beta` passes (2 m 2 s); `smoke:beta` — see below. |
| W0.2 | 20 SHIP PASS blocks seeded `enabled:false` after `MOBILE_ENHANCED`, under one header; `lib/fly/ship-pass.js` (`shipPassOn`, `shipPassBlock`, `shipPassFlags`, a literal `pinned(BLOCK, '__fly<Name>Override')` per block); the device-report FLAGS literal is one line per pass plus the SHIP PASS line. `verify-true-earth-flags` **8/8, 73 blocks**. |
| W0.3 | Every section 7 block seeded empty, plus **import blocks** wherever a block sits inside a function body (a stream cannot otherwise import its own module there): `SettingsRows.jsx` FRAME rows imports, `fly-settings.js` FRAME and RELEASE imports, `front-door.js` and `flight-plan.js` RELEASE imports, `device-report.js` FRAME imports, `PlayerPlane.jsx` LIGHT imports. The SettingsRows FRAME block declares `frameRows` (rendered after the HUD row in both layouts; `null` until FRAME lands). The fly-store FRAME/RELEASE groups have a fields block and a setters block each. The marker gate counts **38 blocks in 10 files**, each exactly once. |
| W0.4 | `lib/fly/prewarm-registry.js` (frozen `registerPrewarm({stream,key,build,when})`, `prewarmEntries()`, plus `entryReachable(entry, ctx)` so "reachable here" means one thing) with one block per stream; `lib/fly/device-policy.js` (frozen `deviceClassOf()` and `deviceFeature(name, ctx?)`, today's equivalents: a seed row per Ship Pass feature so SKY, CITY and LIGHT can consume the policy from day one while FRAME replaces the table with measured rows). Nothing consumes either yet; `verify-import-integrity` passes. **The section 6 contracts are seeded as frozen stubs too**, so a consumer stream can import a provider stream's function while both run in parallel: `lib/fly/frame-api.js` (FRAME: `FRAME_RATE_KEY`, `setFrameCadence`, `frameCadence`, `holdGovernor`, `governorHolds`, `frameSessionSummary`), `lib/fly/analytics.js` (RELEASE: `track`, a no-op), `lib/fly/challenge.js` (RELEASE: `CHALLENGE_KEY`, `challengeOn()` = today's true) and `moonState()` at the end of `lib/fly/sun-model.js` (SKY: today's full anti-solar moon). Each owner replaces its stub; the signatures stay. |
| W0.5 | `scripts/ship-pass-gates.mjs` (PASS / KNOWN-RED / FAIL / SKIP; the seam-marker check; with `--stream` or on a `ship/<stream>` branch, the seam rule over the stream's diff from the merge-base) and `scripts/ship-pass-known-reds.json` (section 12.3, plus `verify-r25-front-door`, red here and on CI because the `r25-w0` tag is absent from shallow clones and from origin). On the W0 tree: **32 PASS, 2 KNOWN-RED (r25-front-door, encounters), 0 FAIL**, about 55 s. The seam rule was proven red on purpose (the W0 diff read as a SKY diff fails it). |
| W0.5b | `smoke:beta` on the W0 build (fixture, SwiftShader, `BETA_SOFTWARE=1`) passes its first two checks and then **times out (90 s) clicking `Invert pitch`** in flight settings: Playwright resolves the checkbox and never completes the click while the page renders at 1–3 fps. Handed to RELEASE (RL-1) to settle venue vs product, since CI runs the same smoke on a SwiftShader runner. |
| W0.6 | **Not run: no RTX 5080 and no iPhone in this venue (3.8).** It stays the first item of the owner run list. Venue baselines instead (fixture and SwiftShader, never device numbers): `verify:beta` source/gameplay/world as above; `test:shaders` 4/4 with the browser alias; `verify-ops-golden` 28/28; `FLY_TILE_FIXTURE=1 verify-worker-window` 4/4; `graphics-unit` PASS; ESLint on the W0-touched files 27 errors before and after (no new errors). |
| W0.7 | This record, section 3.8, the CLAUDE.md banner, the five worktrees and the kickoff prompts (section 10.1). |

---

### 5.1 FRAME — first minute, frame pacing, device policy

**Mission.** No freezes in the first minute. A soak that passes. Every device
starts at the right quality and paces honestly. One source of budget truth.

**Owns.**
- Prewarm and compile:
  - `lib/fly/prewarm.js`, `compile-scene-safe.js`, `measured-world-prewarm.js`,
    `terrain-program-retention.mjs`, `cinema-profile-prewarm.js`;
  - `lib/fly/prewarm-registry.js`, the consumer side; each stream owns its own
    registry block.
- Pacing and budgets: `perf-governor.js`, `frame-stats.js`, `frame-cadence.mjs`,
  `tier-budgets.js`, `cinema-profile.js`, `cinema-policy.js`,
  `render-resolution.js`, `render-scale.js`, `step-safe.js`, `finalize-pace.js`.
- Device classes: `device-class.js`, `device-tiers.js`, `device-policy.js`
  (full), and new `gpu-benchmark.js`.
- Diagnostics:
  - `diag.js` and `diag-handles.js`;
  - the body of `device-report.js` below FLAGS, in a seeded block;
  - `app/api/dev/device-report/*`.
- Components: `FlyCanvas.jsx`, `PrewarmRig.jsx`, `StepSafeRig.jsx`,
  `DiagFrameTotals.jsx`, `hud/DiagnosticsPanel.jsx`.
- Scripts: `beta-soak.cjs`, `analyze-beta-soak.mjs`,
  `render-flight-benchmark.cjs`, `verify-device-report.mjs`,
  `verify-env-uniform.js`, `verify-device-tiers.mjs`, and new
  `verify-ship-frame.mjs`.

**Edits only in blocks.**
- `fly-settings.js`: `SHIP PASS FRAME start tier`.
- `SettingsRows.jsx`: `SHIP PASS FRAME rows`.
- `FlyScene.jsx`: `SHIP PASS FRAME` imports and frame blocks.
- `stores/fly-store.js`: the FRAME fields.

**Must not touch.** `Effects.jsx`, shader text owned by SKY, CITY or LIGHT,
and `world-bend.js`.

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| FR-1 | P0 | **Program census.** Time WebGL program acquisition and first use. Publish `__flyStats.census.programs = {total, afterReveal:[{key, ms, t}]}`, a DiagnosticsPanel row and a device-report field. | The 5080 reference route lists every post-reveal compile. Overhead under 0.05 ms per frame. |
| FR-2 | P0 | **`checkShaderErrors:false`** on the renderer in production builds outside automation. Dev and harness keep `true`. | A node gate proves the production/dev split. The production first-minute `getProgramInfoLog` time drops (5080 trace before and after in the record). |
| FR-3 | P0 | **Prewarm the registry.** `runPrewarm` and `requeueForEnvironment` compile every `prewarmEntries()` variant reachable at the current tier and device, during the boot hold and title, on a tier step and across the day/night bucket crossing. Run `verify-env-uniform` on the 5080 and record a ship-or-delete ruling for ENV_UNIFORM. | The census shows 0 post-reveal compiles for registered variants. The boot hold grows by no more than 1.5 s on the 5080. |
| FR-4 | P0 | **Draw, triangle and texture census.** Per-layer draws and triangles (DiagFrameTotals, keyed by component), a texture and renderbuffer byte counter (promote FlyMode's memory probe), RGBA16F target audit. Fill `textureBytes` in the device report. Expose `__flyStats.census.layers`. | The census matches `gl.info` totals within 2%. The report shows texture MiB on the 5080 and the iPhone. |
| FR-5 | P0 | **30 Hz cadence (PACE_ADAPT).** Add 30, 48 and 50 to the refresh snap. Detect a cadence lock (dt near 33.3 ms with low variance while GPU or work time stays low) and set `targetFps=30` without stepping. Re-estimate on `visibilitychange` and on the battery-saver setting. Put the governor state in the report. | A node gate holds a synthetic 30 Hz stream at rung 0 for 5 minutes, and a synthetic overload at 30 Hz still steps. On the iPhone in Low Power Mode the report shows target 30 and the boot rung. |
| FR-6 | P0 (week 1) | **One budget table (D16).** Re-derive draws, triangles, texture MiB, GPU ms and stalls per minute per device class from the W0.6 reports into `tier-budgets.js`. `cinema-profile.js` budgets, `verify-device-report.mjs` and the census gates all read it. Grade frame time as the share of frames over 1.5× the target interval, not raw p95 dt. | A node gate asserts every consumer imports the one table, and a synthetic 60 Hz report with no missed vblank grades as a pass. The table and its sources are in the record. |
| FR-7 | P1 | **Soak triage.** Under the GPU lock, run `soak:beta` with `BETA_CPU_TRACE=1` and `BETA_GPU_TRACE=1` at Ultra and High. Classify every interval over 100 ms by phase (program link, tile upload, worker finalize, GC, React commit). Fix the top three causes behind `PACE_ADAPT` sub-switches, then re-run uninstrumented. | Section 2 endurance numbers met, or every remaining cause attributed in the record with an owner. |
| FR-8 | P1 | **Turning hitches.** Run a scripted 360° yaw at Manhattan 900 m, desktop and phone emulation, with `lastStall.phases` captured. Enforce per-frame budgets for finalize, atlas uploads and chunk mounts (the existing COMMIT_BUDGET, TERRA_PACE and FINALIZE_PACE knobs, through `PACE_ADAPT` tunables). Prewarm chunk material variants. | Longest interval under 50 ms on desktop and under 67 ms in phone emulation. Physical iPhone: at most 1 interval over 100 ms per minute. |
| FR-9 | P1 | **Frame-rate modes (D12).** Add `setFrameCadence('60'\|'display'\|'30')` and persist it to `fly-frame-rate-v1` (RELEASE adds the key to the save whitelist). Settings rows in the FRAME block: desktop "Frame rate: 60 / Match display", touch devices "Battery saver" (30 fps plus the phone-lean profile). Suggest Battery saver through the existing calm-hud notice API (no CalmHud edits) when the governor latches low, or after 10 minutes in Watch for me on a phone. | The setting persists and the measured cadence matches the mode. Match display governs to refresh (or refresh/2 for heavy profiles). |
| FR-10 | P2 | **Boot micro-benchmark (DEVICE_POLICY).** A fill and cloud-march test of at most 1.5 s inside the existing boot hold, using a timer query where available, cached per device and app version. It chooses the start tier and class for phones, tablets and masked Macs (Safari's "Apple GPU"). Ultra DPR is capped at 1.5 unless the benchmark passes. An iPad may select the desktop medium or high effects profile with the touch UI. | A node gate covers the decision table. The report shows the score and the chosen tier. The benchmark never extends boot past the hold. |
| FR-11 | P2 | **`device-policy.js` table.** Allow and budget per (class, tier, score), for this pass's features: SKY_LITE, NIGHT_LITE, TERRAIN_SHADOW phone path, TRAFFIC_SHADOWS blob vs caster, AIRFRAME_DETAIL on tablets. | A node gate enumerates phone, tablet, iGPU, dGPU and software. No new flag in the pass gates on raw class calls (grep gate). |
| FR-12 | P2 | **ULTRA_SUPERSAMPLE.** On Ultra with a high GPU class and a passing benchmark, allow render scale up to 1.5× on DPR-1 displays as the top governor rung, shed first. | The 5080 at 1440p boots at 1.5 and holds it on the reference route. Shimmer metric (frame-diff energy on static facades during a slow pan) drops at least 30%. |
| FR-13 | P1 (conditional) | **iPhone depth precision.** Read `gpu.reversedDepth` from the W0.6 iPhone report. If it is false, add a dynamic near plane, `clamp(0.02·AGL, 2.5 m, 60 m)`, as a `DEVICE_POLICY` sub-switch applied from the FRAME frame block, and cap the phone horizon if needed. If it is true, record that and close the item. | The report field is in the record. If the fallback is built: a physical-iPhone capture of a runway from 2 km shows no z-fighting, and desktop is unchanged (flag-off keys). |

**Provides.** `budgetFor(profile)`, `__flyStats.census.*`, the registry
consumer, `deviceFeature()`, `setFrameCadence()`, and a frame-stats session
summary for RELEASE's `perf_summary`.

**Gates.**
- New `verify-ship-frame.mjs`: production/dev split, 30 Hz hold and step,
  single budget table, registry coverage, benchmark decision table, policy
  enumeration.
- Existing: `verify-device-tiers`, `verify-device-report`,
  `verify-render-optimization`, `verify-cinema-overhaul`, `graphics-unit`.

**5080 checks.** First-minute trace, both soaks, the yaw and the shimmer pan.

**iPhone checks (owner).** Low Power Mode, Battery saver, and a report at
Medium and High.

---

### 5.2 SKY — the clear sky over the hero city, a real moon, sky on small devices

**Mission.** Clear air reads clear at altitude, nights follow the real moon,
and Medium and phone skies stop looking like a different game.

**Owns.**
- Components: `AerialPerspective.jsx`, `AtmosphereRig.jsx`,
  `SatEnvironment.jsx`, `SkyDome.jsx`, `CloudField.jsx`, `Effects.jsx` and
  `FlyEffectComposer.jsx` (whole files).
- Atmosphere: `lib/fly/atmosphere/*`, `satellite-atmosphere.js`,
  `living-atmosphere.js`, `atmo-law.js`, `ground-mist.js`.
- Clouds: `immersive-cloud-pass.js`, `living-clouds.js`,
  `cloud-reconstruction.js`, `cloud-calm.js`, `cinema-cloud*.js`.
- Sky, sun and moon: `light-shafts.js`, `cinema-sky.js`, `living-sky.js`,
  `night-sky.js`, `sun-model.js`, `cinema-environment.js`, `cinema-frame.js`,
  `r25-sky.js`, `sky-model.js`, `sky-dusk.js`.
- Scripts: new `verify-ship-sky.mjs`.

**Edits only in blocks.** `FlyScene.jsx` (`SHIP PASS SKY` imports and frame
blocks); `prewarm-registry.js` (SKY block).

**Must not touch.** City and building modules, `cinema-shadows.js`,
`perf-governor.js`, `prewarm.js` (use the registry), `PlayerPlane.jsx`,
`app/api/weather/route.js` and `weather-model.js` (D13).

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| SK-1 | P0 (days 1–2, joint with CITY) | **Grey-veil diagnosis.** Pinned Manhattan clear noon (`?sunUtc=`, `?weather=` pins) at 5,000, 6,000, 7,500, 8,500 and 10,000 ft. Arms: baseline; building fade pushed (CITY's pin); skyline haze premix off (CITY's pin); aerial off (`__flyAerialOverride=0`); `?flags=-GROUND_MIST`. Measure Midtown block-to-street luma contrast and ground chroma. Write the attribution table (share per cause) in the record before either stream codes its fix. | The table is in the record; both streams sign it. |
| SK-2 | P1 | **AERIAL_CLARITY.** Remove the atmosphere's share of the veil in clear air (aerosol and Mie density with altitude, the haze-mix colour space, mist coupling), from SK-1's evidence. Distant ridges keep their depth. | With CITY_RANGE: section 2 veil row. Contrast at 50 km stays within the flag-off arm ±10% (no "flat clear"). Motion bar. |
| SK-3 | P0 | **REAL_MOON.** A truncated lunar ephemeris (Meeus ch. 47) gives altitude, azimuth and illuminated fraction from the runtime clock and geo, computed inside `sun-model.js`. With the flag on, `moonDirFromSun` returns the real direction, so FlyScene, the cloud pass and cinema-environment inherit it without edits. Moonlight intensity is `max(floor, phase × altitude factor)`, with the floor at about today's quarter-moon key (D15). When the moon is below the horizon, the floor light is shadowless sky fill with no disc. `night-sky.js` draws the phase terminator. Night exposure adapts. | Node gate: position within 0.3° and phase within 2% on 20 reference dates (source documented in the gate). The night key never exceeds today's full-moon value. New-moon frames stay at or above the floor luma. Motion bar at a moonrise. |
| SK-4 | P1 | **SKY_LITE.** Medium and phones get a cheap aerial perspective (folded into existing passes; no new full-screen pass on phones) and a far-cloud lite on phones (one sample, half reach), gated through `deviceFeature()`. Record the cost table per device. | Phone emulation: ≤ 0.6 ms GPU and +0 draws for aerial, ≤ +1 draw for clouds. Owner iPhone captures at 5 poses side by side with desktop High. |
| SK-5 | P2 | **Remove the lens-flare code (D10).** Delete it from `light-shafts.js` and `immersive-cloud-pass.js`. LIGHT_SHAFTS stays off and untouched. The block and reader removal is the lead's close task (8.3). | Default-frame shader text and program keys are unchanged (sha256). |
| SK-6 | P2 | **Keep the sky LUT cadence.** The existing `skyHz` cadence and redraw counts stay unchanged on phones. | `verify-mobile-enhanced` cadence 6/6. |

**Provides.** `moonState()` (alt, az, phase, illumination); SK-1's pin set
and table.

**Gates.**
- New `verify-ship-sky.mjs`: ephemeris, floor, flag-off text hashes, phone
  budgets.
- Existing: `verify-phys-sky` (GPU half on Chrome with
  `PLAYWRIGHT_CHANNEL=chrome`), `verify-cloud-calm`,
  `verify-cloud-silhouette-gpu`, `verify-cloud-reconstruction-gpu`,
  `verify-hdr-guard`, `verify-twilight`, `verify-sun-azimuth`.

**5080 checks.** The veil matrix, moonrise, and the Medium sky.

**iPhone checks (owner).** Night at a new and a full moon, and the
Medium/High sky.

---

### 5.3 CITY — the city at altitude and at night

**Mission.** A real city from 8,000 ft on desktop, a better skyline mass
everywhere, and night cities that read from altitude on phones and keep a
believable evening-to-late-night rhythm.

**Owns.**
- Engines (`lib/fly/toy-world/`): `sat-building-engine.js`,
  `sat-skyline-engine.js`, `sat-road-engine.js`.
- `lib/fly/toy-world/vector-tile.worker.js`: building, skyline and road
  sections. CITY owns the protocol, and any `WORKER_PROTOCOL` bump moves every
  pin site in the same commit.
- Components: `SatBuildingLayer.jsx`, `SatSkylineLayer.jsx`,
  `SatCityGlow.jsx`, `SatHouseLights.jsx`, `SatRoadLayer.jsx`,
  `NightGroundRig.jsx`.
- Building look: `satellite-architecture-material.js`, `city-facades.js`,
  `building-profiles.js`, `architecture-draw-range.js`, `skyline-drape.js`,
  `settlement-infill.js`.
- Night: `night-city.js`, `night-ground*.js`, `night-lights-atlas.js`,
  `night-lights-pattern.js`, `night-lighting-policy.js`.
- Scripts: `verify-sat-buildings.js`, `verify-skyline.js`,
  `verify-sat-night.js`, `verify-night-city-identity.mjs`, and new
  `verify-ship-city.mjs`.

**Edits only in blocks.** `FlyScene.jsx` (`SHIP PASS CITY` imports and mount
blocks); `prewarm-registry.js` (CITY block).

**Must not touch.** `AerialPerspective.jsx`, `lib/fly/atmosphere/*`, the
cloud pass, `world-bend.js`, `cinema-profile.js`, and the pre-marker
`SAT_BLDG_FADE` and `SAT_SKYLINE`.

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| CT-1 | P0 | **Diagnosis pins for SK-1.** Add `window.__flyCityRangeOverride`-style pins for fade start and end and the skyline haze premix. | Pins in the record; SK-1 table co-signed. |
| CT-2 | P1 | **CITY_RANGE (D9).** On High and Ultra, keep detailed buildings to about 4,500 m eye height: past 2,400 m a roofless lite LOD, then a dither crossfade into the skyline mass at 4,500–5,000 m, with eviction only after it is invisible. On Medium and phones, improve the skyline mass instead: in dense cores the minimum height drops from 35 m to about 20 m; Enhanced drops the baked grey premix; the skyline uses the CITY_FACADES regional palette. | With SK-2, the section 2 veil row. Manhattan 8,000 ft draws within the FR-6 table. No pop in a descend/climb burst (motion bar). Flag-off worker output byte-identical. |
| CT-3 | P1 | **City budget.** Use FR-4's census at Manhattan 900 m and 8,000 ft. Merge chunks per tile group where materials match (building and skyline engines). Retire layers Enhanced already supersedes. | Phone city draws ≤ the FR-6 phone budget (today 284 vs 250). Desktop High and Ultra within budget at both poses. |
| CT-4 | P1 | **NIGHT_LITE.** On phones and Low at night from altitude, city light reaches 60+ km. Use SatCityGlow's instanced draws in Enhanced, mounted from the CITY block (FlyScene's gated mount at 3768 is not edited), or a cheap VIIRS-atlas emissive. | +≤ 2 draws. No crawl in a 60 s still diff. Phone-emulation capture at 3 km. Owner iPhone night check. `verify-sat-night` reconciled (green or re-premised with evidence). |
| CT-5 | P2 | **NIGHT_RHYTHM.** Match NIGHT_LIGHTS gain to the road ring at `nearFade` (no visible ring). Twilight keyed to sun elevation, so dusk is not pale. Local-time occupancy through one uniform: window share falls after about 23:00 local, offices go dark late, residential stays warm. No new programs. | Dusk and night capture pairs at 500 m and 3 km with no handoff ring. Unit test of the occupancy curve. Program count unchanged. |
| CT-6 | P0 | **The `verify-sat-buildings` F1 red.** Re-derive F1 against the current `maxPerChunk` accounting, with evidence. | Green, or a recorded re-baseline with the measured reason. |
| CT-7 | Close | List NIGHT_CITY_R23's consumers for the lead's deletion (8.3). | List in the record. |

**Provides.** City diagnosis pins and the census readings at the city poses.

**Gates.**
- `FLY_TILE_FIXTURE=1 verify-worker-window`, `verify-skyline`,
  `verify-sat-buildings`, `verify-play-city` (flag-off identity unchanged),
  `verify-true-areas.cjs`.
- New `verify-ship-city.mjs`: draw census thresholds, occupancy curve,
  flag-off hashes.

**5080 checks.** Midtown at 750, 1,500, 6,000, 8,000 and 10,000 ft by day;
dusk and night pairs.

**iPhone checks (owner).** Night from 3 km, and the city turn.

---

### 5.4 LIGHT — shadows, aircraft look, photos

**Mission.** Golden hour looks real: mountains shadow valleys, aircraft land
on their shadows, the player's own aircraft is shadowed, and photos are
worth sharing.

**Owns.**
- Shadows: `cinema-shadows.js`, `CinemaShadowRig.jsx`, `shadow-coverage.js`,
  `shadow-kernel.js`, `compact-shadow-target.js`, `daylight-depth.js`,
  `PlayerGroundShadow.jsx`, and new `terrain-shadow.js` and
  `traffic-shadows.js`.
- MOBILE_ENHANCED: `mobile-enhanced.js` and `mobile-bloom.js` (the
  `Effects.jsx` call site is unchanged).
- Earth surface (TERRAIN_SHADOW sampling): `earth-surface-material.js`,
  `earth-surface-engine.js`.
- Aircraft: `detailed-traffic.js`, `fleet-material.js`,
  `live-aircraft-geometry.js`, `airframe-detail.js`, `aircraft-lights.js`.
- Hangar: lighting constants in `hud/HangarScene.jsx` and `hud/hangar-stage.js`.
- Photo: `PhotoCapture.jsx`, `photo-camera.js`, `photo-composition.js`,
  `hud/PhotoModeBar.jsx`.
- Scripts: new `verify-ship-light.mjs` and `verify-photo-hires.mjs`.

**Edits only in blocks.**
- `PlayerPlane.jsx`: the new `SHIP PASS LIGHT` block and the existing
  LIVING WORLD AIRFRAME block.
- `FlyScene.jsx`: `SHIP PASS LIGHT` imports and mount blocks.
- `prewarm-registry.js`: the LIGHT block.

**Must not touch.** `TrafficLayer.jsx`, `Effects.jsx`, `world-bend.js`,
`perf-governor.js` (request a governor hold through FRAME's API), and city
modules.

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| LT-1 | P0 | **Promote MOBILE_ENHANCED.** The owner glances at it on the iPhone in week 1 (run list); LIGHT fixes anything found and flips it ON. | Owner glance recorded. `verify-mobile-enhanced`, `verify-mobile-bloom` and `verify-cloud-silhouette-gpu` green. |
| LT-2 | P1 | **TERRAIN_SHADOW.** Desktop: a terrain-only orthographic shadow map (2048 to about 40 km on High/Ultra, 1024 to about 20 km on Medium), texel-snapped, refreshed at 2 Hz or on a sun or position change, sampled only by the earth surface material through an anchored patch. Phones: a CPU horizon map (about 64² around the aircraft, at most 1 Hz) built from `terrain-ground-query.js`. | Alps at a 5° sun: shadowed valley luma drops at least 30% vs flag off. No shimmer in a 60 s still diff. +≤ 1 draw. ≤ 0.6 ms GPU on the 5080; ≤ 0.3 ms in phone emulation. |
| LT-3 | P1 | **TRAFFIC_SHADOWS.** On High and Ultra, hero and mid live aircraft within N km cast into the cascades through the fleet depth material. On Medium and phones, an analytic contact blob under aircraft below 60 m AGL on the drawn surface. | KJFK lounge touchdown capture shows the shadow. +≤ 2 draws. Lounge census within budget. Motion bar. |
| LT-4 | P1 | **AIRFRAME_SHADOW.** On High and Ultra the player receives shadows: a tight cascade-0 fit in chase and photo views, with normal bias per airframe size. | No acne in a 60 s chase burst. A photo-mode orbit at a 10° sun shows a wing-root shadow. Flag-off program keys unchanged. |
| LT-5 | P1 | **SHADOW_REACH.** On Medium desktops, shadow range follows AGL up to 1,200 m (generalizing the MOBILE_ENHANCED logic), with the same map size and cascades. | Medium at 900 m AGL shadows to about 1.2 km. Frame-time delta recorded (5080, Medium preset). |
| LT-6 | P1 | **PHOTO_HIRES.** With composition paused, render one frame offscreen at 2–3× (tiled where `MAX_TEXTURE_SIZE` limits), with the governor held through FRAME's API, then restore. Keep the attribution burn-in. | iPhone export ≥ 2,560 px on the long side; desktop up to 4,096. Attribution present (`verify-attribution`). No frame over 2 s during capture. |
| LT-7 | P2 | **HANGAR_EXPOSURE.** Scale the key light by livery luminance; use a half-resolution reflector on Medium. | No clipped pixels on a white-livery nose. Reflector cost halved on Medium. |

**Provides.** `requestShadowCasters()` for future streams, and
`capturePhoto({scale})`.

**Gates.**
- New `verify-ship-light.mjs`: flag-off program keys, texel snap, bounded
  casters, contact-blob math, photo scale math.
- New `verify-photo-hires.mjs`.
- Existing: `verify-shadow-calm`, `verify-shadow-coverage`,
  `verify-fleet-airframes`, `verify-mobile-enhanced`, `verify-photo`,
  `verify-hangar`.

**5080 checks.** Alps, Yosemite and Queenstown at golden hour; KJFK
touchdowns; a chase burst; the hangar.

**iPhone checks (owner).** MOBILE_ENHANCED glance, and a photo export.

---

### 5.5 RELEASE — CI, identity, commerce scaffolding, platform

**Mission.**
- CI is green and stays green.
- New players get the calm explorer.
- The product can be measured, linked and installed.
- One look ships.

**Owns.**
- Package and CI (after W0.1): `package.json`, `package-lock.json`,
  `.github/workflows/*`, `scripts/beta-checks.mjs`, `beta-smoke.cjs`.
- The red-gate scripts and fixtures in section 12.3, except those FRAME and
  CITY own.
- Challenge layer: `juice.js`, `JuiceSystems.jsx`, `hud/JuiceHud.jsx`,
  `hud/ComboChip.jsx`, `hud/RunSummary.jsx`, `contracts.js`,
  `contract-progress.js`, `daily.js`, `crash-system.js`, and new
  `challenge.js`.
- Settings: `hud/SettingsRows.jsx`, except FRAME's block.
- Analytics: `adventure-analytics.js`, new `analytics.js`,
  `hud/GuestSaveControls.jsx`, new `hud/ConsentPrompt.jsx`,
  `FlyErrorBoundary.jsx`.
- Entitlements and links: `content-access.mjs`, new `entitlements.js`, new
  `offer.mjs`, new `deep-link.mjs`, and new `app/api/entitlements/route.js`.
- Platform and metadata: `app/layout.js`, `public/manifest.json`, new
  `public/og/*`, new `public/sw.js`, new `offline-shell.js`,
  `next.config.mjs` (headers).
- The PLAYER_SURFACE flip: `player-surface.js`, `visuals-profile.js`,
  `map-style.js`.
- Reliability: `PoiLetters.jsx` (the assert flood) and `save-backup.mjs`.
- "Copy link" additions in:
  - `hud/airports/browser-parts.jsx`;
  - `hud/AdventureExperience.jsx`;
  - `hud/atlas/*`;
  - `PauseMenu.jsx`.

  Each is additive, with testids kept.

**Edits only in blocks.**
- `fly-settings.js`: `SHIP PASS RELEASE stakes`.
- `front-door.js`: `SHIP PASS RELEASE entry`.
- `flight-plan.js`: `SHIP PASS RELEASE spawn`.
- `FlyMode.jsx`: `SHIP PASS RELEASE` imports and mount blocks.
- `stores/fly-store.js`: RELEASE fields.

**Must not touch.** Any shader or material module, `perf-governor.js`,
`FlyCanvas.jsx`, `device-report.js`, and `FlyScene.jsx` outside RELEASE
blocks.

| ID | Pri | Requirement | Acceptance |
|---|---|---|---|
| RL-1 | P0 | **Red gates and CI.** Fix the known reds in the beta suite and around it (section 12.3): `verify-encounters` C-17 metrics, `verify-finalize-pace` CRLF, `verify-lounge-promotion` (`tcn-row`), `verify-living-earth` no-data semantics, the `verify-mobile-layout` intermittent commit race, the `verify-mobile-flight-deck` tips-card tap, stale operations design and touch role names, and `verify-cinematic-earth` fleet assertions. Everything else goes to the known-red file with owner, reason and date. | The `Explorer beta` workflow is green on `main`. `ship-pass-gates` prints KNOWN-RED rows separately. |
| RL-2 | P0 | **CHALLENGE_LAYER (D2).** New `challenge.js` (`fly-challenge-v1`; pin `__flyChallengeOverride`). Challenge ON means crashes (stakes), combos, near-miss, shake from near-miss, the RunSummary, and the buzz and night-buzz contracts. Migration: a saved `fly-crash-mode='stakes'` turns Challenge on; `'forgiving'` or absent leaves it off. The Settings stakes row becomes "Challenge mode" with the same testids (`settings-stakes`, `pause-stakes`). The daily pool draws only from non-challenge templates, so every player still gets the same two. Buzz contracts are dealt only with Challenge on. The boost meter stays. Harness posture: `verify-crash` and `verify-juice` pin Challenge on. | Flag off: byte-identical behaviour (node gate over `crashEnabled`, juice gates and the daily pick). Flag on with a fresh profile: no crash on a commanded dive, no combo/near-miss UI, no buzz in contracts. Toggling restores today. `verify-daily` 28 and `verify-living-contracts` 16 still green with the new pool rule documented. Save whitelist updated. |
| RL-3 | P0 | **PLAYER_SURFACE ON (D11).** Flip the flag and confirm the one-time migration and the phone credit bar. Review and automation surfaces stay. | `verify-player-surface` 5/5. A saved Neon or Classic profile boots Enhanced Day once and stays. `?graphicsReview=1` still shows both rows. |
| RL-4 | P1 | **DEEP_LINKS.** Pure `deep-link.mjs`: `?watch=<ICAO>`, `?fly=<destinationId>` or `?at=<lat>,<lon>[,<altFt>]` with optional `&aircraft=<id>`, and `?journey=<adventureId>`. Validated against `lounge-airports.mjs`, `destinations.js`, `adventures.mjs` and `player-aircraft.js`. Resolved pre-mount through the seeded front-door and flight-plan blocks. Harness bypass pins win, and load guards are respected. Consumed once (`history.replaceState`). An invalid link opens the title with a quiet notice. "Copy link" goes on airport cards, journey cards, the Atlas destination card and Pause (current place). | A node gate covers the parser (valid, invalid, junk, injection and range cases). A browser check that each link kind opens its mode shows zero page errors. `verify-r25-front-door` and `verify-title-cinema` stay green. |
| RL-5 | P1 | **Share metadata** (no flag). `metadataBase` comes from `NEXT_PUBLIC_SITE_URL`. Static 1200×630 OG and Twitter images per mode, captured on the 5080. The manifest and description lead with the real Earth; `shadowadsb.app` is removed. | The built HTML has og:image and the right URL. The manifest validates. |
| RL-6 | P1 | **ANALYTICS_V2 (D3).** `analytics.js` with an explicit, sanitized schema and no location, aircraft identity or screenshots: `session_start`, `mode_entered{mode}`, `session_end{minutes_by_mode, preset, device_class}`, `lounge_movement_watched`, `photo_taken`, `deep_link_opened{kind}`, `link_copied{kind}`, `challenge_toggled`, `perf_summary{p95_bucket, stalls_per_min, rung}` (from FRAME's summary), and `client_error{kind: context_lost\|boundary\|shader_link}`. A non-blocking first-run consent prompt after the first completed flight, plus a Settings row. Error telemetry rides the same consent. `adventure-analytics.js` becomes a thin wrapper with existing events unchanged. Emit or delete `pack_interest`: wire it from the Wild Earth debrief. | A node gate over the sanitizer (unknown events and fields dropped, no free text). Without consent, zero network calls (browser check with request interception). The consent choice persists. |
| RL-7 | P2 | **Entitlement seam** (no UI, no flag). `entitlements.js` `currentGrants()` returns `[]` and is the only grants source for `contentAccess`. `app/api/entitlements/route.js` returns `{grants: []}` unless server env is configured. `offer.mjs` describes the Pass contents as data with no prices shown. | A node gate: every `contentAccess` call site passes grants through the resolver. Behaviour unchanged. |
| RL-8 | P2 | **OFFLINE_SHELL.** A production-only service worker caches first-party static assets (Next chunks, models, materials, HDRIs, fonts, runway data) under versioned keys. It never caches `/api/*`, provider tiles, ADS-B or weather. It has a kill switch (the flag off unregisters it). An install hint shows on touch devices on the second visit after a completed flight. | Lighthouse installable. A warm boot to reveal on the 5080 recorded vs W0.6. An offline launch shows the title shell. A node gate checks the cache allowlist. |
| RL-9 | P1 | **The PoiLetters assert flood.** Query POI heights through the bucketed ground query with a coverage check, cached per POI until a finer tile lands. Fix PoiLetters' two hooks lint errors. | 0 assert failures in a 5-minute flight and a lounge session. Letters within 2 m of the ground query. |
| RL-10 | P2 | **Save durability.** Call `navigator.storage.persist()` after the first meaningful progress. Whitelist `fly-challenge-v1`, `fly-frame-rate-v1` and flight history v2 in `save-backup.mjs`. | A node gate over the whitelist and import validation. |
| RL-11 | P0 | **Honest title copy (P-21, no flag).** The Takeoff & Landing row (`CinemaTitle.jsx:671`) changes from "Real runways, gate to gate." to "Real runways, worldwide." The "From the gate" Continue label is not shown while GATE_TO_GATE is off. This is a one-line edit; CinemaTitle is otherwise untouched. | `verify-title-cinema` green; testids unchanged. |

**Provides.** `track(event, props)`, the deep-link schema, `currentGrants()`,
and the Challenge state API (`challengeOn()`).

**Gates.**
- New `verify-ship-release.mjs`: Challenge migration and flag-off identity,
  the deep-link parser, the analytics sanitizer, the entitlement call sites,
  the SW allowlist, the save whitelist.
- Existing: `verify-crash`, `verify-juice`, `verify-daily`,
  `verify-living-contracts`, `verify-player-surface`, `verify-r25-front-door`,
  `verify-title-cinema`, `verify-attribution`, `verify-mobile-layout`,
  `verify-poi`.

**iPhone checks (owner).** A deep link from Messages, Add to Home Screen, and
the consent prompt.

## 6. Cross-stream contracts

A contract changes only in the provider's commit, and the record is updated in
the same commit.

| Contract | Provider → consumers | Shape (frozen in W0 or by day 2) |
|---|---|---|
| Prewarm registry | W0 API, FRAME consumer → all | `registerPrewarm({stream,key,build,when})`, `prewarmEntries()` |
| Device policy | W0 API, FRAME table → SKY, CITY, LIGHT | `deviceFeature(name) → {allowed, budget}`, `deviceClassOf()` |
| Budgets and census | FRAME → all gates | `budgetFor(profile)`, `__flyStats.census.{programs,layers,textureBytes}` |
| Cadence and governor hold | FRAME → LIGHT (photo), RELEASE (rows), SKY | `setFrameCadence(mode)`, `holdGovernor(reason) → release()` |
| Session perf summary | FRAME → RELEASE | `frameSessionSummary() → {p95Bucket, stallsPerMin, rung}` |
| Veil pins and table | SKY plus CITY → both | pin names and the attribution table in the record by day 2 |
| Moon state | SKY → CITY (night exposure balance) | `moonState() → {altDeg, azDeg, phase, illum}` |
| Photo capture | LIGHT → RELEASE (analytics) | `capturePhoto({scale}) → Promise<Blob>`; emits through `track('photo_taken')` |
| Challenge state | RELEASE → anyone | `challengeOn()`; `fly-challenge-v1` |
| Analytics | RELEASE → anyone | `track(event, props)`, with the schema enforced by the sanitizer |

## 7. Hot-file seam map (W0 seeds every marker, empty)

| File | Blocks (`SHIP PASS <STREAM> …`) |
|---|---|
| `components/fly/FlyScene.jsx` | `imports` × 5, `frame` blocks for FRAME, SKY and LIGHT inside the −50 hook (about :3540–3585), and `mounts` for CITY, LIGHT and SKY beside the PLAY PASS mounts (:3736–3749) |
| `components/fly/FlyMode.jsx` | `imports` and `mounts` for RELEASE (consent prompt, install hint) and FRAME (battery-saver suggestion host, if needed) |
| `components/fly/PlayerPlane.jsx` | `LIGHT` (receiveShadow and cascade fit) |
| `lib/fly/fly-constants.js` | One header and 20 seeded blocks (section 5); streams edit only inside their braces |
| `lib/fly/device-report.js` | FLAGS and import (W0 only); `FRAME report body` block below FLAGS |
| `lib/fly/fly-settings.js` | `FRAME start tier` (`defaultQualityTier` hint branch); `RELEASE stakes` (`_stakesOn` resolution) |
| `lib/fly/front-door.js` | `RELEASE entry` in `resolveInitialScreen` |
| `lib/fly/flight-plan.js` | `RELEASE spawn` in `resolveInitialSpawn` |
| `components/fly/hud/SettingsRows.jsx` | `FRAME rows`; RELEASE owns the rest of the file |
| `stores/fly-store.js` | A SHIP PASS field group: `frameRateMode` (FRAME); `challengeOn`, `consentPrompt` (RELEASE) |
| `lib/fly/prewarm-registry.js` | One block per stream |
| `Effects.jsx` | SKY owns the whole file this pass; no other stream needs it |
| `world-bend.js`, `TrafficLayer.jsx` | Frozen |

## 8. Integration and close (the lead)

### 8.1 Landing order and checkpoints
Streams land when ready, with no fixed order, because file ownership is
disjoint. Week-1 targets:
- RELEASE RL-1 (CI green) first;
- FRAME FR-1 to FR-6 (instruments and budget table);
- SKY and CITY: SK-1 and CT-1 (veil table).

| Checkpoint | Owner looks at |
|---|---|
| C1 (end of week 1) | Baseline vs instruments, the budget table, the veil attribution, the MOBILE_ENHANCED iPhone glance, Challenge default |
| C2 (each look flag as it lands) | 5080 live flight with `?flags=-NAME` comparisons |
| C3 (pass end) | The full run list in section 9 |

### 8.2 Final battery (on the merged tree)
- `ship-pass-gates` all green, with known reds listed.
- CI green on `main`.
- A 20-minute uninstrumented soak at Ultra and High against section 2.
- The iPhone run list.
- Program census on the reference route.

### 8.3 Cleanup wave (D14)
The lead makes one commit per item, after all streams land. Each commit
proves the default frame is unchanged: shader text and program key sha256 on
default flags, `verify-ops-golden`, and a 5080 still diff.
- **LENS_FLARE:** remove the block from `fly-constants.js`, `living-world.js`
  and the device-report FLAGS (after SK-5).
- **SKY_PROCEDURAL:** remove the block (no consumers).
- **AERIAL_LAW:** remove the law path from `world-bend.js`, `r25-sky.js`,
  `AerialPerspective.jsx` and `FlyScene.jsx`. Keep `nightRamp`'s live
  multiplier (`FlyScene.jsx` ~1896) byte-identical. Update `verify-atmo-law`,
  `verify-c-flagoff` and `verify-lod-fade` accordingly.
- **NIGHT_CITY_R23:** remove from CITY's list (CT-7).
- **Lint:** fix FlyScene.jsx's 28 pre-existing ESLint errors (targeted disables
  with reasons where runtime-bus mutation is the contract).

### 8.4 Record
- Update `FLY_SHIP_PASS.md` with status, verification, owner checkpoints and
  known issues.
- Update the CLAUDE.md banner.
- Update EXPLORER_BETA.md's evidence ledger rows.
- Push only when the owner asks.

### 8.5 Merge to main (2026-10-30, the lead, cloud venue)

The owner asked, mid-pass, to "merge to main and turn the flags off so the
features are enabled". The lead stopped the five stream agents and merged
their COMMITTED heads, without the remaining browser evidence, the 3.7
cross-review or the 8.3 cleanup wave.

**What merged** (`--no-ff`, onto W0 `940b751`, zero conflicts between streams):
FRAME `c749b4a`, SKY `fbb3a28`, CITY `594c516`, LIGHT `bba7809`, RELEASE
`8a60f9e`; then the owner's `75afafa` (laptop controls), which had landed on
`origin/main` after W0. One conflict: `FlyMode.jsx`. The owner's commit removed
the small-window `mobileNote` banner and the streams had put the SHIP PASS
RELEASE / FRAME mount blocks next to it. Resolved by keeping both: the banner
is gone and the mount blocks stay.

**Flags: all 21 ship `enabled:true`.** That is the 20 Ship Pass blocks (FRAME
SHADER_READY, PACE_ADAPT, DEVICE_POLICY, ULTRA_SUPERSAMPLE; SKY AERIAL_CLARITY,
REAL_MOON, SKY_LITE; CITY CITY_RANGE, NIGHT_LITE, NIGHT_RHYTHM; LIGHT
TERRAIN_SHADOW, TRAFFIC_SHADOWS, AIRFRAME_SHADOW, SHADOW_REACH, PHOTO_HIRES,
HANGAR_EXPOSURE; RELEASE CHALLENGE_LAYER, DEEP_LINKS, ANALYTICS_V2,
OFFLINE_SHELL) plus PLAYER_SURFACE. Sub-switches keep the streams' values
(e.g. `PACE_ADAPT.turn` stays off). This waives the 3.6 motion bar by the
owner's call, so every look flag is unproven on real hardware.
`?flags=-NAME` restores the pre-pass behaviour for one page load. A first
merge commit (`fd0a334`) shipped them all off; it was a misreading of the
request and is superseded by the merge commit that turns them on.

**Lead fixes at the merge:**
- `scripts/_ship-pass-base.mjs`: the stream gates' identity base is the W0
  commit. `merge-base HEAD main` became HEAD once the streams were in main, so
  FRAME's W0 rows broke and CITY's / LIGHT's compared the tree with itself.
- The stream gates were re-premised for flags shipping on: off arms now pin
  the flag off rather than reading the shipped state, and "ships off" rows
  read "ships on". No assertion was removed; each re-premise had an
  independent reviewer looking for a weakened row.
- Flag leaks found by the merge audit: the Atlas destination card rendered an
  empty Copy-link wrapper with DEEP_LINKS off, and ReleaseAnalytics evaluated
  `deviceClassOf()` (a throwaway WebGL context) with ANALYTICS_V2 off.
- `beta-smoke.cjs`: evidence screenshots get the software-GL allowance and are
  non-fatal on software GL only. CI run 51 failed on a 30 s screenshot
  timeout while every check before it had passed.

**Verification at the merge (venue: fixture + SwiftShader, no device numbers):**
- `node scripts/ship-pass-gates.mjs --require-stream-gates
  --also=verify-laptop-controls.mjs`: 38 PASS, 0 FAIL, 0 known reds, 1 SKIP
  (seam rule, lead tree). Stream gates: FRAME 56/0, SKY 49/0, CITY 49/0,
  LIGHT 67/0, RELEASE 83/0.
- With every flag pinned off, the off arms still reproduce W0. CITY: the
  architecture programs and the NIGHT_LIGHTS text match `940b751`'s sha, and
  worker output is byte-identical over 48 fixture builds. SKY: the program
  texts match W0's sha. LIGHT and FRAME: the same, pinned.
- `next build`: compiled, no errors (one warning: `metadataBase` unset, see
  RL-5 below).
- Production boot (`verify-ship-frame-browser --arms=default`, every flag
  on), with zero page errors, zero shader errors and 0 link failures:
  - Neon revealed in 88 s, 107 programs.
  - Satellite (Enhanced) revealed in 75 s, 114 programs.
  - All four FRAME flags resolve on, and the Frame rate row is present.
- The owner's `verify-laptop-browser` (75afafa): 51/51 on the merged
  production build. That run was before the flags were turned on.
- `smoke:beta` (CI's step) run locally: 18 checks pass. It then hit a red
  that predates this pass: the feed-loss step waited for the pre-CALM_HUD
  status text. That is fixed in `beta-smoke.cjs`, which now waits for the
  runtime's traffic state and records whichever notice the player sees.
  CI had never reached this step; earlier runs died at `npm audit`, and run
  51 died at a screenshot timeout.
- CI run 52 (`4cb7e8b`) then passed every smoke check except one: the
  production page threw "Cannot read properties of undefined (reading
  'isReady')" after the context-loss leg. Cause: three's `compileAsync` polls
  `properties.get(material).currentProgram` from a timer, and a context
  restore replaces that table. FRAME's registry warm and the older prewarm
  queues keep compiles in flight across the loss. Fix:
  `installSafeCompileAsync` (`lib/fly/compile-scene-safe.js`), installed once
  per renderer in `installFrameRenderer`, routes every caller through the
  existing context-loss-safe `compileSceneAsync`, keeping three's contract.
  Re-run locally after the fix, `smoke:beta` passes every check, ending
  with "production browser has no uncaught errors []".
- `smoke:ultra` (CI's last step, never reached before) passes locally with
  every flag on. All four stages (Ultra → High → Low → Ultra) link their
  terrain programs, Ultra keeps three cascades, and there are no page errors.
  Its waits now poll on an interval: with every look flag on, a SwiftShader
  frame can starve `requestAnimationFrame` past the old 30 s while the profile
  is already resolved.
- Gate re-premise notes for the owner:
  - DEVICE_POLICY on also enables FR-13's dynamic near plane on renderers
    without reversed depth (no iPhone report yet), and runs the boot
    micro-benchmark (up to 1.5 s, PROVISIONAL thresholds).
  - ULTRA_SUPERSAMPLE boots a DPR-1 Ultra dGPU display at 1.5× render scale
    (FR-12's 5080 check has not run).
  - TERRAIN_SHADOW makes the shipped desktop-Ultra earth fragment use
    exactly 16 of 16 texture units (zero headroom on a 16-unit GPU).
  - PHOTO_HIRES's phone 2,560 px row is proven in node (touch maxScale 3)
    but `verify-photo-hires` never re-ran in a browser on the merged tree.

**Not done when the streams stopped:**
- FRAME: the stall root causes need the 5080 trace (FR-7); FR-8's turn budget
  ships off.
- SKY: the SK-1 veil table run was in flight.
- CITY: with CITY_RANGE on, two frozen browser premises move and must be
  re-read: `verify-skyline` (B) "detail ring gone at 5,000 m" (the range
  evicts at 5,200 m: probe at 5,400 m) and `verify-sat-night` (E) "fade
  strictly inside (0,1) at 2,700 m" (the range dissolves at 4,500–5,000 m).
  Neither browser harness ran on the merged tree.
- LIGHT: LT-1 is owner-pending; the LT-2 / LT-3 / LT-7 browser sessions and
  the KJFK lounge capture were queued and never ran.
- RELEASE: RL-1 (CI green) was still in progress; RL-4 (deep links) never had
  its browser check before shipping on.
- 8.3 cleanup wave: not done. `ship/close` holds partial, uncommitted
  AERIAL_LAW work and is not merged. LENS_FLARE's block and reader still exist,
  but SK-5 deleted its code, so `?flags=LENS_FLARE` renders nothing.

**The owner should know (from the merge audit):**
- RL-10 (no flag, per the plan): after the first completed flight the app
  calls `navigator.storage.persist()`. Firefox can answer that with a
  "store data in persistent storage" prompt.
- RL-5: `og:url` / `og:image` resolve through `metadataBase`, which needs
  `NEXT_PUBLIC_SITE_URL` on any non-Vercel deploy (the build warns and uses
  `http://localhost:3000` otherwise).
- OFFLINE_SHELL on registers `public/sw.js` in production builds. Turning the
  flag off is the kill switch: the next load unregisters it.
- CITY's `window.__flyCityDiag` pin is read in production (console only).

## 9. Owner run list (consolidated, about 90 minutes)

**RTX 5080, production build:**
1. A cold boot to the first flight: watch for freezes, and read the census
   panel.
2. Midtown climb from 6,000 to 10,000 ft, with `?flags=-AERIAL_CLARITY,-CITY_RANGE`
   for comparison.
3. Alps at golden hour (TERRAIN_SHADOW).
4. KJFK lounge, Watch for me, through a touchdown (TRAFFIC_SHADOWS).
5. A chase orbit at low sun (AIRFRAME_SHADOW).
6. A night flight at the current moon (REAL_MOON, NIGHT_RHYTHM).
7. Photo export.
8. A fresh profile in a private window: no crash, then turn on Challenge.
9. Each deep-link kind.
10. The Match display setting.

**iPhone (LAN dev and production):**
1. A report at Medium and High.
2. Low Power Mode holds 30 fps.
3. Battery saver.
4. A city turn, a night at 3 km and a mountain.
5. A 15-minute lounge session in Watch for me (heat).
6. Photo export at 2,560 px or more.
7. A deep link from Messages.
8. Add to Home Screen.
9. The consent prompt.
10. MOBILE_ENHANCED, SKY_LITE and NIGHT_LITE glances.

## 10. Kickoff prompt template (one per stream, written in W0.7)

> You are the <STREAM> stream of the Ship Pass. Read `FLY_SHIP_PASS.md`
> sections 1, 3, 5.<n>, 6 and 7 (rules, your requirements, contracts, seams),
> plus CLAUDE.md's banner. Work only in `..\skyloom-<stream>` on
> `ship/<stream>`, dev server port <port>. Own only the files in 5.<n>; edit
> hot files only inside your `SHIP PASS <STREAM>` blocks. Do P0 first. Write
> your report section in your first commit and update it on every landing.
> Take the GPU lock for any measurement, and never measure while
> `owner.lock` exists. Land with `--no-ff` on local `main` after
> `node scripts/ship-pass-gates.mjs` is green; flip your flag ON only after
> its 5080 motion bar. Never push to origin.

### 10.1 This run's kickoff (W0.7, 2026-10-30)

Each stream runs as one Opus agent in its own worktree, launched by the lead
with the template above plus section 3.8 and these per-stream notes. Every
stream's work then gets an independent review agent (correctness, seam rule,
flag-off identity, honesty of the record) and a fix pass before it lands.

| Stream | Worktree / port | Flags this venue can land ON | Notes |
|---|---|---|---|
| FRAME | `/home/user/skyloom-frame`, 3131 | SHADER_READY, PACE_ADAPT (sub-switches that only a 5080 soak can prove ship off) | DEVICE_POLICY and ULTRA_SUPERSAMPLE stay off (device evidence). FR-6 builds the one table with provisional rows and a re-derive script for the owner's W0.6 reports. FR-13 gates on the runtime's reversed-depth capability. Implements `frame-api.js`; FlyCanvas's context-lost path and the census's link failures call `track('client_error', …)`. |
| SKY | `/home/user/skyloom-sky`, 3132 | none (all three are look flags) | SK-1: the atmosphere arms here; CITY measures the city arms with the `window.__flyCityDiag` pins; the lead joins the table on the merged tree. SK-5 deletes the lens-flare code with a default-frame sha256 proof. Implements `moonState()`. |
| CITY | `/home/user/skyloom-city`, 3133 | none (all three are look flags) | CT-1 pins are `window.__flyCityDiag = { fadeStartM, fadeEndM, skylinePremix }`, honoured with CITY_RANGE off. CT-6 settles the F1 red. Any WORKER_PROTOCOL bump moves every pin site in one commit. |
| LIGHT | `/home/user/skyloom-light`, 3134 | PHOTO_HIRES, only if desktop and iPhone-emulation exports pass without context loss | MOBILE_ENHANCED and every shadow and hangar flag stay off (owner glance / motion bar). Uses `holdGovernor` and `track('photo_taken')`. |
| RELEASE | `/home/user/skyloom-release`, 3135 | CHALLENGE_LAYER, DEEP_LINKS, ANALYTICS_V2, OFFLINE_SHELL, PLAYER_SURFACE | RL-1 reproduces the CI steps locally (audit, verify:beta, build:beta, smoke:beta, smoke:ultra) and settles the W0.5b smoke timeout and the `r25-w0` baseline. Owns `ship-pass-known-reds.json`; FRAME and CITY report the reds they fix. |

## 11. Out of scope (the backlog, with gap IDs)

| Item | Gap IDs |
|---|---|
| Takeoff & Landing: Gate to Gate W1+W2 runway-first, featured runways, debrief and touchdown audio (the candidate next pass) | P-20…P-25, L-15, F-01. The title copy fix "gate to gate" → "worldwide" (P-21) is the one exception, a one-line RELEASE change in the CinemaTitle mode row. |
| Pilot meta loop: rank, lounge spotting and photos counting, badges for every mode, visible daily and goals, journal naming | P-01, P-03, P-13…P-15, P-29…P-33 |
| Content: journeys engine (12–20 routes), discoveries worldwide, featured lounges, more monuments, helicopter | P-02, P-10, P-12, P-18, P-34, P-36 |
| Lean-back and live: Ride along, a Live channel, busy-now routing, Watch for me by default | P-05, P-16, P-17, P-19 |
| Audio: a composed score, per-class engines, touchdown sounds, a lounge listening check | P-37…P-40 |
| Onboarding: an action-gated first flight, optional hangar, vocabulary | P-11, P-26…P-28 |
| Share: postcards, clips and replay, async social | P-43, P-44, F-02 |
| Accessibility: gamepad and remap, UI scale and colour vision, units and i18n | P-49…P-51 |
| Phone flight UX: tilt and haptics in flight, auto title tour | P-52, P-55 |
| Accounts, checkout, provider contracts (owner-led, blocks any paid launch) | P-45…P-47, R-06 |
| Weather layers, cirrus rebuild, snow and wet, storms, light shafts (after the provider switch, D13) | L-02, L-04, L-12…L-14 |
| Later rendering: imagery de-lighting, HDR output, TAA, flag-retirement wave, FRAME_STEP | L-11, L-20, PF-10, PF-11 |
| Other devices: physical iGPU, Android and iPad certification | D-06, D-10 |

The P-21 copy fix is pulled in because the title must not over-promise, and
it costs one line with no flag.

## 12. Appendix — deep-dive findings (condensed)

### 12.1 How each mode stands

| Mode | Score | Biggest hole |
|---|---|---|
| Watch an Airport | 7/10 | Spotting doesn't count (`FlyScene.jsx:2223`); no touchdown sound; quiet airports are dead ends |
| Free Flight | 6/10 | Goals hidden until the first score (`calm-hud.css:444`); 12 discoveries; warps take 9–14 s |
| Front door | 6.5/10 | Mandatory hangar; vocabulary drift |
| Guided Journeys | 5/10 | About 40 minutes of content; forced live clock |
| Phones | 5/10 | No device evidence; 284 vs 250 draws; nearly black at night |
| Takeoff & Landing | 3/10 | W1–W3 never built; one-word grade |

### 12.2 Verified spot checks
- CI: the last 12 runs on `main` failed (one cancelled), stopping at `npm audit`.
- `refreshSnap` is `[60, 90, 120, 144]` (`fly-constants.js:4595`).
- `SAT_BLDG_FADE` runs 2,400–3,000 m.
- `landing-grade.mjs`, `ops-audio.js` and `flight-deck/` are missing;
  `camera-director.js` is 44 lines.

### 12.3 Known reds at the start
`verify-encounters` (C-17 53.45 m), `verify-living-earth` (no-data),
`verify-finalize-pace` (CRLF), `verify-sat-buildings` (F1), `verify-lounge-promotion`
(`tcn-row`), `verify-mobile-layout` (intermittent), `verify-r25-flight-plan`
(7h/8a/8b, owner tag), `verify-frame-step` (10/11), `verify-operations-design`
and `-touch` (role names), `verify-operations-experience` (rollout braking),
`verify-mobile-flight-deck` (tips card), `verify-sat-night` (27/2),
`verify-feel` (74° vs 78°), `verify-chase-cam` (live traffic),
`verify-cinematic-earth` (fleet), the GPU halves of `verify-phys-sky` and
`verify-hdr-guard` (they need Chrome), `verify-graphics-governor` and
`verify-atmo-law` (they crash), and the lounge iPad TOUCH 70/72 (flaky).

### 12.4 Full inventory
Every gap is in the appendix below. Product gaps are P-01…P-60. Look, tech
and device gaps are L-01…L-20, PF-01…PF-11 (the tech audit's performance
P-xx, renamed so they don't collide with the product IDs), D-01…D-11,
R-01…R-06, A-01…A-04 and F-01…F-03.

## Appendix — every gap from the deep dive (2026-10-29)

Severity and effort are the auditors' estimates. "Where" names the requirement that closes the gap this pass, or the backlog. Evidence lists the first two references; the auditors read each one.

### A.1 Product and play

| ID | Area | Sev | Effort | Gap | Evidence | Where |
|---|---|---|---|---|---|---|
| P-01 | Free Flight | high | S | New players see no goals: contracts and dailies are hidden until the first score | components/fly/hud/calm-hud.css:442-446; FLY_PLAY_PASS.md:199 | Backlog |
| P-02 | Free Flight | high | M | Only 12 discoveries exist worldwide, all inside the six journey regions | lib/fly/encounters.mjs:7-11; FLY_SCALE_AND_ENCOUNTERS.md:16-18 | Backlog |
| P-03 | Progression | medium | S | Most travel-journal places are coordinate strings | components/fly/hud/ExplorerGuide.jsx:62-67; components/fly/hud/ExplorerJournal.jsx:22-37 | Backlog |
| P-04 | Free Flight | medium | M | Nearby and escort are passive and rare | lib/fly/encounters.mjs:6; FLY_SCALE_AND_ENCOUNTERS.md:26-29 | Backlog |
| P-05 | Free Flight | medium | L | No lean-back flight: no scenic autopilot, no ride along with a real flight | lib/fly/autopilot.js:24-35; lib/fly/fly-constants.js:8194-8233 (LOUNGE_DIRECTOR director block) | Backlog |
| P-06 | Free Flight | medium | S | Arcade layer and explorer identity pull in opposite directions | lib/fly/fly-settings.js:32-34; lib/fly/fly-constants.js:3555-3563 | RL-2 |
| P-07 | Reliability | high | L | Warps and transfers take 9–14 s; cold boot is about 20 s | EXPLORER_BETA.md:229-235; EXPLORER_BETA.md:289 | FR-7, RL-8 (masking: backlog) |
| P-08 | Desktop UX | medium | M | Free Flight camera variety is thin: only chase and cinema | FLY_GATE_TO_GATE.md:51; lib/fly/fly-constants.js:7602 | Backlog |
| P-09 | Guided Journeys | high | S | Live clock and weather make authored journeys dark or clouded, with no 'best time' guidance | lib/fly/adventure-runtime.js:32; lib/fly/adventure-environment.mjs:3-15 | Backlog |
| P-10 | Guided Journeys | high | L | Six journeys (~40 minutes total) is the whole authored campaign | lib/fly/adventures.mjs:7-; FLY_FLEET_AND_ADVENTURES.md:377 | Backlog |
| P-11 | Onboarding | high | S | The teaching journey is no longer the first-run path | FLY_FLEET_AND_ADVENTURES.md:285; FLY_TITLE_CINEMA.md:73-75 | Backlog |
| P-12 | Guided Journeys | medium | M | Discoveries arrive with no drama: one-line captions, synth cue, no narration or music | lib/fly/adventures.mjs:11-15; lib/fly/audio-engine.js (adventureCue) | Backlog |
| P-13 | Watch an Airport | high | S | Spotting in the plane-spotting mode doesn't count | components/fly/FlyScene.jsx:2223; components/fly/hud/InspectModal.jsx:155-160 | Backlog |
| P-14 | Watch an Airport | medium | S | Lounge photos never reach the travel journal | components/fly/PhotoCapture.jsx:89; components/fly/PhotoCapture.jsx:122-124 | Backlog |
| P-15 | Watch an Airport | medium | S | No recents, favourites or Continue for the lounge | components/fly/hud/lounge/LoungeHud.jsx:58; lib/fly/observation-config.js:741 | Backlog |
| P-16 | Watch an Airport | high | M | Quiet or uncovered airports leave the player staring at an empty sky | components/fly/hud/lounge/LiveBoard.jsx:17-20; components/fly/hud/lounge/DirectorHud.jsx:100,140 | Backlog |
| P-17 | Watch an Airport | medium | L | Lounge and flight are only loosely linked (LOUNGE_BRIDGE off) | lib/fly/fly-constants.js:7703; FLY_GATE_TO_GATE_PLAN.md:42-43,345-353 | Backlog |
| P-18 | Watch an Airport | medium | M | Featured lounges don't include the world's iconic spotting places | lib/fly/airport-observation.mjs:4-; FLY_PLAY_PASS.md:217 | Backlog |
| P-19 | Watch an Airport | medium | S | 'Watch for me' is opt-in; there is no TV mode at entry | FLY_PLAY_PASS.md:132,206; lib/fly/fly-constants.js:8228-8229 | Backlog |
| P-20 | Takeoff & Landing | critical | XL | Gate to Gate W1–W3 (and W5 replay) were never built: 13 of 15 flags off | FLY_GATE_TO_GATE.md:10-14,79-95; FLY_GATE_TO_GATE_PLAN.md:11-33 | Backlog |
| P-21 | Takeoff & Landing | high | S | The title promises 'Real runways, gate to gate', which the game cannot do | components/fly/hud/CinemaTitle.jsx:671; components/fly/hud/CinemaTitle.jsx:373 | RL-11 |
| P-22 | Takeoff & Landing | high | M | The landing payoff is one word; flight history is written but never read | components/fly/hud/OperationsHUD.jsx:76,79; lib/fly/flight-history.mjs (no consumers) | Backlog |
| P-23 | Takeoff & Landing | high | M | Entry and in-flight UI is a web form | components/fly/hud/GroundHangar.jsx:124-136; components/fly/hud/AirportPicker.jsx:5-17 | Backlog |
| P-24 | Takeoff & Landing | high | L | Only three authored airports (all Columbus, Ohio); catalogue airports are bare strips | lib/fly/operations-airports.js:9-22; EXPLORER_BETA.md:76-94 | Backlog |
| P-25 | Takeoff & Landing | medium | M | Feel defects: switch liftoff, gear-up 'Smooth', frozen failures | FLY_GATE_TO_GATE_PLAN.md:25-27; lib/fly/fly-constants.js:7547 (OPS_FEEL off) | Backlog |
| P-26 | Onboarding | medium | S | Names disagree across surfaces, and some copy is stale or wrong | components/fly/hud/CinemaTitle.jsx:1103-1106; components/fly/PauseMenu.jsx:144,175,256,282 | Backlog |
| P-27 | Onboarding | high | M | First-flight tips are five passive text cards and never teach the live-traffic hook | components/fly/hud/ExplorerGuide.jsx:15-21,95-99; lib/fly/observation-config.js:741 | Backlog |
| P-28 | Title/Hangar | medium | S | The hangar is mandatory between the title and every flight | lib/fly/front-door.js:98-107; components/fly/hud/CinemaTitle.jsx:652-655 | Backlog |
| P-29 | Progression | low | S | Journal tabs duplicate each other | components/fly/hud/Logbook.jsx:61-68,285-287; components/fly/hud/ExplorerJournal.jsx:36-38 | Backlog |
| P-30 | Progression | critical | L | No unified meta loop across modes | stores/fly-contracts-store.js:19-55; lib/fly/player-aircraft.js:33-37,50 | Backlog |
| P-31 | Progression | high | M | All badges are about spotting; none for flying, landing, journeys or watching | lib/badges.js; components/fly/hud/Logbook.jsx:199-205,360-392 | Backlog |
| P-32 | Progression | medium | M | The daily set is invisible and has no social dimension | lib/fly/daily.js:1-21; components/fly/hud/calm-hud.css:442-446 | Backlog |
| P-33 | Progression | medium | M | Aircraft and liveries are almost all free; the unlock track is unused | lib/fly/content-access.mjs:6-10; FLY_FLEET_AND_ADVENTURES.md:1-17 | Backlog |
| P-34 | Buildings | medium | L | Hero landmark content is thin for 'anywhere on Earth' | lib/fly/monument-detail-assets.json; public/models/monument-*.glb | Backlog |
| P-35 | Social/Share | low | S | Orphaned features: unused aircraft search and military APIs, an unemitted research event | lib/api.js:134,162; app/api/aircraft/military/route.js | RL-6 (pack_interest); rest backlog |
| P-36 | Aircraft look | medium | L | No helicopter or hover-capable aircraft | lib/fly/player-aircraft.js:24-31 | Backlog |
| P-37 | Audio | high | M | Music is procedural synth drones only; there is no theme | lib/fly/music-director.js:1-37; FLY_TITLE_CINEMA.md:88-90 | Backlog |
| P-38 | Audio | high | M | No touchdown, rollout, gear or brake sounds anywhere | lib/fly/audio-engine.js (FlyAudio methods); FLY_PLAY_PASS.md:207-208 | Backlog |
| P-39 | Audio | medium | M | One sampled engine loop shared by 13 aircraft; no per-class voices | lib/fly/immersive-audio.js:7-12; public/audio/immersive/ | Backlog |
| P-40 | Audio | medium | S | Lounge and second-level audio has never been heard by a human | FLY_LOUNGE_SECOND_LEVEL.md:1028-1031 | Backlog |
| P-41 | Social/Share | high | M | No deep links or share links | app/page.js:1-27; lib/fly/fly-pins.js (installUrlFlags) | RL-4 |
| P-42 | Social/Share | medium | S | Share metadata points at a legacy domain and has no image | app/layout.js:28-39; public/manifest.json:4 | RL-5 |
| P-43 | Social/Share | high | M | Photo mode is minimal and exports a raw PNG; no clips | components/fly/hud/PhotoModeBar.jsx:40-99; EXPLORER_BETA.md:62-69,327-328 | LT-6 (hi-res); rest backlog |
| P-44 | Social/Share | high | L | No async social: no leaderboards, ghosts or challenges | EXPLORER_BETA.md:327-328; FLY_FLEET_AND_ADVENTURES.md:404 | Backlog |
| P-45 | Release readiness | critical | L | No commercial rights to the core data (imagery, traffic, weather, tiles) | EXPLORER_PROVIDERS.md:7-15,59-61; FLY_FLEET_AND_ADVENTURES.md:389-404 | Backlog |
| P-46 | Release readiness | critical | XL | No accounts, cloud saves, server entitlements or checkout | lib/fly/content-access.mjs:14-25; FLY_FLEET_AND_ADVENTURES.md:310 | Backlog |
| P-47 | Release readiness | high | S | The paid offer is undefined | lib/fly/content-access.mjs:3-11; README.md:18-20 | RL-7 (offer as data) |
| P-48 | Release readiness | high | M | Analytics only covers adventures; no error telemetry | lib/fly/adventure-analytics.js:2-3,22-25; components/fly/hud/GuestSaveControls.jsx:41 | RL-6 |
| P-49 | Accessibility | high | M | No gamepad, no key remapping; WASD is layout-dependent | lib/fly/input-controller.js:179-190,307-308; EXPLORER_BETA.md:327-328 | Backlog |
| P-50 | Accessibility | medium | M | No text size, UI scale or colour-vision options | components/fly/hud/Logbook.jsx:366,374,462; components/fly/hud/Logbook.jsx:444,493-495 | Backlog |
| P-51 | Accessibility | medium | L | English only, imperial aviation units only | lib/fly/ops-labels.mjs (fmtKt/fmtFt/fmtFpm); components/fly/hud/OperationsHUD.jsx:75 | Backlog |
| P-52 | Mobile UX | medium | M | Mobile flight has no tilt steering or haptics | lib/fly/lounge/touch-motion.mjs; lib/fly/lounge/haptics.js:11-58 | Backlog |
| P-53 | Mobile UX | high | M | No physical-device acceptance for phone flight or the phone lounge | MOBILE_ENHANCED_VISUALS.md; FLY_LOUNGE_MOBILE.md:329-361 | W0.6, run list (iPhone only, D7) |
| P-54 | Mobile UX | low | S | Installable manifest but no service worker, install prompt or offline shell | public/manifest.json; app/layout.js:20-27 | RL-8 |
| P-55 | Mobile UX | low | S | The panorama tour never moves on its own on phones | lib/fly/title-tour.js:26; FLY_TITLE_CINEMA.md:56-61 | Backlog |
| P-56 | Reliability | critical | L | Recurring stalls and first-use shader waits are felt by players | EXPLORER_BETA.md:226-235,273-280; FLY_OBSERVATION_LOUNGE.md:671-682 | FR-1, FR-2, FR-3 |
| P-57 | Reliability | high | M | Local-only saves are fragile and backups are manual | components/fly/hud/GuestSaveControls.jsx:19-44; lib/fly/save-backup.mjs:47-50 | RL-10 |
| P-58 | Release readiness | critical | M | Not accepted for release: zero human playtests, red gates, scattered open owner checkpoints | EXPLORER_BETA.md:7-12,282-293; FLY_FLEET_AND_ADVENTURES.md:266-275 | RL-1, section 2, section 9 (playtests: backlog) |
| P-59 | Release readiness | low | S | Agent onboarding docs are stale for a five-agent pass | CLAUDE.md:1-60; EXPLORER_BETA.md:5-6 | W0.7 (record and banner); ARCHITECTURE.md backlog |
| P-60 | Watch an Airport | medium | S | The lounge's best moments rely on owner checks that never happened | FLY_OBSERVATION_LOUNGE.md:645-650; FLY_PLAY_PASS.md:205-210 | Run list item 4; rest backlog |

### A.2 Look, tech and devices

| ID | Area | Sev | Effort | Gap | Evidence | Where |
|---|---|---|---|---|---|---|
| R-01 | Release readiness | critical | S | CI has failed on every push: npm audit criticals (next 16.4.0, dompurify) block the whole pipeline | gh run view 40962066052 --log-failed (npm audit report); gh run list: 0/49 success | W0.1 |
| PF-01 | Performance | critical | L | First-use shader program links stall the frame for seconds | EXPLORER_BETA.md 'Live-provider diagnostic and corrections' (getProgramInfoLog ~20 s, 4.18 s calls); FLY_GATE_TO_GATE.md W4 N record (4-12 s program links) | FR-1, FR-2, FR-3 |
| PF-02 | Performance | critical | L | Endurance gate still red: >100 ms stalls, slow transfers, p99 over target | EXPLORER_BETA.md 'Live-provider diagnostic and corrections'; EXPLORER_BETA.md acceptance table (60 fps target; twenty-minute routes) | FR-7 |
| D-01 | Release readiness | critical | M | No physical phone, tablet or integrated-GPU device has ever reported | TRUE_EARTH_PASS.md 'Owner run list (Phase 0)' item 1; FLY_ROUND24.md §6 'User checkpoints — ALL PENDING' | W0.6, FR-4, run list |
| PF-05 | Performance | high | S | Governor treats a 30 Hz-capped display (iOS Low Power Mode, battery saver) as overload and walks to Low for good | lib/fly/fly-constants.js:4592-4611; lib/fly/perf-governor.js:200-208 | FR-5 |
| PF-03 | Performance | high | M | Draw-call budgets exceeded at hubs, in cities and on phones | EXPLORER_BETA.md 'Live-provider diagnostic' (378 > 375); FLY_GATE_TO_GATE.md 'The BEFORE baseline' | FR-4, CT-3 |
| PF-04 | Performance | medium | S | Budgets are inconsistent and the High frame budget cannot be met on a 60 Hz display | lib/fly/tier-budgets.js:7-11; lib/fly/cinema-profile.js:4-8 | FR-6 |
| PF-06 | Performance | high | M | Texture memory over ceiling with no in-app census; phone memory unknown | GROUND_NIGHT_MOBILE.md 'Open acceptance items'; lib/fly/device-report.js:101 (textureBytes: null) | FR-4 |
| PF-07 | Performance | high | M | Slow transfers and boot; no asset caching or service worker | EXPLORER_BETA.md 'Live-provider diagnostic' (transfers, cold hold); lib/fly/fly-constants.js:7297-7303 (LOAD_GUARD caps) | RL-8 (static cache); FR-7 (transfers) |
| PF-08 | Performance | medium | M | About 100 ms hitches while turning, on phone emulation and desktop | MOBILE_ENHANCED_VISUALS.md final sequential moving-flight table; FLY_RENDER_OPTIMIZATION.md 'Ordinary moving flight' table | FR-8 |
| PF-09 | Reliability | medium | S | PoiLetters elevation queries fail a three-tile console.assert about 6 times a second | FLY_PLAY_PASS.md 'Known issues and follow-ups' (Assert flood); components/fly/PoiLetters.jsx:167 | RL-9 |
| PF-10 | Performance | medium | L | Shader-variant and code growth from never-retired flags | lib/fly/living-world.js:1-13; MOBILE_ENHANCED_VISUALS.md 'Main push verification' (53 flags) | Backlog (retirement wave); 8.3 deletes superseded flags |
| PF-11 | Performance | low | M | Frame pacing on high-refresh displays and the unused fixed-step interpolation | lib/fly/perf-governor.js:200-208; FLY_ROUND24.md §6 checkpoint 4 | FR-9 (Match display); FRAME_STEP backlog |
| L-01 | Atmosphere | high | M | Grey veil: Manhattan dissolves into uniform haze from about 8,000 ft in clear weather | FLY_PLAY_PASS.md 'Known issues and follow-ups' (Grey veil at altitude); lib/fly/fly-constants.js:1309-1314 | SK-1, SK-2, CT-1, CT-2 |
| L-06 | Lighting | high | L | Mountains cast no shadows: no terrain shadowing beyond the 3 km cascades | lib/fly/cinema-shadows.js:20-24; lib/fly/cinema-profile.js:4-8 | LT-2 |
| L-07 | Aircraft look | medium | M | Live traffic casts no shadows: arrivals touch down with no shadow on the runway | lib/fly/detailed-traffic.js:1-21,44; lib/fly/fleet-parked.js:156-157 | LT-3 |
| L-08 | Aircraft look | medium | S | The player aircraft receives no shadows (no wing or tail self-shadowing) | components/fly/PlayerPlane.jsx:269-270; TRUE_EARTH_PASS.md 'Phase 2' TERRAIN_SHADOW bullet (PlayerPlane receives shadows) | LT-4 |
| L-05 | Lighting | medium | M | The moon is fake: always full, always opposite the sun at a fixed elevation | lib/fly/sun-model.js:173-190; lib/fly/immersive-cloud-pass.js:607 | SK-3 |
| L-12 | Atmosphere | high | M | Live weather feeds only total cloud cover; humidity, cloud layers and freezing level are faked | app/api/weather/route.js:17-22,156-157; lib/fly/weather-model.js:51-59 | Backlog (D13, provider first) |
| L-04 | Atmosphere | medium | M | No high cloud: CIRRUS off because its filaments read as a lattice | lib/fly/fly-constants.js:7804-7822; FLY_LIVING_WORLD.md 'What the survey found' and 'Flag state at the close' | Backlog (D13) |
| L-02 | Lighting | medium | L | Crepuscular rays off: screen-space shafts darkened sunlit valleys | lib/fly/fly-constants.js:7826-7845; FLY_LIVING_WORLD.md 'Results (2026-10-20)' | Backlog (D10) |
| L-03 | Lighting | low | S | Lens flare off by owner taste | lib/fly/fly-constants.js:7846-7849; FLY_LIVING_WORLD.md flag table ('whether it belongs at all is the owner's call') | SK-5, 8.3 (D10) |
| L-09 | Lighting | high | M | Night from altitude on phones and Low is nearly black beyond the near ring | lib/fly/fly-constants.js:7947-7960; components/fly/FlyScene.jsx:3768-3769 | CT-4 |
| L-10 | Lighting | low | S | Night city tuning: far lights brighter than the ground below; pale at dusk; windows never change | FLY_LIVING_WORLD.md 'Owner checkpoints'; lib/fly/night-lighting-policy.js:30-45 | CT-5 |
| L-11 | Terrain | medium | L | Photographic ground: baked capture shadows, seasons and capture swaps fight the live sun | FLY_ROUND24.md §6 checkpoint 3; lib/fly/earth-surface-material.js:219-295 | Backlog |
| L-13 | Atmosphere | medium | M | No snow cover or wet surfaces in flight | lib/fly/fly-constants.js:8236-8248; app/api/weather/route.js:148-157 | Backlog (D13) |
| L-14 | Atmosphere | low | L | No storms: no towering cumulus, cumulonimbus or lightning | app/api/weather/route.js:17-22; lib/fly/living-clouds.js | Backlog (D13) |
| L-15 | Takeoff & Landing | high | L | Airports at night in flight: no approach lights, PAPI or landing-light pool | lib/fly/fly-constants.js:7470-7490; lib/fly/fly-constants.js:7527-7537 | Backlog (Takeoff & Landing) |
| L-16 | Image quality | medium | S | Aliasing: SMAA only, and Ultra cannot supersample on DPR-1 monitors | lib/fly/render-resolution.js:9-13; lib/fly/fly-constants.js:15-22 (CANVAS dprMax/ultraDprMax) | FR-12 |
| L-17 | Lighting | medium | S | Short shadow reach at city altitudes on Medium and phones | lib/fly/cinema-profile.js:4-8; lib/fly/fly-constants.js:8273-8286 | LT-5, LT-1 |
| L-18 | Title/Hangar | low | S | Hangar lighting: light liveries blow out; the reflector renders the hangar twice | FLY_LIVING_WORLD.md 'Owner checkpoints'; lib/fly/fly-constants.js:8043-8056 (HANGAR_STAGE) | LT-7 |
| L-19 | Social/Share | high | M | Photos export at drawing-buffer size, about 1055×487 on a phone; PHOTO_V2 never built | components/fly/PhotoCapture.jsx:79-86; MOBILE_ENHANCED_VISUALS.md 'Verification' (1055×487 buffer) | LT-6 |
| L-20 | Image quality | low | XL | No HDR display output | CINEMATIC_EARTH_OVERHAUL.md 'September 30, 2026: HDR graphics pass' | Backlog |
| D-02 | Mobile UX | medium | S | iPhone start tier depends on hints Safari does not provide reliably | lib/fly/fly-settings.js:41-50; lib/fly/device-tiers.js:23-31 | FR-10 |
| D-03 | Desktop UX | medium | S | Mac classification: Safari's masked 'Apple GPU' becomes Medium; Chrome on M-Pro/Max boots Ultra at DPR 2 | lib/fly/device-class.js:50-75; lib/fly/render-resolution.js:9-13 | FR-10 |
| D-04 | Mobile UX | high | L | Phone look parity: phones get a much plainer Enhanced | lib/fly/fly-constants.js:7783-7786; lib/fly/fly-constants.js:7947-7960 | SK-4, CT-4, LT-1 |
| D-05 | Mobile UX | medium | M | Device gating is inconsistent across features | lib/fly/device-class.js:18-43; lib/fly/airframe-detail.js:522-524 | FR-11 |
| D-06 | Mobile UX | low | S | iPads, including M-series, run the phone graphics profile | lib/fly/render-resolution.js:9-13; lib/fly/cinema-profile.js:37-45 | FR-10 (physical iPad: backlog) |
| D-07 | Mobile UX | medium | S | No battery saver, frame cap option or thermal awareness | components/fly/FlyCanvas.jsx:40,119-125; lib/fly/frame-cadence.mjs:4-17 | FR-9 |
| D-08 | Mobile UX | medium | M | Installable but not offline: no service worker, no install prompt | app/layout.js:19,54-72; public/manifest.json | RL-8 |
| D-09 | Mobile UX | high | S | Safari depth precision unknown; the fallback plan was never built | components/fly/FlyCanvas.jsx:176-200; lib/fly/toy-world/world-bend.js:529-542 | W0.6, FR-13 |
| D-10 | Mobile UX | medium | M | Android untested: Mali and Adreno performance, Chrome specifics, Back in flight | EXPLORER_BETA.md acceptance table; FLY_LOUNGE_MOBILE.md 'Owner checkpoints' (Android) | Backlog (no Android device, D7) |
| D-11 | Mobile UX | low | M | Extra WebGL contexts for the hangar and inspect turntable | components/fly/hud/HangarScene.jsx; components/fly/hud/inspect/ModelTurntable.jsx | FR-4 measures; fix only if material |
| R-02 | Reliability | high | M | Pre-existing red gates block a green beta suite | FLY_PLAY_PASS.md 'Pre-existing reds' table; scripts/beta-checks.mjs:4-7 | RL-1 |
| R-03 | Reliability | medium | M | ESLint debt: 28 errors in FlyScene.jsx plus lounge and PoiLetters errors | FLY_PLAY_PASS.md 'Verification on the merged main' (ESLint 28); FLY_LOUNGE_MOBILE.md 'Known issues' | 8.3 (FlyScene); streams keep zero new errors |
| R-04 | Reliability | medium | S | Gate sprawl: 1,360 scripts and no single 'what to run' manifest | ls scripts \| wc -l = 1360; scripts/beta-checks.mjs:4-7 | W0.5 |
| R-05 | Release readiness | low | S | Records drift: contradictory and stale guidance | CLAUDE.md:1-45; AGENTS.md:1-40 (lacks the 2026-10-20+ notices) | W0.7 |
| R-06 | Release readiness | critical | L | Commercial use of providers is unresolved (cross-cutting) | EXPLORER_PROVIDERS.md provider table; EXPLORER_BETA.md 'Known limits before acceptance' | Backlog (owner: provider contracts) |
| A-01 | Release readiness | medium | S | The device-report FLAGS literal and the TRUE EARTH tail are guaranteed merge-conflict points | lib/fly/device-report.js:12-18,35; scripts/verify-true-earth-flags.mjs (6) and (7) | W0.2 |
| A-02 | Release readiness | medium | M | Hot files without seams: FlyScene's frame block, Effects.jsx, world-bend.js | components/fly/FlyScene.jsx:226-238,3738-3749,3540-3585; components/fly/Effects.jsx:186-300 | W0.3, section 7 |
| A-03 | Release readiness | high | S | The venue split: look and performance work needs the owner's GPU; the cloud container cannot run the app | FLY_LIVING_WORLD.md 'Handoff (2026-10-20)'; CLAUDE.md notices ('Environment truth') | D5 venue, section 3.1 |
| A-04 | Release readiness | low | S | Pre-marker tunables cannot be changed without breaking flag-off identity | lib/fly/fly-constants.js:1309-1314; lib/fly/fly-constants.js:3214-3272 | Rule 3.2 |
| F-01 | Takeoff & Landing | high | XL | Gate to Gate W1-W3 and W5 never built: 13 flags are contracts with no consumers | FLY_GATE_TO_GATE.md 'Ownership per wave'; lib/fly/camera-director.js (44 lines) | Backlog (Takeoff & Landing) |
| F-02 | Social/Share | medium | XL | No replay or clip export | lib/fly/fly-constants.js:7658-7671 (REPLAY); TRUE_EARTH_PASS.md 'Phase 4' REPLAY | Backlog |
| F-03 | Desktop UX | medium | S | Three looks are player-facing but only Enhanced gets new work | lib/fly/fly-constants.js:7305-7316; lib/fly/player-surface.js:1-27 | RL-3 |

### A.3 Mode scorecard (product audit)

| Mode | Score | Strengths | Weaknesses | Missing from the core loop |
|---|---|---|---|---|
| Free Flight | 6/10 | Real satellite Earth at true scale, live ADS-B traffic, a calm Explorer HUD (CALM_HUD) with Instruments/Clean modes, an Atlas with about 1,700 cities, 123 landmarks, 30 hotspots and 63 military bases, a fly-alongside escort with a photo-ship camera and a 'Flight memory saved' payoff (ENCOUNTER_FEEL), photo composition, 13 aircraft with 39 free presets. | No visible goals: the contracts zone is hidden until the first score (calm-hud.css:444-446). Points have nothing to spend on. Only 12 discoveries worldwide (encounters.mjs:8-11). Nearby offers come every 3 minutes at most, and the escort flies itself ('Let the escort fly it for you', EncounterExperience.jsx:530). Journal places are stored as coordinate strings. Warps take 8.8–14.3 s. An arcade layer (crashes ON, combos, near-miss, buzz-tower contracts) clashes with the calm explorer tone. | Minute to minute: steer with the mouse, look at scenery, sometimes warp in the Atlas, sometimes accept a Nearby invite, which then autopilots for 30 s. What's missing is a reason to go somewhere next (visible goals, a 'next up' suggestion, discoveries near every featured place), a skill payoff (hand-flown formation, landing at the end of a trip) and a meta reward that builds. |
| Guided Journeys | 5/10 | Six illustrated briefings, four ordered discoveries per route, optional gold-gate and photo activities, Bronze/Silver/Gold medals, nine earned liveries previewed on the aircraft, a debrief with your photo, retry and resume, checkpoint saves, a library sheet in the cinema style. | Total content is about 40 minutes (adventures.mjs, 5–7 min each). Journeys always run on the live clock and live weather (adventure-runtime.js:32 forces 'live'), so the authored conditions are unused and a nature route can be pitch dark. It is no longer the first-run path (the cinema title sends new players to 'Fly here' Free Flight). There is stale copy ('Nine ways to fly there' with 13 aircraft). Captions are one line and the cues are synth. Backlogged in the Play Pass. Zero human playtests. | Fly to a ring, read a one-line caption, optionally fly gates or take a photo, finish in about 6 minutes. Missing: enough routes for a second week, narration and music that make each discovery an event, a choice of light (best at golden hour or night), and a link from finishing a journey into the wider game (next unlock, rank, share card). |
| Watch an Airport | 7/10 | The most polished mode. A pier lounge with a second level, free walk and vantage seats, binoculars that auto-frame and hold steady, a 'Next movement' cue with an off-screen locator, 'Watch for me' auto director with lower thirds, touchdown/airborne moments, a live board, a living apron in rain and at night, 180 destinations across 7 regions plus golden-hour picks, a spotter card with photo and route, Join flight, and phone/tablet support (LOUNGE_MOBILE, 2026-10-29). | Spotting does not count here: logSpot is skipped while the lounge is active (FlyScene.jsx:2223, InspectModal.jsx:157, front-door.js:58, plan rule 'no rewards from the lounge'). Photos are not journaled (PhotoCapture.jsx:89,122-124). No recents, favourites or Continue. Empty or quiet boards with no routing to busy airports. No touchdown sound. LOUNGE_BRIDGE is off. Iconic spotting spots are not featured. First-visit shader stalls of 4–12 s and OSM waits of 10–15 s. | Pick an airport, sit, wait for the cue, press N or H, watch a touchdown, repeat. Missing: a collection that grows (types, airlines and airports watched, a spotter streak), sound for the payoff (chirp, reversers, rollout), a way to find action when your airport is quiet, and a reason to return to a favourite airport tomorrow. |
| Takeoff & Landing | 3/10 | A worldwide runway catalogue (14,094 runways), three authored aprons with taxi paths (KOSU, KCMH, KLCK), approach guidance with a glide-path dot and plain-English cues, go-around and practice-final options, a phone flight deck. Gate-to-Gate W0 contracts (flags, service, ops split, telemetry, flight-history v2, camera-mode) are on main. | 13 of the 15 G2G flags are off, and W1–W3 and W5 were never built (no flight-deck/, debrief/, landing-grade.mjs, ops-audio.js, ops-journey.js or replay/). The title promises 'gate to gate' (CinemaTitle.jsx:671). The panel is a web form with a select, a range and a details element (OperationsHUD.jsx:76-90). The grade is one word, and the history is written but never read. Catalogue airports are bare grey slabs. There is no smoke, chirp or shake at touchdown, and a gear-up landing grades 'Smooth'. | Search a runway, pick a start, line up, rotate, fly, follow the cue, land, read one word. Missing: feel (spool, flare, ground effect), drama (camera beats, smoke, sound), a graded debrief with a touchdown photo and per-airport bests, curated challenge airports, and a reason to try 'one more landing'. |
| Front door (title, hangar, journal, settings) | 6.5/10 | A cinematic window-seat title with a live tour, shade transitions, a boarding-pass Continue, a route map and UI sounds; hangar inspection views and a livery picker; settings for quality, visuals, map style, HUD, chase framing, stakes, reduced motion, sensitivity, invert pitch and volumes; guest backup export and import. | Names don't match (Travel journal / Pilot Logbook / Logbook; Guided Journeys / Adventures). The hangar is a mandatory stop before every flight. The tips are five passive text cards. The journal header counts spots, and its tabs repeat each other. 'Day' map style also shows night. There is no Continue for the lounge. The mobile note shows to the wrong audience. | The title sells four modes well, but it doesn't show the player's own progress: no rank, no 'today' card, no daily, no 'golden hour at JFK now'. |
| Phone experience (all modes) | 5/10 | One device contract (useDeviceLayout); touch stick and throttle; an Actions panel; a phone flight deck for operations; the lounge on phones with gestures, a portrait binocular view, haptics on Android and Android Back; 44 px targets; solid surfaces. | No physical-device acceptance anywhere: MOBILE_ENHANCED is off, city draws are 284/285, about 100 ms turning hitches remain, and iPhone haptics are silent. Flight has no tilt steering and no haptics. The title tour never auto-advances on phones. A PWA manifest exists but there is no service worker or install prompt. The three red mobile gates are pre-existing. | Phones get the full desktop design squeezed down. A phone-native loop (short 'Watch for me' sessions, tilt-to-fly sightseeing, share to Photos) is not designed. |

## Stream reports

(Each stream writes its section here in its first commit: what landed, flag state, gates, 5080 evidence, owner checks, known issues. A stream edits only between its own two markers.)

### FRAME

<!-- SHIP PASS FRAME report begin -->
**Status (2026-10-30): BUILT on `ship/frame`; SHADER_READY and PACE_ADAPT ON; production smoke 50/50; remaining browser evidence in progress (continuation agent after an API-limit cutoff).**
Venue: the cloud container (section 3.8) — offline world fixture + SwiftShader,
no RTX 5080, no iPhone. Nothing below is a device number; every fps, stall,
soak, motion and device acceptance row is the owner's (run-list steps below).
A continuation agent picks up from this report and `git log ship/frame`.

#### Per requirement

| ID | State | What landed | Evidence (venue) |
|---|---|---|---|
| FR-1 | built | `lib/fly/program-census.js`: hooks `renderer.info.programs.push`/`pop` (instance properties of that one array) and each new program's first `getUniforms`/`getAttributes` (restored after the first call), so it costs nothing per frame. `__flyStats.census.programs = {total, live, preReveal, afterReveal:[{key, ms, t, waitMs}], afterRevealCount, firstUseMs, worstMs, linkFailures}`; `key` = `<type>[:name]#fnv1a(cacheKey)`. A failed link (three's diagnostics, else LINK_STATUS read after the link landed) → `track('client_error', {kind:'shader_link'})`. DiagnosticsPanel row "late shaders"; device report `census`. Installed with SHADER_READY, `?diag=1` or automation. | `verify-ship-frame` FR-1 (a)–(e) |
| FR-2 | built | `lib/fly/shader-ready.js`: `gl.debug.checkShaderErrors = false` only with SHADER_READY on, a production build and `navigator.webdriver` not true; dev and every harness keep `true`. Applied first thing in FlyCanvas `onCreated` (`installFrameRenderer`, `lib/fly/census.js`), before any program exists; flag off never writes the field. | `verify-ship-frame` FR-2 (a)–(c) (all 8 combinations); production smoke 50/50: the player arm reads `false` against `next start`, every automated arm `true` |
| FR-3 | built | `lib/fly/registry-warm.js` + `prewarm.js queueRegistryWarm` + `PrewarmRig`: every `prewarmEntries()` entry that `entryReachable()` allows here (tier/preset, `deviceClassOf()`, `shipPassOn`) is compiled against the LIVE scene under the 1×1 target binding (production's key) and RETAINED (refcount); the boot tier rides the boot drain, the lower ladder tiers queue after it on idle frames, and a tier/preset step, a late registration (2 s rescan: covers the title) and a new `scene.environment` (the day/night bucket) queue whatever is missing. Empty registry = no-op; a throwing entry is counted, never thrown; a restored context drops the retained set. `__flyStats.prewarm.registry`, and the live consumer state at mount as `__flyStats.prewarmRegistry` (the `prewarm` record itself still appears only when the boot warm finishes, which verify-settle reads as its completion time). A harness-only probe entry (`window.__flyRegistryProbe = true` → `FRAME:registry-probe`, a box with a define no app material has) lets the browser smoke watch the consumer see, judge and queue or compile an entry; the app never sets it. ENV_UNIFORM is now read through its pin in prewarm.js / PrewarmRig, so `?flags=ENV_UNIFORM` A/Bs its two prewarm halves (the constant is untouched). | `verify-ship-frame` FR-3 (a)–(g) |
| FR-4 | built | `lib/fly/render-census.js` + `components/fly/CensusRig.jsx`: per-layer draws/triangles through `renderBufferDirect` (nearest named ancestor, else `<top type>~<material>`; shadow-map draws `shadow/…`, other scenes `pass/…`), `__flyStats.census.layers` with three's whole-frame totals beside it for the 2% check; logical texture + renderbuffer bytes from the allocation calls on the context instance (FlyMode's opt-in probe promoted to a live counter), RGBA16F count/MiB/top-8, unknown-format count, `__flyStats.census.textureBytes`; device report `renderer.textureBytes` (TRUE EARTH left it null). The per-draw instruments install only with `?diag=1` or automation, so a player never pays per draw. | `verify-ship-frame` FR-4 (a)–(b); browser smoke |
| FR-5 | built, flag ON | `lib/fly/pace-adapt.js` + governor (PACE_ADAPT): `refreshSnap` with 30/48/50 (`PERF_GOVERNOR` untouched); a mid-session cadence lock (90-frame window on 33.3 ms ± 2.5, σ ≤ 2.5 ms, the frame's own work ≤ 60 % of the interval, measured end-of-frame by `PaceClock`) with a CANDIDATE that defers a down-step while the window decides; the lock is trusted on touch devices, Battery saver or a 30 Hz boot (`lockDesktop` false: a GPU-bound desktop also quantizes to 33.3 ms and GPU time is not readable everywhere); re-estimate on `visibilitychange`; the stutter window resets when the boot estimate re-aims the target. Governor state, cadence, lock and boot rung in the device report (`pacing`). | `verify-ship-frame` FR-5 (a)–(g): 30 Hz held at rung 0 for 5 simulated min (target 30); the flag-off control steps to Low (PF-05 reproduced); 45 ms frames at 30 Hz step; touch lock holds, desktop and busy 33 ms frames step; holds freeze both ways |
| FR-6 | built, provisional rows | `lib/fly/tier-budgets.js` is the ONE table (`BUDGET_TABLE`: ultra/high/medium/phone/tablet/low; draws, triangles, texture MiB, geometry MiB, GPU ms, stalls/min, missed share; every row `provisional:true` with `sources`). `cinema-profile.js` budgets (verdict thresholds only; every rendering field identical), `device-report.js`, `verify-device-report.mjs`, `beta-soak.cjs`, `analyze-beta-soak.mjs` read it; `budgetFor(profile)` (section 6). Frame time graded as the share of frames over 1.5× the target interval (`missedShare`; report `frame.missed`), p95/p99 kept as information. Conflicts → stricter: High 375 / 2.2 M (not 450 / 4.0 M); phone 250 / 1.2 M (not cinema-profile's 375 / 2.2 M). `node scripts/derive-budget-table.mjs <reports> --write` re-derives rows (peak + 5 %) after W0.6. | `verify-ship-frame` FR-6 (a)–(e); `verify-device-report` 5/5 (new: a 60 Hz report with no missed vblank passes; the miss rule) |
| FR-7 | instrument built; one fix ON, root causes owner | `lib/fly/stall-classify.mjs` + `lib/fly/stall-census.js`: every >100 ms interval classified (program link, tile upload, worker finalize, GC, React commit, else unattributed) from the program/upload rings, markPhase tags, JS heap drop and Long Animation Frame scripts; `beta-soak.cjs` writes the tally (`stalls`, `programs`, budget limits) and `analyze-beta-soak.mjs` reports `stallPhases`; the tally covers the WHOLE session (an interval leaving the 64-interval ring is classified and folded in; the fixture soak recorded 182). `BETA_SOAK_FIXTURE=1` is the instrument-proof mode for this venue (exit = no uncaught errors and every interval in the tally). Fix behind PACE_ADAPT: `sliceBar` (the post-reveal prewarm slice bar follows the target: 24.2 ms at 60 = today, 48 ms at 30, where a 30 Hz page used to wait 20 s and then drain on 50 ms frames). The other root causes need the 5080 trace (owner). | `verify-ship-frame` FR-7 (a)–(d); 2-minute fixture soak (Browser evidence): 0 page errors, the phase tally filled (worker-finalize dominant, 0 unattributed) |
| FR-8 | harness built; budget ships OFF | `scripts/verify-ship-frame-yaw.cjs`: 360° yaw at the Battery (Manhattan, in the fixture), 900 m, desktop or `--device=phone` (iPhone 13 emulation), per-frame arc; records longest interval, `lastStall.phases`, stalls by phase, programs first used during the turn, peak draws; `--strict` enforces 50 / 67 ms on a real GPU only. `lib/fly/turn-budget.js` + `finalize-pace.js setTurnBudgetK`: `PACE_ADAPT.turn` scales the shared finalize allowance (chunk mounts) while yawing > 25°/s, fed from the FlyScene FRAME frame block — SHIPS OFF (only a turn measurement on the 5080/iPhone can show the benefit). COMMIT_BUDGET, TERRA_PACE and atlas uploads are read inside engines FRAME does not own (contract request below). Chunk-material prewarm: the yaw records which programs compile mid-turn; none can be named without that run on a real GPU. | `verify-ship-frame` FR-8 (a); `verify-finalize-pace` 22/0; phone-emulation yaw: see Browser evidence |
| FR-9 | built, ON with PACE_ADAPT | `lib/fly/frame-api.js` implemented: `setFrameCadence` persisted under `fly-frame-rate-v1`, `holdGovernor` OR'd into the governor's pin (both ways; live regardless of flags), `frameSessionSummary` (p95 bucket, stalls/min bucket, rung). `presentationFps`: Battery saver pumps 30 + the phone-lean floor (`setCinemaEffectFloor`), '60' caps a >65 Hz desktop at 60 (D12) and leaves 60 Hz alone, Match display renders native (refresh/2 on Ultra ≥ 100 Hz); `PaceClock` probes the display rate. Settings rows in the FRAME blocks (desktop "Frame rate: 60 / Match display", touch "Battery saver"), `frameRateMode` store field + setter, `BatterySaverHint` (FlyMode FRAME mounts) through `publishNotice`/`wakeHud` when the governor latches low or after 10 min of Watch for me (shown once the flight HUD is visible). `window.__flyFrame` for the console. | `verify-ship-frame` FR-9 (a)–(d), FR-5 (g) |
| FR-10 | built, DEVICE_POLICY OFF | `lib/fly/gpu-benchmark.js`: fill + 48-step cloud march on a throwaway WebGL2 context, doubling batches to 40 ms, ≤ 1.5 s total (a doubled batch that would end past the cap is never issued), TIME_ELAPSED timer query where exposed (wall time to a readPixels sync elsewhere), cached per device and app version; a software renderer is not measured (fixed low score: decideStart starts it at Low anyway, and the venue's SwiftShader spent 1,991 ms measuring); `decideStart` (grade → start tier, preset, Ultra DPR cap 1.5 unless 'high', tablet desktop effects). Wired into the FRAME start-tier block, `render-resolution.js` and `cinema-policy.js`; report `devicePolicy`. Thresholds PROVISIONAL (DEVICE_POLICY.benchmark). | `verify-ship-frame` FR-10 (a)–(d) (12-row decision table; the software skip and the session cache with the flag on); policy smoke arm (Browser evidence) |
| FR-11 | built, live regardless of the flag | `lib/fly/device-policy.js`: frozen signatures kept; every W0 seed row answers exactly its W0 answer with no score, except the ONE sanctioned move LIGHT asked for (PHOTO_HIRES touch `maxScale` 2 → 3; `maxLongPx` stays 4096); score-aware tablet rows; FRAME rows BATTERY_SAVER, MATCH_DISPLAY, CADENCE_LOCK, DYNAMIC_NEAR; `devicePolicyReport()`. Class order: a touch device is phone/tablet even on a software renderer (emulated phones get the phone policy; a real phone never has a software renderer). LIGHT's class pin: `window.__flyDeviceClassOverride = 'phone'\|'tablet'\|'igpu'\|'dgpu'\|'software'` makes `deviceClassOf()` (and so every `deviceFeature()` row) answer that class; any other value is ignored, `ctx.cls` still wins, and device-class.js's tier resolution is untouched. | `verify-ship-frame` FR-11 (a)–(f): 14 features × 5 classes × 3 tiers × 2 presets; 300 seed answers identical to W0 (12 moved by the sanctioned PHOTO_HIRES row, asserted exactly); (e) a 585×1266 phone buffer exports 3,798 px ≥ LT-6's 2,560 (cap 4096); (f) the pin for all five classes, an unknown value ignored, `ctx.cls` precedence; the raw-call grep (count per file may not grow) |
| FR-12 | built, OFF | `ultraSupersampleScale()`: 1.5× on a DPR-1 display at Ultra with a dGPU and a 'high' benchmark (needs DEVICE_POLICY); the governor makes it the top rung, shed first. | `verify-ship-frame` FR-12 (a)–(b) |
| FR-13 | built, DEVICE_POLICY sub-switch (OFF) | `lib/fly/dynamic-near.js`: near = clamp(0.02·AGL, 2.5 m, 60 m), only where `gl.capabilities.reversedDepthBuffer` is false, from the FlyScene FRAME frame block (the lounge keeps its own near plane). Every reversed-depth renderer (the 5080, desktop Chrome) never runs it; no iPhone report exists, so whether it ever runs on Safari is the owner's W0.6 report. Phone horizon cap: not built (only if that report needs it). | `verify-ship-frame` FR-13 (a)–(b) |

#### Flags

| Flag | State | Why |
|---|---|---|
| SHADER_READY | **ON** | FR-1/2/3 node gates green and the production smoke 50/50 (`smoke-prodC2.log`, below); behaviour, not pixels: no shader text or program key moves (`verify-ship-frame` flags (c)). `?flags=-SHADER_READY` is the W0 renderer for one page load. |
| PACE_ADAPT | **ON** | FR-5 node gate green (30 Hz held at rung 0 for 5 simulated minutes; a 30 Hz overload still steps). `?flags=-PACE_ADAPT` is W0 pacing for one page load. Sub-switches: `sliceBar` ON (its 60 Hz value is today's 24 ms bar), `turn` OFF (only a 5080/iPhone turn measurement can show its benefit), `lockDesktop` false (a GPU-bound desktop also quantizes to 33.3 ms). |
| DEVICE_POLICY | OFF | The boot benchmark and the FR-13 fallback change what real devices do; the owner's reports decide (thresholds provisional). `deviceFeature()` is live regardless. |
| ULTRA_SUPERSAMPLE | OFF | 5080 only (boot at 1.5 on 1440p, shimmer metric). |

Flag-off identity: `verify-ship-frame` flags (b) — 576 `resolveCinemaProfile`
answers and every profile identical to W0 in every rendering field; (c) no
`onBeforeCompile`/`customProgramCacheKey`/shader-text edit in FRAME's diff;
`verify-ops-golden` 28/28. **Merged-tree note:** flags (c) and FR-11 (d) used to
diff all of `lib/`/`components/` against the merge-base, so on the lead's trial
merge of all five branches flags (c) went red on LIGHT's
`earth-surface-material.js` shader edits. Both now read only the diffs of the
non-merge `Ship Pass FRAME` commits since the merge-base (`frameDiff` in the
gate), so they hold on the merged tree (on `main` after the merge there is
nothing of FRAME's left to diff, and they pass trivially).

#### Gates (venue)
`verify-ship-frame` 55/55 · `ship-pass-gates` 32 PASS, 2 KNOWN-RED (RELEASE's), 0 FAIL, 4 SKIP, seam rule PASS (44 files) ·
`verify-device-report` 5/5 · `verify-device-tiers` 6/6 · `verify-render-optimization` 22 ·
`verify-cinema-overhaul` 16/16 · `verify-graphics-governor` 14/14 (was red) · `verify-finalize-pace` 22/0 ·
`verify-cinema-profile-prewarm` 7/7 · `verify-graphics-repair` 8 · `verify-ops-golden` 28/28 · `graphics-unit` PASS ·
`verify-true-earth-flags` 8/8 · `verify-import-integrity` 4/4 · `verify-frame-step` 11/11 (see Reds) — all with PACE_ADAPT and
SHADER_READY on. ESLint over all 42 changed source files: 34 errors now, 34 on main, no file gained one.

#### Browser evidence (fixture + SwiftShader; functional only)
All under the heavy lock on port 3131, logs in `.graphics-review/ship-pass/frame/`. No timing here is a device number.
- **Production smoke** (`smoke-prodC2.log`, `next build --webpack` into `.next-frame` + `next start`, tree `132a77f` +
  the SHADER_READY flip): `verify-ship-frame-browser --arms=off,on,player,default` **50/50**. Every arm reveals (80–101 s),
  0 page errors, 0 shader compile/link errors; program census 97–104 programs, link failures 0; layer census = gl.info
  exactly (85–107 draws); 81.5 MiB in 64–86 textures, RGBA16F 4 = 54.1 MiB; each arm resolves its FRAME flags; governor
  PACE_ADAPT per arm; the registry probe entry WARMED in on/player/default and the consumer absent in off; **player
  (navigator.webdriver hidden) reads checkShaderErrors `false`** and every automated arm `true` (FR-2); Battery saver/30
  persists and comes back to 60; the Frame-rate row present with PACE_ADAPT, absent without. This is the run that
  turned SHADER_READY on.
- **Dev smoke, first agent** (`smoke-dev.log`, `75a91d8`): `off` 10/10, `on` 10/11 — the red (consumer published only
  when the boot warm finishes) and the `policy` arm's harness crash were fixed then; the production run above is
  their re-run.
- **Dev smoke, `policy` arm** (`smoke-devA2-policy.log`, `6352af5`): 13/14 — boots, 0 page/shader errors, census, flags
  `1 1 1 1`, probe WARMED, frame-rate rows; the red was FR-10's cap: the benchmark measured SwiftShader for **1,991 ms**
  (timer query exposed, 0 GPU-timed batches, grade low) against the 1.5 s cap. FIXED in `575f9f6` (a software renderer
  is not measured; a doubled batch never runs past the cap); re-run queued (session D).
- **`verify-mobile-layout`** (`mobile-layoutA2.log`, `6352af5`, PACE_ADAPT and SHADER_READY on by default): **PASS**,
  18/18 (portrait 390×844 and landscape 844×390, overlap/overflow/44 px, zero page errors). Screenshots copied to
  `mobile-layoutA2/` (the harness rewrites the tracked `scripts/mobile-layout-*.png`; restored, not committed).
- **2-minute fixture soak** (`soak-fixtureA2.log`, `soak-fixture/soak.json`, `6352af5`, 960×540, SwiftShader): the
  instrument ran end to end — 0 uncaught errors, renderer read, two legs of samples, and the FR-7 tally: 182 intervals
  over 100 ms, the last 64 classified **62 worker-finalize, 2 React commit, 0 unattributed** (the phases named:
  `finalize:sat-roads` / `sat-skyline` / `sat-buildings`, `lod-walk`, `skirt`); 22 programs first used after the
  reveal; 94 MiB of textures. Its pass rows (p95 2,941 ms, every frame over 1.5× the interval) are SwiftShader's and
  certify nothing. The process then sat on the fixture server until the session timeout — FIXED (`575f9f6`), and the
  tally now covers the whole session; re-run queued (session D).
- **Phone-emulation 360° yaw** — first agent (`yaw-phone.log`, `75a91d8`, iPhone 13, the Battery / Manhattan 900 m in
  the fixture, 30 frames of 12°, SHADER_READY + PACE_ADAPT): YAW PASS (functional) — revealed in 31 s, 0 page errors,
  peak 117 draws at tier low, `lastStall.phases` recorded, the stall census by phase (64 worker-finalize), 2 programs
  first used during the turn. Re-run on the shipped flags (`yaw-phoneA2.log`): revealed in 53 s, then ran out of its
  300 s session slot at the default 0.5°/frame (720 SwiftShader frames at DPR 3) — not a failure of the app; re-run at
  12°/frame queued (session D).
- **ENV_UNIFORM off/on** (`env-uniform-off.log` / `-on.log`): see the ruling below.

#### ENV_UNIFORM ruling (as far as this venue shows; the 5080 half is owner)
Venue run (dev server, fixture + SwiftShader, Powell OH 900 m, satellite, all three pins released, one run per arm;
`env-uniform-off.log` / `env-uniform-on.log`):

| arm | (1) programs compiled across the dusk walk | (2) across 4 forced tier steps, shadows casting | steps accepted | page errors |
|---|---|---|---|---|
| `?flags=-ENV_UNIFORM` | 8 (123 → 131) | 3 (131 → 134) | 2/4 | 0 |
| `?flags=ENV_UNIFORM` | 5 (128 → 133) | 3 (133 → 136) | 2/4 | 0 |

**Ruling: DELETE, unless the owner's 5080 run shows otherwise.** Neither leg reaches 0 with the flag; the tier leg is
identical; the flag adds 5 programs before the walk. Its parts:
- **The equirect half is dead.** `SatEnvironment.jsx` resizes every PMREM input when `(ENV_UNIFORM.enabled || immersive)`
  and `immersive` is `IMMERSIVE.features.lighting`, hard-wired true, at `IMMERSIVE.environmentSize` 2048 (=
  `ENV_UNIFORM.equirectWidth`): IMMERSIVE already removed the dusk re-key this half was for (`verify-ship-frame` FR-3 (g)
  proves it from source). The file is not FRAME's; the deletion belongs to the close (8.3).
- **The two prewarm halves** (shadow-twin warm, environment re-queue; `prewarm.js`) act only on frames ≤ 12 ms, which
  SwiftShader never draws, so their benefit cannot be shown here. Owner, 5080: `PW_CHANNEL=chrome node -r
  ./scripts/_pw-shim.js scripts/verify-env-uniform.js` with `FLY_URL=…/?flags=-ENV_UNIFORM` and `…/?flags=ENV_UNIFORM`;
  SHIP only if (2) reads 0 with the flag and not without, else DELETE. The harness now prints, from the FR-1 program
  census, WHICH programs each leg first compiled (`(1i)` / `(2i)`): those are the variants their owners register in
  `prewarm-registry.js` so the FR-3 consumer warms them (its `env` and `tier` triggers cover exactly these two events).

#### Owner checks (section 9)
- **5080 #1 (cold boot):** `?diag=1` → "late shaders" reads `0 / N` with SHADER_READY; compare `?flags=-SHADER_READY`. FR-2 trace: `BETA_GPU_TRACE=1` soak, `getProgramInfoLog` totals default vs `-SHADER_READY`. FR-3: `__flyStats.prewarm.ms` default vs `-SHADER_READY` (boot hold ≤ +1.5 s).
- **5080 endurance (FR-7):** `BETA_CPU_TRACE=1 BETA_GPU_TRACE=1 npm run soak:beta` at Ultra and High, then `node scripts/analyze-beta-soak.mjs` → `stallPhases`; re-run uninstrumented.
- **5080 turn (FR-8):** production build, `FLY_FINALIZE_BUDGET_K=1 FLY_URL=… node scripts/verify-ship-frame-yaw.cjs --device=desktop --strict` (and `--device=phone`); A/B `window.__flyPaceAdaptOverride = { turn: { enabled: true } }`.
- **5080 #10 (Match display):** Settings → Frame rate → Match display; `__flyFrame.cadenceState()`.
- **5080 FR-12:** `?flags=DEVICE_POLICY,ULTRA_SUPERSAMPLE` at 1440p DPR 1 → boots dpr 1.5, holds it; shimmer pan.
- **ENV_UNIFORM:** `PW_CHANNEL=chrome node -r ./scripts/_pw-shim.js scripts/verify-env-uniform.js`, both arms (`FLY_URL=…/?flags=-ENV_UNIFORM` and `…/?flags=ENV_UNIFORM`); the ruling above.
- **W0.6 (FR-6):** after the 5080 and iPhone reports, `node scripts/derive-budget-table.mjs .graphics-review/device-reports/*.json --write`.
- **iPhone #1–#3:** report at Medium and High (`pacing`, `devicePolicy`, `census.textureBytes`, `gpu.reversedDepth` for FR-13); Low Power Mode → `pacing.targetFps` 30, no tier step; Battery saver row.
- **iPhone/iPad/Mac FR-10:** `?flags=DEVICE_POLICY&diag=1` → report `devicePolicy.score` and the chosen tier.

#### Known issues
- The benchmark thresholds, the budget rows and the cadence-lock tolerances are provisional until real reports exist.
- A masked "Apple GPU" Mac that measures 'high' starts High, not Ultra (the preset still comes from `DEVICE_TIERS.ultraStart`, outside the FRAME block).
- The Battery-saver notice cannot show inside the lounge (its HUD is not the calm HUD); it shows on the return to flight.
- The phone budget row is stricter than cinema-profile's old phone numbers (250 / 1.2 M), so `soak-visual-finish` phone verdicts now flag the city poses MOBILE_ENHANCED_VISUALS already measured at 284/285.

- The stall tally classifies an interval with the Long Animation Frame scripts that overlap it; Safari and Firefox have no LoAF, so there a React-commit stall reads as unattributed unless a markPhase tag names it.

#### Contract requests
Received and DONE (from LIGHT, for `device-policy.js`):
- **Device-class pin** — `window.__flyDeviceClassOverride` honoured by `deviceClassOf()` (all five classes; anything else ignored). LIGHT can drop its own `window.__flyLightDeviceClass` / `ctx.cls` plumbing. Gate: `verify-ship-frame` FR-11 (f).
- **PHOTO_HIRES touch `maxScale` 3** (was 2; `maxLongPx` 4096 kept). Gate: FR-11 (b) sanctioned move, FR-11 (e).

Made by FRAME:
- **RELEASE:** add `fly-frame-rate-v1` (`FRAME_RATE_KEY`) to the save/backup whitelist (FR-9).
- **CITY (and the terrain owner):** if the owner's yaw shows finalize/atlas hitches, route `COMMIT_BUDGET.finalizePerFrame` and the TERRA_PACE / surface-atlas upload budgets through a FRAME hook (`turnBudgetK()` from `lib/fly/finalize-pace.js` is ready to read); FRAME does not edit those engines.
- **SKY / CITY / LIGHT:** `deviceClassOf()` now classes a touch device as phone/tablet before the software check (emulated phones in harnesses get the phone policy).

#### Reds fixed
- `verify-graphics-governor` (FRAME's known red, "crashes"): it ran the governor in a VM without the imports it has gained and asserted removed behaviour (a latch that times out, a legacy satellite renderer, a ladder with no effect rungs). Now 14/14, the stubs added and those assertions brought to the shipped contract.
- `verify-frame-step` (listed 10/11, FRAME's): reads **11/11 on `main` and on `ship/frame`** in this venue (run against a `git archive main` snapshot too), so its known-reds row is stale, not fixed by FRAME; RELEASE owns `ship-pass-known-reds.json` and can retire it. FRAME_STEP stays backlogged and nothing here reads it.

**Files outside the 5.1 list (new, FRAME's):** `components/fly/{CensusRig,PaceClock}.jsx`, `components/fly/hud/BatterySaverHint.jsx`,
`lib/fly/{shader-ready,program-census,render-census,census,stall-census,pace-adapt,registry-warm,dynamic-near,turn-budget}.js`,
`lib/fly/stall-classify.mjs`, `scripts/{verify-ship-frame-browser,verify-ship-frame-yaw}.cjs`, `scripts/derive-budget-table.mjs`.
**Existing files outside the list (edited minimally):** none — `frame-stats.js`, `finalize-pace.js`, the governor, budgets and prewarm files are FRAME's; `scripts/verify-graphics-governor.mjs` is FRAME's red.
<!-- SHIP PASS FRAME report end -->

### SKY

<!-- SHIP PASS SKY report begin -->
**Status (2026-10-30, cloud venue, branch `ship/sky`): IN PROGRESS — every
item built and node-gated; the browser rows are running through the shared
heavy lock.** SK-2 to SK-6 are built (the three look flags `enabled:false`),
SK-1's model attribution is in, and its rendered fixture matrix and the
flag-on browser smoke are queued (a continuation after a usage-limit cutoff:
the first agent's seven commits stand; this run fixed one red it had
introduced, see "Reds fixed"). Every number below is the offline fixture
under SwiftShader (section 3.8), never a 5080 or iPhone number.

| ID | State | What landed | Evidence |
|---|---|---|---|
| SK-1 | instrument built, run in flight | `scripts/ship-sky-veil.cjs`: pinned clear noon (`__flySunOverride` = local solar noon, `__flyWeatherOverride='clear'`), Midtown 20° below the horizon at 5,000 / 6,000 / 7,500 / 8,500 / 10,000 ft, lens 60°, clock frozen; arms baseline, `aerial-pin` (`__flyAerialOverride=0`), `air-off` (SKY's new dev/review pin `window.__flySkyDiag={aerial:0}`, `lib/fly/sky-diag.js`: the whole Enhanced aerial post pass leaves the ground pixels), `no-mist` (`?flags=-GROUND_MIST`), and CITY's `city-fade` / `city-premix` through `window.__flyCityDiag` — measured only when the tree publishes `__flyCityDiagApplied === true`, otherwise "pending merged tree". Metric: percentile Michelson luma contrast, RMS contrast, mean CIELAB chroma and mean luma in a crop around the projected Midtown point, plus a 50 km crop for SK-2. | `verify-ship-sky` SK-1 (a)–(d); table: below, when the run lands |
| SK-3 | built, flag OFF (look flag) | `lib/fly/sun-model.js`: truncated Meeus ch. 47 (26 Σl/Σr + 14 Σb rows, A1–A3 terms), topocentric parallax, phase and illuminated fraction (Meeus ch. 48); `computeSun` records the place and instant behind each `az`, so `moonDirFromSun(az)` returns the real moon with REAL_MOON on and FlyScene, the cloud pass and cinema-environment inherit it unedited; `moonLight()` (D15 floor 0.5 of today's key, never above today's full moon, shadowless fill up to the floor when the moon is low or set, no key/disc under the horizon, exposure opens ≤ 0.5 stop); `moonState()` implemented (frozen shape plus additive `compassAzDeg`, `lightK`, `real`). `cinema-environment.js`: key × keyK, fill top-up, disc weight × visibility, exposure adapt (flag off: main's expressions). `night-sky.js`: the phase terminator on the composite's disc (sphere normal lit by the true sun, earthshine 0.06) and a corona that follows the lit fraction. | `verify-ship-sky` SK-3 (a)–(o): Meeus 47.a; the terminator geometry (a CPU mirror of the shader, true sun on the ephemeris moon) lights the disc's real fraction within 0.61% on 14 moon-up dates; 20 JPL Horizons dates (worst 0.020° position, 0.63% illumination); flag-off bit identity of `moonDirFromSun` and of cinema-environment over 820 states (sha256 vs main); the light law over a 241 × 21 grid; 403 deep-night states with the flag on |
| SK-5 | done | The lens flare (veiling glare, aperture starburst, five ghosts, `livSunVisible()` / `livLens()`, `uLivFlare*`, `FLARE_ON`) is deleted from `light-shafts.js`; the cloud pass's comments follow. `LIGHT_SHAFTS` is untouched and still off. The `LENS_FLARE` block, its `living-world.js` reader and its device-report entry stay for the lead's close (8.3). `verify-living-sky` (2a)'s LENS_FLARE marker now asserts the lens is gone (a file no stream lists; one line, unavoidable once the code is deleted). | `verify-ship-sky` SK-5 (a)–(d): default-frame program texts unchanged (TEXT (a), sha256 vs main); `?flags=LENS_FLARE` reaches no program; LIGHT_SHAFTS' source and blur programs are main's and its composite is main's minus exactly the lens text (sha256 of main's text with the lens cut out); `verify-living-sky` node rows green and its GPU compile/link rows green on SwiftShader |
| SK-4 | built, flag OFF (look flag) | `lib/fly/sky-lite.js` + one anchored edit function in `lib/fly/atmosphere/glsl.js` (`skyLiteAerialGLSL(src, on)`, pure; sky-lite.js reads the flag and exports the consumers' `PSKY_AERIAL_LOOKUP_GLSL`, so glsl.js keeps no runtime dependency). What Medium and phones lost was REACH: the aerial volume is 450 km on High, 250 km on Medium, 160 km on touch devices and `pskyAerial()` clamped farther pixels to the last slice, so from altitude the outer band (and the clouds over it) stopped hazing where High keeps going; and the far cloud deck is 180 km on High, 90 km on Medium, none on phones. SKY_LITE, inside passes that already run: (1) past the last slice the optical depth continues linearly with distance and the in-scatter keeps its share of the opacity (continuous; a few ALU ops on the pixels beyond the range), switched per frame by `uPskyAp.z`, which `AtmosphereRig` sets from `deviceFeature('SKY_LITE')`; (2) phone profiles get the existing one-sample far deck at the policy's `cloudReach` (0.5 × 180 = 90 km) through the deck's existing reach uniform. Medium desktops keep their 90 km deck and get (1). | `verify-ship-sky` SK-4 (a)–(g): the policy (phones and tablets at any tier, desktops at Medium/Low, never a desktop at High); no raw device-class call, no GPU object; flag off = 0 switch and the old deck rule; flag on = the reach edit in the aerial pass, cloud march and composite, once each, and the ONLY difference (sha256 of each text with the edit reverted = default); the extrapolation continuous and monotone. Cost: **+0 draws, +0 passes, +0 targets, +0 programs at runtime** (structural, gated); GPU ms is the owner's (run list) |
| SK-6 | kept | Nothing SKY added touches the LUT cadence. | `verify-ship-sky` SK-6 (a) PHYS_SKY `skyHz` 60/30/30 and `aerialHz` 30/15/10 unchanged and unwritten by SKY's modules; (b) `verify-mobile-enhanced` **6/6** (sky redraws 241 → 61 over 2 s at 120 Hz at the phone's 30 Hz budget, run from the gate) |
| Prewarm | registered | SKY block of `lib/fly/prewarm-registry.js`: `SKY:real-moon-composite` (REAL_MOON), `SKY:sky-lite-clouds` and `SKY:sky-lite-aerial` (SKY_LITE). SKY's flag-on texts REPLACE default ones for the page load, so each entry builds clones of the live materials (the cloud pass's Enhanced pair; the composer's merged aerial pass), published through `lib/fly/sky-prewarm.js`; the existing chain prewarm (`prewarm.js` through `buildPassList`) builds the flag-on text by construction. | `verify-ship-sky` PREWARM row: three keys, each reachable only with its flag, each `build()` an Object3D |
| SK-2 | built, flag OFF (look flag) | `lib/fly/aerial-clarity.js`, from SK-1's model attribution (the atmosphere's veil is near-field Rayleigh in-scatter, not aerosol, not the mix space, not mist): in clear daylight from altitude the near and mid field's physical in-scatter is cut, S' = S·(1 − k·(1 − smoothstep(nearKm, farKm, d))), k = strength × (1 − overcast)(1 − fog) × day × eye ramp; extinction untouched; S' still grows with distance (no ring); from `farKm` (45 km) out S is the physical one, so distant ridges, the 50 km band and the horizon keep exactly their depth; nothing below 900 m eye AGL. One anchored edit on the final Enhanced aerial text (after PHYS_SKY, TRUE_SCALE and the ground edits) and one uniform; tunables in the `AERIAL_CLARITY` block (`strength` 0.45, `nearKm` 12, `farKm` 45, `eyeRampM` [900, 2600]). Prewarm: the aerial entry builds the live merged pass. | `verify-ship-sky` SK-2 (a)–(f): flag-off identity; the edit is the only change (sha256 with the edit reverted = default, Enhanced and merged pass); k law; far field identical by construction and monotone; **the atmosphere's veil on the model: 8,500 / 10,000 ft vs 6,000 ft from −6.8% / −10.2% to 0.0% / −2.3%, 50 km sight line 0.283 → 0.283**. The rendered fixture arm (`--arms=baseline,clarity`) and the 5080 motion bar are pending (lock queue / owner) |

**SK-1 — the atmosphere's share of the veil (SKY's half of the table).**
Two instruments. (1) `scripts/ship-sky-veil-model.mjs`: the shipped
atmosphere's own CPU mirror (`lib/fly/atmosphere/model.js`, the same medium and
integrator as the GPU tables), the harness geometry (Midtown 20° below the
horizon, July clear noon, sun behind the eye, city albedo 0.12), metric = the
contrast transfer G·T / (G·T + S) of the ground under the aerial in-scatter
(1 = no veil). Venue-independent and exact for the atmosphere term alone:

| Eye height | 5,000 ft | 6,000 ft | 7,500 ft | 8,500 ft | 10,000 ft | 50 km sight line (10,000 ft) |
|---|---|---|---|---|---|---|
| shipped atmosphere: transfer (vs 6,000 ft) | 0.817 (+3.2%) | 0.792 | 0.758 (−4.3%) | 0.738 (−6.8%) | 0.711 (−10.2%) | 0.283 |
| aerosol removed (turbidity 0) | 0.830 | 0.805 | 0.771 | 0.751 (−6.7%) | 0.724 (−10.0%) | 0.306 |
| Rayleigh removed | 0.986 | 0.984 | 0.983 | 0.982 (−0.2%) | 0.982 (−0.3%) | 0.907 |

So the atmosphere alone costs Midtown ≈ 7% of its contrast from 6,000 to
8,500 ft and ≈ 10% to 10,000 ft (inside the 15% row by itself), and that
share is **Rayleigh in-scatter over dark imagery, not aerosol**: taking the
Mie medium out entirely moves it by 0.1–0.2 points. The haze mix is already
scene-linear in the physical path (`lit = ground·T + S·E`), and the ground
mist burns off by a 19° sun, so neither "Mie density with altitude", "the
haze-mix colour space" nor "mist coupling" can remove it — the in-scatter on
the near and mid field is the lever (SK-2). (2) `scripts/ship-sky-veil.cjs`:
the rendered fixture matrix (arms baseline / `aerial-pin` / `air-off` /
`no-mist` / CITY's two), fixture/SwiftShader — **its run is queued on the
shared heavy lock; its rows land here when it completes**; CITY's arms read
"pending merged tree" on this branch and the lead re-runs the harness on the
merged tree.

**SK-4 cost table (SKY_LITE on; structural rows are gated, GPU ms is the
owner's).**

| Device (policy class / tier) | SKY_LITE | Aerial reach | Far cloud deck | Draws / passes / targets / programs | GPU ms |
|---|---|---|---|---|---|
| phone, any tier | on | 160 km volume, continued past it (`uPskyAp.z = 1`) | none → 90 km, one sample (`cloudReach` 0.5) | +0 / +0 / +0 / +0 (the edits replace the default texts for the page load) | owner: iPhone device report at Medium and High, `?flags=SKY_LITE` vs default |
| tablet, any tier | on | 160 km, continued | none → 90 km (the phone cinema profile) | +0 | owner (emulation only, D7) |
| desktop Medium (dGPU / iGPU) | on | 250 km, continued | 90 km (unchanged) | +0 | owner: 5080 at Medium |
| desktop High / Ultra | off (policy) | 450 km clamp (unchanged) | 180 km (unchanged) | +0 | — |
| software (SwiftShader) | Medium / Low only | as Medium | as its profile | +0 | — |

Per pixel, the reach edit is a uniform branch plus three `pow` and a few
ALU ops on pixels beyond the volume's last slice only; the far deck on a
phone costs what Medium's already does per cloud-resolution pixel (one shell
intersection, one density sample, one light estimate). The 0.6 ms row of the
policy budget is the owner's to read on the iPhone (run list, iPhone step 10).

**Flags.** `AERIAL_CLARITY`, `REAL_MOON`, `SKY_LITE`: `enabled:false` (look
flags; section 3.8 — the owner flips each after the 5080 motion bar).
`REAL_MOON` tunables live in its block (`floorK`, `horizonBandDeg`,
`minKeyElDeg`, `exposureAdapt`, `earthshine`, `terminatorSoft`).

**Gates.** `node scripts/verify-ship-sky.mjs`: 42 passed, 0 failed (includes
the default-flag program-text hashes vs main: cloud march / composite /
filter, Classic and Enhanced; aerial Classic, Enhanced, merged pass and its
defines; SK-4 (h) keeps `atmosphere/glsl.js` dependency-free). Existing, node:
`verify-cinema-overhaul` 16/16, `verify-twilight` 6/6, `verify-sun-azimuth`
5/5, `verify-cloud-calm` 6/6, `verify-true-earth-flags` 8/8,
`verify-import-integrity` 4/4, `verify-living-sky` 21/21 (its GPU rows on
SwiftShader). Existing, browser halves (bundled Chromium + SwiftShader under
the heavy lock): `verify-hdr-guard` 4/4; `verify-cloud-silhouette-gpu` PASS
(1,426 → 0 leaked hull pixels, 15 silhouettes, no GL errors) and
`verify-cloud-reconstruction-gpu` PASS (cloud error 3.6e-8, foreground 0) —
both ask for `channel: 'chrome'`, which the container lacks, so they ran
unedited under `node --import ./scripts/ship-sky-pw-venue.mjs` (SKY's venue
shim: the bundled Chromium instead); `verify-phys-sky` re-run queued (see
"Reds fixed"). `node scripts/ship-pass-gates.mjs`: 32 PASS, 2 KNOWN-RED,
0 FAIL, 4 SKIP, seam rule PASS. ESLint: no new problems — `FlyScene.jsx`
26 errors / 2 warnings and `SkyDome.jsx` 3 errors on main and on the branch
alike (pre-existing), every other touched file clean.

**Reds fixed.** None from section 12.3. One red this branch had introduced:
SK-4's flag read put `import … from '../ship-pass.js'` into
`lib/fly/atmosphere/glsl.js`, whose header promises no runtime dependencies;
`ship-pass.js` imports extensionless paths, so plain node could no longer
import glsl.js (or `cinema-sky.js` through it) and `verify-phys-sky` crashed
at its node half (`ERR_MODULE_NOT_FOUND …/lib/fly/fly-pins`). Fixed in
`5c2cb0a`: the flag is read in `sky-lite.js`, glsl.js's lookup text is main's
again (sha256), and `verify-ship-sky` SK-4 (h) holds the import set and a
plain-node import.

**Owner checks (run list, section 9).** RTX 5080 step 6: a night flight at
the current moon with `?flags=REAL_MOON` against the default; a moonrise for
the motion bar (pin one with `?sunUtc=`). iPhone step 10 / SK-3: a new and a
full moon night over Manhattan (`?flags=REAL_MOON&sunUtc=2026-11-10T03:00:00Z`
is a new moon, set; `?flags=REAL_MOON&sunUtc=2026-11-24T05:00:00Z` a full
moon 70° up), each against the same URL without the flag.

**Contract notes.** `moonState()` (section 6, CITY consumes it): frozen
shape kept; additive `lightK` is the ground's moonlight relative to today's
(1 with REAL_MOON off), the number a night exposure balance wants.

**Files outside the listed ownership:** new and SKY's own — `lib/fly/sky-diag.js`,
`lib/fly/sky-lite.js`, `lib/fly/sky-prewarm.js`, `lib/fly/aerial-clarity.js`,
`components/fly/ShipSkyDiag.jsx`, `scripts/ship-sky-veil.cjs`,
`scripts/ship-sky-veil-model.mjs`, `scripts/ship-sky-smoke.cjs`; edited minimally — `scripts/verify-living-sky.mjs`
(one marker line, SK-5).
<!-- SHIP PASS SKY report end -->

### CITY

<!-- SHIP PASS CITY report begin -->
**Status (2026-10-30, cloud venue, branch `ship/city`): IN PROGRESS.** CT-1,
CT-6 (node half), CT-4 and CT-5 (built, flags off) and CT-7 (the list) landed;
CT-2 plumbing is in (flag off); the SK-1 city arms (browser), CT-3 and the
browser smokes follow. The browser probe (`scripts/ship-city-probe.cjs`) now
measures the SK-1 city arms at SKY's poses with SKY's metric (ported from
`scripts/ship-sky-veil.cjs`, live CT-1 pins on one boot), books every draw of
a frame to its layer (CT-3 census) and takes a 60 s still diff (CT-4). Every number below is the offline
fixture on SwiftShader or a node gate, never a device number (3.8).

**CT-1 — diagnosis pins (P0, landed).** `window.__flyCityDiag = { fadeStartM?,
fadeEndM?, skylinePremix?: 0 | 1 }` is read live (every frame) by the city code
whether or not CITY_RANGE is on, through `lib/fly/city-range.js`
(`cityDiag`, `buildingBand`, `cityRangeRequest`). Absent = today's band exactly
(node gate: the band equals SAT_BLDG_FADE / SAT_BUILDINGS and `bandFade` is the
engine's old expression, `Object.is` at ten heights). A fade pin needs both
ends; it moves the detail ring's dissolve, keeps the shipped 200 m evict
margin past the pinned end and arms the ring up to the pinned end (so a warp
to 10,000 ft streams the city it pins); the skyline's hole choreography and
coverage mask follow the same band. `skylinePremix: 0` rides the skyline build
request as `premix: false`. When a consumer honours a pin it sets
`window.__flyCityDiagApplied = true`. **Finding:** the Enhanced skyline bakes
no grey premix at all (the worker's `visuals` palette path never applied
`SAT_SKYLINE.hazeMix`; only the Classic colour did), measured: Enhanced output
with `premix: false` is byte-identical on 12 fixture tiles, Classic output
changes. So the skyline-premix arm's share of the veil is structurally zero in
Enhanced; the city's share is the detail-ring fade.

**SK-1 — the city's share of the veil (CITY's half of the table).** Two
readings. (1) By construction (node, `city-range.js` `bandFade` over the
shipped band, `verify-ship-city` CT-1): the detailed ring is fully drawn below
2,400 m eye AGL and dithered away by 3,000 m (evicted at 3,200 m), i.e. it
dissolves between about 7,900 and 9,850 ft, which is where the owner's veil
begins (L-01, "from about 8,000 ft"). At the five SK-1 heights (eye AGL with
the fixture's ~15 m Midtown ground):

| Eye height | 5,000 ft (1,509 m) | 6,000 ft (1,814 m) | 7,500 ft (2,271 m) | 8,500 ft (2,576 m) | 10,000 ft (3,033 m) |
|---|---|---|---|---|---|
| detailed ring, shipped band | 1 | 1 | 1 | 0.79 | 0 (resident, invisible) |
| detailed ring, `city-fade` pin (4,500/5,000 m) | 1 | 1 | 1 | 1 | 1 |
| skyline premix, Enhanced | none baked | none baked | none baked | none baked | none baked |

So the city's two arms cannot move a pixel at 5,000-7,500 ft (both bands
read 1), the fade arm is the whole city share at 8,500 and 10,000 ft, and
the premix arm is structurally zero in Enhanced (the worker's `visuals`
palette never applied `SAT_SKYLINE.hazeMix`: Enhanced skyline output with
`premix: false` is byte-identical on 12 fixture tiles; only Classic changes).
(2) Rendered (fixture/SwiftShader, `ship-city-probe --mode=veil`, SKY's
geometry and metric, baseline / `fade` / `baseline-2` as live pins on one
boot, plus the draws per layer): queued, see "Venue" below.

**CT-2 — CITY_RANGE (P1, plumbing in, flag `enabled:false`).** Tunables in the
CITY_RANGE block. Desktop High/Ultra (`deviceFeature('CITY_RANGE').budget.detailedM`):
detailed ring live to ~4,500 m (lite LOD past 2,400 m: body range only and the
surface-detail term off; Bayer dissolve 4,500-5,000 m into the skyline mass,
which the coverage mask fills in under the same fade; evict 5,200 m, re-arm
5,000 m). Every allowed device: a dense-core skyline (a z14 tile with >= 40
polygons mapped >= 35 m admits its mapped 20-35 m blocks into the cap the
shipped selection leaves; a capped core keeps its towers byte for byte, a
suburb or desert tile is byte-identical). The CITY_FACADES regional palette
already reaches the skyline program (Play Pass, on), and Enhanced already drops
the baked premix (above), so those two sub-items need no new code.
Worker flag-off identity: byte-identical to `main`'s worker on 48 fixture
builds (skyline, buildings, roads, Classic skyline).

**CT-3 — city budget (P1, partly landed under CITY_RANGE).** Measured lever
first: the building colour pass splits a partly visible chunk into one draw
per contiguous run of visible 4x4 regions (`architecture-draw-range.js`), so a
half-visible chunk costs 4 submissions (node test) and a portrait phone, where
most chunks are partly visible, pays several draws per chunk. Under CITY_RANGE
without the long band (Medium desktops and touch, i.e. exactly the phone
budget's devices) the colour pass submits a visible chunk's body as ONE draw
(`setArchitectureMergeColor`); the shadow pass keeps its split. The skyline is
already merged per 2x2 tile group (`SAT_SKYLINE.groupN`), so "merge chunks per
tile group" holds there; merging the DETAIL ring's z14 chunks into groups would
rebuild its drape, heal, fade and collision bookkeeping and is not attempted
this pass (recorded, not hidden). Thresholds import `TIER_BUDGETS` from
`lib/fly/tier-budgets.js` (FRAME's FR-6 table replaces it at integration). The
per-layer census (probe `--mode=census`, visibility toggles, an independent
per-frame draw counter) is pending a heavy-lock slot.

**CT-6 — the `verify-sat-buildings` F1 red (P0, re-derived, not re-baselined).**
Cause, measured: since Living Earth the Enhanced builder keeps EVERY mapped
footprint of a tile as a body (`vector-tile.worker.js`, "all mapped footprints
retain a body") and the 500-polygon cap bounds the DETAILED subset
(`meta.provenance.detailedBodies`: roof forms, entrances, stepped levels);
`meta.kept` is now the coverage count, legitimately over 500 on a live Midtown
tile (~1,500 footprints), so F1's `kept <= 500` and `max kept === 500` read the
wrong number. F1 now reads the detailed subset, and its binding precondition is
the implication "every chunk that parsed more footprints than the cap details
exactly the cap" (the cap number 500 did not move). Node evidence
(`verify-ship-city` CT-6): fixture Midtown parses at most 363 footprints per
z14 tile, so the shipped cap cannot bind on the fixture (detailed = parsed on
every tile); with the cap scaled to the fixture's density (200) the detailed
subset never exceeds it and binds while kept = every body (363 > 200), which
is the old red reproduced and explained. The browser half (verify-sat-buildings
on the fixture, `PLAYWRIGHT_CHANNEL=` for the bundled Chromium) is pending a
heavy-lock slot. `scripts/ship-pass-known-reds.json` is RELEASE's: the row can
retire once the browser half reads green.

**CT-4 — NIGHT_LITE (P1, built, flag `enabled:false`).** `lib/fly/night-lite.js`
+ `components/fly/SatNightLite.jsx`, mounted from FlyScene's CITY mounts block
only with the flag on, in satellite, in Enhanced lighting (where FlyScene's own
gated SatCityGlow mount at the old line is off and untouched); the device gate is
`deviceFeature('NIGHT_LITE')` (touch, or Low). ONE instanced draw of flat
ground light pools at the POI cities: a disc whose vertex colours fall from a
hot core to exactly black at the rim (no dome, so no silhouette against the
horizon), bent per vertex through the shared `world-bend` variant, additive, no
depth write (the terrain behind writes depth, so the cloud composite never
reads it as sky). Full strength from the road-ring hand-off to the policy's
60 km reach, fading out by 75 km and never past the world edge band; hidden by
day and whenever nothing is placed (zero draws); placement on a 2 s cadence
(nothing moves between placements, so a still camera is still). Program
registered in the CITY prewarm block (`CITY:night-lite-pools`, flag-gated).
`verify-sat-night` reconciliation and the phone-emulation capture at 3 km are
pending browser runs.

**CT-5 — NIGHT_RHYTHM (P2, built, flag `enabled:false`).** `lib/fly/night-rhythm.js`.
(a) Seam: NIGHT_LIGHTS' lamps faded in across 0.3-1.4 x the road ring, so
inside the ring both lit the same streets and just past it the lamps were still
partial; with the flag they arrive across 0.8-1.05 x the ring at `seam.gain`
(1 = the owner's 5080 calibration knob; the venue cannot draw VIIRS, GIBS is
blocked), an anchored edit on `night-lights-atlas.js`'s text re-anchored to
the ring through the shipped `uNLFade` (living-ground.js untouched).
(b) Twilight: Enhanced window light followed the cinema night weight (0 above
-2 deg, full at -12 deg), so a blue-hour city was unlit; window emission now
takes at least an elevation-keyed weight (0 above +1 deg, full by civil dusk,
-6 deg). (c) Occupancy: local SOLAR hour recovered from the published sun
(hour angle from sinEl/decl/lat, sign from the azimuth; within 0.032 h of the
clock in both azimuth conventions) drives ONE uniform `uNightRhythm` =
(office, residential, other, twilight); a window stays lit while its stable
per-cell hash is under its family's share, so windows go dark one by one after
~23:00, offices empty through the evening, homes stay lit until bedtime.
No new program: each edited material keeps one program under a `|night-rhythm-v1`
key (gate counts them); flag off, the four architecture programs and the
NIGHT_LIGHTS text are main's byte for byte. Prewarm: `prewarm.js` already
builds these programs through the same factory, so the flag-on variant is
warmed with no registry entry. Dusk/night capture pairs at 500 m and 3 km are
owner rows (run list 6); VIIRS cannot render here.

**CT-7 — NIGHT_CITY_R23's consumers (for the lead's deletion, 8.3).** NOT dead
code in Enhanced: `nightCityOn(sub)` (`lib/fly/night-city.js`) is true for every
sub-block but `windows` whenever `satelliteVisualsOn('lighting')`, so two
sub-blocks are LIVE in the shipped frame: `.roads` (spread by
`satelliteRoadLighting()` into the Enhanced road program, key
`world-bend-road-satnight-r23`) and `.tier` (`.tier.nightMinTier` gates night
windows in `SatBuildingLayer.jsx`). Deleting the block must move those values,
not drop them. Consumers: `lib/fly/fly-constants.js` (the block, ~6711-6900,
plus comments in NIGHT_TRUTH_R23's header); `lib/fly/night-city.js`
(`nightCityOn`, `satelliteRoadLighting`, `NIGHT_CITY_SWEPT`,
`installNightCityDevHandle`); `lib/fly/toy-world/sat-building-engine.js`
(import + `nightCityOn('windows')` at the material, twin pool and
`setNightCityWindows`); `lib/fly/toy-world/sat-road-engine.js`
(`satelliteRoadLighting()` into `applyBendRoadSat`); `lib/fly/prewarm.js`
(`nightCityOn('windows')`, `satelliteRoadLighting()`);
`components/fly/SatBuildingLayer.jsx` (the `.tier` gate);
`components/fly/SatRoadLayer.jsx` (`installNightCityDevHandle`);
`lib/fly/toy-world/world-bend.js` (the r23 road/window variants and their
uniforms, frozen this pass); `scripts/verify-night-city-identity.mjs` (the
gate; it crashed on main with ERR_MODULE_NOT_FOUND since world-bend.js gained
imports, fixed here with the shared resolve hook: 8/8 run, (1)/(3) need
`R23_BASE_WORLDBEND`).

**Flags (all three `enabled:false`, by design, 3.8).** CITY_RANGE, NIGHT_LITE
and NIGHT_RHYTHM are look flags: built, node-gated (flag-off identity proven
against `main`), smoke-tested on and off on the fixture, and left off for the
owner's RTX 5080 motion bar (3.6) and iPhone glance; none claims to be on.
When CITY_RANGE is flipped, three frozen browser premises move with it and
must be re-read the same day: `verify-skyline` (B) "detail ring gone at
5,000 m" (the range evicts at 5,200 m: probe at 5,400 m),
`verify-sat-night` (E) "fade strictly inside (0,1) at 2,700 m" (the range
dissolves at 4,500-5,000 m) and `verify-sat-buildings` (C-ii) is unaffected
(6,000 m > 5,200 m).

**Owner checks (run list section 9).**
- 5080 step 2 (Midtown climb 6,000 -> 10,000 ft): `?flags=CITY_RANGE` vs
  `?flags=-CITY_RANGE` (with SKY's `AERIAL_CLARITY`); the motion bar: a
  descend/climb burst through 2,400 m (lite LOD) and 4,500-5,000 m (dissolve
  into the mass) with no pop; Manhattan 8,000 ft draws against the FR-6 row.
- 5080 step 6 (night at the current moon): `?flags=NIGHT_RHYTHM` at 500 m and
  3 km at dusk and at 23:00-01:00 local: no ring where the road lights hand
  off to NIGHT_LIGHTS (tune `NIGHT_RHYTHM.seam.gain` against the ring-edge
  luma if one shows), lit windows by civil dusk, windows going dark one by one
  late; still-camera diff for window crawl.
- iPhone step 4 (night at 3 km) and step 10: `?flags=NIGHT_LITE` vs off at
  night from 3 km and at cruise: city light to 60 km, no sparkle in a 60 s
  still, the phone's draws (DiagnosticsPanel) within 250.
- iPhone step 4 (city turn): `?flags=CITY_RANGE` (merged colour draws on the
  phone) vs off: draws and turn hitch.

**Gates.** `scripts/verify-ship-city.mjs` (node, starts the fixture itself): 46/46.
`verify-play-city` 28/28, `verify-night-city-identity` PASS (8 rows). `ship-pass-gates`: 32 PASS, 2 KNOWN-RED, 0 FAIL, seam rule PASS.
`FLY_TILE_FIXTURE=1 verify-worker-window` 4/4, `verify-true-areas` 7/7.

**Contract requests.** None yet.

**Venue (browser runs; every number fixture/SwiftShader, 3.8).** Earlier
sessions (07:29-09:40 UTC) produced no result: SKY's harness copy lost its page
after the 5,000 ft baseline, then an orphaned RELEASE `next-server` held the
heavy lock from ~08:22, and CITY's queued chain never acquired it. Session s3
(12:58-13:23 UTC, `next dev` on a source snapshot of `af3b588`, phone emulation
844x390, `cls=phone`, tier Low as the phone resolves): **smoke PASS, zero page
errors and zero shader errors** with all flags off (day, 900 m and 2,438 m) and
with `?flags=CITY_RANGE,NIGHT_LITE,NIGHT_RHYTHM` (night, 900 m, 2,438 m and
3,000 m). NIGHT_LITE mounted and placed 26-27 pools out to 52-54 km (reach
60 km); per-layer census, phone, all flags off, day: 138 draws at 900 m (map
83, aux/shadow 15, post 9, roads 7; the building ring not yet resident) and
199 at 2,438 m (map 127, aux 15, roads 11, post 9, `sat-buildings` 7 for 5
resident chunks, `sat-skyline` 3). The s3 night still pair captured the HUD's
tips card and toasts (11 % of pixels moved over 60 s), so the probe now hides
the DOM overlays, the player rig and the traffic instances before a still pair
(`dd41247`), and both probes exited only at their timeouts (fixed in the same
commit). Session s8 (14:18-14:43 UTC, snapshot `ecb5140`): **smoke PASS** for
phone `?flags=CITY_RANGE` by day (900 m, 2,438 m) and for the phone night pair
off / all three flags at 3,000 m; desktop night (`cls=dgpu`, tier High) all
flags off at 900 m PASS, while its all-flags arm ran out of the session's
budget before its first pose (re-queued as s9). CT-3 census (phone, day,
2,438 m, per frame): all flags off, `sat-buildings` booked **7 draws for 5
resident chunks** (a partly visible chunk splits); `?flags=CITY_RANGE`,
**6 draws for 8 resident chunks** (at most one colour draw per chunk); the
scene totals (199 vs 208) are dominated by the satellite map's 127-137 tile
draws, which follow how far streaming had got when the bounded settle
(75 s) expired, so they are not a CITY_RANGE delta. CT-4 still (phone, night,
3,000 m, 60 s apart, HUD, player rig and traffic hidden): all flags off
13.2 % of pixels moved (mean |dL| 4.85: the skyline was still landing,
`skReady` 0), all three flags on 4.1 % (mean |dL| 1.65, 27 pools placed to
54 km): the pools add no crawl the off arm does not already show. Desktop
night off still at 900 m: 7.3 % (clouds and streaming). Queued
(`chain2.sh`): s9 desktop night all flags at 900 m (still) + desktop day
census off / CITY_RANGE at 2,438 / 4,300 m; s10 `verify-sat-buildings` + the
SK-1 veil arms at 10,000 / 8,500 ft; s11 `verify-sat-night`; s12
`verify-skyline`.

**Known issues.** In this venue the device policy classes SwiftShader as
`software`, which CITY_RANGE refuses; the probe uses the harness pin
`window.__flyCityDeviceClass` ('dgpu' / 'phone') to see each arm.
<!-- SHIP PASS CITY report end -->

### LIGHT

<!-- SHIP PASS LIGHT report begin -->
**Status (2026-10-30, cloud venue, IN PROGRESS — continuation after an API
cutoff).** LT-2..LT-7 are built and node-gated, and the Provides
(`requestShadowCasters()`, `capturePhoto({scale})`) are in. Browser evidence
so far: the fixture on SwiftShader, phone emulation only. The desktop and
look-flag browser batches are queued behind the shared heavy lock (see
known issues). Every LIGHT flag ships `enabled:false`.

| ID | State | What landed | Evidence |
|---|---|---|---|
| LT-1 | owner-pending | No defect found. Review of `mobile-enhanced.js` / `mobile-bloom.js` and their three consumers (Effects bloom, CinemaShadowRig reach, daylight depth): uniform-only or same-shader changes, so no program-key moves; the flag stays OFF for the owner's iPhone glance | `verify-mobile-enhanced` 6/6, `verify-mobile-bloom` 6/6, `verify-cloud-silhouette-gpu` PASS on SwiftShader (1426 -> 0 leaked hull px over 15 silhouettes; Chrome is absent, so it ran through a venue shim that drops `channel:'chrome'`). Phone-emulation app smoke with `?flags=MOBILE_ENHANCED` is queued (`review-ship-light --arms=phone-off,phone-mobile,phone-on`) |
| LT-2 | built, browser queued | `lib/fly/terrain-shadow.js`: on desktop, a terrain-only ortho depth map (texel-snapped, 2 Hz per policy); on touch, a CPU horizon map built from a wrapped `TerrainGroundQuery` and time-sliced. Anchored patch in `earth-surface-material.js`; `TerrainShadowRig.jsx` is mounted from FlyScene's LIGHT block only with the flag on | `verify-ship-light` (0a)-(0c), (1a)-(1p). Flag off, the terrain key and the shader sha256 equal the base tree. (1p) is the 16-unit fragment sampler ceiling (ANGLE D3D11 and iPhone expose 16): at Ultra's 3 cascades the upper bound goes from 15 to 16 with the flag on (phone 14). That is zero headroom, and no sibling branch adds a sampler. The review harness now fails an arm whose measured earth program exceeds 16, whatever the venue's own limit |
| LT-3 | built, browser queued | `lib/fly/traffic-shadows.js`, driven from `detailed-traffic.js` (TrafficLayer untouched). Casters render through the fleet depth material, with a per-cascade cull and a per-frame (mesh, cascade) budget. Contact blobs (1 draw) on Medium and touch. Shadow hooks are chained, and `dispose()` hands the meshes back | (3a)-(3j) |
| LT-4 | built | `CinemaShadows.setAirframeFit` pins cascade 0 past the airframe, with its normal bias in cascade-0 texels. The PlayerPlane LIGHT block toggles receiveShadow (a uniform, so no recompile) | (4a)-(4f) |
| LT-5 | built | `shadowReachConfig` applies MOBILE_ENHANCED's AGL rule to Medium desktops | (5a)-(5b): 900 m AGL reaches the 1.2 km ceiling |
| LT-6 | built, flag OFF | `lib/fly/photo-hires.js` and PhotoCapture: one supersampled offscreen frame, tiled through the camera's own projection past GL limits, with `holdGovernor('photo-hires')` and `track('photo_taken')`. On touch, `'auto'` aims at `touchScale` 2 and is raised just to `minLongPx` 2,560 where the policy allows. Once the frame picks the request up, the 15 s timeout is cleared | (6a)-(6h). `verify-photo-hires` on SwiftShader, fixture: **desktop 8/8** (1280x720 buffer: 3840x2160 PNG, attribution burned in, restored with no context loss, the 2x2 tiled path at a forced MAX_TEXTURE_SIZE 2048 restored with the tiles moved, bare `capture()` still the buffer, zero page/shader errors); **phone 7/8** (390x844 at DPR 3, 487x1055 buffer: 975x2110 PNG, tiled 2x2 restored, bare capture, zero errors). The one red: long side 2,110 < 2,560 at W0's touch maxScale 2 |
| LT-7 | built, browser queued | `hangar-stage.js` `liveryLuminance` / `hangarExposureScale` / `hangarReflectorResolution`. StageBay scales the key, pool, rims and sun; Medium's reflector is halved | (7a)-(7d) |

**Provides.** `requestShadowCasters(key, objects, {max}) -> release`
(cinema-shadows.js; CinemaShadowRig applies it each frame: casters on while
the cascades exist, parked without them, each object's own castShadow
restored on release; (9a)-(9b)), and `capturePhoto({scale}) -> Promise<Blob>`
(photo-hires.js).

**PHOTO_HIRES decision: OFF on this branch.** The phone export misses LT-6's
2,560 px only because W0's touch `maxScale` is 2: the emulated phone's
1055 px buffer reaches 2,110 and needs 2.427x. FRAME's contract (touch
`maxScale` 3, device-policy.js) closes exactly that: `photoExportPlan` then
gives 1181x2560 (touchScale 2 raised to minLongPx). **Lead: re-run
`verify-photo-hires` on the merged tree**, and flip `PHOTO_HIRES.enabled` if
it is all green there: the phone long-side row, the desktop arm (queued here)
and `verify-photo` (queued here). `verify-attribution` 4/4 (node).

**LT-2 draw cost, read honestly.** The receiver adds no draw: it samples inside the earth surface's existing draw. The desktop refresh is an offscreen pass that redraws the loaded terrain tiles in the light box, bounded by `maxTiles` (400), twice a second or at once on a warp or a light jump. Between refreshes the frame pays 0 extra draws; a refresh frame pays its tile count (`runtime.terrainShadow.draws` and `.tiles`, recorded by the terrain-on arm). So LT-2's "+≤ 1 draw" and the policy seed's `draws: 1` hold on every frame but the two refresh frames a second. A tile-tree terrain cannot be redrawn in one draw. A design that can keep it to one draw per frame (a top-down height map updated per landed tile, plus one lit pass at 2 Hz) is a rewrite this venue cannot check on a GPU, so it is offered, not built. The owner's census (D16) decides whether the refresh frames fit; `?flags=TERRAIN_SHADOW` with the frame stats on shows them.

**Device gating.** Every LIGHT feature asks `deviceFeature()` through
`lib/fly/ship-light.js`. SwiftShader is class 'software', which the policy
refuses, so harnesses pin `window.__flyLightDeviceClass`. FRAME's
`window.__flyDeviceClassOverride` is read as a fallback, and the harnesses set
both, so they work before and after integration.

**Gates.** `verify-ship-light` 58/58; `ship-pass-gates` 32 PASS / 2 KNOWN-RED
/ 0 FAIL, seam rule PASS (re-run at f67addb); `lounge-pass-gates.mjs` PASS all 31; node:
verify-shadow-calm (35), verify-shadow-coverage, verify-fleet-airframes,
verify-mobile-enhanced, verify-mobile-bloom, verify-attribution all green.
ESLint: no new errors in any touched file (FlyScene.jsx 26/2 = main).

**Owner checks (section 9).** RTX 5080: step 3 (`?flags=TERRAIN_SHADOW`, Alps
golden hour, valley luma drop and 60 s shimmer), step 4
(`?flags=TRAFFIC_SHADOWS&airports=on`, KJFK touchdown), step 5
(`?flags=AIRFRAME_SHADOW`, chase orbit at a 10 deg sun), step 7 (photo
export, no frame over 2 s), `?flags=SHADOW_REACH` at Medium,
`?flags=HANGAR_EXPOSURE` (white nose). iPhone: step 6 (photo at 2,560 px or
more, after the merged-tree flip) and step 10 (`?flags=MOBILE_ENHANCED`
glance).

**Contract requests (to FRAME, accepted, on its branch).** A general
device-class pin, and touch PHOTO_HIRES `maxScale` 3.

**Known issues.** (1) The heavy lock was still deadlocked at 09:20 (since
about 07:57) by an orphaned RELEASE `next-server` (pid 28356, :3135) that
inherited the lock fd. This agent was denied permission to kill it, and the
lead has been told. LIGHT's run script now starts its server with `3>&-`.
**Queued LIGHT browser batches** run on their own once the lock frees, each
under 25 minutes. Stop one by killing its `flock ... run-session.sh <X>`
process. Output goes to `.graphics-review/ship-pass/light/`:
`sessionB.out` (verify-photo-hires desktop / phone / off, plus the
terrain-off / terrain-on arms with the 60 s still diff and the phone-off /
phone-mobile / phone-on arms, into `review/`), `sessionC.out` (desktop-on,
medium-on, airframe-off / airframe-on, hangar-off / hangar-on into
`review-c/`, plus verify-photo) and `sessionD.out` (lounge-off /
lounge-casters / lounge-blobs at KJFK into `review-d/`, plus verify-hangar).
Every arm's `report.json` records page and shader errors, LIGHT telemetry,
sampler counts and context loss. For terrain-shadow luma, compare
`review/terrain-off.png` with `review/terrain-on.png`. (2) A pre-existing
venue harness defect: on desktop, `_boot.js`'s
`.fixed.inset-0 canvas` wait resolves to a hidden first canvas and times out
after the reveal (CITY hit it too). The LIGHT harnesses wrap bootFly, and
existing gates run through a scratch preload; `_boot.js` is not edited.
<!-- SHIP PASS LIGHT report end -->

### RELEASE

<!-- SHIP PASS RELEASE report begin -->
**Status (2026-10-30, cloud venue, branch `ship/release`): IN PROGRESS.**
Order: P0 (RL-11, RL-2, RL-3, RL-1) then P1 (RL-4, RL-6, RL-9, RL-5) then P2
(RL-10, RL-7, RL-8). Gate: `node scripts/verify-ship-release.mjs` (node, no
browser). Every number below is the cloud venue's (offline fixture,
SwiftShader); nothing here is a 5080 or iPhone result.

| ID | Status | What landed / evidence |
|---|---|---|
| RL-11 | done | `CinemaTitle.jsx`: the Takeoff & Landing row reads "Real runways, worldwide."; the Continue sub-label "From the gate" shows only while `GATE_TO_GATE` is on (falls back to "Takeoff & landing"). No testid moved. Gate rows T1–T3. |
| RL-2 | done (flag ON) | `lib/fly/challenge.js` implements the W0 stub: `challengeOn()`, `resolveChallenge()`, `saveChallenge()`, the pure `resolveChallengeState()` and `CHALLENGE_TEMPLATE_IDS` (`buzz-tower`, `night-buzz`). Pin `window.__flyChallengeOverride` (true/false, 'on'/'off', `{enabled}` — so `?flags=CHALLENGE` / `?flags=-CHALLENGE` works on a phone). Migration: saved `fly-crash-mode='stakes'` → Challenge on (written `'1'` once), `'forgiving'` → off (written `'0'`), absent → off and nothing written. Consumers: the `fly-settings.js` RELEASE stakes block (crashes follow Challenge with the layer on), `JuiceSystems.jsx` (no combo chain, no near-miss scan or its shake, no run summary, no tower-buzz score or shake when calm; touch-and-go still scores), `juice.js` (`scoreEvent(…, chain)`), `contracts.js` (the buzzes are dealt only with Challenge on; the daily pool is the calm pool for everyone), and the Settings row ("Challenge mode: On/Off", testids `settings-stakes` / `pause-stakes` kept; a click writes both keys). The boost meter is untouched. Harness posture: `verify-crash` (stakes sessions; 9a reads the Challenge row) and `verify-juice` pin Challenge on; `verify-daily` c2 documents the new pool rule (registers the R24 `_node-resolve` hook, since `contracts.js` now imports `challenge.js`). Evidence: verify-ship-release A1–A20 — **flag off equals the W0 tree** (`git archive 940b751`, or recorded goldens on a shallow clone) for crashStakesOn() in 4 storage states, the daily pool, 400 days of daily picks, contract eligibility over 24 world contexts, and the juice scoring sequence; flag on: fresh profile calm with no crash, the migration table, the calm daily pool, buzz dealt only with Challenge on, ×1 with no chain when calm, W0 juice sequence when on. `verify-daily` 28/28 (flag on); `verify-living-contracts` DAY_A/DAY_B still draw different pairs (A12). |
| RL-1 | in progress | **Node reds fixed (retired from `ship-pass-known-reds.json`):** `verify-r25-front-door` 70/0 — the r25-w0 baseline now comes from the tag when present, else from committed fixtures `scripts/fixtures/r25-w0/{front-door,use-overlay-back}.js` (fetched from origin at db78bdf via the GitHub contents API; `scripts/_r25-w0-baseline.mjs` re-hashes each to its recorded git blob id and throws on drift — proven by tampering one byte); `verify-encounters` 10/10 — the GLB check measured the loose node box (C-17 hinge nodes → 53.45 m), now the precise skin box that `computeModelCorrection` scales by; `verify-living-earth` 19/19 — LOAD_GUARD made provider-empty `no-data` tiles count as ready, so the row now asserts `noDataCountsReady()` for no-data and a hard hold for a provider failure (`state:'error'`); `verify-finalize-pace` 22/22 — every source read normalizes CRLF (on a simulated CRLF tree: main's gate 21/1, fixed 22/0); `verify-cinematic-earth` 9/9 — the fleet rebuild (9ba95e8) presents every aircraft through FLEET_PRESENTATION in every visuals state, and the Vector v4 carries a seventh "Service markings" material: the rows now assert the physics length, a hero + mobile model on disk, one look per profile, the six roles, and the recorded 20,000 / 6,000 triangle limits. | **Browser reds ported to today's UI (source fixed; rows kept until one owner run, since each launches `channel:'chrome'` on live data):** `verify-lounge-promotion` accepts the cinema title's `tcn-row`; the phone legs of `verify-operations-design` / `-touch` drive the compact `MobileFlightDeck` (the 'Flight setup' sheet, the one 'Parking brake' toggle with `aria-pressed`); `verify-mobile-flight-deck` seeds a returning player's tutorial preference so the first-flight tips card no longer takes the sheet's close tap (the overlap itself is a Takeoff & Landing backlog note). `verify-r25-front-door` (8g) follows RL-5: the legacy OG domain is gone and `metadataBase` follows `NEXT_PUBLIC_SITE_URL`; the passport key is still pinned (70/0). `verify-r25-flight-plan` now runs on a clone without the r25-w0 tag (five more hash-verified fixtures through `pinnedShow(ref, rel)` in `scripts/_r25-w0-baseline.mjs`, also used by its `?r25bw0` SSR loader) and its 6a/7a count the grown catalogs (13 aircraft × 11 destinations, the R25 size as a floor): 45/3 here, exactly the known 7h/8a/8b, which need an owner-sanctioned baseline. `verify-mobile-layout`'s intermittent React 'Cannot commit the same tree' error was not reproduced or attributed here and stays listed. **CI reproduction** (`.github/workflows/explorer-beta.yml`, every heavy step under the heavy lock): see Gates.
| RL-3 | done (flag ON) | `PLAYER_SURFACE.enabled:true`. A saved Neon / Classic player migrates once to Day / Enhanced and the next boot stays there; automation and `?graphicsReview=1` keep both rows. `verify-player-surface` 6/6 (its "shipped" row now asserts the migrated default; legs (1)–(5) unchanged); verify-ship-release R1–R2. The phone credit bar: see the browser smoke below. |
| RL-4 | built (flag off until its browser check) | `lib/fly/deep-link.mjs`: a pure `parseDeepLink()` for `?watch=<ICAO>` (the 180 featured lounge airports), `?fly=<destinationId>`, `?at=<lat>,<lon>[,<altFt>]` (500–45,000 ft; a `poi:` point destination that flight-plan's own validator accepts) and `?journey=<adventureId>`, with optional `&aircraft=<id>`; strict patterns then catalog lookups, so a refusal never echoes the URL; `buildDeepLink()` (Copy link only builds links the parser accepts; base `NEXT_PUBLIC_SITE_URL` else the origin), `stripDeepLink()`, and the one-shot `consumeDeepLink()` (parsed once, `history.replaceState` strips the link, other parameters such as `?flags=` kept). Pre-mount: the front-door RELEASE entry block opens a linked session on the title; the flight-plan RELEASE spawn block stages the title where the link points (lounge airport, destination, point, or the journey's first leg), so the world streams there from boot. Both act only with DEEP_LINKS on; a harness bypass pin and an injected node `env` win. `components/fly/hud/DeepLinkHost.jsx` (FlyMode RELEASE mounts) waits for the boot reveal (`__flyBoot.pct === 100`, which LOAD_GUARD bounds) and opens the mode the title's own buttons open (`launchSetup` for Free Flight, `airportWatch.enter` for a lounge, `adventures.prepare` for a journey's briefing); it stands down if the player leaves the title, and an invalid or failed link leaves one quiet, self-fading line (`deep-link-notice`). Copy link (`components/fly/hud/CopyLink.jsx`, lucide icons, `link_copied{kind}`): featured airport cards (`copy-link-airport-<id>`), the journey brief (`copy-link-journey`), the Atlas destination card (`atlas-copy-link`) and Pause (`pause-copy-link`, the current place via a `currentPlace` runtime-bus action). Gate rows D1–D10: 9 valid, 7 no-link, 31 invalid / junk / range / injection cases, no echo, every catalog row linkable, round trip, strip, one-shot. `verify-r25-front-door` 70/0, `verify-title-cinema` 22/0. |
| RL-6 | done (flag ON) | `lib/fly/analytics.js` implements `track()`: an explicit `SCHEMA` (the ten RL-6 events plus the seven pre-pass adventure events, each field an enum, boolean, bounded number or short token — no free text, location, aircraft identity or screenshot), `sanitizeEvent()`, a `before_send` `sanitizeWire()` that keeps only schema fields and the SDK identity keys (no URL, referrer or IP; GeoIP off), one consent (`fly-analytics-consent`, the key the adventure checkbox already used; error telemetry rides it), and the existing posthog-js integration loaded only after 'yes' (no new provider). `adventure-analytics.js` is a thin wrapper under the flag (pre-pass bodies untouched with it off). Emitters: `session_start`, `mode_entered`, `session_end{minutes_by_mode, preset, device_class}`, `perf_summary` from FRAME's `frameSessionSummary()` (sent only when it reports values; the W0 stub's nulls send nothing) and `lounge_movement_watched` (`components/fly/hud/ReleaseAnalytics.jsx`, 1 Hz, outside the frame loop); `deep_link_opened` / `link_copied` (RL-4); `challenge_toggled` (RL-2); `client_error{kind:'boundary'}` (`FlyErrorBoundary`; FRAME sends `context_lost` / `shader_link`); `pack_interest` now emitted from the Wild Earth debrief (persisted in `progress.interest`, asked once). `components/fly/hud/ConsentPrompt.jsx`: non-blocking, never-asked players only, raised **on the title** once a first flight is complete (a flight of ≥ 1 min that ends, or 5 min in one; this visit or an earlier one), once per visit, never mid-flight (a lower-left card would sit on a phone's flight stick) and never under automation; it sits above the title's measured imagery-credit reserve (`use-title-credit-reserve.js`, shared with the RL-8 install hint) (`consent-prompt` / `consent-share` / `consent-decline`; rows N11, W11); the Settings row is the existing checkbox, relabelled under the flag (`settings-analytics-consent`). Gate rows N1–N10: unknown events dropped, 16 field cases, schema = RL-6 + legacy, before_send, **no consent (never asked or 'no') → 80 track() calls load and queue nothing**, flag off → W0 no-op, consent + key → the SDK loads (positive control). `verify-adventures` 15/15 (now loads `adventure-analytics` after the R24 resolve hook). |
| RL-5 | done (per-mode 5080 cards: owner) | `app/layout.js`: `metadataBase` from `NEXT_PUBLIC_SITE_URL` (unset → Next's build-time fallback: the Vercel production URL on Vercel, else `http://localhost:3000`, which the venue's unset build measured in og:image — **a self-hosted deploy must set `NEXT_PUBLIC_SITE_URL`**), the legacy `shadowadsb.app` URL removed, the description leads with the real Earth, Open Graph and Twitter carry a 1200×630 card. `public/og/skyloom.jpg` is a cover crop of an in-game Photo-shutter capture (`public/adventures/canyon-discovery.webp`, captured 2026-10-01 on the owner's production build, attribution strip kept; provenance in `public/og/README.md`), not a venue render. `public/manifest.json`: real-Earth description (no Neon), `id` and `scope` added. Gate rows M1–M4, plus the browser `meta` leg reading the built HTML. Per-mode cards captured on the 5080 need a server-rendered page wrapper to vary per link: owner item. |
| RL-9 | done (owner run for the 5-minute count) | `lib/fly/poi-ground.js` wraps the bucketed `TerrainGroundQuery` (one per map; `terrain-ground-query.js` untouched): only the resident tile under the POI answers (no covering tile → null) and nothing raycasts, so three-tile's `console.assert(r.object.visible)` — fired when the old `getElevationAt` raycast hit a TERRA_PACE-parked tile — has no path left; each POI keeps its finest answer (`elev`, `elevZ`) until a finer tile lands. `PoiLetters.jsx` samples through it, and its two react-hooks errors are fixed (the ref mirrors moved into layout effects; ESLint 2 → 0). Gate rows P1–P5. The browser legs count console asserts; the 5-minute flight + lounge session count is owner run list 5080 #4. |
| RL-10 | done | `save-backup.mjs` whitelists `fly-challenge-v1` ('0'/'1'), `fly-frame-rate-v1` (FRAME's modes '60'/'display'/'30') and `fly-flight-history-v2` (rows re-normalized by `normalizeHistoryRow`; one bad row rejects the backup). Gate rows S1–S4. `navigator.storage.persist()` is requested once, at the first completed flight (`ReleaseAnalytics.jsx`, `fly-storage-persist-v1`; no flag). |
| RL-7 | done | `lib/fly/entitlements.js` `currentGrants()` returns a frozen `[]` and is the default `grants` of `contentAccess()` (`content-access.mjs`), so it is the only grants source; `app/api/entitlements/route.js` answers `{grants: []}` (`no-store`) unless the server-only `SKYLOOM_GRANTS` names known pack ids; `lib/fly/offer.mjs` describes the free core and the Pass as data with no prices, currencies or purchase URLs. Gate rows E1–E7: every one of the 9 `contentAccess` call sites passes grants through the resolver, and all 33 content ids answer exactly as with `[]`. |
| RL-8 | done (flag ON; warm boot and Lighthouse installable: owner) | `public/sw.js` caches first-party static assets only — Next's hashed chunks cache-first; models, materials, HDRIs, textures, fonts, audio, data, atlas, icons, share and journey art stale-while-revalidate; the title shell network-first — under a versioned key (`skyloom-shell-v1`; an activate drops older versions). It never answers `/api/*`, provider tiles, ADS-B, weather, analytics, ranged reads or anything cross-origin (those fall through untouched). `lib/fly/offline-shell.js` registers it in production only, after the load event and an idle period (never in the first minute's critical path), and under automation only when pinned (`?flags=OFFLINE_SHELL`); it then offers the worker what the first visit already loaded, so one visit is enough for an offline launch. With the flag off it is the kill switch: it unregisters the worker and deletes its caches. `components/fly/hud/OfflineShell.jsx` (FlyMode RELEASE mounts, whatever the flag) hosts both and the install hint: touch devices (`deviceClassOf()` phone or tablet), the second visit after a completed flight, never installed or dismissed (`install-hint`, `install-hint-install`, `install-hint-dismiss`; the browser's install prompt is captured only for that player). `next.config.mjs` (RELEASE-owned headers) serves `/sw.js` no-cache. Gate rows W1–W10 (the allowlist in 22 cases, the LIVE fetch and warm handlers run in a VM, the production-only and kill-switch table, deferral, the hint rule); the browser half is `scripts/verify-offline-shell.cjs` (unpinned automation registers nothing; one visit warms the cache with only allowlisted entries; a controlled boot reaches reveal; with the server stopped an offline launch is answered by the worker and shows the title; `?flags=-OFFLINE_SHELL` unregisters and deletes the caches). |

**Flags.** `CHALLENGE_LAYER` **ON** (behaviour, not look: its acceptance is
measurable here and its node gate passes). `PLAYER_SURFACE` **ON** (D11;
node-proven migration, owner glance in run list). `OFFLINE_SHELL` **ON**: its
three landing conditions are measured in the venue (production-only
registration, the cache allowlist live and in node, an offline launch showing
the title); the kill switch unregistered the worker in the browser and its
cache residue is fixed and node-gated (W12), browser re-run pending.
`ANALYTICS_V2` **ON**: session S1b (production build, PostHog host
intercepted) saw zero analytics requests on all six legs with the flag on and
no consent, "No thanks" persisted, and the 'yes' leg is the positive control.
`DEEP_LINKS` is built and stays off until its last browser row (`?watch=`)
passes; it lands ON in its own commit.

**Gates (venue).** `verify-ship-release` 80/80 (node); `verify-player-surface`
6/6; `verify-daily` 28/28; `verify-r25-front-door` 70/0; `verify-title-cinema`
22/0; `verify-attribution` 4/0; `verify-r25-flight-plan` 45/3 (the known
7h/8a/8b); `npm audit --omit=dev --audit-level=high` 0 vulnerabilities;
`ship-pass-gates --quick` 33 PASS, 0 KNOWN-RED, 0 FAIL, seam rule PASS.
ESLint on every file the branch touches: no new errors or warnings
(`PoiLetters.jsx` 2 → 0; `FlyMode.jsx` 1 error + 1 warning = main's).

**Venue evidence (fixture + SwiftShader, correctness only; logs under
`.graphics-review/ship-pass/release/`).** Session 1, production build
`.next-release` (2 min) with a test PostHog key whose host is intercepted:
`verify-offline-shell` 8/9 — unpinned automation registers nothing; one pinned
visit registers the worker at `/` after load + idle and caches the title shell
and all 9 page scripts (73 entries, every one first-party and allowlisted); a
visit under the worker boots on the fixture to reveal with zero page errors;
**with the server stopped, an offline launch is answered by the worker
(`fromServiceWorker`, 200) and shows the title shell with zero page errors**;
the kill leg unregistered the worker but found `skyloom-shell-v1` re-created
(an unregistered worker still serves its page) → fixed by the retire message
(W12), browser re-run pending. `verify-ship-release-browser`: meta (no legacy
domain; the manifest leads with the real Earth; og:image measured at
`localhost:3000` on an unset build → RL-5 note), off leg (all four flags off:
a `?fly=` link does nothing, zero analytics requests, zero page / shader errors,
zero console asserts), consent positive control (the intercepted host sees
the SDK's config requests within 35 s). The `?fly=` leg consumed and stripped
the link but never left the title → diagnosed (the launcher read the store's
pre-spawn 'hangar' screen as "the player left") and fixed (D11); re-run
pending.

**Owner checks (section 9; nothing here is a 5080 or iPhone result).**
- 5080 #1 (production build): a warm boot to reveal with the worker installed
  vs W0.6 (RL-8), and Chrome's install prompt / Lighthouse "installable".
  `?flags=-OFFLINE_SHELL` once removes the worker (DevTools → Application).
- 5080 #4 / #8: no `Assertion failed` in the console over a 5-minute flight and
  a lounge session (RL-9); a private window boots calm (no crash on a
  commanded dive, no combo chip, no tower buzz in Contracts); Settings →
  "Challenge mode" On restores today's arcade layer; `?flags=-CHALLENGE_LAYER`
  is the pre-pass game (RL-2).
- 5080 #9: each deep-link kind — `?fly=grand-canyon`, `?at=36.1,-112.1,9000`,
  `?watch=KJFK`, `?journey=manhattan-skyline`, `&aircraft=glider`, and a junk
  link (quiet notice); Copy link on an airport card, a journey brief, the Atlas
  card and Pause (RL-4; while DEEP_LINKS is off add `&flags=DEEP_LINKS`).
- iPhone #7 / #8 / #9: a deep link from Messages; Add to Home Screen (the
  install hint shows on the second visit after a completed flight); the
  consent card on the title after a first flight, and "No thanks" sticks
  (RL-6; `&flags=ANALYTICS_V2` while it is off).
- Per-mode 1200×630 share cards captured on the 5080 (RL-5), and
  `NEXT_PUBLIC_SITE_URL` set on any self-hosted deploy.

**Known issues.** The airport-buzz *toast* (`SpotToast.jsx`, not a RELEASE
file) still shows when a calm player buzzes a tower; it no longer scores,
shakes or advances a contract. `verify-crash`, `verify-juice`,
`verify-living-contracts` and `verify-poi` launch `channel:'chrome'`, which
this container does not have.
<!-- SHIP PASS RELEASE report end -->

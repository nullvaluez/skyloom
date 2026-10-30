# Ship Pass — plan and record (2026-10-30)

Status: **W0 landed 2026-10-30 in the cloud venue (section 4.1); the five
streams are running in worktrees (section 3.8).** This file is the plan, the requirements
and (as the pass runs) the record for a five-agent parallel pass, in the
FLY_PLAY_PASS.md format. Each stream adds its report under "Stream reports"
in its first commit and updates it on every landing.

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
(not started)
<!-- SHIP PASS FRAME report end -->

### SKY

<!-- SHIP PASS SKY report begin -->
(not started)
<!-- SHIP PASS SKY report end -->

### CITY

<!-- SHIP PASS CITY report begin -->
(not started)
<!-- SHIP PASS CITY report end -->

### LIGHT

<!-- SHIP PASS LIGHT report begin -->
(not started)
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
| RL-1 | in progress | **Node reds fixed (retired from `ship-pass-known-reds.json`):** `verify-r25-front-door` 70/0 — the r25-w0 baseline now comes from the tag when present, else from committed fixtures `scripts/fixtures/r25-w0/{front-door,use-overlay-back}.js` (fetched from origin at db78bdf via the GitHub contents API; `scripts/_r25-w0-baseline.mjs` re-hashes each to its recorded git blob id and throws on drift — proven by tampering one byte); `verify-encounters` 10/10 — the GLB check measured the loose node box (C-17 hinge nodes → 53.45 m), now the precise skin box that `computeModelCorrection` scales by; `verify-living-earth` 19/19 — LOAD_GUARD made provider-empty `no-data` tiles count as ready, so the row now asserts `noDataCountsReady()` for no-data and a hard hold for a provider failure (`state:'error'`); `verify-finalize-pace` 22/22 — every source read normalizes CRLF (on a simulated CRLF tree: main's gate 21/1, fixed 22/0); `verify-cinematic-earth` 9/9 — the fleet rebuild (9ba95e8) presents every aircraft through FLEET_PRESENTATION in every visuals state, and the Vector v4 carries a seventh "Service markings" material: the rows now assert the physics length, a hero + mobile model on disk, one look per profile, the six roles, and the recorded 20,000 / 6,000 triangle limits. |
| RL-3 | done (flag ON) | `PLAYER_SURFACE.enabled:true`. A saved Neon / Classic player migrates once to Day / Enhanced and the next boot stays there; automation and `?graphicsReview=1` keep both rows. `verify-player-surface` 6/6 (its "shipped" row now asserts the migrated default; legs (1)–(5) unchanged); verify-ship-release R1–R2. The phone credit bar: see the browser smoke below. |
| RL-10 | partial | `save-backup.mjs` whitelists `fly-challenge-v1` ('0'/'1'), `fly-frame-rate-v1` (FRAME's modes '60'/'display'/'30') and `fly-flight-history-v2` (rows re-normalized by `normalizeHistoryRow`; one bad row rejects the backup). Gate rows S1–S4. `navigator.storage.persist()` not yet wired. |

**Flags.** `CHALLENGE_LAYER` **ON** (behaviour, not look: its acceptance is
measurable here and its node gate passes). `DEEP_LINKS`, `ANALYTICS_V2`,
`OFFLINE_SHELL` off (not landed yet). `PLAYER_SURFACE` **ON** (D11; node-proven migration, owner glance in run list).

**Gates (venue).** `verify-ship-release` 29/29; `verify-player-surface` 6/6; `verify-daily` 28/28;
`ship-pass-gates --quick` 31 PASS, 2 KNOWN-RED, 0 FAIL, seam rule PASS.
ESLint on every touched file: no new errors (JuiceSystems.jsx 3 = main's 3).

**Owner checks.** Run list 5080 #8: a private window boots calm (no crash on a
commanded dive, no combo chip, no tower buzz in Contracts); Settings →
"Challenge mode" On restores today's arcade layer; `?flags=-CHALLENGE_LAYER`
is the pre-pass game.

**Known issues.** The airport-buzz *toast* (`SpotToast.jsx`, not a RELEASE
file) still shows when a calm player buzzes a tower; it no longer scores,
shakes or advances a contract. `verify-crash`, `verify-juice`,
`verify-living-contracts` and `verify-poi` launch `channel:'chrome'`, which
this container does not have.
<!-- SHIP PASS RELEASE report end -->

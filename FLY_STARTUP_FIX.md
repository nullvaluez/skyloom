# Launch and world-loading fix — 2026-10-31

The owner reported broken initial launch/loading and a world that takes too long
to render. These changes are on the local `main` working tree. They change
scheduling and readiness; no graphics preset, shader appearance, scenery budget,
or loading timeout has been reduced.

## Causes and corrections

1. **The flight bundle's loading fallback was a blank background.** The route
   and dynamic import now share a small, dependency-free launch status. It is
   visible before the flight JavaScript arrives, including during scenery-worker
   preparation. The existing service-worker handshake remains ordered before
   flight imports.
2. **Cloud shaders blocked the main thread on first draw.** The pass initialized
   unused Classic shaders while the default Enhanced programs compiled on first
   use. A local Chrome CPU profile attributed a roughly 4.96-second synchronous
   `getProgramInfoLog`/uniform initialization stall to `ImmersiveCloudPass`.
   The pass now dispatches its exact active march/filter/composite programs
   through the existing cancellable parallel-compile helper. While covered, it
   waits to draw until they are ready. Cloud readiness participates in the
   loading gate; context loss, retry, disposal and unsupported drivers retain
   explicit behavior. Terrain fetches and worker callbacks can progress during
   the driver's compile.
3. **Boot compiled unused lighting profiles.** The required measured-world
   batch was 57 programs on desktop High and 76 on Ultra. It is now the 19
   programs for the actual current cascade profile. Critical terrain follows
   the same rule. Other reachable profiles remain retained background jobs.
   Optional work cannot race the boot drain or begin before reveal, and cannot
   replace the active readiness record's context-loss owner.
4. **Cold terrain requests did not prioritize the destination.** Initial spawn
   now uses the existing bounded arrival burst. Its cold prefetch warms complete
   coarse sibling sets instead of beginning at z8; the existing limit remains
   48 URLs and six concurrent prefetches. During loading, quadtree traversal
   spends loader slots on the nearest branch first. Scene-child order, zoom
   thresholds and steady-flight traversal remain unchanged. Mountain spawns
   no longer lose arrival priority because their ground elevation is initially
   unknown.
5. **Readiness waited on unrelated downloads and could stay bypassed forever.**
   Adequately resolved local terrain can now satisfy terrain readiness while
   the horizon continues streaming. Other world-content gates still apply.
   A loading time cap releases hidden terrain but no longer discards the
   eventual shader completion; a matching subsequent frame can certify it for
   later arrivals. The loading label identifies fleet/shader work when that is
   the remaining blocker.

## Browser evidence

Production build, live providers, local headless Chrome using ANGLE/D3D11 on an
RTX 5080. Fresh browser contexts, saved Grand Canyon destination, Enhanced,
shader diagnostics enabled. Automation normally starts at High; the Ultra row
explicitly saves Ultra and verifies three active cascades. Phone is a Chrome
390×844/DPR-2 layout and mobile budget test on this same desktop GPU, **not an
iPhone performance result**.

| Final run | Boot curtain | Next nearby arrival | Result |
| --- | ---: | ---: | --- |
| Desktop High, two cascades | 18.165 s | 1.018 s | Ready, no deferred terms |
| Phone layout, one cascade | 16.209 s | 1.006 s | Ready, no deferred terms |
| Desktop Ultra, three cascades | 19.358 s | 1.011 s | Ready, no deferred terms |

All three: initial launch feedback visible with flight scripts held; nine of
nine world terms ready; cloud and critical terrain programs ready; 19 active
world variants; reveal reason `content`, never `time-cap`; Continue works;
second arrival completes; curtain disappears; zero uncaught page errors.
Post-curtain screenshots show terrain, clouds and aircraft. An earlier final-code
desktop run completed in 16.359 s and phone-layout run in 13.804 s, illustrating
run-to-run variation; these are observations, not a universal startup target.

The initial development reproduction exhausted the 20-second curtain cap with
terrain/shaders still pending. Its cold development bundle also delayed the
loading UI, so its wall time is not a valid production speed comparison. A
partially fixed production run still hit the cap; that led to the cloud CPU
profile and final correction. Shader compilation remains expensive, especially
on cold Ultra. Provider latency, driver caches and actual phone behavior can
change these timings; the existing explicit reduced-detail/capped fallback is
still necessary.

Reproduce against a production server (default `http://localhost:3095`, or set
`FLY_URL`):

```powershell
node scripts/verify-startup-browser.cjs --live
node scripts/verify-startup-browser.cjs --live --phone
node scripts/verify-startup-browser.cjs --live --ultra
```

Run these serially to avoid GPU contention. Omitting `--live` uses the local
world fixture. JSON and title/flight screenshots are written to
`.graphics-review/startup/` (ignored local evidence).

## Verification and limits

- Production build passed using `.next-startup-prod`.
- New startup regressions: 8/8; critical terrain: 18/18; cinema profiles: 7/7;
  cloud calm: 6/6; living earth: 19/19; load guard: 4/4; front door: 70/70;
  vendor integrity: 34/34; import integrity: 4/4 over 1,331 files.
- New and otherwise clean changed files pass ESLint. `FlyScene.jsx` and
  `PrewarmRig.jsx` already report 26 and 5 React compiler lint errors on HEAD;
  the same diagnostics remain. They were not suppressed to report a clean lint.
- `verify-measured-world-prewarm.mjs` has an existing captured-program-key
  mismatch (Program 200, old building shader key). It fails on unchanged HEAD
  as well. The historical capture was not regenerated. The other 14 checks
  pass when that row is explicitly isolated in the local diagnostic runner;
  the committed full test is still red. New startup tests independently verify
  active-profile counts, readiness and background context-loss ownership.
- Browser coverage is Grand Canyon, Continue and a nearby warp, not a global
  scenery soak or real-iPhone certification. No deployment was performed.

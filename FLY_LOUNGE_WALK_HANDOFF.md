# Lounge walk — session handoff

For the next Claude Code session. Owner decision, 2026-10-13: **build the
lounge walk first**, ahead of W1 (takeoff & landing). This file is the
kickoff: where things stand, what to build, the rules, and how to prove it.

Read these first, in order:
1. `CLAUDE.md`, the top banner only.
2. `FLY_GATE_TO_GATE.md`: the record, the seam rule, the contract table, the flag registry and **the W4-0 and W4 N ownership lists**.
3. `FLY_GATE_TO_GATE_PLAN.md` sections **W4-0** and **W4 N WALK & SIT**, plus "Rules every stream follows".
4. `FLY_OBSERVATION_LOUNGE.md`, the record of how the lounge was built.
5. The detailed design: `.graphics-review/gate-to-gate-plan/design-lounge.json`, steps **W0-2** (numbers), **W0-3** (eye, aperture and posture plumbing) and **W1-B** (walk and sit). These are local and gitignored; read them with node. Where a design and the plan disagree, the plan wins.

## Where things stand

- **`main`** carries Gate to Gate W0 (contracts and seams, nothing visible; record in `FLY_GATE_TO_GATE.md`) up to `1a75429`, then three more commits:
  - `1846ba4` the lounge **promoted to desktop players now** (`LIVING_AIRPORTS.enabled: true` in `lib/fly/airport-feature-policy.js`): "Watch an airport" on the title card and the Atlas pill with no URL parameters. Phones and tablets stay excluded.
  - `abbabec` `scripts/verify-lounge-promotion.cjs`, written but **not yet run** (task 0).
  - this handoff.
- **Nothing is pushed.** Pushing is the owner's call.
- **Flags.** The three lounge flags exist, all `enabled:false`, read through `lib/fly/ops-flags.js`: `loungePier()`, `loungeWalk()`, `loungeBridge()` and `loungeVariant()` ('classic' until LOUNGE_PIER). Turn one on for a page load with `?flags=LOUNGE_WALK`.
- **Already done in W0, don't redo:**
  - the session seat cache moved to `lib/fly/lounge-site.js` (`resolveSessionSite`, `sessionSiteSync`, keyed ident|variant);
  - the stale "Return to the lounge" pill is cleared on exit to title and on any launch (`verify-airport-lifecycle` 24/24);
  - `lib/fly/lounge-bridge.js` exists as an empty slot;
  - `lib/fly/player-visibility.js` and `lib/fly/camera-mode.js` exist;
  - `runtime.simHold` has a `'lounge'` reason.
- **What the owner sees today:** the seated lounge (drag to look, wheel zoom, click a plane, binoculars). **You cannot walk.** That is this job.
- **The owner is running `next dev` on port 3000 in `C:\Users\bfecho\skyloom-3`.**
  - Do not run harnesses against it.
  - Do not start a second `next dev` in that checkout (it fails on `.next/dev/lock`).
  - Every edit you make in that checkout hot-reloads under the owner while they test.

## Scope

1. **W4-0, lounge contracts** (behaviour identical, every lounge gate unchanged). Do all of it, since the pier and bridge build on the same plumbing. Per the plan and design W0-2/W0-3:
   - `observation-config` sections (`LOUNGE_PIER_ROOM`, `VANTAGE`, `WALK`, `PIER_SET`, `SEAT_BACK`, budgets) and `roomVariant()`;
   - `loungeApertureFrom(eye, …, variant)`;
   - watch `eyeLocal`/`eyeWorld`, `posture`, `seats`, `lookLimits`, the `walk`/`cinematic` hook points, `enter(id, {origin, keepFlight, seat, faceStand})`, `exit()`, `handoff()`;
   - `clampYawAround` / `walkBob`;
   - the audio listener uses `eyeWorld`;
   - classic room blockers;
   - additive layout fields;
   - `scripts/_tri-bvh.mjs` (byte-identical AO bake);
   - LoungeHud/LoungeHeader slots;
   - the `verify-lounge-walk.mjs` skeleton;
   - a "Lounge, further" plan section in `FLY_OBSERVATION_LOUNGE.md`.

   Skip the items W0 already did (above).
2. **W4 N, WALK & SIT** (`LOUNGE_WALK`), on the **classic** room (3 vantage seats: window, corner-left, corner-right). Per design W1-B:
   - `lib/fly/lounge/room-walk.mjs` (pure): a 0.1 m grid of floor minus blockers inflated by the body radius; sliding collision; A* plus string-pulling; deterministic seat glides ≤3 s (a 0.3 s veil cut under reduced motion); the sit prompt.
   - `lib/fly/lounge-walk-runtime.js`: the posture machine; standing eye 1.65 m, seated 1.18 m; walk 1.4 m/s, Shift run 2.4 m/s; a camera-only bob that is zero under reduced motion.
   - WASD + Shift captured in the capture phase so flight input never sees them; **no pointer lock** (the cursor stays the picker); Enter sits at the prompt; click a chair to sit; V or the "Seats" button opens the SeatMenu; footsteps on the room bus.
   - Testids: `lounge-seat-menu`, `lounge-seat-<id>`, `lounge-sit-prompt`, `lounge-seats`. `lounge-face-runway` is kept.
3. **Out of scope** (later, unless the owner says otherwise): the pier room (W4 M), the pier set and back seats (W4 O), the bridge (W4 P), and all of W1–W3.

## Rules

- **Flags off is byte-identical.** Every lounge gate passes unchanged with LOUNGE_WALK off, and again with it on where the plan says so.
- **Work in a worktree, not in the owner's checkout.**
  - Create `C:\Users\bfecho\skyloom-g2g\lounge-walk` on a branch from `main`.
  - Junction `node_modules` with PowerShell `New-Item -ItemType Junction`.
  - Run `node node_modules/next/dist/bin/next dev --webpack -p <free port>` there (Turbopack refuses the junction).
  - Merge `--no-ff` to `main` at the end of W4-0 and again at the end of N, and tell the owner each time so they can refresh.
  - Before removing the worktree, delete the junction non-recursively (`[System.IO.Directory]::Delete(path)`), then check that `node_modules/three/package.json` still exists in the main checkout.
- **Files are CRLF.** Use the Edit tool. Any scripted replacement must normalise CRLF and assert that it matched.
- **Run node directly:** `node scripts/x.mjs`, `node node_modules/next/dist/bin/next build`.
- **Never push.** No attribution trailers in commits.
- **Seam rule:**
  - Don't edit `FlyScene.jsx`, `PlayerPlane.jsx`, `TrafficLayer.jsx`, `operations-runtime.js` or the flag registry. Lounge input belongs in `LoungeSurface.jsx`; the lounge camera belongs in `airport-watch-runtime.js` `updateCamera` and its `watch.walk` hook.
  - Hot lounge files (`airport-watch-runtime.js`, `LoungeHud.jsx`, `LoungeHeader.jsx`) are edited in W4-0 only.
- **Agent pattern** (owner's standing practice): the orchestrator does W4-0 on the branch, then N runs as one Opus 5 subagent in its own worktree, or the orchestrator does both if that's simpler. Economise on agent count.
- **Comfort:** modest speeds, no FOV change, bob off under reduced motion.

## Verification

Task 0, before anything else:
- run `FLY_URL=http://localhost:<port>/ node scripts/verify-lounge-promotion.cjs` against your worktree's dev server. The URL must have no query parameters.
- Fix anything it finds, and record the result in `FLY_OBSERVATION_LOUNGE.md`.

**Node gates:**
- unchanged: `verify-airport-observation` 45, `verify-airport-lifecycle` 24, `verify-airport-lounge` (AO signature unchanged), `verify-lounge-seat` 6, `verify-airport-set` 17, `verify-fleet-airframes` 13, `verify-airfield-ground` 13, `verify-true-earth-flags` 8, `verify-import-integrity`, `verify-ops-golden` 28/28;
- `verify-airport-audio` 11 → 12 (the delay is computed from the walking eye);
- NEW `verify-lounge-walk.mjs` with the W4-0 contract checks plus at least 18 walk checks:
  - the aperture wrapper matches on 20k directions;
  - `eyeWorld` matches the old eye at k = 1 and k = 1.31;
  - a seeded 50k-step random walk never leaves free space;
  - the eye and near-plane corners keep at least 0.12 m from every room triangle;
  - glides are deterministic;
  - with the flag off the camera never moves.
- NEW `verify-lounge-vantage.mjs`, classic variant: each vantage seat sees the faced runway's TDZ and approach points through glazing, and picking works from every seat.

**Browser gates:**
- NEW `verify-lounge-walk.cjs` with `?flags=LOUNGE_WALK` and real keys and mouse, at least 14 checks:
  - W walks, Shift runs and releasing the key stops;
  - the eye never enters a blocker;
  - Enter sits;
  - a seat-menu jump lands within 3.2 s;
  - the Esc chain is unchanged;
  - `input.keys` never holds WASD;
  - 0 page errors.
- `verify-airport-interaction` 25/25 and `verify-airport-browser-states` 24/24, run flags off **and** with `?flags=LOUNGE_WALK`.

**Review:** `review-observation-lounge.cjs --flags LOUNGE_WALK --seats all` (per-seat PNGs and a walk sequence) at KCMH and one hub.

**Known pre-existing reds**, named in `FLY_GATE_TO_GATE.md`; not yours:
- `verify-r25-flight-plan` 7h/8a/8b;
- `verify-frame-step` (1 check);
- `verify-operations-design`, `-touch`, `-experience`;
- `verify-mobile-flight-deck` (the tips card blocks a tap);
- `verify-sat-night` (SatCityGlow);
- `verify-feel` ("punch decayed").

## Owner checkpoint (end of the job)

Walking comfort and seat choice on the owner's RTX 5080, with `?flags=LOUNGE_WALK`:
- walk and run speed, and the bob;
- collisions with furniture;
- the three vantage seats and the seat menu;
- the Sit prompt;
- nothing is broken when the flag is off.

On sign-off, flip `LOUNGE_WALK.enabled` to `true` in its own commit. The lounge is already promoted, so that ships walking to every desktop player.

Then ask the owner what comes next: the pier room and back seats (LOUNGE_PIER), the bridge (LOUNGE_BRIDGE), or W1 takeoff & landing. Checkpoint 0 (confirming the W0 flag registry) is also still open.

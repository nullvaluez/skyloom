# R25 handoff: finish "Front Door & Clear Sky" in a fresh session

**State as of 2026-09-23 (end of session 1):** `main` = `claude/game-intro-menu-world-mf37eg` = `ec7dc6e` plus this doc.
The game plays exactly as it did at `2c624a3`, because every R25 flag ships `enabled:false`.
The plan is approved; do not re-plan.

## Session 2 state (2026-09-24 ~00:45 UTC) — read this first if the session died

- **The intro is on `main` at `93c28f3`** (E + A + B merged, node gates green, a production build of `28c2d16` succeeded).
  `FRONT_DOOR` and `FLIGHT_PLAN` are ON; `R25_SKY` / `R25_GROUND` are OFF (the Visuals row is hidden).
- **Integration branch** `claude/skyloom-r25-intro-d0pp2v` = main + workflow-script commits + E's round-1 E2 smoke
  (`scripts/r25-e-cert.md` §4d): every product smoke leg is green in toy and satellite, and all four title-era REDs are calibrated.
  Three owner findings remain:
  - **A product:** exit-to-title snapped instead of blending (`lib/fly/title-camera.js`, t11).
  - **A gate:** s2/t6 must use the per-spot radius.
  - **B gate:** freeflight (2) must stage a non-title destination.
- **Running when this was written:**
  - The inline workflow `r25-intro-finish`: the A and B fixes in parallel, then `scripts/r25-workflow.txt` with
    `pass:'intro', smokeOnce:true, reports:{…}` for the merges, one smoke on the red rows, and the scoped close
    (record `FLY_FRONT_DOOR_AND_VISUALS.md`, the `CLAUDE.md` notice).
  - `r25-workflow.txt` `pass:'visuals-early', stopAfter:'fix'` for C and D: code and node gates only until
    `/tmp/r25-locks/intro-pushed` exists. The orchestrator writes it after the intro close is pushed.
- **Workflow modes added this session** (`scripts/r25-workflow.txt`):
  - `pass: intro | visuals-early | visuals`
  - `roles`, `base`, `priorMerged`, `stopAfter:'fix'`
  - `reports`, which skips the build and integrates finished branches
  - `note`, which is appended to every prompt of the run
  - `smokeOnce`, which runs the fixture smoke only after the last merge
- **After the intro close:** push the branch and `main`, `echo <head> > /tmp/r25-locks/intro-pushed`. When C and D return,
  run `pass:'visuals'` with `reports` for c and d and `priorMerged:['r25/e','r25/a','r25/b']`.
- **Lesson:** on this 4-CPU container a workflow runs at most 2 agents at once. Run one workflow per role (or per pair)
  when more parallelism is needed, and never assume a queued agent has started.

## What exists

| Piece | Where | Status |
|---|---|---|
| The approved plan | [FLY_ROUND25_PLAN.md](FLY_ROUND25_PLAN.md): decisions, UX flow, five role charters, verification and risks. The **W0 addendum** holds the as-built wiring and gate baselines. | Done |
| W0 scaffold | `db78bdf` | Done, verified to change no behaviour |
| E CERT phase 1 | `5072a38` (merged as `8323bb6`, scripts only). Notes in `scripts/r25-e-cert.md`. | Done |
| The five-agent workflow | [`scripts/r25-workflow.txt`](scripts/r25-workflow.txt). Takes `args: { intBranch, trailer }`. | Ready |
| Browser-slot lock | [`scripts/r25-run-browser.sh`](scripts/r25-run-browser.sh) | Ready |
| Roles A FRONT DOOR, B FLIGHT PLAN, C SKY, D GROUND | — | **Not started.** Session 1's partial A work was discarded. |

**W0 scaffold contents (`db78bdf`)**
- Owner blocks at the end of `lib/fly/fly-constants.js`: `FRONT_DOOR`, `VISUALS`, `FLIGHT_PLAN`, `R25_SKY`, `R25_GROUND`, `R25_CERT`.
- Store fields `screen`, `flightMode`, `settingsOpen`, `visuals`, plus the `menuOpen()` and `inFlight()` helpers.
- Stub modules `lib/fly/{front-door,flight-plan,visuals-profile,r25-sky,r25-ground}.js`.
- Every FlyScene / FlyMode / FlyCanvas hook the roles fill in.
- Harness pins `__flyTitleBypass` and `__flyVisualsOverride='classic'`.

**E CERT phase 1 contents (`5072a38`)**
- The satellite offline fixture reveals again: 459.6 s with 0 page errors. Toy reveals in 51.5 s.
- WorldCover is served by `scripts/r24-fixture/worldcover.mjs`.
- Helpers: `scripts/_title.js`, `_skip-menus.js`, `_r25-poses.js`, `_r25-luma.js`.
- Gates: `verify-r25-flagoff.mjs`, `verify-r25-smoke.cjs`, `verify-r25-visuals.cjs`.
- Tolerant edits to the legacy harnesses.
- Import-integrity fixed.

**The workflow** runs build → sibling review → fix → integrate (E → A → B → D → C, with a smoke run after each merge) → certify and close. It is kept as `.txt` because its top-level `return` would fail the repo's ESLint and import-integrity checks as a `.js` file.

**The browser-slot lock** allows at most 2 SwiftShader browsers across the whole container.

## Baseline to confirm before launching

| Gate | Expected |
|---|---|
| `node scripts/verify-import-integrity.mjs` | 4 passed / 0 failed |
| `verify-r25-flagoff.mjs` | 8 passed, 2 NOT CALIBRATED (exit 2; waits for C/D) |
| `verify-mobile-actions-node.mjs` | 11/11 PASS, 5 PENDING (waits for A's Esc/Back table) |
| `graphics-unit.mjs`, `verify-flight-operations.mjs` (33), `verify-stylized-earth.mjs` (22/22), `verify-c-flagoff.mjs` (58), `verify-living-earth.mjs` (19), `verify-operations-disclosure.mjs` | PASS |
| `verify-vendor-three-tile.mjs` | 34/0, but **only after `git fetch --unshallow`** (it reads commit `b64457b`) |
| `verify-lod-fade.mjs` | 60 passed / 4 failed. Pre-existing on `2c624a3`; must not get worse. |
| `verify-atmo-law.mjs` | Crashes in `setAerial`. Pre-existing on `2c624a3`; must not get worse. |

## What session 1 learned

- **Don't `pkill -f` with a pattern that also appears in your own command line.** It kills your own shell. Kill dev servers by the PGID you recorded.
- **A satellite fixture boot takes about 8 minutes** at SwiftShader speed. Budget browser rows for that, and prove things on toy first.
- **The Workflow tool is multi-agent orchestration** and needs the user's explicit opt-in, which the prompt below gives. It runs about 15–25 agent calls.
- **Keep the orchestrator's own context small.** Rely on the workflow's structured return and the agents' ledgers (`scripts/r25-*-*.md`). Don't read agent transcripts wholesale.

---

## Prompt for the new session (paste this)

```text
Continue Skyloom Round 25 "Front Door & Clear Sky". You are the ORCHESTRATOR. The plan is approved, so do not re-plan or re-ask its decisions. I explicitly opt in to multi-agent orchestration: run the saved five-agent workflow (about 15–25 agent calls; I accept that scale).

Read, in order: FLY_ROUND25_KICKOFF.md (state, baselines, lessons), then FLY_ROUND25_PLAN.md (especially "Key rulings", the role charters and the W0 addendum). W0 (db78bdf) and E CERT's first phase (5072a38) are already on main. Do not redo them.

1. Container setup (a fresh container has none of this):
   cd /home/user/skyloom
   git fetch --unshallow origin || true
   npm ci --no-audit --no-fund
   git tag -f r25-w0 HEAD
   mkdir -p /tmp/r25-locks
   cp scripts/r25-run-browser.sh /tmp/r25-locks/run-browser.sh && chmod +x /tmp/r25-locks/run-browser.sh
   touch /tmp/r25-locks/browser-0.lock /tmp/r25-locks/browser-1.lock
   rm -f /tmp/r25-locks/e1-satellite-blocked
   git rev-parse HEAD > /tmp/r25-locks/e1-ready
   for x in a b c d e; do git worktree add /home/user/skyloom-r25-$x -b r25/$x r25-w0 && cp -al node_modules /home/user/skyloom-r25-$x/; done
   (If r25/* branches already exist, reuse them. Never delete work you did not create.)

2. Confirm the baseline table in FLY_ROUND25_KICKOFF.md with the node gates. If anything differs, stop and tell me.

3. Launch the workflow:
   Workflow({ scriptPath: "/home/user/skyloom/scripts/r25-workflow.txt",
              args: { intBranch: "<your designated branch>", trailer: "<your session's commit attribution lines, newline-separated>" } })
   The integration merges land on intBranch, checked out in /home/user/skyloom. Wait for its completion notification. Do not poll, and do not read agent transcripts wholesale.

4. When it returns:
   - read its structured result;
   - re-run the node gates on the integrated branch yourself;
   - check `git diff r25-w0..HEAD` for edits to W0-only files (FlyScene.jsx, fly-store.js, the fly-constants.js tail) that the record doesn't justify, and for any product change outside a flag;
   - then push your designated branch.
   Don't open a PR. Ask me before touching main.

5. Report back briefly:
   - what shipped ON and OFF (the ship-state table);
   - which rows are fixture-only or unmeasurable in the container;
   - the user-machine run list from FLY_FRONT_DOOR_AND_VISUALS.md.
   Every fps, ms and visual-quality judgement is mine to make on my machine.

If the context window gets heavy before the workflow finishes, stop at a clean point, record the state in FLY_ROUND25_KICKOFF.md (same structure as now), push, and tell me.
```

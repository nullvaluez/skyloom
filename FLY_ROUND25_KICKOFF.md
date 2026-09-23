# R25 kickoff: start "Front Door & Clear Sky" in a fresh session

Paste the prompt below into a new Claude Code session started from `main`
(which carries everything below). The session is the **orchestrator**. It sets
up the container, runs the five-agent workflow on its own designated branch,
checks the merged result, and pushes.

- **The plan:** [FLY_ROUND25_PLAN.md](FLY_ROUND25_PLAN.md), including the W0 addendum with the as-built wiring and gate baselines.
- **The workflow script:** [`scripts/r25-workflow.txt`](scripts/r25-workflow.txt). It is kept as `.txt` because a Workflow script has a top-level `return`, which the repo's ESLint and `verify-import-integrity.mjs` would reject as a `.js` file.
- **The browser-slot wrapper:** [`scripts/r25-run-browser.sh`](scripts/r25-run-browser.sh).
- **Already done, don't redo it:**
  - W0 (the scaffold) is commit `db78bdf`.
  - E CERT's first phase is commit `5072a38`, merged in `8323bb6`. It makes the satellite offline fixture reveal again (459.6 s, 0 page errors; toy 51.5 s) and adds the shared helpers `scripts/_title.js`, `_skip-menus.js`, `_r25-poses.js` and `_r25-luma.js`. It also adds `verify-r25-flagoff.mjs`, `verify-r25-smoke.cjs` and `verify-r25-visuals.cjs`, plus the tolerant legacy harness edits, and fixes import-integrity (now 4/0).
  - A first session stopped the workflow at that point. Its unfinished A–D work was discarded; roles A–D start from scratch.

---

## Orchestrator prompt

> You are the orchestrator for Skyloom Round 25 "Front Door & Clear Sky". Read
> `FLY_ROUND25_PLAN.md` fully, especially the W0 addendum, then this file.
> W0 (`db78bdf`) and E CERT's first phase (`5072a38`) are already on `main`. Do
> not redo them. Ultracode: run the workflow in `scripts/r25-workflow.txt`.
>
> 1. **Container setup** (a fresh cloud container has none of this):
>    ```bash
>    cd /home/user/skyloom
>    git fetch --unshallow origin || true          # vendor-history gates need b64457b
>    npm ci --no-audit --no-fund
>    git tag -f r25-w0 HEAD                        # the base every role diffs against (product code == db78bdf; E1 is scripts-only)
>    mkdir -p /tmp/r25-locks
>    cp scripts/r25-run-browser.sh /tmp/r25-locks/run-browser.sh && chmod +x /tmp/r25-locks/run-browser.sh
>    touch /tmp/r25-locks/browser-0.lock /tmp/r25-locks/browser-1.lock
>    rm -f /tmp/r25-locks/e1-satellite-blocked
>    git rev-parse HEAD > /tmp/r25-locks/e1-ready  # E1 already landed: A-D may start fixture runs at once
>    for x in a b c d e; do
>      git worktree add /home/user/skyloom-r25-$x -b r25/$x r25-w0
>      cp -al node_modules /home/user/skyloom-r25-$x/
>    done
>    ```
>    If `r25/*` branches already exist locally, reuse them. Never delete another
>    session's work.
> 2. **Re-check the W0 baseline** before launching:
>    - `node scripts/verify-import-integrity.mjs` should show 4 passed / 0 failed.
>    - `verify-r25-flagoff.mjs` should show 8 passed with 2 NOT CALIBRATED (exit 2, expected until C/D land).
>    - `verify-mobile-actions-node.mjs` should show 11/11 PASS with 5 PENDING.
>    - `graphics-unit.mjs`, `verify-flight-operations.mjs`, `verify-stylized-earth.mjs`, `verify-c-flagoff.mjs` and `verify-vendor-three-tile.mjs` should all PASS.
>
>    If anything differs from the addendum's table, stop and report.
> 3. **Launch** with
>    `Workflow({ scriptPath: "/home/user/skyloom/scripts/r25-workflow.txt", args: { intBranch: "<your designated branch>", trailer: "<your session's commit attribution lines, newline-separated>" } })`.
>    The integration merges land on `intBranch`, checked out in `/home/user/skyloom`.
> 4. **Check the result yourself.** When the workflow returns:
>    - read its result;
>    - re-run the node gates on the integrated branch;
>    - review `git diff db78bdf..HEAD` for W0-only-file edits and flag-off identity;
>    - only then push your designated branch (`git push -u origin <branch>`).
>
>    Do not open a PR unless asked.
> 5. **Report to the user:**
>    - the ship-state table;
>    - which rows are fixture-only;
>    - the user-machine run list from `FLY_FRONT_DOOR_AND_VISUALS.md`.
>
>    Every fps, ms and visual-quality judgement belongs to the user's machine.

---

## What the workflow does (summary of `scripts/r25-workflow.txt`)

| Phase | Agents | Notes |
|---|---|---|
| Build | 5 roles in parallel: E1 CERT (fixture + helpers first), A FRONT DOOR, B FLIGHT PLAN, C SKY, D GROUND | Each role works in `/home/user/skyloom-r25-<x>` on `r25/<x>`, with its own dev and fixture ports (A 3031/3201 … E 3035/3205). A–D wait for `/tmp/r25-locks/e1-ready` before their first fixture browser run. |
| Review | One adversarial sibling review per branch (A↔B, C↔D, C reviews E) | Node gates re-run by the reviewer; no edits |
| Fix | Owner fixes blocking and major findings | Skipped when a branch has none |
| Integrate | E merges E → A → B → D → C into the session's designated branch (`intBranch`), with a smoke run after each merge | A red merge is reset (local, unpushed) and sent back to its owner. At most 2 fix loops; after that the failing sub-flag ships OFF. |
| Certify | E: Enhanced pixel columns, Classic identity, budgets, boot time, ship state, production build, the lean record `FLY_FRONT_DOOR_AND_VISUALS.md` and the `CLAUDE.md` notice | Nothing is pushed by agents; the orchestrator pushes. |

## Environment truths (cloud container)

- **Blocked hosts:** Esri, OpenFreeMap, adsb and open-meteo all return 403. Use the offline fixture: `FLY_TILE_FIXTURE=1`, `FLY_FIXTURE_PORT=<port>`, started in-process by `scripts/_fixture.js`.
- **WebGL is SwiftShader** at about 1–3 fps. Browser gates run through `node -r ./scripts/_pw-shim.js`, and at most two run at once via `/tmp/r25-locks/run-browser.sh`.
- **`window.__fly` only exists** under `next dev` or with `?graphicsReview=1`.
- **The legacy harness fleet is pinned** to `__flyTitleBypass=true` and `__flyVisualsOverride='classic'` (in `scripts/_boot.js` both legs, and in `scripts/_mobile-boot.js`). The R25 gates un-pin with `unpinPins`.

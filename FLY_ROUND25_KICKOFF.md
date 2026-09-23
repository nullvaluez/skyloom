# R25 kickoff: start "Front Door & Clear Sky" in a fresh session

Paste the prompt below into a new Claude Code session on the
`claude/game-intro-menu-world-mf37eg` branch. The session is the
**orchestrator**. It sets up the container, runs the five-agent workflow, checks
the merged result, and pushes.

- **The plan:** [FLY_ROUND25_PLAN.md](FLY_ROUND25_PLAN.md), including the W0 addendum with the as-built wiring and gate baselines.
- **The workflow script:** [`scripts/r25-workflow.txt`](scripts/r25-workflow.txt). It is kept as `.txt` because a Workflow script has a top-level `return`, which the repo's ESLint and `verify-import-integrity.mjs` would reject as a `.js` file.
- **The browser-slot wrapper:** [`scripts/r25-run-browser.sh`](scripts/r25-run-browser.sh).
- **Already done, don't redo it:** W0 (the scaffold) is commit `db78bdf` on this branch.

---

## Orchestrator prompt

> You are the orchestrator for Skyloom Round 25 "Front Door & Clear Sky". Read
> `FLY_ROUND25_PLAN.md` fully, especially the W0 addendum. W0 is already committed
> as `db78bdf`. Do not redo it. Ultracode: run the workflow in
> `scripts/r25-workflow.txt`.
>
> 1. **Container setup** (a fresh cloud container has none of this):
>    ```bash
>    cd /home/user/skyloom
>    git fetch --unshallow origin || true          # vendor-history gates need b64457b
>    npm ci --no-audit --no-fund
>    git tag -f r25-w0 db78bdf                     # the base every role diffs against
>    mkdir -p /tmp/r25-locks
>    cp scripts/r25-run-browser.sh /tmp/r25-locks/run-browser.sh && chmod +x /tmp/r25-locks/run-browser.sh
>    touch /tmp/r25-locks/browser-0.lock /tmp/r25-locks/browser-1.lock
>    rm -f /tmp/r25-locks/e1-ready /tmp/r25-locks/e1-satellite-blocked
>    for x in a b c d e; do
>      git worktree add /home/user/skyloom-r25-$x -b r25/$x r25-w0
>      cp -al node_modules /home/user/skyloom-r25-$x/
>    done
>    ```
>    If `r25/*` branches already exist locally, reuse them. Never delete another
>    session's work.
> 2. **Re-check the W0 baseline** before launching:
>    - `node scripts/verify-import-integrity.mjs` should show 3 passed / 1 failed. The 3 errors are pre-existing.
>    - `graphics-unit.mjs`, `verify-flight-operations.mjs`, `verify-mobile-actions-node.mjs`, `verify-stylized-earth.mjs`, `verify-c-flagoff.mjs` and `verify-vendor-three-tile.mjs` should all PASS.
>
>    If anything differs from the addendum's table, stop and report.
> 3. **Update the attribution trailer.** Set the `TRAILER` constant at the top of
>    `scripts/r25-workflow.txt` to THIS session's commit attribution lines, as given
>    in your system prompt. Then copy the script to your scratchpad and launch it
>    with `Workflow({ scriptPath: "<that copy>" })`.
> 4. **Check the result yourself.** When the workflow returns:
>    - read its result;
>    - re-run the node gates on the integrated branch;
>    - review `git diff db78bdf..HEAD` for W0-only-file edits and flag-off identity;
>    - only then run `git push -u origin claude/game-intro-menu-world-mf37eg`.
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
| Integrate | E merges E → A → B → D → C into `claude/game-intro-menu-world-mf37eg`, with a smoke run after each merge | A red merge is reset (local, unpushed) and sent back to its owner. At most 2 fix loops; after that the failing sub-flag ships OFF. |
| Certify | E: Enhanced pixel columns, Classic identity, budgets, boot time, ship state, production build, the lean record `FLY_FRONT_DOOR_AND_VISUALS.md` and the `CLAUDE.md` notice | Nothing is pushed by agents; the orchestrator pushes. |

## Environment truths (cloud container)

- **Blocked hosts:** Esri, OpenFreeMap, adsb and open-meteo all return 403. Use the offline fixture: `FLY_TILE_FIXTURE=1`, `FLY_FIXTURE_PORT=<port>`, started in-process by `scripts/_fixture.js`.
- **WebGL is SwiftShader** at about 1–3 fps. Browser gates run through `node -r ./scripts/_pw-shim.js`, and at most two run at once via `/tmp/r25-locks/run-browser.sh`.
- **`window.__fly` only exists** under `next dev` or with `?graphicsReview=1`.
- **The legacy harness fleet is pinned** to `__flyTitleBypass=true` and `__flyVisualsOverride='classic'` (in `scripts/_boot.js` both legs, and in `scripts/_mobile-boot.js`). The R25 gates un-pin with `unpinPins`.

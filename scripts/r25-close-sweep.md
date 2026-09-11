# R25 CLOSE SWEEP — the per-harness ledger

Owner: **E CERT**. This is the round's certification record, opened on W1 day 1
as a SKELETON so every row has a home before it has a number. **A row with no
number says so.** Two columns, and they are never mixed:

- **FIXTURE** — measured in this container against `scripts/r24-fixture/`
  (`FLY_TILE_FIXTURE=1`, the `_pw-shim` launch, SwiftShader at 1–3 fps).
  Hardware-independent assertions only: counts, census, draw/tri totals, source
  and flag scans, buffer identity, program-count flatness, byte identity,
  fixed-pose pixel A/B.
- **LIVE** — measured on the **user's RTX 5080 + phone** against the real Esri /
  OpenFreeMap / adsb bytes. Every fps / ms / stutter / tearing / bloom-feel
  number, and every frozen hash and pixel band that was calibrated on live tile
  bytes.

**A FIXTURE NUMBER NEVER RE-BASELINES A LIVE NUMBER.** Where a gate cannot run
in this venue at all, the row says **"user machine only"** — not "skipped", and
never a weakened bound. Where a gate ran but could not reach its precondition,
the row says **NOT CALIBRATED** — never PASS.

Run everything here with:

```bash
scripts/r25-smoke.sh 3134                 # the subset that runs in this container
SMOKE_NODE_ONLY=1 scripts/r25-smoke.sh    # the fast per-merge check
```

> **STATUS: SKELETON (W1 day 1).** Section §1's tables carry the rows and the
> baseline this round inherits; the result cells fill in at W2/W3. §2 is the
> user-machine run list and is the half that decides this round.

---

## §1 Per-harness matrix

Legend: ✔ green · ✘ red · — not run · **UM** user machine only · **NC** not
calibrated (ran, precondition unmet) · *(fx)* fixture column · *(live)* live
column.

### 1.1 Node gates — the W1 BASELINE on the untouched R25 base

Run: `SMOKE_NODE_ONLY=1 bash scripts/r24-smoke.sh 3134` on `r25/e` at the W0
tip `6bf628e`. **14 passed, 3 failed, 0 skipped.** All three reds reproduce on
`f0cd81e` and none was caused by this round. Their attribution is
`scripts/r25-e-cert.md` §2; the after-column is E's W1 tip.

| Gate | Base (`6bf628e`) | After E W1 | Note |
|---|---|---|---|
| `verify-import-integrity.mjs` | ✘ 3/4 | ✔ 4/4 | `scripts/r24-c-agl.js` `agl`/`speed` never destructured |
| `verify-classify.mjs` | ✔ | ✔ | |
| `verify-warbirds.mjs` | ✔ | ✔ | |
| `verify-daily.mjs` | ✔ | ✔ | |
| `verify-depth-offset.mjs` | ✔ | ✔ | |
| `verify-terra-residency.mjs` | ✔ | ✔ | |
| `verify-c-flagoff.mjs` | ✔ | ✔ | R24's flag-off contract, still green |
| `verify-lod-fade.mjs` | ✘ 60/4 | ✔ 69/0 | 4 TEXT assertions vs the Codex merge fix; +5 new rows |
| `verify-worker-normals.mjs` | ✔ | ✔ | |
| `verify-skirt-worker.mjs` | ✘ 8/1 | ✘ **10/1** | **the surviving red is a DEFECT** — see §3 |
| `verify-artifact-hygiene.mjs` | ✔ 5/5 | ✔ 7/7 | +the allowance rule |
| `r24-b-attr-proof.js` | ✔ | ✔ | |
| `verify-vendor-three-tile.mjs` | ✔ | ✔ | |
| `verify-skirt-fast.mjs` | ✔ | ✔ | |
| `verify-frame-step.mjs` | ✔ | ✔ | |
| `verify-finalize-pace.mjs` | ✔ | ✔ | |
| `verify-seam.js` (node leg) | ✔ | ✔ | |
| `verify-r25-flagoff.mjs` | — (new) | ✔ 20/20 | **9 of 20 VACUOUS** until the owners merge |
| `verify-registry-inventory.mjs` | — (new) | ✔ 6/6 | 11 pre-existing unregistered keys, frozen |
| `verify-ground-bubble-k.mjs` | — | SKIP | A GROUND ships it |
| `verify-moon-light.mjs` | — | SKIP | C LIGHT ships it |

### 1.2 R25 gates (new this round) — TWO COLUMNS PER ROW

Each row: what the FIXTURE can decide, and what only the user's machine can.
**E writes none of the six owner gates** — E audits them after merge (does it
have a RED leg? does its pass depend on the flag? could a count of 0 be passing
because nothing mounted?).

| Gate | Owner | Fixture column | Live column | Pin it releases |
|---|---|---|---|---|
| `verify-ground-bubble.js` | A GROUND | | | `__flyGroundDetail` |
| `verify-night-ground.js` | B NIGHT | | | `__flyNightGround` |
| `verify-moon-light.mjs` | C LIGHT | | | — (node, pure) |
| `verify-shadow-bubble.js` | C LIGHT | | | `__flyStats.shadow` |
| `verify-mobile-fan.js` | D MOBILE | | | `touch-fab` / `touch-fan[data-open]` |
| `verify-feel-ground.js` | F FEEL | | | `__flyDof` |
| `verify-r25-flagoff.mjs` | E CERT | ✔ 20/20 (9 vacuous) | n/a — flag-independent | — |
| `verify-registry-inventory.mjs` | E CERT | ✔ 6/6 | n/a — flag-independent | — |

### 1.3 Inherited gates the round touches — TWO COLUMNS PER ROW

Here the two columns mean something different, and it is the more important
pair:

- **FLAG-OFF PASS = IDENTITY.** The frozen number comes back **unmoved** on the
  flag-off integrated tree — the measurement that says +N lines of R25 compose
  to a no-op, and the only honest basis for a one-flag revert contract.
- **FLIPPED PASS = STILL THE SAME NUMBER.** A frozen number that moves when a
  flag flips is a **re-baseline**, and a re-baseline is an escalation.

| Gate | Why R25 touches it | Flag-off (identity) | Flipped |
|---|---|---|---|
| `verify-mobile.js` | E rewired every action tap through `openFan` | **PARTIAL** — every row both arms reached is identical; neither arm completed here (the CONTROL died earlier). §3.2a of `r25-e-cert.md` | |
| `verify-mobile-layout.js` | + a second disjointness census, fan OPEN | **✔ EXACT** — both orientations, `diff` of the PASS/FAIL rows between the edited file and the base file is EMPTY; the only difference is the two new SKIP rows | |
| `verify-hangar.js` | + gate 14b, the `touch-hangar` petal | **inherited** — its only edit is the same `openFan` no-op the layout run proved | |
| `verify-logbook.js` | `openFan` before the pause tap | **inherited** — same | |
| `verify-sat-night.js` | B NIGHT moves night ground pixels | | |
| `verify-dusk.js` | C LIGHT moves the night/dusk grade | | |
| `verify-seam.js` (hashes) | A GROUND's `'d'` block is in the tile fragment | | |
| `verify-monuments-sat.js` | **frozen** — C's hemi/moon must not move it | | |
| `verify-flicker.js` | bound of **12**, never moves | | |
| `verify-one-sun.js` | C LIGHT's moon terms | | |
| `verify-shadow-calm.js` | C LIGHT's AGL-keyed shadow ortho | | |
| `verify-chase-cam.js` / `verify-photo.js` | F FEEL's chase settle | | |
| R21 quartet (`stability` / `flicker` / `tier-step` / `seam`) | frozen, must stay green | | |

### 1.4 THE FIXTURE COLUMN — the fixed poses

The fixture's Owens desert has **zero landcover and zero landuse**, which is
what makes the round's content gate a construction rather than a hope: every
+draw layer parks at `count 0 / visible=false` with an empty content set, so
Owens must read **identically** flag-on and flag-off.

| Pose | Scene | Base draws | Base tris | With every R25 flag armed | Δ |
|---|---|---|---|---|---|
| Owens 36.6/−118.1 | empty desert | | | | **must be 0** |
| Powell 40.1578/−83.0752 | suburb | | | | |
| Manhattan 40.7549/−73.984 | dense city | | | | |
| Columbus 39.9612/−82.9988 | small downtown | | | | |
| toy (Neon) | — | | | | **must be 0 — byte-identical** |

**Ceilings, never re-baselineable:** Owens ≤ **261** · satellite ≤ **375** ·
toy ≤ **480** · fixed-pose tris ≤ **2.0 M** · soak p95 tris ≤ **2.2 M** ·
texture bytes ≤ **300 MB**.

> **W1 fixture-health row.** `verify-fixture.js` at `FLY_BOOT_SCALE=6` against
> E's dev server on :3134 — gates (1)–(3) green: deterministic bytes (mvt
> 12 021 B / dem 1 817 B / img 46 864 B), the 200-with-empty-body tile
> reachable, satellite boots on the fixture in **96.5 s** (pct 100 at 46.6 s)
> with img 72 / dem 69 / mvt 69 / tilejson 23. Pose census on this run:
> manhattan draws **144**, tris 263 808, 268 meshes; powell draws **154**,
> tris 187 464, 262 meshes — **both `settled=false` after 427/428 s with 15–16
> chunks still draping.** Those two draw numbers are therefore an
> UNSETTLED-POSE reading and bound nothing; they are recorded because an
> unsettled number is still a number, and because "settled" is a state of the
> streamer, not an identity of the scene (R24 §7).

### 1.4a Fixed-pose pixel gates un-recertified since the Codex overhaul

`verify-sat-night` (27/1/1 in R24), `verify-dusk`, the `verify-seam` hashes,
`verify-monuments-sat` and the NEON_COVER FNV hashes were all last calibrated
before `be711f2`. Each needs a **FIXTURE column re-baselined on the R25
flag-off base**, with RED-first evidence (a before/after PNG pair + the number
under `scripts/r25-out/`). The live column is written ONLY from numbers the
user pastes; a gate whose live column cannot be measured here prints
**NOT CALIBRATED**, never PASS.

| Gate | Fixture column re-baselined? | Evidence | Live column |
|---|---|---|---|
| `verify-sat-night.js` | | | **UM** |
| `verify-dusk.js` | | | **UM** |
| `verify-seam.js` hashes | | | **UM** |
| `verify-monuments-sat.js` | | | **UM** |
| NEON_COVER FNV hashes | | | **UM** |

### 1.4b Cache-key registry audit (fills in at close)

`verify-registry-inventory.mjs` freezes an **11-key pre-existing gap** in the
`world-bend.js` registry header (ten from the Codex overhaul, one from R17).
Every key R25 adds must be registered in the same change; the gate fails if the
gap grows. At close, this section records the final key set and whether the
gap shrank.

---

## §2 THE USER-MACHINE RUN LIST

Everything in this section is measured on the **RTX 5080 + phone**, because
nothing in the container can produce it.

### 2.1 The diagnosis pack — THE ROUND'S REAL RED

`scripts/r25-user-diag.md`, sent on W1 day 1. Until it comes back there is **no
before**, and no claim this round makes about smoothness, darkness or flatness
has anything to be compared against.

| Item | Status |
|---|---|
| C — day, Powell 80–150 m, `__flyStats.frame.sample()` | **PENDING** |
| C — scene (draws / tris / tier / style) | **PENDING** |
| D — night, Powell 80–150 m, frame sample | **PENDING** |
| D — night census (sun / sky / env / bg / houseLights / clutter) | **PENDING** |
| D4 — three "before" screenshots (Powell 80 m / Columbus 250 m / Manhattan 792 m) | **PENDING** |
| E — phone portrait + landscape HUD | **PENDING** |
| F — one harness row proven (`verify-mobile.js` on :3019) | **PENDING** |
| The four written answers (what reads flat; dark vs copper; is tearing still there; which orientation) | **PENDING** |

### 2.2 The checkpoints, in the plan's order (performance feel FIRST)

Plan §7. Each is a row here when it has been run.

1. R25 BASE diag pack (§2.1).
2. Night "before" screenshots.
3. Phone "before"; then D's fan demo from `r25/d`.
4. Ground bubble by day at 80 m over Powell.
5. Night irradiance A/B via `__flyNightGround.set()` sweeps; then the road re-sweep.
6. Moon + grade: full vs new moon; hemi ground; bloom threshold; haze floor.
7. Shadows/AO in the bubble.
8. Feel: ground rush, DoF, chase settle, audio — reduced-motion on and off.
9. 15-minute satellite soak with everything on.

### 2.7 The R25 gates, one line each: what the user's machine adds

| Gate | Runs here? | What the user's machine adds | Command |
|---|---|---|---|
| `verify-ground-bubble` | fixture only | whether the overlay reads as ground TEXTURE or as NOISE at 80 m; scrub density; hedge scale | `FLY_URL=http://localhost:3019 node scripts/verify-ground-bubble.js` |
| `verify-night-ground` | fixture only | whether it reads as "a real city from a small plane"; the RT cost in real ms | `FLY_URL=http://localhost:3019 node scripts/verify-night-ground.js` |
| `verify-moon-light.mjs` | **yes, fully** (node, pure) | nothing — it is arithmetic | `node scripts/verify-moon-light.mjs` |
| `verify-shadow-bubble` | fixture only | whether the 350 m frustum edge is VISIBLE at the deck | `FLY_URL=http://localhost:3019 node scripts/verify-shadow-bubble.js` |
| `verify-mobile-fan` | fixture only (emulated phone) | a real thumb: reach, spring feel, whether the arc is comfortable | `FLY_URL=http://localhost:3019 node scripts/verify-mobile-fan.js` |
| `verify-mobile` | fixture only | same | `FLY_URL=http://localhost:3019 node scripts/verify-mobile.js` |
| `verify-mobile-layout` | fixture only | same | `FLY_URL=http://localhost:3019 node scripts/verify-mobile-layout.js` |
| `verify-feel-ground` | fixture only | the DoF taste call, and whether ground rush reads as speed or as smear | `FLY_URL=http://localhost:3019 node scripts/verify-feel-ground.js` |
| `verify-r25-flagoff.mjs` | **yes, fully** | nothing | `node scripts/verify-r25-flagoff.mjs` |
| `verify-registry-inventory.mjs` | **yes, fully** | nothing | `node scripts/verify-registry-inventory.mjs` |
| `verify-artifact-hygiene.mjs` | **yes, fully** | nothing | `node scripts/verify-artifact-hygiene.mjs` |
| `verify-sat-night` / `verify-dusk` / `verify-seam` hashes | fixture column only | **the live column** — these were calibrated on live tile bytes | `FLY_URL=http://localhost:3019 node scripts/<gate>` |
| R21 quartet (`stability` / `flicker` / `tier-step` / `seam`) | partially | the governor's real ladder; the flicker bound of 12 on a real display | `FLY_URL=http://localhost:3019 node scripts/verify-<gate>.js` |
| `soak-fly.js` 15 min | **no** | **everything** — fps floor, p95 frame ms, heap climb, draw/tri p95, pageerrors | `FLY_URL=http://localhost:3019 node scripts/soak-fly.js` |

**Prelude, once per session:**

```bash
npm install
npm run dev -- -p 3019
# then, in a second terminal, one gate at a time:
FLY_URL=http://localhost:3019 node scripts/<gate>
```

### 2.7b What we will still not know afterwards

(filled in at close — the honest list of questions neither venue answered)

---

## §3 Deviations, honestly

1. **`node_modules` could not be symlinked into the worktree.** Next 16's
   Turbopack refuses a symlink that resolves outside the filesystem root
   (`Symlink node_modules is invalid, it points out of the filesystem root`).
   Replaced with a hard-link copy (`cp -al`), which is the same inodes and no
   extra disk. Recorded because the setup instructions said "symlink".
2. **`verify-skirt-worker` gate 2b ships RED, deliberately.** It is not a stale
   bound: the splice regex inside the shipped vendored bundle no longer matches
   the LERC DEM worker tail, so `TERRA_PACE.skirtWorker` and
   `TERRAIN_LIGHT.workerNormals` degrade to OFF on the only DEM path the live
   app uses. Owner A GROUND / vendor arbitration. Full evidence in
   `scripts/r25-e-cert.md` §2c.
3. **`verify-registry-inventory` ships with an 11-key BASELINE_GAP.** E owns
   `scripts/`, not `world-bend.js`, so the pre-existing unregistered keys are
   named and frozen rather than fixed. Owner: the registry header's owner.
4. **The mobile fleet was outside the artifact redirect.** `scripts/_fixture.js`
   installs its write redirect for every gate that requires `_boot.js`; the five
   mobile gates require `_mobile-boot.js` instead, so four runs rewrote fourteen
   tracked `scripts/mobile-*.png` baselines in place while
   `verify-artifact-hygiene` stayed green. Restored; closed in both halves
   (`_mobile-boot.js` now requires `_fixture`, and PATTERNS gained the three
   mobile globs, RED-calibrated). `scripts/r25-e-cert.md` §2e.
5. **The dev server gets reaped under load** — twice on :3134 mid-harness, and
   the harness then reports `ERR_CONNECTION_REFUSED`, which reads like a broken
   tree and is not one. A supervisor loop (`scripts/r25-out/devwatch.sh`,
   gitignored) restarts it. Check a dev log's tail before believing such a row.
6. *(more as they happen)*

---

## §4 Verdict

*(fills in at W3)*

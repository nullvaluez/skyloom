# R22.1 "WORLD STABILITY" — CLOSE LEDGER (D "CERT")

Branch `r22p1/integrate`, worktree `.claude/worktrees/r22-fable`, dev server
`:3021`. Final tree = STEP_SAFE (A) + FRAME_PACE (B) + FLASH_GUARD (C2), all
three `enabled: true`.

Conventions follow `scripts/r22-close-sweep.md`: every row carries its
NUMBERS, every red carries an ADJUDICATION reached by control rather than by
re-baselining, and everything unrun is named rather than assumed.

Written INCREMENTALLY while the runs were in flight (a session limit killed an
agent earlier in this round), so section numbering is stable but rows were
appended as they landed.

---

## §0 What this round certifies, and what makes it different

R22.1 is a three-defect hotfix wave against one user recording of the shipped
R22 production build. Each defect has a measured root cause, a one-flag revert
and a NEW RED-calibrated gate:

| defect | root cause | fix | gate |
|---|---|---|---|
| one-frame full-screen white flash | ONE **zero-area triangle** in a streamed sat-buildings chunk; `side: DoubleSide` + the bend's float32 offset tips the rasterizer's area determinant | `FLASH_GUARD` — area filter at drape finalize | verify-flash-guard |
| micro-stutter, ~1 freeze / 2 s while manoeuvring | three-tile's `getBoundaryEdges` skirt builder on the MAIN thread (67 % of stall samples) | `FRAME_PACE` — vendored patch #5, output identical by construction | verify-frame-pace |
| (latent) DPR-step present-before-draw | r3f reallocates the drawing buffer between animation frames; the composer resizes a frame late | `STEP_SAFE` — a priority −99 rig that resizes inside the frame that draws | verify-step-clean |

What is different from an ordinary close: **this round's certification is not
just "the gates are green", it is "the gates can still go RED on THIS tree".**
A gate that cannot fail certifies nothing, so every new gate below was run in
BOTH directions on the final integrated tree, not only on its author's branch.

---

## §1 The three new gates — GREEN and RED, both legs, on the final tree

### 1.1 verify-flash-guard

| leg | lever | result | numbers |
|---|---|---|---|
| **GREEN** | — | **PASS 9/9** | 45,925 composed frames · **0 pale** · 0 black · census **0 zero-area** of 109,141 live tris over 25 meshes · `degenScanned 3,983,782 / degenDropped 274,902 / degenChunks 202` |
| **RED** | `FLASH_PIN_OFF=1` (`__flyFlashPin='off'`) | **FAIL (4)(6)** — the gate still detects the defect | 40,777 composed frames · **2 pale** (first n=2903, `pr` 0.997, L 225.2) · census **9,500 zero-area** live · `degenDropped 0` |

The RED leg is the load-bearing row: the identical harness, on the identical
integrated tree, reproduces both the deterministic census red (9,500 zero-area
triangles across six named chunks) and the stochastic content red (2 pale
frames) the moment the guard is pinned off. Gate (3) — "there WERE degenerates
to drop" — passed in both legs, so the GREEN is not vacuous: the defective
content was present and the filter removed it.

### 1.2 verify-frame-pace

| leg | lever | result | numbers |
|---|---|---|---|
| **GREEN** | — | **PASS 7/7** | stalls/min OFF **95.5 / 177.5** → ON **2.7** (ratio **65.7x**, bound 4x) · worst frame **91.5 → 29.2 ms** (0.32x, bound 0.6x) · p99 **45.8 → 12.6 ms** · identity 24 buffers / 46,295 tris / 24 fast / **0 mismatches** · content **223 tiles resident in BOTH arms, 0 differ** · scene totals 277 draws both arms |
| **RED** | `PACE_PIN_OFF=1` (`__flyPaceForce=false` on the middle arm too) | **FAIL (1)(2)(3)(4)(5)** | stalls ON-arm **90/min** vs OFF median 142.3 → ratio **1.6x** (bound 4x) · worst frame **70.7 vs 95.9 ms = 0.74x** (bound 0.6x) · fast 0 / upstream 2,107 |

**The RED lever is new, and it is gate mechanics, not a product change.** This
gate is the one member of the trio whose defective tree is *already inside
every run* — the OFF arms ARE the shipped-R22 program — but running the
defective tree is not the same as proving the gate can FAIL on it. `PACE_PIN_OFF=1`
(added here, env-gated, default path untouched) boots the middle arm with
`__flyPaceForce=false` as well, so all three arms are defective and the ratio
gates collapse. They did: **1.6x against a 4x bound and 0.74x against a 0.6x
bound.** The gate detects the defect on this tree.

Two things worth recording from the GREEN run's own numbers:

* **The OFF arms got WORSE than B's calibration, not better** — 95.5 and 177.5
  stalls/min here against B's 83.9–100.7. The second OFF arm ran at a median
  8.3 ms rather than 4.2 ms, i.e. the machine was under more load by the third
  arm. That is exactly the drift the gate's OFF/ON/OFF interleave exists to
  absorb, and it absorbed it: the ON arm sat between two worse arms and still
  came in at 2.7/min.
* **Content identity is measured, not argued** — gate (6) reloads the whole
  quadtree under each arm at one frozen pose and compares every resident tile
  by z/x/y: 223 in both, 0 differ, and the scene totals agree at 277 draws.

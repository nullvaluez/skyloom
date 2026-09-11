# R25 — D MOBILE ledger — "one floating button, a quarter-arc fan"

> **VENUE TRUTH, stated once and binding on every number below.** Headless
> Chromium reports `env(safe-area-inset-*)` as **0** — there is no notch to
> report — and every phone offset in this app is written
> `calc(env(...) + <base>)` or `max(env(...), <base>)`. So every geometry
> number in this ledger certifies the **BASE**, which is the conservative
> floor: a real inset pushes the whole control column further inside the
> screen, never out of it. **The notch, thumb reach and the spring's FEEL are
> user checkpoints; no harness here can read them.** The container is also
> egress-blocked (Esri / OpenFreeMap / adsb 403) and runs SwiftShader at 1–3
> fps: the world boots empty through `bootMobile`'s ceiling, which is fine for
> a DOM/geometry round and useless for anything with a millisecond in it. **No
> fps, frame-time or animation-smoothness number appears in this ledger,
> because none can be measured here.**
>
> Branch `r25/d` off the W0 tip `6bf628e`. Dev server: D's own worktree, port
> **3133**. Artifacts: `scripts/r25-out/` (gitignored).

## §0 RED FIRST — what the phone HUD was on `6bf628e`

Measured on the base tree, this venue, before a line of R25 code existed
(`scripts/r25-out/base-controls.txt`, `base-verify-mobile-layout` run):

| | portrait 390×844 | landscape 844×390 |
|---|---|---|
| `controls-right` members | LOOK · ATLAS · LOGBOOK · PHOTO · PAUSE (48 px each) stacked over the 3-detent throttle rail (68×132) over the BOOST pad (68×44) | the same five **plus** the contextual row INLINE, then the rail + pad side by side |
| contextual row on a lock | +INSPECT +INTERCEPT +CINEMA (44 px), a SECOND row above the first | rides inside the persistent row |
| **buttons in that corner** | **5 at rest, 8 on a lock** | **5 at rest, 8 on a lock** |
| thumbstick | `[18,664 – 146,792]` | `[18,210 – 146,338]` |
| info chip when up | `[8,404 – 382,452]` (dock 24.5 rem) | `[252,302 – 592,350]` |
| zone members measured | 14 | 14 |
| overflow affordance | **none** | **none** |
| hangar | **no key, no touch button** — `PauseMenu.jsx:201-211` is the only door | same |

`verify-mobile-layout.js` on that tree: **16/18 PASS**, and the two reds are
the venue, not the layout — `portrait zero pageerrors` / `landscape zero
pageerrors`, both "Failed to fetch" from the 403-blocked aircraft/weather
endpoints. That pair is the pre-existing baseline every run below is read
against, and it is the reason a red on those two rows is never attributed to
this round.

The PauseMenu is the de-facto "everything" list: Resume, three speed presets,
Atlas, Logbook, **Hangar**, quality ×3, map style ×2, sound, reduced motion,
crash stakes, credits, Exit — **19 `MenuButton`s**, every one of them behind a
modal that stops the game. That is the shape the user was describing.

## §1 Mechanism — what ships

**New** `components/fly/hud/TouchFan.jsx`. **Changed** `TouchControls.jsx`
(petal set + open state + the signal), `fly-constants.js`
(`MOBILE_UI.cluster` / `clusterSize` / `infoChip.dockBottomRem` /
`zones['info-dock'].phonePort`, and two hoisted helpers beside
`MOBILE_FAN_R25`), `FlyMode.jsx` (ONE attribute + the hook that feeds it),
`app/globals.css` (ONE rule pair). **New gate**
`scripts/verify-mobile-fan.js`. Nothing else — no zone added, no store field,
no harness edited, no 3D or shader file touched.

1. **The FAB replaces the row, not the column.** In PORTRAIT the 56 px FAB
   stands exactly where the 5-wide persistent row stood, atop the throttle
   rail and the BOOST pad. In LANDSCAPE it joins the existing
   `flex-row-reverse items-end` throttle group as a third member, so it lands
   to the LEFT of the boost pad and the fan opens up-left across the empty
   middle of a 844×390 screen. The joystick, the rail and the pad are
   untouched in both.
2. **Petals are absolutely positioned inside `controls-right`.** The fan's
   container is a 0×0 anchor at the FAB's centre; each petal is a
   `motion.div` offset by `(cos θ, −sin θ)·r`. Out of flow ⇒ the column
   reserves the FAB's box and nothing more, so no petal can ever push a
   flight control around. **No ninth zone**: `__flyZoneNames.length === 8`
   still holds, and the petals are `pointer-events-auto` descendants of the
   zone exactly like every other control in it.
3. **Geometry.** `petal i of n` at `fromDeg − (fromDeg − toDeg)·i/(n − 1)`,
   with **n = the persistent count**, never the total — that arithmetic IS
   the "a lock never moves a button you have learned" guarantee. Contextual
   petals ride a second ring at `radiusPx + petalPx + ringGapPx` (= +52 px,
   two 44 px petals 8 px apart) starting from the `fromDeg` end, i.e.
   radially outboard of the first three persistent slots.
4. **Open/close.** Tap the FAB; tap a petal (it closes, then acts); tap
   anywhere else (a **window `pointerdown` CAPTURE listener that only reads
   `e.target`** — capture so the R17 `stopPropagation()` rule cannot hide the
   tap from it, read-only so the tap still reaches what it was aimed at and
   the R17 tap-leak fix is not disturbed); or any `covered` transition (the
   existing `if (covered) return null` unmounts the tree, and a new effect
   resets `open` so the fan cannot be waiting, open, behind the Atlas).
5. **`hideWhileOpen`.** One module signal in TouchControls → `useFanOpen()` →
   ONE attribute `data-fan-open="1"` on the fly root → one CSS rule pair that
   sets `visibility:hidden; pointer-events:none` on `[data-zone="info-dock"]`
   and `[data-zone="toasts"]`. Everything else stays: minimap, contracts chip,
   stick, throttle, BOOST pad.
6. **`touch-hangar` is new.** `MOBILE_UI.cluster` gains a `hangar` entry
   carrying `fanOnly: true`, so `PERSISTENT` (the flag-off row) filters it
   out and only `MOBILE_FAN_R25.order` names it. The tap is PauseMenu's own
   two lines minus the un-pause. It drops out if `HANGAR.enabled` ever goes
   false, because a door into a shut room is the R17 "an inert button can
   never appear" rule.
7. **The revert is LAZY.** `TouchControls` reaches TouchFan through
   `next/dynamic`, so with `MOBILE_FAN_R25.enabled:false` the module is never
   fetched and never evaluated — proven on the network, not by inspection
   (gate: no `resource` entry matching `/TouchFan/`).

## §2 Geometry, measured

Both orientations, base insets (venue truth above), petals 44 px, FAB 56 px
portrait / 48 px landscape. `r0` = `MOBILE_FAN_R25.radiusPx`, `r1` = second
ring = `r0 + petalPx + ringGapPx`. Every box below is MEASURED off the armed
tree (`scripts/r25-out/fan-armed-3.log`, `fan-*-0*.png`); the petal centres are
measured to within **2 px** of the geometry the component published, which is
the gate's own assertion.

**PORTRAIT 390×844** — the column, bottom-up from the zone anchor at
`env(bottom) + 3.25rem` = 52 px:

| | box | height |
|---|---|---|
| BOOST pad | `[306,748 – 374,792]` | 44 |
| gap-3 | | 12 |
| throttle rail | `[306,602 – 374,736]` | 134 (3 × `min-h-11` + borders) |
| gap-3 | | 12 |
| **FAB** | `[318,534 – 374,590]`, centre **(346, 562)** | 56 |

**Column top 534 px ⇒ 310 px = 19.375 rem above the bottom.** The pre-R25
column (five 48 px buttons where the FAB is, plus a 2.75 rem contextual row on
a lock) topped out at ~23.5 rem, which is what `dockBottomRem` 24.5 was
derived against. `MOBILE_FAN_R25.dockBottomRem` 21.75 therefore docks the
chip's bottom **2.375 rem clear** of the new column — see the note in
`fly-constants.js` on why the plan's 20.75 was kept rather than tightened.

Petals, ring 0 (`r0` 168), centre = FAB centre + (cos θ, −sin θ)·r:

| petal | θ | centre | box (44 px) |
|---|---|---|---|
| `touch-look` | 180° | (178, 562) | `[156,540 – 200,584]` |
| `touch-atlas` | 162° | (186, 510) | `[164,488 – 208,532]` |
| `touch-logbook` | 144° | (210, 463) | `[188,441 – 232,485]` |
| `touch-photo` | 126° | (247, 426) | `[225,404 – 269,448]` |
| `touch-hangar` | 108° | (294, 402) | `[272,380 – 316,424]` |
| `touch-pause` | 90° | (346, 394) | `[324,372 – 368,416]` |

Ring 1 (`r1` 220) carries the contextual three at the same first three angles:
`touch-inspect` 180° → (126, 562), `touch-intercept` 162° → (137, 494),
`touch-cinema` 144° → (168, 433).

Nearest edges: **156 px of left margin**, **372 px from the top**, and the
whole fan clears the thumbstick (`[18,664 – 146,792]`) by 80 px vertically.

**LANDSCAPE 844×390** — the FAB joins the `flex-row-reverse items-end`
throttle row as its third member:

| | box |
|---|---|
| throttle rail | `[760,204 – 828,338]` |
| BOOST pad | `[686,294 – 754,338]` |
| **FAB** | `[632,290 – 680,338]`, centre **(656, 314)** |

Petals, ring 0 (`r0` 150), MEASURED boxes: `touch-look [484,292]` ·
`atlas [491,246]` · `logbook [513,204]` · `photo [546,171]` ·
`hangar [588,149]` · `pause [634,142]`, all 44×44. Ring 1 (`r1` 202) carries
inspect (454, 314) · intercept (464, 252) · cinema (493, 195) by centre.
Top-most petal edge **142 px**, left-most **484 px** — clear of the stick
(`[18,210 – 146,338]`) and of the minimap and contracts chip, both of which
live in the top corners.

## §3 Cost

This round adds **zero draws, zero triangles, zero RT bytes and zero texture
samples** — it is HUD DOM, and it does not touch the 3D tree, any material,
any shader, the worker protocol or a cache key. What it does cost:

| | flag off | armed, closed | armed, open |
|---|---|---|---|
| DOM nodes in `controls-right` | 5 buttons + rail + pad | **1 button** + rail + pad | 1 + rail + pad + **6–9 petals** |
| JS chunks fetched | TouchFan **never** | +1 small chunk (`next/dynamic`) | same |
| React state | — | one boolean (`fanOpen`) | same |
| window listeners | — | none | **one** `pointerdown` capture, removed on close |
| animation | — | none | one framer-motion presence tree; **`readReducedMotion()` ⇒ no animation at all** |
| store writes | — | none | none (a module signal, not `fly-store`) |

The BoostBar's 10 Hz ring poll, the 200 ms boost mirror poll and the LabelCanvas
redraw are all untouched.

## §4 Frozen gates this round touches — and how each is kept

| Frozen | How it is kept | Measured |
|---|---|---|
| `window.__flyZoneNames.length === 8` (`verify-mobile-layout.js:211`) | the fan adds NO zone; petals are descendants of `controls-right` | 8 in both orientations, armed and off |
| 44 px targets (`MOBILE_UI.minTargetPx`) | FAB 56 px portrait / 48 px landscape, every petal 44 px | see §2 |
| pairwise zone disjointness | petals vs minimap · contracts chip · stick · throttle · boost, in both orientations, closed AND open | see §2 |
| Neon/toy byte-identity, Owens/satellite/toy draw ceilings, tris, texture bytes | not touched — no 3D file in the diff | n/a by construction |
| `verify-mobile` / `verify-mobile-layout` / `verify-hangar` / `verify-logbook` | they tap `touch-look`/`touch-pause`/… directly; **armed, they need E's `openFan` first** — §6 is the exact list | measured, §6 |

## §5 Decisions, and what each one refused

1. **The FAB is at the TOP of the portrait column, not the bottom.** It stands
   exactly where the persistent row stood, so the muscle memory for "the
   buttons are above the throttle" survives, and the arc opens into the empty
   middle of the screen instead of across the attribution credit. It is the
   plan's own placement.
2. **The throttle and the BOOST pad do NOT go in the fan.** They are flight
   controls; you use them WHILE flying, often with the other thumb on the
   stick. A control you fly with must not be behind a tap. (The user's ruling
   said so too.)
3. **The info chip and the toast stack hide while the fan is open; the
   minimap and the contracts chip do not.** The two that hide are transient
   read-only surfaces that the arc lands on (LANDSCAPE, measured: the 180°
   petal at `[484,292–528,336]` against a chip at `[252,302–592,350]`). The
   minimap is spatial orientation and the contracts chip is a live score — and
   neither of them is under the arc in either orientation, so hiding them
   would be a cost with no benefit. Two zones, one attribute, one CSS rule.
4. **`visibility`, not `display`.** `display:none` would collapse the toast
   stack's layout and SpotToast's queue is timing state that has to keep
   running while a menu is up — the same reason FlyMode's photo-mode HudGroup
   hides rather than unmounts. It also drops both zones out of
   verify-mobile-layout's census by construction, which is what makes a
   fan-open disjointness pass measure what is actually on screen.
5. **A module signal, not a store field.** "Is the HUD menu open" is
   transient chrome state; `stores/fly-store.js` is the save-and-restore
   surface and the thing every overlay subscribes to. One signal, one
   `useSyncExternalStore`, one attribute.
6. **`next/dynamic`, not a static import.** It makes "TouchFan is not imported
   when the flag is off" a claim about the NETWORK that a gate can measure,
   rather than a claim about source that nobody can.
7. **Contextual petals on the OUTER ring, not inserted into the arc.**
   Inserting them would re-space all six persistent petals the instant a
   contact locks — the fan would rearrange itself under a thumb already
   moving. The persistent angles are computed from the persistent count and
   nothing else, and the gate asserts the six do not move by a pixel when the
   contextual three appear.
8. **`hangar` carries `fanOnly: true` instead of being a sixth row button.**
   The row is the flag-off surface; a new button in it would break
   byte-identity on a tree where the feature is supposed to be absent.

## §6 The existing mobile gates on an ARMED tree — E CERT's edit list

These four harnesses tap `touch-look` / `touch-atlas` / `touch-pause` /
`touch-inspect` / … **directly**. Armed, those testids do not exist until the
fan is open, so every one of them needs `openFan(page)` (E's shared helper in
`scripts/_mobile-boot.js`, a no-op when there is no FAB so the SAME file runs
on both trees) before the tap, and the presence censuses need it before the
read. **Line numbers are `r25/d`'s tree; the DOM contract they are written
against is §1's.**

### `scripts/verify-mobile.js`
| Line | What it does | What it needs |
|---|---|---|
| **127-148** `clusterState()` | the shared presence reader | add `fab: q('touch-fab')` and `hangar: q('touch-hangar')`; every caller must `openFan` first |
| **161-168** the `ui` probe | `pause`/`atlas`/`look` presence | `openFan` before, `closeFan` after |
| **214**, **225** | `click('[data-testid="touch-look"]')` ×2 (look on / off) | `openFan` before EACH — the first tap closes the fan |
| **231** | `click('touch-atlas')` | `openFan` before |
| **333** | `click('touch-pause')` | `openFan` before |
| **345-359** | persistent cluster + ≥44 px | `openFan`; add `hangar` to the ≥44 px list |
| **365-393** | contextual absence/presence + CINEMA rule | `openFan` (petals are gone when closed, so "absent" is vacuously true otherwise) |
| **424-430** | the tap-leak rows | keep `touch-look` (open the fan first) and ADD a `touch-fab` row — the FAB is a new control on the R17 rule |
| **481**, **502-508** | `touch-inspect`, `touch-intercept` | `openFan` before each |
| **526** | `touch-logbook` | `openFan` before |
| **547** | `touch-photo` | `openFan` before |
| **585-603** | landscape cluster + ≥44 px | `openFan`; add `hangar` |
| **607-636** | `landFit` — every control inside 844×390 | `openFan`; add `touch-fab` and the petals (**this one wants BOTH states**: closed and open) |
| **655-661** | `legacyPass` | reads the `ui` probe above; nothing else |

### `scripts/verify-mobile-layout.js`
| Line | What it does | What it needs |
|---|---|---|
| **482** | `locator('touch-pause').click()` (landscape Exit) | `openFan` first |
| **326-351** | the zone census + pairwise disjointness | passes as-is with the fan CLOSED (the census sees FAB + rail + pad). The plan's **second census with the fan OPEN** is the one that adds value — note that `info-dock` and `toasts` go `visibility:hidden` then, so `collectBoxes`' own `visible()` drops them by construction |
| **211** | `__flyZoneNames.length === 8` | **unchanged — the fan adds no zone** |
| **447-478** | the 44 px sweep | passes closed (FAB 56/48); open, every petal is 44 |

### `scripts/verify-hangar.js:430-436` · `scripts/verify-logbook.js:483-496`
Both click `touch-pause` to reach the pause menu on a phone. Both need
`openFan` before the click. `verify-hangar` also gets the plan's **gate 14b**:
`touch-hangar` opens the hangar and hides the stick — the first time that
door has ever been reachable without the pause menu.

## §7 Open risks

1. **The spring's FEEL is unmeasured.** framer-motion drives springs on the
   main thread's rAF; here that is 1–3 Hz, so what this venue certifies is
   "the petals END where they should", never "the fan feels good". On the
   user's phone the same tree runs a 3D scene on that same thread — if the
   spring ever looks steppy there, the honest lever is `MOBILE_FAN_R25.spring`
   (or `readReducedMotion()`, which removes the animation entirely and is
   already certified). **User checkpoint.**
2. **A stalled main thread delays the COLLAPSE, not just the expansion.**
   `AnimatePresence` removes a petal only when its exit animation completes,
   which needs frames. Measured here: the petals were still in the DOM ~600 ms
   after `data-open` went to `0`, and gone once the loop caught up. On a phone
   at 60 Hz this is ~150 ms; on a phone that has just hitched it is longer.
   The FAB's `aria-expanded` and the container's `data-open` flip IMMEDIATELY,
   so the state is never ambiguous — but a petal can be tappable for a few
   frames after the menu logically closed.
3. **The notch.** Every number here is the 0-inset base (see the header). A
   real safe area moves the whole column inward and up; the arc moves with the
   FAB, so the geometry is invariant, but the 180° petal's distance from the
   left edge (portrait: 156 px of margin) is the number to re-read on a real
   phone. **User checkpoint.**
4. **Tablets get the fan too.** `FlyMode` mounts TouchControls on `isTouch`,
   which includes tablets, and the zone strings there are the DESKTOP ones.
   The fan is anchored to the FAB, so it cannot escape a larger screen — but
   no tablet viewport was measured this round.
5. **`hideWhileOpen` is a CSS↔JS pair.** The selector list in `globals.css`
   cannot read `MOBILE_FAN_R25.hideWhileOpen`; a gate asserts the array still
   reads exactly `['info-dock','toasts']` so the two cannot drift in silence,
   but adding a zone to the array still means editing two files.
6. **The dock class carries a LITERAL 21.75rem.** A console pin that moves
   `dockBottomRem` moves the number the gate reads and the derivation comment,
   but not the compiled Tailwind rule — Tailwind cannot generate a class that
   is not written out in source. The gate asserts the two agree, so a change
   that forgets the class is caught; a PIN that moves it is knowingly
   cosmetic.
7. **A tap outside closes the fan AND reaches what it hit.** The listener is
   read-only by charter (it must not fight the R17 tap-leak rule), so a tap on
   the world with the fan open both dismisses the menu and lets LabelCanvas
   pick an aircraft, and a tap on the joystick both dismisses and starts
   steering. The steering case is right; the aircraft-pick case is a judgement
   call a scrim would change. No scrim ships this round — it would be a new
   full-screen interactive surface in a HUD whose whole problem was too many
   surfaces. **User checkpoint.**
8. **Six petals is the shipped arc; nine is the locked one.** Nothing stops a
   future round adding a tenth `order` entry, and the arc would then space ten
   petals over the same quarter turn (168 px radius ⇒ ~26 px of arc between
   44 px petals — they would overlap). If `order` grows past ~7, the radius or
   the arc has to grow with it. Not a defect today; a tripwire for tomorrow.

## §8 Could not measure here — the honest list

* **Anything with a millisecond in it.** SwiftShader at 1–3 fps: the spring's
  duration, the stagger's read, the FAB's rotation swap, the collapse's
  latency, and whether any of it costs a dropped frame while the world is
  streaming. The numbers this ledger prints for "settle" are WALL CLOCK on a
  1 fps renderer and are not animation durations.
* **Thumb reach.** Whether the 180° petal (portrait: centre 178 px from the
  left edge, 564 px down a 844 px screen) is comfortable for a right thumb
  holding the phone, and whether the arc should mirror for a left-handed
  grip. No harness has a thumb.
* **The notch / safe-area insets.** Headless Chromium reports 0 for every
  `env(safe-area-inset-*)`.
* **A real phone's touch behaviour**: palm rejection while the stick is held,
  whether the outside-tap-closes rule fights a two-thumb grip (thumb on the
  stick, thumb on a petal), and iOS's own edge-swipe gestures near the 180°
  petal.
* **Tablet viewports.** Not measured (see §7.4).
* **Whether hiding the toast stack loses a spot.** SpotToast's queue keeps
  running behind `visibility:hidden` by construction, but "did the player miss
  a toast because the fan was open" is a play-session question.
* **The live world.** Every tile host is 403-blocked here; the fan was
  certified over an empty sky, and the contextual petals were exercised with
  an injected lock rather than real traffic.

## §9 Lessons — every one of them paid for with a red

1. **A dev server that was running when `globals.css` changed will serve you
   yesterday's stylesheet.** `hideWhileOpen` read RED — `toasts=VISIBLE` with
   `data-fan-open="1"` on the root and the selector matching the element
   (`el.matches(...)` returned `true`). The rule was right; the compiled chunk
   was 4 minutes older than the source, and Turbopack had rebuilt the app but
   not the CSS. `ls -la .next/dev/static/chunks/*globals*` against `ls -la
   app/globals.css` is a one-line check worth doing before believing any CSS
   red.
2. **A 700 ms sleep is not a settle; it is a sample of the first frame.** The
   gate measured a petal at `scale(0.6)` sitting on the FAB and reported "every
   petal is < 44 px" and "Δ168 px off its arc slot". `getBoundingClientRect`
   returns the TRANSFORMED box, so a mid-spring read is a lie about the layout
   in both size and position.
3. **A quiet window shorter than a frame is not quiet.** Two agreeing reads
   600 ms apart on a 1 fps renderer can land inside ONE painted frame:
   "nothing changed" meant "the page has not painted since I last looked", and
   the gate still read Δ130.8 mid-spring. Three agreeing reads 900 ms apart
   span 2.7 s — longer than any frame this venue produces, instant on a phone.
4. **Playwright's `waitForFunction` polls on rAF by default.** It reported
   `removedWithinCap=false` on a page where the very next line measured
   `petals=0`. `polling: 250` asks the same question at a rate that does not
   depend on the GPU.
5. **`locator.boundingBox()` runs the actionability wait.** It died with
   `Timeout 30000ms exceeded` against a call log that says, in the same
   breath, `locator resolved to visible <button data-testid="touch-fab">`. The
   element was there and unmoving; the FRAMES were not. Read the rect inside
   `page.evaluate` and dispatch on the selector — `dispatchEvent` only needs
   the element to be attached. (This is the R24 "actionability never settles
   on a continuously rendering canvas" lesson, arriving via a plain DOM
   button.)
6. **Petals reuse the ROW's testids, so a presence census cannot tell them
   apart.** On the flag-off tree the gate found five 48 px buttons, called
   them petals and handed three open-state rows a PASS — a false green inside
   the RED calibration. Every open assertion now carries
   `data-open === '1'` alongside whatever it measures.
7. **A gate about the info chip must contain an info chip.** `hideWhileOpen`
   and `dockBottomRem` both passed vacuously on the idle HUD, where
   `[data-zone="info-dock"]` does not exist at all. It is the R17 lesson
   inverted: not "a probe that contains an actor it does not control", but a
   probe that passes because the actor is ABSENT.
8. **Tailwind cannot generate a class you did not write out.** The dock offset
   had to become a getter returning one of TWO literal strings; a template
   literal built from `dockBottomRem` would have compiled to no rule at all
   and docked the chip nowhere. The flag-off literal is then
   character-identical by construction, which is exactly what the gate
   asserts.
9. **`fly-constants.js` cannot import `r25-pins.js`.** The pin accessor imports
   six constants at module scope, so the cycle throws a TDZ ReferenceError in
   one of the two load orders. Two hoisted helpers next to the owner's own
   block spell the same `pinned()` merge; a browser gate asserts the two
   readings agree.
10. **Five agents share four cores.** A settle that takes 400 ms on a phone
    took **29.7 s of wall clock** here, one dev server was OOM-killed
    mid-run, and three other harnesses were live in the process table. None of
    that is a number about the feature — which is precisely why every timing
    number in this ledger is labelled as wall clock, and why the gate waits for
    STATES rather than for clocks.

## §10 Runs — what was executed, and on which tree

All runs: D's worktree, port 3133, `FLY_TILE_FIXTURE=1 FLY_BOOT_SCALE=6
node -r ./scripts/_pw-shim.js`. Logs and screenshots under
`scripts/r25-out/` (gitignored). **Three other agents' browser harnesses were
live in the process table for most of this window** — every wall-clock number
is a number about that, not about the fan.

### Node gates on this tree (no browser, no contention)

| Gate | Result |
|---|---|
| `scripts/verify-artifact-hygiene.mjs` | **5/5 PASS** — including (1) no R15–R24 calibration artifact changed and (4) no previous-round artifact dirtied by a run |
| `scripts/graphics-unit.mjs` | **PASS** (six families, masks, stable variation, quality continuity, latitude, atmosphere, protocol) |
| `scripts/immersive-unit.mjs` | **PASS** |
| `npx eslint` on every file in the diff | clean (FlyMode's 15 `react-hooks/refs` errors are PRE-EXISTING — the same 15 on `HEAD:components/fly/FlyMode.jsx`) |

### `scripts/verify-mobile-fan.js` — D's gate

| Run | Tree | Result |
|---|---|---|
| `fan-RED-flagoff.log` | flag off (gate v1) | 20/30, 10 FAIL, 14 SKIP. Three of those passes were FALSE — the row's buttons wearing the petals' testids — which is what put `data-open === '1'` into every open assertion. |
| **`fan-RED-final.log`** | **flag off (shipped gate)** | **20/34 · 14 FAIL · 18 SKIP — the RED calibration of record.** Every armed assertion is red in both orientations (no FAB, no petals, no `data-fan-open`); the 20 passes are the flag-off identity rows themselves — the dock literal, the five row buttons, the never-fetched TouchFan chunk, the untouched stick/throttle/boost, the chip at its pre-R25 `[8,404–382,452]`. **The same gate, same tree, flag on: 53 PASS / 0 FAIL.** |
| `fan-armed-1/-2/-3` | armed | killed / instrument reds (§9.1-9.5), each one fixed in the gate, none in the feature |
| `fan-armed-4` | armed | VOID — `ERR_CONNECTION_REFUSED`: the dev server had been killed by another agent's over-broad `pkill -f next-server` |
| **`fan-armed-5.log`** | **armed** | **53 PASS · 0 FAIL · 0 SKIP**, then the same `pkill` took the server out again five rows from the end |

The five rows `fan-armed-5` did not reach are the LANDSCAPE tail —
`hideWhileOpen hides a chip that is REALLY there`, the dev handle, the two
`armed:` dock/mirror rows and the two pageerror rows. **All five passed in the
PORTRAIT leg of the same run**, and the two dock rows read the same constants
in both orientations; they are recorded here as REACHED-IN-ONE-ORIENTATION,
not as green in both.

What the 53 include, in both orientations unless noted: closed = FAB only
(56 px portrait / 48 px landscape) with `data-open="0"`, `aria-expanded=false`
and **zero petals in the DOM**; open = six petals at exactly
180/162/144/126/108/90° on ring 0, every one 44×44 and within **2 px** of the
published arc, inside the viewport, disjoint from minimap · contracts chip ·
stick · throttle · boost; `hideWhileOpen` hiding the toasts (and, portrait,
a REAL info chip); the BoostBar ring still tracking the pad to within 1.5 px;
a tap outside closing AND removing the petals; the Atlas unmounting the whole
control set and restoring it CLOSED; a lock adding INSPECT + INTERCEPT on
ring 1 with **all six persistent petals within 1 px of their no-lock
positions** and CINEMA correctly absent on a soft lock; reduced motion landing
the petals at their final positions with **0.0 px of drift at +60 ms** against
a spring control that drifted **168.0 px** (portrait) / **150.1 px**
(landscape); the dock class and `dockBottomRem` agreeing on 21.75 rem; the
`clusterSize` mirror equalling the block; `hideWhileOpen` still naming exactly
the two zones `globals.css` hides; and the only pageerror being this
container's blocked-fetch signature, with no dynamic-import failure.

### The EXISTING mobile harnesses, armed and off

| Harness | Tree | Result |
|---|---|---|
| `verify-mobile.js` | **ARMED** | dies at **:214** `page.click('[data-testid="touch-look"]')`, `Timeout 30000ms exceeded`. Before that, :161-168 already reads `pause:false atlas:false look:false` and the stick/throttle/steer legs pass. **Everything from :214 on is unreachable until `openFan` is inserted** — §6 is the list. |
| `verify-mobile-layout.js` | **ARMED** | **14 PASS / 1 FAIL / dies at :482.** The fail is the venue (`portrait zero pageerrors — Failed to fetch`); the death is `locator('[data-testid="touch-pause"]').click()` in the landscape-only leg. **Every frozen contract passes ARMED in both orientations**: the 8 zone names, no overflow, every zone member inside the viewport, pairwise zone disjointness, the 44 px sweep, the toast stack, and the info chip vs the thumbstick — now measured at the NEW dock (`chip [8,448–382,496]` portrait). The census drops from **14 interactive members to 8**, which is the five-buttons-into-one-FAB change, seen from the outside. |
| `verify-mobile-layout.js` | **flag off** | **16/18 PASS — the base tree's result, row for row.** The only two reds are the venue's `zero pageerrors` pair (`Failed to fetch`), which the UNTOUCHED base tree also fails here; 14 interactive members in both orientations, same pairwise-disjointness set, and the info chip back at `[8,404–382,452]` portrait — the pre-R25 pixels. |
| `verify-mobile.js` | flag off | NOT RUN TO COMPLETION — E CERT reports it does not complete in EITHER arm on this venue under the current load (three other agents' harnesses live, load ~15-24 on 4 cores). The flag-off tree's rendered control DOM is byte-identical to the base tree's in both orientations (`diff` clean), so the base-tree behaviour is the flag-off behaviour by construction. |

## §11 Flag-off identity — the proof, not the claim

| Claim | How it was proven | Result |
|---|---|---|
| TouchControls renders today's rows byte-for-byte | dumped `outerHTML` of `[data-zone="controls-left"]` and `[data-zone="controls-right"]` at BOTH orientations on the base tree (`6bf628e`) and on this tree with the flag off, then `diff` | **IDENTICAL** (`scripts/r25-out/base-controls.txt` vs `flagoff-controls.txt`, diff clean, 15,968 bytes) |
| the dock string is character-identical | the flag-off branch of `zones['info-dock'].phonePort`, read out of the running app through the dev handle and compared to the pre-R25 literal | **EQUAL**, and `dockBottomRem` reads 24.5 |
| TouchFan is not imported | `performance.getEntriesByType('resource')` filtered for `/TouchFan/` on the flag-off leg | **no matching resource** — the chunk is never fetched |
| the fly root is unchanged | `data-fan-open` is `undefined` (React omits the attribute), asserted on every closed census | **absent** |
| the existing layout gate is unmoved | `verify-mobile-layout.js` flag off vs the base tree | **same 16/18, same boxes** |
| nothing else in the tree moved | `verify-artifact-hygiene.mjs` gates (1) and (4) | **PASS** |

## §12 Screenshots for the user checkpoint

`scripts/r25-out/` (gitignored — copy them out before the round closes):

| File | What it shows |
|---|---|
| `BEFORE-portrait-row.png` · `BEFORE-landscape-row.png` | the flag-off HUD: five 48 px buttons stacked over the throttle rail and the BOOST pad |
| `DEMO-portrait-closed.png` · `DEMO-landscape-closed.png` | the same HUD armed: ONE hamburger FAB where the row was |
| `DEMO-portrait-open.png` · `DEMO-landscape-open.png` | the fan open — six petals on the quarter arc |
| `fan-armed-*-0*.png` | the gate's own evidence (closed / open / open-with-a-lock / open-with-the-chip) |

The plan's §6 checkpoint 3 is "D's fan demo from `r25/d` as soon as W1 closes:
petal size, arc, spring, chip hiding". The first three are in these images; the
SPRING is the one they cannot carry (§8).


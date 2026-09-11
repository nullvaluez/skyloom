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

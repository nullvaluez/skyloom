'use client';

import { useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { ActionButton, Glyph } from '@/components/fly/hud/TouchControls';
import { readReducedMotion } from '@/lib/fly/immersive';

/**
 * ROUND 25 (D MOBILE) — ONE floating button that fans every action out on a
 * quarter arc.
 *
 * THE PROBLEM, in the user's words: "a single button that pans out all of our
 * functionalities aside from the joystick". What they were looking at was a
 * column of five permanent circles that grows to eight the moment a contact
 * locks, stacked above a three-detent throttle rail and a BOOST pad, on a
 * 390 px-wide screen — and a HANGAR that had no key and no touch button at
 * all, reachable only by pausing the game (PauseMenu.jsx:201-211). Twelve
 * actions, one of them behind a modal, none of them further than a thumb's
 * width from the next.
 *
 * WHAT THIS IS. The FAB stands where the persistent row stood; the petals are
 * ABSOLUTELY POSITIONED around it, so they cost the control column no height
 * at all and can never push the throttle or the boost pad around. The
 * joystick, the throttle rail and the BOOST pad are untouched — they are the
 * controls you fly with, and a control you fly with must not be behind a tap.
 *
 * WHY NO NEW ZONE. `window.__flyZoneNames.length === 8` is a frozen contract
 * (verify-mobile-layout.js:211) and the petals have no business being a
 * ninth: they belong to the same corner as the button that opens them, and a
 * zone is "where a thing is". So the fan lives inside `controls-right`, whose
 * container is `pointer-events-none`; every petal re-enables pointer events on
 * itself exactly like every other control in there.
 *
 * THE DOM CONTRACT (E CERT's `openFan`/`closeFan` and six harnesses are
 * written against it — it does not move without D and E in the same room):
 *   [data-testid="touch-fab"]   the button, with aria-expanded="true|false"
 *   [data-testid="touch-fan"]   the container, with data-open="1|0"
 *   petals                      the EXISTING touch-* testids, unchanged, plus
 *                               the new touch-hangar, and present in the DOM
 *                               ONLY while the fan is open.
 *
 * GEOMETRY. Petal i of n sits at `fromDeg − (fromDeg − toDeg)·i/(n−1)`,
 * measured the mathematician's way (0° = +x, counter-clockwise) and flipped
 * into screen space (y grows down), so the shipped 180° → 90° arc runs from
 * "straight left of the FAB" to "straight above it" — a quarter turn into the
 * empty middle of the screen, in both orientations. The PERSISTENT set always
 * computes its angles from its own count, so a lock appearing cannot shift a
 * button a player has learned the position of; the contextual petals ride a
 * second ring further out, taking the slots nearest the thumb.
 */

const DEG = Math.PI / 180;

/**
 * Where every petal goes, in px relative to the FAB's centre. Pure, so the
 * dev handle can publish the intended geometry and a harness can diff it
 * against the rects the browser actually produced.
 *
 * `persistent` keeps ring 0 and its angles are computed from `persistent`
 * alone — that is the "the persistent set never shifts" guarantee, written as
 * arithmetic rather than as a promise.
 */
export function fanGeometry({ persistent, contextual, cfg, orientation }) {
  const land = orientation === 'landscape';
  const r0 = land ? cfg.radiusPx.landscape : cfg.radiusPx.portrait;
  const r1 = r0 + cfg.petalPx + cfg.ringGapPx; // ring 2 — see MOBILE_FAN_R25
  const from = cfg.arc.fromDeg;
  const span = cfg.arc.fromDeg - cfg.arc.toDeg;
  // n − 1 slots between n petals; a single petal sits at `fromDeg`.
  const step = persistent.length > 1 ? span / (persistent.length - 1) : 0;
  const at = (i, r) => {
    const a = (from - step * i) * DEG;
    return { x: Math.cos(a) * r, y: -Math.sin(a) * r, deg: from - step * i, r };
  };
  return [
    ...persistent.map((p, i) => ({ ...p, ring: 0, ...at(i, r0) })),
    // INNER SLOTS: the contextual petals start at `fromDeg` too, so they sit
    // radially outboard of the first, second and third persistent petals —
    // the end of the arc nearest the thumb — instead of extending it.
    ...contextual.map((p, i) => ({ ...p, ring: 1, ...at(i, r1) })),
  ];
}

export function TouchFan({ cfg, orientation, open, setOpen, petals, reducedMotion }) {
  const land = orientation === 'landscape';
  const fabPx = land ? cfg.fabPx.landscape : cfg.fabPx.portrait;
  const reduced = reducedMotion ?? readReducedMotion();

  const placed = useMemo(
    () =>
      fanGeometry({
        persistent: petals.filter((p) => !p.contextual),
        contextual: petals.filter((p) => p.contextual),
        cfg,
        orientation,
      }),
    [petals, cfg, orientation]
  );

  // DEV HANDLE, second half: the INTENDED geometry, so a harness can diff the
  // arc it measured against the arc that was asked for instead of re-deriving
  // the trigonometry in the gate (where a sign error would agree with itself).
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return;
    const h = (window.__flyMobileFan ??= {});
    h.geometry = {
      orientation,
      fabPx,
      radiusPx: land ? cfg.radiusPx.landscape : cfg.radiusPx.portrait,
      ring1Px: (land ? cfg.radiusPx.landscape : cfg.radiusPx.portrait) + cfg.petalPx + cfg.ringGapPx,
      reducedMotion: reduced,
      petals: placed.map((p) => ({
        id: p.id,
        testid: p.testid,
        ring: p.ring,
        deg: p.deg,
        x: p.x,
        y: p.y,
      })),
    };
  }, [placed, orientation, fabPx, land, cfg, reduced]);

  // TAP OUTSIDE. A window listener in the CAPTURE phase, and it only READS
  // `e.target` — it never calls stopPropagation and never preventDefault.
  // That matters twice over:
  //   · capture runs BEFORE the target's own handlers, so the R17 tap-leak
  //     fix (every control calls stopPropagation on pointerdown) cannot hide
  //     an outside tap from us — and we do not have to fight it to be heard;
  //   · because we never stop anything ourselves, the tap we observed still
  //     reaches whatever it was aimed at. Tapping the joystick with the fan
  //     open closes the fan AND starts steering, which is the behaviour a
  //     thumb expects.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (
        t instanceof Element &&
        t.closest('[data-testid="touch-fan"], [data-testid="touch-fab"]')
      ) {
        return;
      }
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, setOpen]);

  const spring = reduced
    ? { duration: 0 }
    : {
        type: 'spring',
        stiffness: cfg.spring.stiffness,
        damping: cfg.spring.damping,
        mass: cfg.spring.mass,
      };

  return (
    // The wrapper is the FAB's box and nothing more: `relative` so the petals
    // have a containing block, and exactly `fabPx` square so the flex column
    // reserves the button's height and not the fan's reach.
    <div className="relative shrink-0" style={{ width: fabPx, height: fabPx }}>
      {/* A zero-size anchor at the FAB's centre. Sizing it 0x0 is what lets a
          petal be positioned by its own offset from that centre without any
          knowledge of the wrapper's box. */}
      <div
        data-testid="touch-fan"
        data-open={open ? '1' : '0'}
        className="pointer-events-none absolute"
        style={{ left: fabPx / 2, top: fabPx / 2, width: 0, height: 0 }}
      >
        <AnimatePresence>
          {open &&
            placed.map((p, i) => (
              <motion.div
                key={p.id}
                className="absolute"
                style={{ left: -cfg.petalPx / 2, top: -cfg.petalPx / 2 }}
                // REDUCED MOTION IS `initial={false}`, NOT `duration: 0`.
                // A zero-duration animation still renders frame 1 at the
                // INITIAL value and only then jumps; `initial={false}` tells
                // framer-motion to mount at the animate values, so the petals
                // are at their final positions on the first painted frame —
                // which is the thing the setting actually promises, and the
                // thing verify-mobile-fan measures.
                initial={reduced ? false : { x: 0, y: 0, opacity: 0, scale: 0.6 }}
                animate={{ x: p.x, y: p.y, opacity: 1, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { x: 0, y: 0, opacity: 0, scale: 0.6 }}
                transition={
                  reduced ? spring : { ...spring, delay: (i * cfg.spring.staggerMs) / 1000 }
                }
              >
                <ActionButton
                  testid={p.testid}
                  label={p.label}
                  active={p.active}
                  size={cfg.petalPx}
                  onTap={() => {
                    // Every petal tap closes the fan. A radial menu that stays
                    // open after a choice is a menu you have to dismiss twice.
                    setOpen(false);
                    p.onTap();
                  }}
                >
                  <Glyph id={p.id} size={18} />
                </ActionButton>
              </motion.div>
            ))}
        </AnimatePresence>
      </div>

      <button
        type="button"
        data-testid="touch-fab"
        aria-label={open ? 'Close actions' : 'Actions'}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Actions"
        onPointerDown={(e) => {
          e.preventDefault();
          // The R17 tap-leak rule, verbatim: nothing in this HUD may reach
          // LabelCanvas's window-level pointerdown. (Our own outside-tap
          // listener is in the CAPTURE phase and has already run.)
          e.stopPropagation();
          setOpen(!open);
        }}
        className="hud-glass pointer-events-auto grid h-full w-full place-items-center rounded-full transition-colors"
        style={{
          border: `1px solid ${open ? 'rgba(249,168,212,0.6)' : 'rgba(125,211,252,0.3)'}`,
          color: open ? '#fbcfe8' : '#dbeafe',
          boxShadow: open
            ? '0 6px 20px rgba(2,4,10,0.5), inset 0 0 0 999px rgba(244,114,182,0.22)'
            : '0 6px 20px rgba(2,4,10,0.5)',
          touchAction: 'none',
        }}
      >
        {/* The 45° rotation is the TRANSITION, not the resting state: the
            hamburger leaves turning one way and the cross arrives turning the
            other, and both settle square. An X parked at 45° is a plus sign,
            which reads as "add", not "close". */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={open ? 'x' : 'menu'}
            className="grid place-items-center"
            initial={reduced ? false : { rotate: -45, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { rotate: 45, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.14 }}
          >
            {open ? (
              <X style={{ width: 22, height: 22 }} aria-hidden="true" />
            ) : (
              <Menu style={{ width: 22, height: 22 }} aria-hidden="true" />
            )}
          </motion.span>
        </AnimatePresence>
      </button>
    </div>
  );
}

export default TouchFan;

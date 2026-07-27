'use client';

import { useEffect, useState } from 'react';
import { getBoostMirror } from '@/lib/fly/juice';
import { useFlyStore } from '@/stores/fly-store';
import { BoostBar } from './BoostBar';
import { ComboChip } from './ComboChip';
import { RunSummary } from './RunSummary';

/**
 * ROUND 18 (A4 SHOWTIME) — the arcade HUD, in ONE component.
 *
 * FlyMode takes exactly one new line for the whole round-18 score layer.
 * That is deliberate: A5 GRAVITY edits FlyMode in the same wave (the
 * CrashFlash mount), and two agents inserting sibling lists into the same JSX
 * block is the classic avoidable conflict.
 *
 * Photo mode is handled here rather than by wrapping the mount in a
 * `HudGroup`, for the same reason — reading `cameraMode` costs one
 * subscription and keeps the FlyMode diff to a single line.
 *
 * LAYOUT NOTE (deviation from the plan's "add a `score` zone"): the zone
 * table lives in `MOBILE_UI.zones`, which is NOT one of this agent's five
 * owned constants blocks, and a new zone name would also widen what
 * verify-mobile-layout enumerates in a zero-re-baseline round. Both chips are
 * pointer-events-none decorations, so they anchor themselves instead:
 *   desktop  — a right-hand column ABOVE the minimap (which occupies
 *              bottom 40 → 208 px at right 16 px), i.e. the same rail the
 *              throttle legend reads against.
 *   portrait — left column just above the contracts chip
 *              (contracts sits at safe-area-top + 15 rem).
 *   landscape— left column above the landscape contracts chip (top 2.9 rem).
 * Because nothing here is interactive, none of it enters the mobile gate's
 * overlap or 44 px passes.
 */
export function JuiceHud() {
  const photoActive = useFlyStore((s) => s.cameraMode === 'photo');
  const combo = useFlyStore((s) => s.combo);
  const [hasBoost, setHasBoost] = useState(false);

  // The column is a positioning shell with no look of its own, so it must not
  // exist when both of its children are absent — that is what makes the
  // "flags false ⇒ ZERO HUD elements" revert contract literally true rather
  // than merely invisible. 2 Hz is plenty: `present` flips at most twice a
  // session (when A5's meter appears).
  useEffect(() => {
    const id = setInterval(() => {
      const v = getBoostMirror().present;
      setHasBoost((p) => (p === v ? p : v));
    }, 500);
    return () => clearInterval(id);
  }, []);

  const showColumn = combo >= 2 || hasBoost;

  return (
    <>
      {!photoActive && showColumn && (
        <div
          data-testid="juice-hud"
          className="pointer-events-none absolute bottom-56 right-4 z-10 flex flex-col items-end gap-2 phone:bottom-auto phone:right-auto phone:left-2 phone:top-[calc(env(safe-area-inset-top)+12.4rem)] phone:items-start phone-land:left-[max(env(safe-area-inset-left),0.5rem)] phone-land:top-[0.55rem]"
        >
          <BoostBar />
          <ComboChip />
        </div>
      )}
      {/* Outside the photo-mode gate on purpose: a run that ends while the
          player is lining up a photo still has to tell them it ended. */}
      <RunSummary />
    </>
  );
}

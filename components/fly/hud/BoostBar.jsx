'use client';

import { useEffect, useRef, useState } from 'react';
import { MOBILE_UI } from '@/lib/fly/fly-constants';
import { getBoostMirror } from '@/lib/fly/juice';
import { useDeviceLayout } from '@/hooks/use-device-layout';

const RING_PAD = 3; // px of clearance between the pad edge and the ring stroke

/**
 * ROUND 18 (A4 SHOWTIME) — the boost meter readout.
 *
 * Reads `runtime.boost = {frac, armed}`, which A5 GRAVITY publishes from the
 * cmd-assembly meter. THIS WAVE THAT FIELD DOES NOT EXIST YET: the component
 * mounts, sees undefined, and renders literally nothing — so a pre-merge tree
 * is byte-clean and either merge order builds. `present` is the only piece of
 * React state and it flips at most twice a session.
 *
 * Updates on a 10 Hz interval writing straight to refs (the FlyHUD idiom).
 * The meter is continuous data; putting it through React state would re-render
 * the HUD sixty times a second for a bar that moves 1 px.
 *
 * Two forms:
 *   desktop — a slim vertical rail in the right column (above the minimap),
 *             next to where the throttle legend lives.
 *   phone   — an SVG ring-fill traced around the existing BOOST touch pad. The
 *             pad has no ref and no positioning context of its own, so the ring
 *             is an absolutely-positioned overlay that follows the pad's live
 *             getBoundingClientRect(). That survives A5/A3 re-laying-out the
 *             cluster, which hard-coding MOBILE_UI.clusterSize offsets would
 *             not.
 */
export function BoostBar() {
  const { isPhone } = useDeviceLayout();
  const [present, setPresent] = useState(false);
  const fillRef = useRef(null);
  const wrapRef = useRef(null);
  const ringRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => {
      const b = getBoostMirror();
      const have = b.present;
      setPresent((p) => (p === have ? p : have));
      if (!have) return;
      const frac = Math.max(0, Math.min(1, b.frac));

      if (wrapRef.current) {
        // Depleted-and-not-yet-re-armed is the state the player must read at a
        // glance: the whole widget desaturates until the meter re-arms.
        wrapRef.current.style.opacity = b.armed === false ? '0.55' : '1';
      }
      if (fillRef.current) {
        fillRef.current.style.height = `${(frac * 100).toFixed(1)}%`;
        fillRef.current.style.background = b.armed === false ? '#f87171' : '#7dd3fc';
      }
      if (ringRef.current) {
        const el = document.querySelector('[data-testid="touch-boost"]');
        const box = boxRef.current;
        if (el && box) {
          const r = el.getBoundingClientRect();
          if (r.width > 0) {
            box.style.left = `${r.left - RING_PAD}px`;
            box.style.top = `${r.top - RING_PAD}px`;
            box.style.width = `${r.width + RING_PAD * 2}px`;
            box.style.height = `${r.height + RING_PAD * 2}px`;
            box.style.opacity = '1';
          }
        } else if (box) {
          box.style.opacity = '0';
        }
        // The ring is one rounded-rect path drawn with a dash offset, so the
        // fill sweeps the perimeter instead of stepping around corners.
        const len = ringRef.current.getTotalLength?.() ?? 0;
        if (len > 0) {
          ringRef.current.style.strokeDasharray = `${len}`;
          ringRef.current.style.strokeDashoffset = `${len * (1 - frac)}`;
          ringRef.current.style.stroke = b.armed === false ? '#f87171' : '#7dd3fc';
        }
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  if (!present) return null;

  if (isPhone) {
    const w = MOBILE_UI.clusterSize.boostPx + RING_PAD * 2;
    const h = MOBILE_UI.minTargetPx + RING_PAD * 2;
    return (
      <div
        ref={boxRef}
        data-testid="boost-bar"
        className="pointer-events-none fixed z-20"
        style={{ opacity: 0 }}
      >
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
        >
          <rect
            x="1"
            y="1"
            width={w - 2}
            height={h - 2}
            rx="15"
            fill="none"
            stroke="rgba(125,211,252,0.16)"
            strokeWidth="2"
          />
          <rect
            ref={ringRef}
            x="1"
            y="1"
            width={w - 2}
            height={h - 2}
            rx="15"
            fill="none"
            stroke="#7dd3fc"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ transition: 'stroke 200ms linear' }}
          />
        </svg>
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      data-testid="boost-bar"
      className="pointer-events-none flex flex-col items-center gap-1"
    >
      <span className="text-[8px] uppercase tracking-[0.28em] text-zinc-400">bst</span>
      <div
        className="relative w-1.75 overflow-hidden rounded-full"
        style={{ height: 88, background: 'rgba(207, 238, 248, 0.09)' }}
      >
        <div
          ref={fillRef}
          className="absolute inset-x-0 bottom-0 rounded-full"
          style={{ height: '100%', background: '#7dd3fc', transition: 'height 120ms linear' }}
        />
      </div>
    </div>
  );
}

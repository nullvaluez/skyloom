'use client';

import { useEffect, useRef } from 'react';
import { MOBILE_UI } from '@/lib/fly/fly-constants';

/**
 * ROUND 17 — the Fly HUD's layout skeleton.
 *
 * THE PROBLEM IT SOLVES. The flying HUD was fifteen sibling overlays, each
 * hard-coding a corner of the screen and none of them able to see any other.
 * On desktop that is fine — the corners are far apart. On a 390x844 phone it
 * is not: the InfoCard landed exactly on the joystick (and ate the steering
 * touch), badge toasts ran ~180 px off the right edge, and the only tool for
 * fixing any of it was to add one more `max-sm:` guess to one more component.
 *
 * THE SHAPE. Positions now live in `MOBILE_UI.zones` (lib/fly/fly-constants.js)
 * and are rendered by ONE component as named containers. An overlay stops
 * being "the thing at bottom-left" and becomes "the content of the info-dock
 * zone", so two overlays can be proven disjoint by comparing two zone rects
 * instead of by flying the game and squinting.
 *
 * DESKTOP IS BYTE-IDENTICAL. Not "carefully re-checked" — identical by
 * construction. Every `desktop` string in MOBILE_UI.zones was transcribed off
 * the component that hard-codes it today, so a migration is a pure
 * re-parenting: same offsets, same z-index, on a container instead of a leaf.
 * All migrated zone members sit at z-10 and none of them overlap on desktop,
 * so re-parenting cannot reshuffle paint order either.
 *
 * WHY NOT PORTALS. A `<Zone>` that portalled its children into a central
 * scaffold would have kept FlyMode's JSX untouched, which is tempting — but
 * photo mode hides the HUD with `display:none` on wrappers IN FlyMode's tree
 * (the HudGroup contract: hidden, never unmounted, so contract progress and
 * the toast queue survive). Portalled content escapes an ancestor's
 * `display:none`, so the shutter would have left toasts and the minimap
 * hanging in the shot. Zones are plain containers, rendered in place.
 *
 * OWNERSHIP. A zone is rendered EXACTLY ONCE. `OWNED` lists the zones whose
 * component renders its own `<Zone>` as its root; LayoutRoot renders the rest
 * as empty scaffolding. An empty absolutely-positioned, pointer-events-none
 * div has zero size and paints nothing, so unclaimed zones are inert.
 */

/** Every zone name, in the order they are declared in MOBILE_UI.zones. */
export const ZONE_NAMES = Object.keys(MOBILE_UI.zones);

/**
 * Zones rendered by their owning component rather than by LayoutRoot.
 * MOVE A NAME HERE in the same commit that switches the component's root to
 * `<Zone name="...">` — a name in both places would mount the zone twice and
 * the second mount would win the `__flyZones` registry entry.
 *
 * `controls-left` / `controls-right` start here on purpose: they are the
 * thumbstick and action-cluster anchors, touch-only, and they belong to
 * components/fly/hud/TouchControls.jsx (round 17 agent A5). LayoutRoot must
 * not shadow them.
 */
const OWNED = new Set(['controls-left', 'controls-right']);

/**
 * Compose a zone's class list: desktop offsets first, then the additive phone
 * variants. ADDITIVE is the contract — `phone-port:`/`phone-land:` only
 * override the properties they name, so the desktop string stays the base in
 * every device state and a zone can never lose its stacking or its position
 * because a phone rule forgot to restate it.
 */
export function zoneClass(name) {
  const z = MOBILE_UI.zones[name];
  if (!z) return '';
  return ['pointer-events-none', z.desktop, z.phonePort, z.phoneLand]
    .filter(Boolean)
    .join(' ');
}

/**
 * One named zone container. `pointer-events-none` so an empty or padded zone
 * never swallows a drag meant for the world; interactive CONTENT re-enables
 * pointer events on itself (every migrated overlay already does — that is how
 * the minimap canvas and the InfoCard buttons work today).
 */
export function Zone({ name, className = '', style, children, ...rest }) {
  const ref = useRef(null);
  const spec = MOBILE_UI.zones[name];

  // Dev-only introspection registry — the `window.__satRoads` pattern.
  // scripts/verify-mobile-layout.js reads zone rects out of it to prove
  // no-overflow and pairwise disjointness without having to know which
  // component happens to own which corner this round.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return;
    const reg = (window.__flyZones ??= {});
    reg[name] = ref.current;
    return () => {
      if (reg[name] === ref.current) delete reg[name];
    };
  }, [name]);

  return (
    <div
      ref={ref}
      data-zone={name}
      className={`${zoneClass(name)}${className ? ` ${className}` : ''}`}
      style={spec?.style ? { ...spec.style, ...style } : style}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * The scaffold. Mounts every zone that no component has claimed yet.
 *
 * Placed EARLY in FlyMode's tree, directly after the canvas: every zone member
 * is z-10, every full-screen overlay that must cover them is z-20 or higher,
 * so the z-index decides and the DOM position only has to be somewhere the
 * z-10 group agrees on. (It is also where the zones' content will end up, so
 * the tree reads in paint order.)
 */
export function LayoutRoot() {
  return (
    <>
      {ZONE_NAMES.filter((n) => !OWNED.has(n)).map((n) => (
        <Zone key={n} name={n} />
      ))}
    </>
  );
}

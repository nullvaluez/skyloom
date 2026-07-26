'use client';

import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  Camera,
  Crosshair,
  Eye,
  Info,
  Map as MapIcon,
  Pause,
  Video,
  Zap,
} from 'lucide-react';
import { Zone } from '@/components/fly/LayoutRoot';
import { MOBILE_UI } from '@/lib/fly/fly-constants';
import { useDeviceLayout } from '@/hooks/use-device-layout';
import { useOverlayBack } from '@/hooks/use-overlay-back';
import { useFlyStore } from '@/stores/fly-store';

/**
 * On-screen flight controls for touch devices (mobile / tablet). Desktop
 * never mounts this — FlyMode gates it behind `useDeviceLayout().isTouch`.
 * Everything drives the shared InputController imperatively (runtime.input),
 * the same struct the mouse/keyboard produce, so the flight model is
 * untouched:
 *
 *   • left thumbstick  → setTouchSteer(x, y)   (turn + pitch, expo-shaped)
 *   • throttle rail     → setSpeedPreset(...)   (mirrors the 1/2/3 keys)
 *   • BOOST pad         → setBoost(true/false)  (mirrors HOLDING Shift)
 *   • LOOK toggle       → setLookActive()/addLook()  (RMB-orbit equivalent)
 *   • ATLAS / LOGBOOK / PAUSE → store transitions    (M / L / Esc equivalent)
 *   • INSPECT / INTERCEPT / CINEMA / PHOTO → input.press('t'|'f'|'c'|'p')
 *
 * ROUND 17 — three things changed here, and the first is a BUG FIX.
 *
 * 1. THE TAP LEAK. LabelCanvas listens for pointerdown on WINDOW (its canvas
 *    is pointer-events-none, so that is the only way it can pick a plane).
 *    Nothing here stopped propagation, so every thumb on the joystick, every
 *    throttle detent and every button ALSO reached that listener, and a touch
 *    landing within the fat-finger radius of any projected aircraft opened the
 *    inspect card mid-turn. Every pointer handler below now calls
 *    `stopPropagation()`. React attaches its listeners at the root container
 *    and forwards the call to the NATIVE event, so a window-level listener
 *    genuinely never fires — this is not a React-tree-only stop.
 *    (LabelCanvas also carries a `[data-zone]` exclusion guard, so the fix
 *    holds even for a listener that bypassed React entirely.)
 *
 * 2. ZONES. The two anchors are now `<Zone>` containers (components/fly/
 *    LayoutRoot.jsx) reading `MOBILE_UI.zones['controls-left'|'controls-right']`,
 *    whose `style` values were transcribed verbatim off the hard-coded ones
 *    that used to live here — portrait geometry is unchanged to the pixel.
 *    LayoutRoot lists both names in its OWNED set precisely so this component
 *    can mount them; that is also what registers them in `window.__flyZones`
 *    for the layout harness's disjointness proof.
 *
 * 3. THE ACTION CLUSTER. Before this round a phone could not press F, C, T,
 *    L or P at all, while the HUD cheerfully printed "C to exit" at it. The
 *    cluster is driven by `MOBILE_UI.cluster` (the ORDER contract shared with
 *    the layout half of the round) and the one-shot actions ride
 *    `InputController.press()` into FlyScene's EXISTING consumePress state
 *    machines — so a touch intercept and a keyboard intercept are the same
 *    code path, guards and all, and cannot drift apart.
 *
 * The controls hide themselves whenever a full overlay owns the screen (pause
 * menu, Atlas, inspect card, logbook, hangar, photo mode) — the stick is
 * neutralized there anyway. Look mode auto-exits on any such overlay so it can
 * never desync.
 */

const KNOB_TRAVEL = 52; // px — max thumbstick deflection from center
const { buttonPx, contextualPx, boostPx } = MOBILE_UI.clusterSize;

// Throttle detents, top (fast) → bottom (slow); mirrors keys 3 / 2 / 1.
const THROTTLE = [
  { key: 'boost', label: 'BOOST', tint: '#f9a8d4' },
  { key: 'cruise', label: 'CRUISE', tint: '#7dd3fc' },
  { key: 'slow', label: 'SLOW', tint: '#bef264' },
];

/** Cluster metadata by id — labels/testids stay in MOBILE_UI.cluster. */
const CLUSTER_ICON = {
  look: Eye,
  atlas: MapIcon,
  logbook: BookOpen,
  photo: Camera,
  pause: Pause,
  inspect: Info,
  intercept: Crosshair,
  cinema: Video,
};

const PERSISTENT = MOBILE_UI.cluster.filter((c) => !c.contextual);
const CONTEXTUAL = MOBILE_UI.cluster.filter((c) => c.contextual);

/** Dev-only telemetry so the harness can prove WHICH action a tap fired. */
function stampPress(key) {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return;
  (window.__flyStats ??= {}).touchPress = { key, at: Date.now() };
}

function Thumbstick({ runtime, lookMode }) {
  const baseRef = useRef(null);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [dragActive, setDragActive] = useState(false); // drives the snap-back

  const apply = (e) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > KNOB_TRAVEL) {
      dx = (dx / dist) * KNOB_TRAVEL;
      dy = (dy / dist) * KNOB_TRAVEL;
    }
    setKnob({ x: dx, y: dy });
    if (lookMode) {
      // Relative-drag orbit: feed raw finger deltas as screen fractions —
      // the same units an RMB drag produces (chase camera consumes them).
      runtime.input?.addLook(
        (e.clientX - last.current.x) / window.innerWidth,
        (e.clientY - last.current.y) / window.innerHeight
      );
      last.current = { x: e.clientX, y: e.clientY };
    } else {
      runtime.input?.setTouchSteer(dx / KNOB_TRAVEL, dy / KNOB_TRAVEL);
    }
  };

  const onDown = (e) => {
    e.preventDefault();
    e.stopPropagation(); // THE TAP LEAK (see header) — never reach LabelCanvas
    dragging.current = true;
    setDragActive(true);
    last.current = { x: e.clientX, y: e.clientY };
    try {
      baseRef.current?.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic/never-active pointer id — the drag still tracks on-element */
    }
    apply(e);
  };
  const onMove = (e) => {
    if (!dragging.current) return;
    e.stopPropagation();
    apply(e);
  };
  const onUp = (e) => {
    e.stopPropagation();
    dragging.current = false;
    setDragActive(false);
    try {
      baseRef.current?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* see onDown */
    }
    setKnob({ x: 0, y: 0 });
    if (!lookMode) runtime.input?.clearTouchSteer();
  };

  return (
    <div
      ref={baseRef}
      data-testid="touch-joystick"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onContextMenu={(e) => e.preventDefault()}
      className="hud-glass pointer-events-auto relative grid h-32 w-32 place-items-center rounded-full"
      style={{
        touchAction: 'none',
        border: `1px solid ${lookMode ? 'rgba(249,168,212,0.5)' : 'rgba(125,211,252,0.35)'}`,
        boxShadow: '0 8px 30px rgba(2,4,10,0.5)',
      }}
    >
      {/* cardinal ticks */}
      <div className="pointer-events-none absolute inset-2 rounded-full border border-white/5" />
      <span
        className="pointer-events-none absolute font-mono text-[8px] uppercase tracking-widest"
        style={{ top: 7, color: lookMode ? 'rgba(249,168,212,0.75)' : 'rgba(191,219,254,0.55)' }}
      >
        {lookMode ? 'look' : '▲'}
      </span>
      {/* knob */}
      <div
        className="pointer-events-none h-14 w-14 rounded-full"
        style={{
          transform: `translate(${knob.x}px, ${knob.y}px)`,
          background: lookMode
            ? 'radial-gradient(circle at 35% 30%, rgba(252,231,243,0.95), rgba(244,114,182,0.55))'
            : 'radial-gradient(circle at 35% 30%, rgba(238,245,255,0.95), rgba(125,211,252,0.55))',
          border: '1px solid rgba(255,255,255,0.55)',
          boxShadow: lookMode
            ? '0 0 16px rgba(244,114,182,0.5), inset 0 1px 2px rgba(255,255,255,0.6)'
            : '0 0 16px rgba(125,211,252,0.5), inset 0 1px 2px rgba(255,255,255,0.6)',
          transition: dragActive ? 'none' : 'transform 0.18s ease-out',
        }}
      />
    </div>
  );
}

function Throttle({ runtime, preset, boost }) {
  const activeKey = boost ? 'boost' : preset;
  return (
    <div
      data-testid="touch-throttle"
      className="hud-glass pointer-events-auto flex flex-col overflow-hidden rounded-2xl"
      style={{
        width: boostPx,
        border: '1px solid rgba(125,211,252,0.28)',
        boxShadow: '0 8px 30px rgba(2,4,10,0.5)',
        touchAction: 'none',
      }}
    >
      {THROTTLE.map((t, i) => {
        const on = t.key === activeKey;
        return (
          <button
            key={t.key}
            type="button"
            data-testid={`touch-throttle-${t.key}`}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              runtime.input?.setSpeedPreset(t.key);
            }}
            className="flex min-h-11 items-center justify-center py-3 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors"
            style={{
              color: on ? '#04060f' : 'rgba(203,213,225,0.75)',
              background: on ? t.tint : 'transparent',
              borderTop: i === 0 ? 'none' : '1px solid rgba(148,163,184,0.14)',
              textShadow: on ? 'none' : '0 1px 2px rgba(0,0,0,0.6)',
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Momentary BOOST — the touch spelling of HOLDING Shift.
 *
 * `InputController.setBoost()` has existed (and been read by `read()`) since
 * round 9 with ZERO callers; this is its caller. Momentary means the release
 * MUST be unconditional, so pointerup / pointercancel / pointerleave all clear
 * it: a finger that slides off the pad, or a gesture the browser steals for a
 * system swipe, cannot leave the throttle jammed open.
 */
function BoostPad({ runtime, held, setHeld }) {
  const release = (e) => {
    e?.stopPropagation?.();
    if (!held) return;
    setHeld(false);
    runtime.input?.setBoost(false);
  };
  return (
    <button
      type="button"
      data-testid="touch-boost"
      aria-label="Boost"
      aria-pressed={held}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setHeld(true);
        runtime.input?.setBoost(true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      className="hud-glass pointer-events-auto flex items-center justify-center gap-1 rounded-2xl font-mono text-[10px] font-bold uppercase tracking-[0.14em] transition-colors"
      style={{
        width: boostPx,
        height: MOBILE_UI.minTargetPx,
        touchAction: 'none',
        border: `1px solid ${held ? 'rgba(249,168,212,0.65)' : 'rgba(125,211,252,0.28)'}`,
        color: held ? '#fbcfe8' : '#dbeafe',
        boxShadow: held
          ? '0 6px 20px rgba(2,4,10,0.5), inset 0 0 0 999px rgba(244,114,182,0.28)'
          : '0 6px 20px rgba(2,4,10,0.5)',
      }}
    >
      <Zap className="h-3.5 w-3.5" aria-hidden="true" />
      BST
    </button>
  );
}

/**
 * One round cluster button. `size` is the tap target in px — never below
 * `MOBILE_UI.minTargetPx`.
 *
 * The active tint is an INSET box-shadow rather than a `background`, so it
 * composites OVER whatever `.hud-glass` resolved to (translucent + blurred on
 * desktop/tablet, near-solid and blur-free on a phone). Overriding `background`
 * inline would have won against the class and handed phones a 22%-alpha button
 * with no backdrop blur behind it — i.e. an unreadable one.
 */
function ActionButton({ testid, label, active, size = buttonPx, onTap, children }) {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onTap();
      }}
      className="hud-glass pointer-events-auto grid shrink-0 place-items-center rounded-full transition-colors"
      style={{
        width: size,
        height: size,
        border: `1px solid ${active ? 'rgba(249,168,212,0.6)' : 'rgba(125,211,252,0.3)'}`,
        color: active ? '#fbcfe8' : '#dbeafe',
        boxShadow: active
          ? '0 6px 20px rgba(2,4,10,0.5), inset 0 0 0 999px rgba(244,114,182,0.22)'
          : '0 6px 20px rgba(2,4,10,0.5)',
        touchAction: 'none',
      }}
    >
      {children}
    </button>
  );
}

function Glyph({ id, size }) {
  const Icon = CLUSTER_ICON[id];
  return Icon ? <Icon style={{ width: size, height: size }} aria-hidden="true" /> : null;
}

export function TouchControls({ runtime }) {
  const phase = useFlyStore((s) => s.phase);
  const atlasOpen = useFlyStore((s) => s.atlasOpen);
  const inspectHex = useFlyStore((s) => s.inspectHex);
  const logbookOpen = useFlyStore((s) => s.logbookOpen);
  const hangarOpen = useFlyStore((s) => s.hangarOpen); // round 17
  const cameraMode = useFlyStore((s) => s.cameraMode); // round 17 (photo/cinema)
  const speedPreset = useFlyStore((s) => s.speedPreset);
  // Targeting state is DISCRETE (it changes on lock transitions, never per
  // frame — FlyScene writes it only when it differs), so subscribing is not a
  // per-frame-through-React violation.
  const lockedHex = useFlyStore((s) => s.lockedHex);
  const lockState = useFlyStore((s) => s.lockState);
  const { orientation } = useDeviceLayout();
  const [lookMode, setLookMode] = useState(false);

  // Android / in-browser BACK replays the Escape chain. Mounted HERE rather
  // than in FlyMode because it only matters on touch, and this component is
  // already the exact "we are on a touch device" boundary. It is called
  // before any early return, so it keeps running while an overlay covers us —
  // which is precisely when it has work to do.
  useOverlayBack(true);

  // A full overlay owns the screen (pause / Atlas / inspect / logbook / hangar
  // / photo) and neutralizes the stick, so free-look must read as OFF while
  // covered. Derive it — never a second state that could desync — and let ONE
  // effect mirror the effective value onto the InputController (updating an
  // external system is exactly what an effect is for). Round 17: the hangar is
  // a full-bleed phone sheet, so it belongs in this list exactly like the
  // logbook (measured: without it, the joystick and throttle rail float over
  // the cards); photo mode joins it because the shot must be clean and
  // PhotoModeBar carries its own controls.
  const covered =
    phase === 'paused' ||
    atlasOpen ||
    !!inspectHex ||
    logbookOpen ||
    hangarOpen ||
    cameraMode === 'photo';
  const lookActive = lookMode && !covered;
  useEffect(() => {
    runtime.input?.setLookActive(lookActive);
  }, [lookActive, runtime]);

  // Boost is momentary state on the controller, not the store — reflect it in
  // the throttle highlight by polling at a lazy cadence (never per frame).
  // `boostHeld` is this component's own pad; the poll also catches a physical
  // Shift on a keyboard-equipped tablet.
  const [boost, setBoost] = useState(false);
  const [boostHeld, setBoostHeld] = useState(false);
  useEffect(() => {
    const id = setInterval(() => {
      const cmd = runtime.input?.read?.();
      setBoost(!!cmd?.boost && cmd.speedPreset !== 'boost');
    }, 200);
    return () => clearInterval(id);
  }, [runtime]);

  // A held BOOST must not survive an overlay opening (neutralize() clears the
  // controller's flag, so the pad's local state would be the only thing left
  // saying "held") or an unmount.
  useEffect(() => {
    if (!covered) return;
    setBoostHeld(false);
    runtime?.input?.setBoost(false);
  }, [covered, runtime]);
  useEffect(() => () => runtime?.input?.setBoost(false), [runtime]);

  if (covered) return null;

  const toggleLook = () => {
    setLookMode((v) => {
      if (!v) runtime.input?.clearTouchSteer(); // stop steering as look begins
      return !v;
    });
  };

  // One-shot actions ride the SAME edge-press channel the keyboard writes, so
  // FlyScene's consumePress() machines (and their guards) are the only
  // implementation of "what F/C/P do".
  const press = (key) => {
    runtime.input?.press(key);
    stampPress(key);
  };

  const TAP = {
    look: toggleLook,
    atlas: () => useFlyStore.getState().setAtlasOpen(true),
    logbook: () => useFlyStore.getState().setLogbookOpen(true),
    photo: () => press('p'),
    pause: () => useFlyStore.getState().setPhase('paused'),
    // The T-key path, minus the key: FlyScene's `consumePress('t')` needs a
    // lock it can read off the targeting engine, and we already have the hex
    // the store mirrors — so open the card directly and stamp the same
    // telemetry, which keeps the harness reading ONE channel for every tap.
    inspect: () => {
      if (!lockedHex) return;
      useFlyStore.getState().setInspectHex(lockedHex);
      stampPress('t');
    },
    intercept: () => press('f'),
    cinema: () => press('c'),
  };

  const locked = !!lockedHex && lockState !== 'none';
  const chasing = lockState === 'intercepting' || lockState === 'formation';
  // Which contextual buttons are RELEVANT right now. INSPECT and INTERCEPT
  // mirror the F/T keys (any lock); CINEMA mirrors C, which FlyScene gates on
  // `autopilot.mode !== 'off'` — the store spelling of that is a chase-grade
  // lock state, so an inert button can never appear.
  const shows = { inspect: locked, intercept: locked, cinema: chasing };
  const actives = { inspect: false, intercept: chasing, cinema: cameraMode === 'cinema' };
  const contextual = CONTEXTUAL.filter((c) => shows[c.id]);

  // Landscape is 390 px TALL — the right column (contextual row + cluster row +
  // throttle rail + boost pad) is the tallest thing on the screen, so it gives
  // back both its gaps AND its stacking: the BOOST pad moves BESIDE the
  // throttle rail instead of under it, which is 52 px of a 390 px screen. The
  // two stay adjacent either way, because they are one functional group.
  // The zone ANCHORS are identical in both orientations on purpose — the
  // bottom offset exists to clear the mandatory attribution credit, and that
  // credit does not move when you turn the phone.
  const land = orientation === 'landscape';
  const stackGap = land ? 'gap-2' : 'gap-3';
  const rowGap = land ? 'gap-1.5' : 'gap-2';
  const throttleGroup = (
    <>
      <Throttle runtime={runtime} preset={speedPreset} boost={boost} />
      <BoostPad runtime={runtime} held={boostHeld} setHeld={setBoostHeld} />
    </>
  );

  return (
    <>
      <Zone name="controls-left">
        <Thumbstick runtime={runtime} lookMode={lookActive} />
      </Zone>

      <Zone name="controls-right" className={`flex flex-col items-end ${stackGap}`}>
        {/* Integration (Fable): in LANDSCAPE the contextual row rides IN the
            persistent row instead of stacking above it — a stacked row pushed
            the column top to ~y42 on a 390px-tall screen, straight into the
            minimap's band (caught by verify-mobile-layout's zone-overlap
            gate). Inline, the column top stays ~150px and the minimap ends
            ~146px. Portrait keeps the stacked row. */}
        {!land && contextual.length > 0 && (
          <div className={`flex ${rowGap}`} data-testid="touch-contextual">
            {contextual.map((c) => (
              <ActionButton
                key={c.id}
                testid={c.testid}
                label={c.label}
                active={actives[c.id]}
                size={contextualPx}
                onTap={TAP[c.id]}
              >
                <Glyph id={c.id} size={18} />
              </ActionButton>
            ))}
          </div>
        )}

        <div className={`flex ${rowGap}`}>
          {land && contextual.length > 0 && (
            <div className={`flex ${rowGap}`} data-testid="touch-contextual">
              {contextual.map((c) => (
                <ActionButton
                  key={c.id}
                  testid={c.testid}
                  label={c.label}
                  active={actives[c.id]}
                  size={contextualPx}
                  onTap={TAP[c.id]}
                >
                  <Glyph id={c.id} size={18} />
                </ActionButton>
              ))}
            </div>
          )}
          {PERSISTENT.map((c) => (
            <ActionButton
              key={c.id}
              testid={c.testid}
              label={c.label}
              active={c.id === 'look' ? lookActive : false}
              onTap={TAP[c.id]}
            >
              <Glyph id={c.id} size={20} />
            </ActionButton>
          ))}
        </div>

        {land ? (
          <div className={`flex flex-row-reverse items-end ${rowGap}`}>{throttleGroup}</div>
        ) : (
          throttleGroup
        )}
      </Zone>
    </>
  );
}

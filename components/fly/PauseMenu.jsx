'use client';

import { useEffect } from 'react';
import { useFlyStore, inFlight } from '@/stores/fly-store';
import { usePassportStore } from '@/stores/passport-store';
import { useIsTouch } from '@/hooks/use-is-touch';
// Round 17: the hangar's ONLY entry point (no keyboard shortcut this round).
import { HANGAR } from '@/lib/fly/fly-constants';
import { aircraftName } from '@/lib/fly/player-aircraft';
import { immersiveOn } from '@/lib/fly/immersive';
import { callRuntimeAction } from '@/lib/fly/runtime-bus';
// R25 A (FRONT DOOR): the settings rows and the credits panel are shared with
// the title's Settings sheet / Credits button; exit leads to the title.
import { MenuButton, SettingsRows } from './hud/SettingsRows';
import { CreditsPanel } from './hud/CreditsPanel';
import { exitGoesToTitle, frontDoorOn } from '@/lib/fly/front-door';

const HELP_SEEN_KEY = 'fly-controls-seen';

const CONTROL_ROWS = [
  ['Mouse', 'steer — cursor offset from center commands the turn/pitch'],
  ['WASD / arrows', 'steer (adds to mouse)'],
  ['1 / 2 / 3', 'airport: idle / taxi / takeoff · cruise: slow / cruise / boost'],
  ['+ / −', 'adjust throttle near airports'],
  ['Space / B', 'hold wheel brakes / toggle parking brake'],
  ['Shift (hold)', 'boost'],
  ['RMB (hold)', 'free-look — full 360° orbit, snaps back on release'],
  ['F', 'intercept the locked aircraft · F again to release'],
  ['C', 'cinema wing-cam while chasing · C again to exit'],
  ['Click a plane', 'inspect it — warp to it or order an intercept'],
  ['T', 'inspect whatever is soft-locked (no aiming needed)'],
  ['M', 'open the Atlas — warp anywhere on Earth'],
  ['L', 'pilot logbook — every spot, badge and stat you have earned'],
  ['Hard stick input', 'breaks intercept/formation'],
  ['Esc', 'close modal / pause menu'],
];

// Touch scheme — mirrors CONTROL_ROWS for the on-screen controls.
const TOUCH_CONTROL_ROWS = [
  ['Left stick', 'steer — push where you want to fly (up = climb)'],
  ['Throttle', 'tap SLOW / CRUISE / BOOST on the right rail'],
  ['👁 Look', 'toggle free-look, then drag the stick to orbit'],
  ['Tap a plane', 'inspect it — then WARP to it or order a CHASE'],
  ['🗺 Atlas', 'warp anywhere on Earth'],
  ['📓 Logbook', 'your spots, badges and stats — open it from this menu'],
  ['⏸ Pause', 'this menu — quality, map style, sound, exit'],
];

/**
 * Pause layer (Phase 6): Esc pauses instead of exiting; exit lives in the
 * menu. Includes the quality-tier setting, the controls reference, and the
 * credits panel rendered from the lib/fly/assets.js manifest (CC-BY
 * requirement). The world keeps rendering (and live traffic keeps moving)
 * behind the dim — only player input is neutralized while paused. The
 * attribution bar stays visible: this backdrop leaves the bottom strip
 * clear and sits below its stacking order.
 */
export function PauseMenu({ onExit }) {
  const phase = useFlyStore((s) => s.phase);
  const creditsOpen = useFlyStore((s) => s.creditsOpen);
  const controlsHelpSeen = useFlyStore((s) => s.controlsHelpSeen);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const aircraftId = useFlyStore((s) => s.aircraftId);
  // R25 A: the first-entry help card waits for an actual flight (the title
  // and the hangar are menus). Constant true with FRONT_DOOR off.
  const flying = useFlyStore((s) => !frontDoorOn() || inFlight(s));
  const isTouch = useIsTouch();

  // First-entry controls help (map style now resolves in FlyMode, pre-mount)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(HELP_SEEN_KEY)) {
      useFlyStore.getState().markControlsHelpSeen();
    }
  }, []);

  // M from the pause menu goes straight to the Atlas — same key as in
  // flight, so muscle memory doesn't dead-end on the paused screen.
  //
  // Round 16 note: L-from-pause behaves the same way but is handled in
  // FlyMode's single listener, NOT here. This effect is a CHILD effect, so it
  // registers on window BEFORE FlyMode's parent effect does — a duplicate L
  // handler here would open the logbook and then FlyMode's toggle, seeing it
  // open, would immediately close it again on the very same keypress. (M is
  // safe: the Atlas's own 'm' listener only mounts on the NEXT render.)
  useEffect(() => {
    if (phase !== 'paused') return;
    const onKey = (e) => {
      if (e.key !== 'm' && e.key !== 'M') return;
      const store = useFlyStore.getState();
      store.closeCredits();
      store.setPhase('flying');
      store.setAtlasOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  const markHelpSeen = () => {
    window.localStorage.setItem(HELP_SEEN_KEY, '1');
    useFlyStore.getState().markControlsHelpSeen();
  };

  if (phase !== 'paused' && controlsHelpSeen) return null;

  // --- First-entry help card (shown while flying, before any pause) ------
  // Thirteen control rows do not fit in 390px of landscape-phone height, and
  // this card is the first thing a new player ever sees. Cap it and let it
  // scroll rather than running "Got it" off the bottom of the screen.
  if (phase !== 'paused') {
    if (!flying) return null;
    return (
      <div className="pointer-events-auto absolute left-1/2 top-1/2 z-20 flex max-h-[calc(100svh-2rem)] w-[420px] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto overscroll-contain rounded-xl border border-zinc-700/60 bg-zinc-900/85 p-5 text-zinc-100 shadow-2xl backdrop-blur">
        <h2 className="shrink-0 text-base font-semibold">Welcome to Skyloom</h2>
        <ControlsTable touch={isTouch} />
        <button
          onClick={markHelpSeen}
          className="mt-4 w-full shrink-0 rounded-md bg-zinc-100 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white phone:min-h-11"
        >
          Got it — let&apos;s fly
        </button>
      </div>
    );
  }

  const store = useFlyStore.getState();
  // Read (never subscribe): this branch only renders while paused, so a
  // snapshot is current by construction and the passport can't re-render the
  // menu on every spot logged behind it.
  const totalSpots = usePassportStore.getState().stats.totalSpotted ?? 0;

  return (
    // Round 17: the backdrop SCROLLS. The pause card is ~640px tall with the
    // controls table; a phone in landscape has 390px of viewport, so
    // `items-center` centred it and clipped both ends — "Exit Fly Mode" was
    // literally unreachable, with no way to scroll to it. `overflow-y-auto`
    // plus `my-auto` on the card keeps the desktop centring (a card shorter
    // than the box still centres) and turns the overflow case into a scroll
    // instead of a crop. Safe-area padding keeps it clear of the notch and
    // the gesture bar; `bottom-8` is unchanged so the Esri credit stays
    // visible underneath, exactly as before.
    <div className="absolute inset-x-0 top-0 bottom-8 z-20 flex items-start justify-center overflow-y-auto overscroll-contain bg-zinc-950/55 py-[max(env(safe-area-inset-top),0.5rem)] px-[max(env(safe-area-inset-left),0px)]">
      {creditsOpen ? (
        <CreditsPanel onClose={() => store.closeCredits()} />
      ) : (
        <div className="pointer-events-auto my-auto w-72 rounded-xl border border-zinc-700/60 bg-zinc-900/90 p-4 text-zinc-100 shadow-2xl backdrop-blur">
          <h2 className="mb-3 text-center text-sm font-semibold uppercase tracking-widest text-zinc-400">
            Paused
          </h2>
          <div className="space-y-2">
            <MenuButton onClick={() => store.setPhase('flying')} primary>
              Resume
            </MenuButton>
            {mapStyle === 'satellite' && immersiveOn() && (
              <div className="space-y-1 rounded-md border border-zinc-700 p-2">
                <p className="mb-2 text-xs text-zinc-400">Explore the new atmosphere</p>
                {[
                  ['Manhattan waterfront',40.7028,-74.017,150],
                  ['Ohio countryside',40.20403,-83.0896,550],
                  ['Sierra mountain flight',36.601,-118.06,3200],
                  ['Above the clouds',40.7028,-74.017,3400],
                ].map(([label,lat,lon,altM]) => (
                  <MenuButton key={label} disabled={!store.runtimeReady} onClick={() => {
                    store.setPhase('flying');callRuntimeAction('warpToGeo',lat,lon,{altM,name:label});
                  }}>{label}</MenuButton>
                ))}
              </div>
            )}
            <MenuButton
              onClick={() => {
                store.setPhase('flying');
                store.setAtlasOpen(true);
              }}
            >
              Atlas — warp the world
            </MenuButton>
            <MenuButton
              testid="pause-logbook"
              onClick={() => {
                store.setPhase('flying');
                store.setLogbookOpen(true);
              }}
            >
              Pilot Logbook — {totalSpots.toLocaleString()} spots
            </MenuButton>
            {HANGAR.enabled && (
              <MenuButton
                testid="pause-hangar"
                onClick={() => {
                  store.setPhase('flying');
                  store.setHangarOpen(true);
                }}
              >
                Hangar — {aircraftName(aircraftId)}
              </MenuButton>
            )}
            {/* R25 A: the rows live in hud/SettingsRows.jsx (shared with the
                title's Settings sheet); pause keeps its pre-R25 order + markup. */}
            <SettingsRows />
            <MenuButton onClick={() => store.openCredits()}>Credits &amp; licenses</MenuButton>
            {exitGoesToTitle() ? (
              // R25 A: leave the flight for the title over the live world
              // (FlyMode passes exitToTitle) instead of reloading the page.
              <MenuButton testid="pause-exit-title" onClick={onExit}>Exit to title</MenuButton>
            ) : (
              <MenuButton onClick={onExit}>Exit Fly Mode</MenuButton>
            )}
          </div>
          <div className="mt-3 border-t border-zinc-800 pt-3">
            <ControlsTable compact touch={isTouch} />
          </div>
        </div>
      )}
    </div>
  );
}

function ControlsTable({ compact = false, touch = false }) {
  const rows = touch ? TOUCH_CONTROL_ROWS : CONTROL_ROWS;
  return (
    <div className={`mt-2 space-y-1 ${compact ? 'text-[10px]' : 'text-xs'}`}>
      {rows.map(([key, what]) => (
        <div key={key} className="flex gap-2">
          <span className="w-28 shrink-0 font-mono text-zinc-300">{key}</span>
          <span className="text-zinc-400">{what}</span>
        </div>
      ))}
    </div>
  );
}

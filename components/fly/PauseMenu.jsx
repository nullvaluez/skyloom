'use client';

import { useEffect, useRef } from 'react';
import { useDialogFocus } from '@/hooks/use-dialog-focus';
import { editableTarget, reservedKeyEvent } from '@/lib/fly/keyboard-target';
import { reviewSurfaceOn } from '@/lib/fly/player-surface';
import { useFlyStore } from '@/stores/fly-store';
import { usePassportStore } from '@/stores/passport-store';
import { useIsTouch } from '@/hooks/use-is-touch';
// Round 17: the hangar's ONLY entry point (no keyboard shortcut this round).
import { HANGAR } from '@/lib/fly/fly-constants';
import { aircraftName } from '@/lib/fly/player-aircraft';
import { immersiveOn } from '@/lib/fly/immersive';
import { callRuntimeAction } from '@/lib/fly/runtime-bus';
// SHIP PASS RL-4 (DEEP_LINKS): Copy link for where you are (renders nothing with the flag off).
import { CopyLink } from './hud/CopyLink';

/** The flight's current place as an ?at= link (altitude clamped to the link's window). */
function currentPlaceLink() {
  const p = callRuntimeAction('currentPlace');
  if (!p || p === false) throw new Error('no position yet');
  const altFt = Number.isFinite(p.altM) ? Math.min(45000, Math.max(500, Math.round(p.altM / 0.3048))) : undefined;
  return { kind: 'at', lat: p.lat, lon: p.lon, altFt };
}
// R25 A (FRONT DOOR): the settings rows and the credits panel are shared with
// the title's Settings sheet / Credits button; exit leads to the title.
import { MenuButton, SettingsRows } from './hud/SettingsRows';
import { CreditsPanel } from './hud/CreditsPanel';
import { exitGoesToTitle } from '@/lib/fly/front-door';
import { useAdventureStore } from '@/stores/adventure-store';
import { conditionsOn } from '@/lib/fly/player-conditions';
import { ConditionsPanel } from './hud/ConditionsPanel';
// Living World (MENU_GLASS): the glass pause card. Flag off renders the
// pre-pass card below, unchanged.
import { BookOpen, Compass, Globe2, Info, LogOut, MapPin, Plane, Play } from 'lucide-react';
import { GLASS_ON, GLASS_EXIT_MS, GlassKeys, GlassNavItem, closingProps, glassRootProps, stillMotion, usePresence } from './hud/LivingGlass';
// The glass pause card speaks the cinema title's type (cinema-menus.css, .tcn-pause).

const CONTROL_ROWS = [
  ['Mouse', 'steer when Mouse + keyboard is selected in Settings'],
  ['WASD / arrows', 'steer — takes over from the mouse'],
  ['Keyboard / trackpad', 'choose Steering input in Settings; drag the view to look around'],
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
  const observing = useFlyStore(s=>!!s.airportWatch);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const aircraftId = useFlyStore((s) => s.aircraftId);
  const adventureOverlay=useAdventureStore(s=>s.libraryOpen||!!s.summary);
  const isTouch = useIsTouch();
  const open = !observing && !adventureOverlay && phase === 'paused';
  const still = GLASS_ON && open ? stillMotion() : false;
  const presence = usePresence(GLASS_ON && open, still ? 0 : GLASS_EXIT_MS);
  const dialogRef = useRef(null);
  useDialogFocus(dialogRef, open && !creditsOpen);

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
      if (e.repeat || reservedKeyEvent(e) || editableTarget(e.target)) return;
      if (e.key !== 'm' && e.key !== 'M') return;
      const store = useFlyStore.getState();
      store.closeCredits();
      store.setPhase('flying');
      store.setAtlasOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  if (GLASS_ON) {
    if (!presence.mounted) return null;
    return (
      <GlassPause
        onExit={onExit}
        closing={presence.closing}
        still={still}
        creditsOpen={creditsOpen}
        mapStyle={mapStyle}
        aircraftId={aircraftId}
        isTouch={isTouch}
        dialogRef={dialogRef}
      />
    );
  }
  if (observing || adventureOverlay || phase !== 'paused') return null;

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
        <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Paused" className="pointer-events-auto my-auto w-72 rounded-xl border border-zinc-700/60 bg-zinc-900/90 p-4 text-zinc-100 shadow-2xl backdrop-blur">
          <h2 className="mb-3 text-center text-sm font-semibold uppercase tracking-widest text-zinc-400">
            Paused
          </h2>
          <div className="space-y-2">
            <MenuButton onClick={() => store.setPhase('flying')} primary>
              Resume
            </MenuButton>
            {conditionsOn() && <ConditionsPanel />}
            <MenuButton onClick={() => useAdventureStore.getState().setLibraryOpen(true)}>Adventures</MenuButton>
            {mapStyle === 'satellite' && immersiveOn() && reviewSurfaceOn() && (
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
            <SettingsRows includeConditions={false} />
            <CopyLink link={currentPlaceLink} testid="pause-copy-link" label="Copy link to this place" />
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

const REVIEW_WARPS = [
  ['Manhattan waterfront', 40.7028, -74.017, 150],
  ['Ohio countryside', 40.20403, -83.0896, 550],
  ['Sierra mountain flight', 36.601, -118.06, 3200],
  ['Above the clouds', 40.7028, -74.017, 3400],
];

/**
 * Living World (MENU_GLASS): the pause card as one glass instrument panel —
 * a header with the lit Resume, the destinations on the left, the settings
 * in the middle and the controls reference on the right (stacked on narrow
 * windows and phones). Every testid, label and accessible name of the
 * pre-pass card is kept; only the arrangement and the finish change.
 */
function GlassPause({ onExit, closing, still, creditsOpen, mapStyle, aircraftId, isTouch, dialogRef }) {
  const store = useFlyStore.getState();
  // Read, never subscribe (as the classic card): mounted only while paused.
  const totalSpots = usePassportStore.getState().stats.totalSpotted ?? 0;
  const spots = `${totalSpots.toLocaleString()} ${totalSpots === 1 ? 'spot' : 'spots'}`;
  const fly = (then) => () => {
    store.setPhase('flying');
    then?.();
  };
  return (
    <div className="lg lg-pause-scrim tcn-pause" {...glassRootProps(still)} {...closingProps(closing)}>
      {creditsOpen ? (
        <CreditsPanel onClose={() => store.closeCredits()} />
      ) : (
        <div ref={dialogRef} tabIndex={-1} className="lg-panel lg-pause lg-enter" role="dialog" aria-modal="true" aria-labelledby="lg-pause-title">
          <header className="lg-pause-head">
            <div>
              <h2 className="lg-title" id="lg-pause-title">
                Paused
              </h2>
              <p className="lg-sub">Live traffic keeps moving while you&apos;re paused.</p>
            </div>
            <button type="button" className="lg-btn lg-btn-lit" onClick={fly()}>
              <Play size={16} fill="currentColor" aria-hidden="true" />
              Resume
              <span className="lg-kbd lg-kbd-hint" aria-hidden="true">
                Esc
              </span>
            </button>
          </header>

          <nav className="lg-pane lg-pane-nav" aria-label="Pause menu">
            <div className="lg-nav">
              <GlassNavItem icon={Compass} label="Adventures" onClick={() => useAdventureStore.getState().setLibraryOpen(true)} />
              {mapStyle === 'satellite' && immersiveOn() && reviewSurfaceOn() && (
                <div className="lg-nav-group">
                  <p className="lg-label">Explore the new atmosphere</p>
                  {REVIEW_WARPS.map(([label, lat, lon, altM]) => (
                    <GlassNavItem
                      key={label}
                      icon={MapPin}
                      label={label}
                      disabled={!store.runtimeReady}
                      onClick={fly(() => callRuntimeAction('warpToGeo', lat, lon, { altM, name: label }))}
                    />
                  ))}
                </div>
              )}
              <GlassNavItem
                icon={Globe2}
                label="Atlas"
                note="warp the world"
                name="Atlas — warp the world"
                kbd="M"
                onClick={fly(() => store.setAtlasOpen(true))}
              />
              <GlassNavItem
                icon={BookOpen}
                testid="pause-logbook"
                label="Pilot Logbook"
                meta={spots}
                name={`Pilot Logbook — ${spots}`}
                kbd="L"
                onClick={fly(() => store.setLogbookOpen(true))}
              />
              {HANGAR.enabled && (
                <GlassNavItem
                  icon={Plane}
                  testid="pause-hangar"
                  label="Hangar"
                  meta={aircraftName(aircraftId)}
                  name={`Hangar — ${aircraftName(aircraftId)}`}
                  onClick={fly(() => store.setHangarOpen(true))}
                />
              )}
              <hr className="lg-rule" />
              <CopyLink link={currentPlaceLink} testid="pause-copy-link" label="Copy link to this place" />
              <GlassNavItem icon={Info} label="Credits & licenses" onClick={() => store.openCredits()} />
              {exitGoesToTitle() ? (
                <GlassNavItem icon={LogOut} testid="pause-exit-title" tone="caution" label="Exit to title" onClick={onExit} />
              ) : (
                <GlassNavItem icon={LogOut} tone="caution" label="Exit Fly Mode" onClick={onExit} />
              )}
            </div>
          </nav>

          <section className="lg-pane lg-pane-settings" aria-label="Settings">
            <p className="lg-label">Settings</p>
            <div className="lg-settings">
              {conditionsOn() && <ConditionsPanel />}
              <SettingsRows includeConditions={false} />
            </div>
          </section>

          <section className="lg-pane lg-pane-keys" aria-label={isTouch ? 'Touch controls' : 'Controls'}>
            <p className="lg-label">{isTouch ? 'Touch controls' : 'Controls'}</p>
            <GlassKeys rows={isTouch ? TOUCH_CONTROL_ROWS : CONTROL_ROWS} keycaps={!isTouch} />
          </section>
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

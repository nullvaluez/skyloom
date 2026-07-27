'use client';

import { useEffect, useState } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { usePassportStore } from '@/stores/passport-store';
import { useIsTouch } from '@/hooks/use-is-touch';
import { FLY_ASSETS } from '@/lib/fly/assets';
import { TERRAIN_ATTRIBUTIONS } from '@/lib/fly/tile-sources';
// Round 11: style key/list + boot-time resolution moved to lib/fly/map-style
// (FlyMode resolves the style BEFORE the canvas mounts — no more toy→sat
// hot-swap on a fresh boot). This menu only reads/writes the picked style.
import { MAP_STYLE_KEY, MAP_STYLES } from '@/lib/fly/map-style';
// Round 16: quality + sound persist the same way — but ONLY from the click
// sites below. PerformanceMonitor's automatic degrade is a live response to
// this session's frame times and must never be written to storage.
import { crashStakesOn, saveCrashMode, saveQualityTier, saveSoundOn } from '@/lib/fly/fly-settings';
// Round 17: the hangar's ONLY entry point (no keyboard shortcut this round).
// Round 18: CRASH gates whether the stakes row exists at all.
import { CRASH, HANGAR } from '@/lib/fly/fly-constants';
import { aircraftName } from '@/lib/fly/player-aircraft';

const TIERS = ['low', 'medium', 'high'];
const HELP_SEEN_KEY = 'fly-controls-seen';

const CONTROL_ROWS = [
  ['Mouse', 'steer — cursor offset from center commands the turn/pitch'],
  ['WASD / arrows', 'steer (adds to mouse)'],
  ['1 / 2 / 3', 'speed preset: slow / cruise / boost'],
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
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const creditsOpen = useFlyStore((s) => s.creditsOpen);
  const controlsHelpSeen = useFlyStore((s) => s.controlsHelpSeen);
  const soundOn = useFlyStore((s) => s.soundOn);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const aircraftId = useFlyStore((s) => s.aircraftId);
  const isTouch = useIsTouch();
  // Round 18: the stakes pick lives in a fly-settings module cache, not the
  // store (see that file for why). This menu is the only surface that shows
  // it, so mirroring it into local state is all the re-render wiring it needs.
  const [stakes, setStakes] = useState(true);
  useEffect(() => setStakes(crashStakesOn()), [phase]);

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

  const pickMapStyle = (style) => {
    window.localStorage.setItem(MAP_STYLE_KEY, style);
    useFlyStore.getState().setMapStyle(style);
  };

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
    return (
      <div className="pointer-events-auto absolute left-1/2 top-1/2 z-20 flex max-h-[calc(100svh-2rem)] w-[420px] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto overscroll-contain rounded-xl border border-zinc-700/60 bg-zinc-900/85 p-5 text-zinc-100 shadow-2xl backdrop-blur">
        <h2 className="shrink-0 text-base font-semibold">Welcome to Fly Mode</h2>
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
            <div className="rounded-md border border-zinc-700/60 p-2">
              <div className="mb-1.5 text-center text-[10px] uppercase tracking-widest text-zinc-500">
                Quality
              </div>
              <div className="grid grid-cols-3 gap-1">
                {TIERS.map((tier) => (
                  <button
                    key={tier}
                    onClick={() => {
                      store.setQualityTier(tier);
                      saveQualityTier(tier); // a CLICKED tier is a choice — persist it
                    }}
                    className={`rounded py-1 text-xs capitalize phone:min-h-11 ${
                      qualityTier === tier
                        ? 'bg-zinc-100 font-medium text-zinc-900'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-zinc-700/60 p-2">
              <div className="mb-1.5 text-center text-[10px] uppercase tracking-widest text-zinc-500">
                Map style
              </div>
              <div className="grid grid-cols-3 gap-1">
                {MAP_STYLES.map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => pickMapStyle(key)}
                    className={`rounded py-1 text-xs phone:min-h-11 ${
                      mapStyle === key
                        ? 'bg-zinc-100 font-medium text-zinc-900'
                        : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <MenuButton
              onClick={() => {
                // Keep the existing toggle as the single source of truth for
                // the flip, then persist whatever it landed on.
                store.toggleSound();
                saveSoundOn(useFlyStore.getState().soundOn);
              }}
            >
              Sound: {soundOn ? 'On' : 'Off'}
            </MenuButton>
            {/* Round 18: the stakes switch. Crashes are ON by default (the
                user's call); "Forgiving" restores the round-17 flight model
                exactly — the same read gate as CRASH.enabled, so nothing about
                a forgiving session differs from R17 by a single frame. */}
            {CRASH.enabled && (
              <MenuButton
                testid="pause-stakes"
                onClick={() => {
                  const next = !stakes;
                  saveCrashMode(next); // a CLICKED mode is a choice — persist it
                  setStakes(next);
                }}
              >
                Flight stakes: {stakes ? 'Crashes ON' : 'Forgiving'}
              </MenuButton>
            )}
            <MenuButton onClick={() => store.openCredits()}>Credits &amp; licenses</MenuButton>
            <MenuButton onClick={onExit}>Exit Fly Mode</MenuButton>
          </div>
          <div className="mt-3 border-t border-zinc-800 pt-3">
            <ControlsTable compact touch={isTouch} />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuButton({ children, onClick, primary = false, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      // `phone:min-h-11` is 44px — MOBILE_UI.minTargetPx, the size
      // verify-mobile-layout gates every visible control against. The desktop
      // `py-1.5 text-sm` row (30px) is unchanged: a mouse does not need 44px
      // and the menu would grow 40% taller for nothing.
      className={`w-full rounded-md py-1.5 text-sm phone:min-h-11 phone:py-2.5 ${
        primary
          ? 'bg-zinc-100 font-medium text-zinc-900 hover:bg-white'
          : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700'
      }`}
    >
      {children}
    </button>
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

function CreditsPanel({ onClose }) {
  return (
    // `w-[440px]` was a hard 440 with no cap: on a 390px phone the credits
    // panel overflowed the viewport by 50px and took the horizontal scrollbar
    // with it. The clamp resolves to exactly 440 at any width >= 472px, so
    // desktop is unchanged. `my-auto` matches the pause card so the scrolling
    // backdrop centres it when it fits.
    <div className="pointer-events-auto my-auto max-h-[70vh] w-[min(440px,calc(100vw-2rem))] overflow-y-auto overscroll-contain rounded-xl border border-zinc-700/60 bg-zinc-900/90 p-5 text-zinc-100 shadow-2xl backdrop-blur">
      <h2 className="text-base font-semibold">Credits &amp; licenses</h2>

      <h3 className="mt-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Assets
      </h3>
      <ul className="mt-1 space-y-2 text-xs text-zinc-300">
        {FLY_ASSETS.map((a) => (
          <li key={a.file}>
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-zinc-100 hover:underline"
            >
              {a.name}
            </a>{' '}
            — {a.author}, {a.source} · {a.license}
            {a.modifications && a.modifications !== 'none' && (
              <span className="text-zinc-500"> · modified: {a.modifications}</span>
            )}
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Map data &amp; imagery
      </h3>
      <ul className="mt-1 space-y-1 text-xs text-zinc-300">
        {TERRAIN_ATTRIBUTIONS.map((t) => (
          <li key={t.label}>
            <a href={t.href} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {t.label}
            </a>
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-xs font-semibold uppercase tracking-widest text-zinc-500">
        Live flight data
      </h3>
      <p className="mt-1 text-xs text-zinc-300">
        ADS-B data by{' '}
        <a
          href="https://adsb.lol"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline"
        >
          adsb.lol
        </a>{' '}
        — community-run, ODbL.
      </p>

      <button
        onClick={onClose}
        className="mt-4 w-full rounded-md bg-zinc-800 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700 phone:min-h-11"
      >
        Back
      </button>
    </div>
  );
}

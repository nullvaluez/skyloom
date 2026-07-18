'use client';

import { useEffect } from 'react';
import { useFlyStore } from '@/stores/fly-store';
import { useIsTouch } from '@/hooks/use-is-touch';
import { FLY_ASSETS } from '@/lib/fly/assets';
import { TERRAIN_ATTRIBUTIONS } from '@/lib/fly/tile-sources';

const TIERS = ['low', 'medium', 'high'];
const HELP_SEEN_KEY = 'fly-controls-seen';
// v2: key bumped when Toy World became the default so styles saved before
// it existed don't pin users to the old look
const MAP_STYLE_KEY = 'fly-map-style-2';
// Every style is a curved mini-globe now (FLY_GLOBE_REWORK) — the names
// describe the mood, not the tile provider. Keys stay stable for persistence.
// Round 7: 'night' retired — it was a flat dark raster with none of Neon's
// vector world; the Electric Night City pass made Neon THE night look.
const MAP_STYLES = [
  ['toy', 'Neon'],
  ['satellite', 'Day'],
];

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
  const isTouch = useIsTouch();

  // First-entry controls help + persisted map style
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.localStorage.getItem(HELP_SEEN_KEY)) {
      useFlyStore.getState().markControlsHelpSeen();
    }
    let savedStyle = window.localStorage.getItem(MAP_STYLE_KEY);
    // Round 7 migration: saved 'night' lands on Neon (the migration must run
    // BEFORE the validity check — 'night' is no longer a valid style).
    if (savedStyle === 'night') {
      savedStyle = 'toy';
      window.localStorage.setItem(MAP_STYLE_KEY, savedStyle);
    }
    if (savedStyle && MAP_STYLES.some(([k]) => k === savedStyle)) {
      useFlyStore.getState().setMapStyle(savedStyle);
    }
  }, []);

  // M from the pause menu goes straight to the Atlas — same key as in
  // flight, so muscle memory doesn't dead-end on the paused screen.
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
  if (phase !== 'paused') {
    return (
      <div className="pointer-events-auto absolute left-1/2 top-1/2 z-20 w-[420px] max-w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700/60 bg-zinc-900/85 p-5 text-zinc-100 shadow-2xl backdrop-blur">
        <h2 className="text-base font-semibold">Welcome to Fly Mode</h2>
        <ControlsTable touch={isTouch} />
        <button
          onClick={markHelpSeen}
          className="mt-4 w-full rounded-md bg-zinc-100 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white"
        >
          Got it — let&apos;s fly
        </button>
      </div>
    );
  }

  const store = useFlyStore.getState();

  return (
    <div className="absolute inset-x-0 top-0 bottom-8 z-20 flex items-center justify-center bg-zinc-950/55">
      {creditsOpen ? (
        <CreditsPanel onClose={() => store.closeCredits()} />
      ) : (
        <div className="pointer-events-auto w-72 rounded-xl border border-zinc-700/60 bg-zinc-900/90 p-4 text-zinc-100 shadow-2xl backdrop-blur">
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
            <div className="rounded-md border border-zinc-700/60 p-2">
              <div className="mb-1.5 text-center text-[10px] uppercase tracking-widest text-zinc-500">
                Quality
              </div>
              <div className="grid grid-cols-3 gap-1">
                {TIERS.map((tier) => (
                  <button
                    key={tier}
                    onClick={() => store.setQualityTier(tier)}
                    className={`rounded py-1 text-xs capitalize ${
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
                    className={`rounded py-1 text-xs ${
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
            <MenuButton onClick={() => store.toggleSound()}>
              Sound: {soundOn ? 'On' : 'Off'}
            </MenuButton>
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

function MenuButton({ children, onClick, primary = false }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md py-1.5 text-sm ${
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
    <div className="pointer-events-auto max-h-[70vh] w-[440px] overflow-y-auto rounded-xl border border-zinc-700/60 bg-zinc-900/90 p-5 text-zinc-100 shadow-2xl backdrop-blur">
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
        className="mt-4 w-full rounded-md bg-zinc-800 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
      >
        Back
      </button>
    </div>
  );
}

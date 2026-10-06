'use client';

import { useState } from 'react';
import { reviewSurfaceOn } from '@/lib/fly/player-surface';
import { useFlyStore } from '@/stores/fly-store';
import { MAP_STYLE_KEY, MAP_STYLES } from '@/lib/fly/map-style';
// Round 16: quality + sound persist — but ONLY from the click sites below. The
// automatic quality ladder is a live response to this session's frame times
// and must never be written to storage.
import { crashStakesOn, saveCrashMode, saveQualityTier, saveSoundOn } from '@/lib/fly/fly-settings';
import { CRASH } from '@/lib/fly/fly-constants';
import { immersiveOn, readReducedMotion, saveReducedMotion } from '@/lib/fly/immersive';
import { visualsAvailable, saveVisuals, setVisualsLive } from '@/lib/fly/visuals-profile';
import { GuestSaveControls } from './GuestSaveControls';

const TIERS = ['low', 'medium', 'high', 'ultra'];
const VISUALS_ROW = [
  ['enhanced', 'Enhanced'],
  ['classic', 'Classic'],
];

/**
 * R25 A (FRONT DOOR): the settings rows, extracted from PauseMenu so the
 * title's Settings sheet and the pause card are one implementation.
 *
 * `sheet` = the title's Settings sheet: plan order (Visuals, Map style,
 * Quality, Sound, Reduced motion, Flight stakes), `settings-*` testids, and
 * Reduced motion always offered (it also slows the title orbit).
 * Pause (default): the pre-R25 pause rows in their pre-R25 order and markup —
 * byte-identical DOM when no R25 visual block ships (the Visuals row renders
 * only when visualsAvailable()).
 */
export function SettingsRows({ sheet = false }) {
  const qualityTier = useFlyStore((s) => s.qualityTier);
  const qualityPreset = useFlyStore((s) => s.qualityPreset);
  const soundOn = useFlyStore((s) => s.soundOn);
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const visuals = useFlyStore((s) => s.visuals);
  const chaseFraming = useFlyStore(s => s.chaseFraming);
  const encountersEnabled = useFlyStore(s => s.encountersEnabled);
  // Round 18: the stakes pick lives in a fly-settings module cache, not the
  // store. The rows mount each time the pause card / sheet opens, so a lazy
  // read on mount is current by construction.
  const [stakes, setStakes] = useState(() => crashStakesOn());
  const [reducedMotion, setReducedMotion] = useState(() => readReducedMotion());
  const store = useFlyStore.getState();
  const tid = (id) => (sheet ? `settings-${id}` : undefined);

  const pickMapStyle = (style) => {
    try {
      window.localStorage.setItem(MAP_STYLE_KEY, style);
    } catch {
      // storage blocked — the live choice still applies for this session
    }
    useFlyStore.getState().setMapStyle(style);
  };

  // TRUE EARTH (PLAYER_SURFACE): the look switches are review/automation only.
  const lookSwitches = reviewSurfaceOn();
  const visualsRow = visualsAvailable() && lookSwitches && (
    <div key="visuals" className="rounded-md border border-zinc-700/60 p-2" data-testid={sheet ? 'settings-visuals' : undefined}>
      <div className="mb-1.5 text-center text-[10px] uppercase tracking-widest text-zinc-500">
        Visuals
      </div>
      <div className="grid grid-cols-2 gap-1">
        {VISUALS_ROW.map(([key, label]) => (
          <button
            key={key}
            data-testid={`settings-visuals-${key}`}
            aria-pressed={visuals === key}
            onClick={() => {
              setVisualsLive(key); // live: C/D materials re-key on the epoch bump
              saveVisuals(key); // a CLICKED profile is a choice — persist it
            }}
            className={`rounded py-1 text-xs phone:min-h-11 ${
              visuals === key
                ? 'bg-zinc-100 font-medium text-zinc-900'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );

  const qualityRow = (
    <div key="quality" className="rounded-md border border-zinc-700/60 p-2">
      <div className="mb-1.5 text-center text-[10px] uppercase tracking-widest text-zinc-500">
        Quality
      </div>
      <div className="grid grid-cols-4 gap-1">
        {TIERS.map((tier) => (
          <button
            key={tier}
            data-testid={tid(`quality-${tier}`)}
            onClick={() => {
              store.setQualityPreset(tier);
              saveQualityTier(tier); // a CLICKED tier is a choice — persist it
            }}
            className={`rounded py-1 text-xs capitalize phone:min-h-11 ${
              (qualityPreset === 'ultra' ? tier === 'ultra' : qualityTier === tier)
                ? 'bg-zinc-100 font-medium text-zinc-900'
                : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            {tier}
          </button>
        ))}
      </div>
      {qualityPreset === 'ultra' && <p className="mt-2 text-xs text-zinc-400">Ultra adds finer clouds for powerful desktops. Effects still adapt to keep flight smooth.</p>}
    </div>
  );

  const mapStyleRow = lookSwitches && (
    <div key="map-style" className="rounded-md border border-zinc-700/60 p-2">
      <div className="mb-1.5 text-center text-[10px] uppercase tracking-widest text-zinc-500">
        Map style
      </div>
      <div className={`grid ${sheet ? 'grid-cols-2' : 'grid-cols-3'} gap-1`}>
        {MAP_STYLES.map(([key, label]) => (
          <button
            key={key}
            data-testid={tid(`style-${key}`)}
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
  );

  const soundRow = (
    <MenuButton
      key="sound"
      testid={tid('sound')}
      onClick={() => {
        // Keep the existing toggle as the single source of truth for the
        // flip, then persist whatever it landed on.
        store.toggleSound();
        saveSoundOn(useFlyStore.getState().soundOn);
      }}
    >
      Sound: {soundOn ? 'On' : 'Off'}
    </MenuButton>
  );

  const reducedRow = (sheet || (mapStyle === 'satellite' && immersiveOn())) && (
    <MenuButton
      key="reduced-motion"
      testid={tid('reduced-motion')}
      onClick={() => {
        const next = !reducedMotion;
        saveReducedMotion(next);
        setReducedMotion(next);
      }}
    >
      Reduced motion: {reducedMotion ? 'On' : 'Off'}
    </MenuButton>
  );

  // Round 18: the stakes switch. Crashes are ON by default (the user's call);
  // "Forgiving" restores the round-17 flight model exactly — the same read
  // gate as CRASH.enabled, so nothing about a forgiving session differs from
  // R17 by a single frame.
  const stakesRow = CRASH.enabled && (
    <MenuButton
      key="stakes"
      testid={sheet ? 'settings-stakes' : 'pause-stakes'}
      onClick={() => {
        const next = !stakes;
        saveCrashMode(next); // a CLICKED mode is a choice — persist it
        setStakes(next);
      }}
    >
      Flight stakes: {stakes ? 'Crashes ON' : 'Forgiving'}
    </MenuButton>
  );

  const flightViewRows=(
      <div className="rounded-md border border-zinc-700/60 p-2">
        <div className="mb-2 text-xs text-zinc-300">Chase view</div>
        <div className="grid grid-cols-2 gap-1">
          {['world','close'].map(value=><button key={value} data-testid={`settings-chase-${value}`} aria-pressed={chaseFraming===value} className="min-h-11 rounded bg-zinc-800 text-sm aria-pressed:bg-zinc-100 aria-pressed:text-zinc-900" onClick={()=>{
            useFlyStore.setState({chaseFraming:value});try{localStorage.setItem('fly-chase-framing',value);}catch{}
          }}>{value==='world'?'World':'Close'}</button>)}
        </div>
        <button className="mt-2 min-h-11 w-full rounded bg-zinc-800 text-sm" aria-pressed={encountersEnabled} onClick={()=>{
          useFlyStore.setState({encountersEnabled:!encountersEnabled});try{localStorage.setItem('fly-encounters',encountersEnabled?'0':'1');}catch{}
        }}>Nearby invitations: {encountersEnabled?'On':'Off'}</button>
      </div>
  );

  return sheet ? (
    <>
      {visualsRow}
      {mapStyleRow}
      {qualityRow}
      {soundRow}
      {reducedRow}
      {stakesRow}
      <GuestSaveControls />
      {flightViewRows}
    </>
  ) : (
    <>
      {visualsRow}
      {qualityRow}
      {mapStyleRow}
      {soundRow}
      {reducedRow}
      {stakesRow}
      <GuestSaveControls />
      {flightViewRows}
    </>
  );
}

/** The pause/sheet menu button (moved here from PauseMenu unchanged). */
export function MenuButton({ children, onClick, primary = false, testid, disabled = false }) {
  return (
    <button
        onClick={onClick}
        disabled={disabled}
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

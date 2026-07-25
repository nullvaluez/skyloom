'use client';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useGLTF } from '@react-three/drei';
import { useFlyStore } from '@/stores/fly-store';
import { useSheetLayout } from '@/hooks/use-sheet-layout';
import { HANGAR } from '@/lib/fly/fly-constants';
import { PLAYER_AIRCRAFT, resolveAircraft, saveAircraft } from '@/lib/fly/player-aircraft';
import { CARD_THEME } from './inspect/inspect-tokens';
import { ModelTurntable } from './inspect/ModelTurntable';

/**
 * THE HANGAR (round 17 §A1) — pick your aircraft.
 *
 * Shape follows the Logbook precedent exactly: a store-gated FULL-SCREEN
 * overlay whose body only exists while open (a closed hangar costs one boolean
 * subscription), the world keeps flying behind it, and FlyScene neutralizes the
 * stick on `hangarOpen` like it does for atlas/inspect/logbook. Esc closes via
 * FlyMode's single window keydown listener — no private listener here (the
 * Atlas's 'm' handler is the standing lesson about racing window listeners).
 *
 * ZERO per-frame work: everything below derives from resolveAircraft() in a
 * useMemo. The only moving thing is the preview turntable, which is the inspect
 * card's own component on its own tiny canvas.
 *
 * NO KEYBOARD SHORTCUT this round — 1/2/3 are speed presets, F/C/T/M/L are
 * taken, and a hangar is not something you flick open mid-turn. One PauseMenu
 * button is the entry point.
 */
export function HangarPanel() {
  const open = useFlyStore((s) => s.hangarOpen);
  return open ? <HangarBody /> : null;
}

// Bar rows are (label, value, max) — max comes from HANGAR.bars so a future
// airframe that redefines the top of a scale only edits fly-constants.
function statsFor(ac) {
  const b = HANGAR.bars;
  return [
    ['top speed', ac.cfg.speeds.boost, b.maxSpeedMps, `${Math.round(ac.cfg.speeds.boost)} m/s`],
    [
      'agility',
      ac.cfg.maxPitchRateDeg,
      b.maxAgilityDeg,
      `${ac.cfg.maxPitchRateDeg}°/s pitch · ${ac.cfg.maxBankDeg}° bank`,
    ],
    ['size', ac.entry.targetLenM, b.maxLenM, `${ac.entry.targetLenM} m long`],
  ];
}

// Silhouette placeholder shown until the preview GLB parses (ModelTurntable's
// own fallback chain). Keys are lib/aircraft-silhouettes icon types.
const ICON_TYPE = {
  fighter: 'military',
  military: 'military',
  'warbird-jet': 'military',
  'warbird-prop': 'prop',
  prop: 'prop',
  glider: 'glider',
  bizjet: 'jet',
  airliner: 'airliner',
  cargo: 'cargo',
};

function HangarBody() {
  const isSheet = useSheetLayout();
  const current = useFlyStore((s) => s.aircraftId);
  const [sel, setSel] = useState(current);

  const fleet = useMemo(() => PLAYER_AIRCRAFT.map((a) => resolveAircraft(a.id)), []);
  const picked = useMemo(() => resolveAircraft(sel), [sel]);

  const close = () => useFlyStore.getState().setHangarOpen(false);
  const select = (id) => {
    setSel(id);
    // Parse the preview GLB while the player is still reading the card — the
    // same trick preloadTurntable plays on inspect hover.
    useGLTF.preload(resolveAircraft(id).entry.url);
  };
  const fly = () => {
    useFlyStore.getState().setAircraftId(sel);
    saveAircraft(sel); // a CLICKED aircraft is a choice — persist it
    close();
  };

  const tall = isSheet;
  const isCurrent = picked.id === current;

  return (
    <div
      className="absolute inset-x-0 top-0 z-20 flex items-center justify-center"
      style={{ background: CARD_THEME.scrim, bottom: isSheet ? 0 : '2rem' }}
      data-testid="hangar"
    >
      <motion.div
        initial={isSheet ? { y: 40, opacity: 0.5 } : { scale: 0.985, opacity: 0.4 }}
        animate={isSheet ? { y: 0, opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30 }}
        className={`pointer-events-auto flex flex-col border shadow-2xl backdrop-blur-md ${
          isSheet ? 'px-3 pb-2 pt-2' : 'rounded-xl p-4'
        }`}
        style={{
          background: `linear-gradient(180deg, ${CARD_THEME.bgTop}, ${CARD_THEME.bgBottom})`,
          borderColor: CARD_THEME.edge,
          width: isSheet ? '100%' : 'min(94%, 880px)',
          height: isSheet ? '100svh' : 'min(92%, 640px)',
          // Phone: the sheet owns the whole viewport — clear notch + gesture bar.
          paddingTop: isSheet ? 'max(0.5rem, env(safe-area-inset-top))' : undefined,
          paddingBottom: isSheet ? 'max(0.5rem, env(safe-area-inset-bottom))' : undefined,
        }}
      >
        {/* ---- Header ---- */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h2
            className="text-lg uppercase tracking-[0.3em] max-sm:text-sm max-sm:tracking-[0.2em]"
            style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.ice }}
          >
            Hangar
          </h2>
          <span
            className="font-mono text-[11px] uppercase tracking-[0.2em]"
            style={{ color: CARD_THEME.iceDim }}
            data-testid="hangar-current"
          >
            flying · {resolveAircraft(current).name}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <span
              className="font-mono text-[10px] max-sm:hidden"
              style={{ color: CARD_THEME.iceFaint }}
            >
              esc close
            </span>
            <button
              onClick={close}
              className="rounded-md border px-2 py-1 font-mono text-xs transition-colors hover:bg-white/10"
              style={{
                borderColor: CARD_THEME.edgeSoft,
                color: CARD_THEME.iceDim,
                minHeight: 44,
                minWidth: 44,
              }}
              aria-label="Close hangar"
              data-testid="hangar-close"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ---- Body: card list | preview ---- */}
        <div
          className={`mt-3 flex min-h-0 flex-1 gap-3 ${isSheet ? 'flex-col-reverse' : 'flex-row'}`}
        >
          {/* Card list */}
          <div
            className="min-h-0 flex-1 overflow-y-auto pr-1"
            style={{ flexBasis: isSheet ? 'auto' : '58%' }}
            data-testid="hangar-list"
          >
            {fleet.map((ac) => {
              const active = ac.id === sel;
              return (
                <button
                  key={ac.id}
                  onClick={() => select(ac.id)}
                  data-testid={`hangar-card-${ac.id}`}
                  data-active={active ? '1' : '0'}
                  data-current={ac.id === current ? '1' : '0'}
                  className="mb-2 flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors"
                  style={{
                    minHeight: 64,
                    borderColor: active ? CARD_THEME.edge : 'transparent',
                    background: active ? CARD_THEME.panelHover : CARD_THEME.panel,
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="truncate text-sm uppercase tracking-[0.18em]"
                        style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.ice }}
                      >
                        {ac.name}
                      </span>
                      {ac.id === current && (
                        <span
                          className="shrink-0 font-mono text-[9px] uppercase tracking-[0.25em]"
                          style={{ color: CARD_THEME.iceDim }}
                        >
                          current
                        </span>
                      )}
                    </div>
                    <div
                      className="mt-0.5 truncate font-mono text-[10px]"
                      style={{ color: CARD_THEME.iceFaint }}
                    >
                      {ac.blurb}
                    </div>
                    <div className="mt-1.5 flex gap-2">
                      {statsFor(ac).map(([label, v, max]) => (
                        <MiniBar key={label} frac={Math.min(1, v / max)} />
                      ))}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Preview + full stats + action */}
          <div
            className="flex min-h-0 shrink-0 flex-col gap-2"
            style={{ flexBasis: isSheet ? 'auto' : '42%' }}
            data-testid="hangar-preview"
          >
            <div
              className="relative rounded-xl"
              style={{
                background: CARD_THEME.panel,
                height: isSheet ? 150 : 250,
              }}
            >
              <ModelTurntable
                entry={picked.entry}
                meta={{ iconType: ICON_TYPE[picked.id] ?? 'airliner' }}
                heroColor={CARD_THEME.ice}
              />
            </div>
            <div className="rounded-xl px-3 py-2" style={{ background: CARD_THEME.panel }}>
              <div
                className="text-sm uppercase tracking-[0.2em]"
                style={{ fontFamily: CARD_THEME.fontDisplay, color: CARD_THEME.ice }}
                data-testid="hangar-sel-name"
              >
                {picked.name}
              </div>
              <div className="mt-2 space-y-2.5">
                {statsFor(picked).map(([label, v, max, detail]) => (
                  <div key={label}>
                    <div className="mb-1 flex items-baseline justify-between">
                      <span
                        className="font-mono text-[9px] uppercase tracking-[0.25em]"
                        style={{ color: CARD_THEME.iceDim }}
                      >
                        {label}
                      </span>
                      <span
                        className="font-mono text-[10px]"
                        style={{ color: CARD_THEME.iceDim }}
                      >
                        {detail}
                      </span>
                    </div>
                    <MiniBar frac={Math.min(1, v / max)} wide />
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={fly}
              disabled={isCurrent}
              data-testid="hangar-fly"
              className="w-full rounded-md text-sm font-medium transition-colors disabled:cursor-default"
              style={{
                minHeight: tall ? 52 : 46,
                background: isCurrent ? CARD_THEME.panel : CARD_THEME.warpBg,
                color: isCurrent ? CARD_THEME.iceFaint : CARD_THEME.warpText,
                borderBottom: isCurrent ? 'none' : `2px solid ${CARD_THEME.warpEdge}`,
              }}
            >
              {isCurrent ? 'Already flying this' : `Fly the ${picked.name}`}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function MiniBar({ frac, wide = false }) {
  return (
    <div
      className={wide ? 'h-1.5 w-full rounded-full' : 'h-1 w-10 rounded-full'}
      style={{ background: CARD_THEME.grid }}
    >
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(3, frac * 100)}%`, background: CARD_THEME.ice }}
      />
    </div>
  );
}

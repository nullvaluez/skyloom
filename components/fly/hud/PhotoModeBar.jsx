'use client';

import { useCallback, useRef, useState, useSyncExternalStore, useEffect } from 'react';
import { Camera, CloudSun, X } from 'lucide-react';
import { CARD_THEME } from './inspect/inspect-tokens';
import { callRuntimeAction } from '@/lib/fly/runtime-bus';
import { useFlyStore } from '@/stores/fly-store';
import { conditionsOn } from '@/lib/fly/player-conditions';
import { ConditionsPanel } from './ConditionsPanel';
import { photoComposition, subscribePhotoComposition, setPhotoComposition } from '@/lib/fly/photo-composition';

/**
 * Round 17 — the photo-mode chrome: a single bottom-center pill, mounted only
 * while cameraMode === 'photo'.
 *
 * It sits OUTSIDE FlyMode's HUD-hiding wrapper on purpose — the shutter and
 * the way out must survive the very state that hides everything else. The
 * AttributionBar is the other survivor (Esri's terms are non-negotiable in
 * every UI state), which is why this pill is centered and short: it must never
 * grow into the bottom-left credit.
 *
 * Styling is the INK CODEX vocabulary (CARD_THEME) so it reads as the same
 * object family as the inspect card and the logbook.
 */
export function PhotoModeBar() {
  const active = useFlyStore((s) => s.cameraMode === 'photo');
  const composition=useSyncExternalStore(subscribePhotoComposition,photoComposition,photoComposition);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [conditionsOpen, setConditionsOpen] = useState(false);
  const noteTimer = useRef(null);
  useEffect(()=>()=>clearTimeout(noteTimer.current),[]);

  const flash = useCallback((msg) => {
    setNote(msg);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(''), 2600);
  }, []);

  const shoot = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Resolved AT CALL TIME through the bus (round 8.5 lesson) — a scene
      // remount re-registers the action instead of orphaning a captured null.
      const pending = callRuntimeAction('capturePhoto');
      if (!pending) {
        flash('shutter not ready');
        return;
      }
      const { blob, filename } = await pending;
      const file =
        typeof File === 'function' ? new File([blob], filename, { type: 'image/png' }) : null;

      // Mobile: the OS share sheet is the natural "save to photos" path.
      if (file && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Skyloom' });
          flash('shared');
          return;
        } catch (err) {
          // A user-cancelled share is not a failure — and it must not then
          // silently download a file they just declined to share.
          if (err?.name === 'AbortError') return;
          // Anything else (share unsupported for this payload) → download.
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next task: revoking synchronously can beat the download.
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      flash('Download started · preview in journal');
    } catch (err) {
      flash(err?.message === 'superseded' ? '' : 'capture failed');
    } finally {
      setBusy(false);
    }
  }, [busy, flash]);

  if (!active) return null;

  const exit = () => useFlyStore.getState().setCameraMode('chase');

  return (
    <>
    {composition.grid&&<div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true" style={{backgroundImage:'linear-gradient(to right, transparent 33.2%, #ffffff55 33.3%, transparent 33.5%, transparent 66.5%, #ffffff55 66.6%, transparent 66.8%),linear-gradient(to bottom, transparent 33.2%, #ffffff55 33.3%, transparent 33.5%, transparent 66.5%, #ffffff55 66.6%, transparent 66.8%)'}}/>}
    <div className="absolute left-1/2 top-4 z-20 flex max-w-[95vw] -translate-x-1/2 items-center gap-3 rounded-xl bg-slate-950/85 px-4 py-2 text-sm text-white" data-testid="photo-composition">
      <label className="flex items-center gap-2">Exposure <input aria-label="Photo exposure" className="w-24" type="range" min="-2" max="2" step=".1" value={composition.exposure} onChange={e=>setPhotoComposition({exposure:Number(e.target.value)})}/><output>{composition.exposure.toFixed(1)}</output></label>
      <button className="min-h-11" aria-pressed={composition.grid} onClick={()=>setPhotoComposition({grid:!composition.grid})}>Grid</button>
      <button className="min-h-11" onClick={()=>setPhotoComposition({exposure:0})}>Reset</button>
    </div>
    <div
      data-testid="photo-bar"
      className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2 select-none max-sm:bottom-[calc(env(safe-area-inset-bottom)+1rem)] phone:bottom-[calc(env(safe-area-inset-bottom)+1rem)]"
    >
      {/* TRUE EARTH (CONDITIONS): time and weather for the shot, above the
          pill so the pill itself stays short of the credit bar. */}
      {conditionsOn() && conditionsOpen && (
        <div
          className="hud-flat-phone pointer-events-auto absolute bottom-full left-1/2 mb-2 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-2xl border p-1 backdrop-blur-sm"
          style={{ background: `linear-gradient(180deg, ${CARD_THEME.bgTop}, ${CARD_THEME.bgBottom})`, borderColor: CARD_THEME.edge }}
        >
          <ConditionsPanel compact />
        </div>
      )}
      <div
        className="hud-flat-phone pointer-events-auto flex items-center gap-2 rounded-2xl border px-2 py-2 backdrop-blur-sm"
        style={{
          background: `linear-gradient(180deg, ${CARD_THEME.bgTop}, ${CARD_THEME.bgBottom})`,
          borderColor: CARD_THEME.edge,
        }}
      >
        <button
          type="button"
          onClick={shoot}
          disabled={busy}
          data-testid="photo-shutter"
          aria-label="Take a photo"
          title="Take a photo"
          className="flex h-11 min-w-[6.5rem] items-center justify-center gap-2 rounded-xl px-4 font-mono text-[11px] uppercase tracking-[0.24em] transition-opacity disabled:opacity-60"
          style={{
            background: CARD_THEME.warpBg,
            borderBottom: `3px solid ${CARD_THEME.warpEdge}`,
            color: CARD_THEME.warpText,
          }}
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          {busy ? '…' : 'shoot'}
        </button>

        <span
          className="hidden px-1 font-mono text-[10px] tracking-[0.14em] sm:inline"
          style={{ color: CARD_THEME.iceDim }}
        >
          {note || 'drag orbit · wheel zoom · P exit'}
        </span>
        {/* Phones get the short form — the pill must not reach the credit. */}
        <span
          className="px-1 font-mono text-[10px] tracking-[0.14em] sm:hidden"
          style={{ color: CARD_THEME.iceDim }}
        >
          {note || 'drag to orbit'}
        </span>

        {conditionsOn() && (
          <button
            type="button"
            onClick={() => setConditionsOpen((v) => !v)}
            data-testid="photo-conditions"
            aria-label="Time and weather"
            aria-pressed={conditionsOpen}
            title="Time and weather"
            className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors"
            style={{ background: CARD_THEME.panel, color: CARD_THEME.ice }}
          >
            <CloudSun className="h-5 w-5" aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          onClick={exit}
          data-testid="photo-exit"
          aria-label="Exit photo mode"
          title="Exit photo mode (P)"
          className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors"
          style={{ background: CARD_THEME.panel, color: CARD_THEME.ice }}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
    </>
  );
}

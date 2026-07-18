'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FlyErrorBoundary } from './FlyErrorBoundary';
import { FlyCanvas } from './FlyCanvas';
import { AttributionBar } from './hud/AttributionBar';
import { FlyHUD } from './hud/FlyHUD';
import { LabelCanvas } from './hud/LabelCanvas';
import { Minimap } from './hud/Minimap';
import { InfoCard } from './hud/InfoCard';
import { InspectModal } from './hud/InspectModal';
import { SpotToast } from './hud/SpotToast';
import { Contracts } from './hud/Contracts';
import { WarpFlash } from './hud/WarpFlash';
import { Atlas } from './hud/Atlas';
import { ArrivalBanner } from './hud/ArrivalBanner';
import { TouchControls } from './hud/TouchControls';
import { PauseMenu } from './PauseMenu';
import { BootScreen } from './hud/BootScreen';
import { useFlyTraffic } from '@/hooks/use-fly-traffic';
import { useFlyAudio } from '@/hooks/use-fly-audio';
import { useIsTouch } from '@/hooks/use-is-touch';
import { BOOT } from '@/lib/fly/fly-constants';
import { resolveInitialMapStyle } from '@/lib/fly/map-style';
import { useFlyStore } from '@/stores/fly-store';

// Fallback spawn: NYC harbor — dense airspace, good demo
const DEFAULT_SPAWN = [40.6892, -74.0445];
// Last in-flight position, persisted ~10s + pagehide → next boot spawns here
const LAST_POS_KEY = 'fly-last-pos';

function readLastPos() {
  try {
    const raw = window.localStorage.getItem(LAST_POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Number.isFinite(p?.lat) && Number.isFinite(p?.lon)) return [p.lat, p.lon];
  } catch {
    // corrupt entry — fall through to the default
  }
  return null;
}

/**
 * R9-1 spawn resolution: geolocation with a quick timeout (the boot screen
 * covers the wait) → last session's persisted position → NYC. Resolves
 * [lat, lon]; never rejects. A late/denied permission prompt can't stall
 * the boot past BOOT.geoTimeoutMs.
 */
function getSpawnLatLon() {
  return new Promise((resolve) => {
    const fallback = () => resolve(readLastPos() ?? DEFAULT_SPAWN);
    if (!navigator.geolocation) {
      fallback();
      return;
    }
    const timer = setTimeout(fallback, BOOT.geoTimeoutMs);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve([pos.coords.latitude, pos.coords.longitude]);
      },
      () => {
        clearTimeout(timer);
        fallback();
      },
      { timeout: BOOT.geoTimeoutMs, maximumAge: 10 * 60 * 1000 }
    );
  });
}

/**
 * Fullscreen Fly-mode container. Round 9 (fly-only pivot): mounted directly
 * by app/page.js — the game IS the app. The FlyCanvas mounts as soon as the
 * spawn resolves, under the BootScreen overlay, which reveals once the
 * world/fleet/shaders are actually ready (window.__flyBoot contract).
 */
export function FlyMode({ onClose }) {
  const spawn = useFlyStore((s) => s.spawn);
  const isTouch = useIsTouch();

  // Shared per-frame runtime: engine/flight/input handles written by the
  // scene, read by DOM overlays at low frequency. Never React state.
  const runtimeRef = useRef({});

  // Live ADS-B traffic: poll every 2s around the player, project in the
  // worker, dead-reckon in runtime.traffic (rendered by TrafficLayer).
  useFlyTraffic(runtimeRef.current, true);

  // Procedural audio bed + one-shots (lock blip, warp sweep, UI clicks)
  useFlyAudio(runtimeRef.current);

  // Spawn where the user is: geolocation (quick timeout — the boot screen
  // covers the wait), else last session's persisted position, else NYC.
  useEffect(() => {
    let cancelled = false;
    // Round 11: resolve the map style BEFORE spawn resolves — FlyCanvas only
    // mounts once spawn is set, so the once-built TerrainEngine sees the
    // final style. Kills the round-10 boot hot-swap where an unsaved player
    // built the toy vector world and then swapped to satellite post-mount.
    resolveInitialMapStyle();
    getSpawnLatLon().then(([lat, lon]) => {
      if (cancelled) return;
      const fly = useFlyStore.getState();
      fly.setSpawn({ lat, lon });
      fly.setPhase('flying');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the live position (runtime.geo, written by the frame loop) so
  // the NEXT boot spawns where this flight left off — cadence save plus
  // pagehide (the reliable tab-close/refresh signal) plus unmount.
  useEffect(() => {
    const save = () => {
      const g = runtimeRef.current.geo; // Vector3(lon, lat, altM)
      if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) return;
      try {
        window.localStorage.setItem(
          LAST_POS_KEY,
          JSON.stringify({ lat: g.y, lon: g.x, at: Date.now() })
        );
      } catch {
        // storage full/blocked — spawn memory is a nicety, not a requirement
      }
    };
    const id = setInterval(save, BOOT.lastPosSaveMs);
    window.addEventListener('pagehide', save);
    return () => {
      clearInterval(id);
      window.removeEventListener('pagehide', save);
      save();
    };
  }, []);

  // Escape priority: inspect → atlas → credits → pause/resume.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const store = useFlyStore.getState();
      if (store.inspectHex) store.setInspectHex(null);
      else if (store.atlasOpen) store.setAtlasOpen(false);
      else if (store.creditsOpen) store.closeCredits();
      else if (store.phase === 'paused') store.setPhase('flying');
      else store.setPhase('paused');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Small non-touch window heads-up: flying wants room. Touch devices get the
  // on-screen controls instead of a "use a desktop" nudge, so skip it there.
  const [mobileNote, setMobileNote] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches;
    const hasTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    if (!(coarse && hasTouch) && window.innerWidth < 900) {
      setMobileNote(true);
      const id = setTimeout(() => setMobileNote(false), 8000);
      return () => clearTimeout(id);
    }
  }, []);

  // Leave no stale lock/telemetry behind for the next session.
  useEffect(() => {
    return () => useFlyStore.getState().reset();
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <FlyErrorBoundary onExit={onClose}>
        {spawn && <FlyCanvas runtime={runtimeRef.current} />}
      </FlyErrorBoundary>

      {/* POI names are in-world 3D letters (PoiLetters) in every style */}
      <LabelCanvas runtime={runtimeRef.current} />
      <FlyHUD runtime={runtimeRef.current} />
      <Minimap runtime={runtimeRef.current} />
      <InfoCard runtime={runtimeRef.current} />
      <InspectModal runtime={runtimeRef.current} />
      <SpotToast runtime={runtimeRef.current} />
      <Contracts runtime={runtimeRef.current} />
      <Atlas runtime={runtimeRef.current} />
      <ArrivalBanner />
      <WarpFlash runtime={runtimeRef.current} />
      {isTouch && <TouchControls runtime={runtimeRef.current} />}
      <PauseMenu onExit={onClose} />
      <AttributionBar />

      {/* Boot overlay (z-40) covers everything — including the first-entry
          controls card — until the world reveals, so the fly-controls-seen
          flow effectively starts AFTER the reveal. */}
      <BootScreen runtime={runtimeRef.current} />

      {mobileNote && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-md bg-zinc-900/85 px-3 py-2 text-xs text-zinc-200 shadow-lg">
          Fly Mode is designed for desktop — a mouse and keyboard are recommended.
        </div>
      )}

      {/* Desktop keeps the quick-exit X (top-right); touch replaces it with the
          Pause button in TouchControls, whose menu carries Exit. */}
      {!isTouch && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Exit Fly Mode"
          className="absolute right-4 top-4 z-10 bg-zinc-900/60 text-zinc-100 hover:bg-zinc-800"
        >
          <X className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}

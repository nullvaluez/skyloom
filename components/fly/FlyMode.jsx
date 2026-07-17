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
import { WarpFlash } from './hud/WarpFlash';
import { Atlas } from './hud/Atlas';
import { ArrivalBanner } from './hud/ArrivalBanner';
import { PauseMenu } from './PauseMenu';
import { useFlyTraffic } from '@/hooks/use-fly-traffic';
import { useFlyAudio } from '@/hooks/use-fly-audio';
import { useFlyStore } from '@/stores/fly-store';
import { useMapStore } from '@/stores/map-store';

// Fallback spawn: NYC harbor — dense airspace, good demo
const DEFAULT_SPAWN = [40.6892, -74.0445];

/**
 * Fullscreen Fly-mode container (same overlay pattern as ARSpotter).
 * Mounted by app/page.js when ui-store.flyModeOpen is true; the 2D map is
 * unmounted while this is up, so all GPU budget belongs to the flight.
 */
export function FlyMode({ onClose }) {
  const spawn = useFlyStore((s) => s.spawn);

  // Shared per-frame runtime: engine/flight/input handles written by the
  // scene, read by DOM overlays at low frequency. Never React state.
  const runtimeRef = useRef({});

  // Live ADS-B traffic: poll every 2s around the player, project in the
  // worker, dead-reckon in runtime.traffic (rendered by TrafficLayer).
  useFlyTraffic(runtimeRef.current, true);

  // Procedural audio bed + one-shots (lock blip, warp sweep, UI clicks)
  useFlyAudio(runtimeRef.current);

  // Spawn where the user is: geolocation if granted, else where the 2D map
  // was last looking (persisted center), else NYC.
  useEffect(() => {
    const { userLocation, center } = useMapStore.getState();
    const [lat, lon] = userLocation || center || DEFAULT_SPAWN;
    const fly = useFlyStore.getState();
    fly.setSpawn({ lat, lon });
    fly.setPhase('flying');
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

  // Mobile heads-up (non-blocking): flying wants a mouse and a big screen
  const [mobileNote, setMobileNote] = useState(false);
  useEffect(() => {
    if (window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 900) {
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
      <Atlas runtime={runtimeRef.current} />
      <ArrivalBanner />
      <WarpFlash />
      <PauseMenu onExit={onClose} />
      <AttributionBar />

      {mobileNote && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-md bg-zinc-900/85 px-3 py-2 text-xs text-zinc-200 shadow-lg">
          Fly Mode is designed for desktop — a mouse and keyboard are recommended.
        </div>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Exit Fly Mode"
        className="absolute right-4 top-4 z-10 bg-zinc-900/60 text-zinc-100 hover:bg-zinc-800"
      >
        <X className="h-5 w-5" />
      </Button>
    </div>
  );
}

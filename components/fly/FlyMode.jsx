'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FlyErrorBoundary } from './FlyErrorBoundary';
import { FlyCanvas } from './FlyCanvas';
import { LayoutRoot, Zone } from './LayoutRoot';
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
import { Logbook } from './hud/Logbook';
import { HangarPanel } from './hud/HangarPanel';
import { ArrivalBanner } from './hud/ArrivalBanner';
import { TouchControls } from './hud/TouchControls';
import { PhotoModeBar } from './hud/PhotoModeBar';
import { CrashFlash } from './CrashFlash';
import { JuiceHud } from './hud/JuiceHud';
import { PauseMenu } from './PauseMenu';
import { BootScreen } from './hud/BootScreen';
import { useFlyTraffic } from '@/hooks/use-fly-traffic';
import { useFlyWeather } from '@/hooks/use-fly-weather';
import { useFlyAudio } from '@/hooks/use-fly-audio';
import { deviceAttr, useDeviceLayout } from '@/hooks/use-device-layout';
import { useGLTF } from '@react-three/drei';
import { BOOT } from '@/lib/fly/fly-constants';
import { resolveInitialMapStyle } from '@/lib/fly/map-style';
import { resolveInitialSettings } from '@/lib/fly/fly-settings';
import { resolveAircraft, resolveInitialAircraft } from '@/lib/fly/player-aircraft';
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
 * Round 17: a layout- and stacking-transparent wrapper (display:contents)
 * that flips to display:none in photo mode. Children stay MOUNTED — their
 * refs, queues and intervals survive the trip.
 */
function HudGroup({ hidden, children }) {
  return (
    <div className={hidden ? 'hidden' : 'contents'} data-photo-hidden={hidden ? '1' : '0'}>
      {children}
    </div>
  );
}

/**
 * Fullscreen Fly-mode container. Round 9 (fly-only pivot): mounted directly
 * by app/page.js — the game IS the app. The FlyCanvas mounts as soon as the
 * spawn resolves, under the BootScreen overlay, which reveals once the
 * world/fleet/shaders are actually ready (window.__flyBoot contract).
 */
export function FlyMode({ onClose }) {
  const spawn = useFlyStore((s) => s.spawn);
  // Round 17: ONE device description for the whole HUD. `isTouch` is the same
  // boolean useIsTouch() always returned (that hook is now a wrapper over this
  // one); the extra fields are what let the overlays stop disagreeing about
  // what a phone is. Stamped onto the root below as data-device/data-orient,
  // which is what the phone:/phone-land:/phone-port: CSS variants key off.
  const device = useDeviceLayout();
  const isTouch = device.isTouch;
  // Round 17: photo mode hides the HUD (see the wrapper in the tree below).
  const photoActive = useFlyStore((s) => s.cameraMode === 'photo');

  // Shared per-frame runtime: engine/flight/input handles written by the
  // scene, read by DOM overlays at low frequency. Never React state.
  const runtimeRef = useRef({});

  // Live ADS-B traffic: poll every 2s around the player, project in the
  // worker, dead-reckon in runtime.traffic (rendered by TrafficLayer).
  useFlyTraffic(runtimeRef.current, true);

  // Real weather at the player's cell (satellite only; toy never fetches).
  // Owns runtime.weather; no data / override 'baseline' = today's exact look.
  useFlyWeather(runtimeRef.current, true);

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
    // Round 16: quality tier + sound resolve on the SAME pre-mount beat and
    // for the same reason — the scene should be built at the tier the player
    // chose rather than built at 'high' and degraded afterwards.
    resolveInitialSettings();
    // Round 17: the saved AIRCRAFT resolves on that same pre-mount beat and for
    // the same round-11 reason — FlyScene builds its FlightModel from
    // aircraftId once, so the pick must be in the store before the canvas
    // exists. Then get the chosen GLB in flight immediately: without this, a
    // saved Leviathan would mount, Suspense-fall back to the primitive plane,
    // and pop in a second later (the fighter is preloaded at import time by
    // PlayerPlane, so only NON-default picks need this).
    resolveInitialAircraft();
    const picked = resolveAircraft(useFlyStore.getState().aircraftId);
    useGLTF.preload(picked.entry.url);
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

  // Escape priority: inspect → photo → atlas → logbook → hangar → credits →
  // pause/resume. (Round 17: photo sits directly under inspect — the inspect
  // card can be opened from inside photo mode, so it must unwind first.)
  //
  // Round 16: the L (Logbook) toggle lives in THIS listener, deliberately —
  // the Atlas's private 'm' handler is a standing lesson that a second window
  // keydown listener races the first on mount order (and has to re-derive the
  // same "am I typing / is something else open" guards). One listener, one
  // priority chain.
  useEffect(() => {
    const onKey = (e) => {
      const store = useFlyStore.getState();
      if (e.key === 'Escape') {
        if (store.inspectHex) store.setInspectHex(null);
        else if (store.cameraMode === 'photo') store.setCameraMode('chase');
        else if (store.atlasOpen) store.setAtlasOpen(false);
        else if (store.logbookOpen) store.setLogbookOpen(false);
        else if (store.hangarOpen) store.setHangarOpen(false); // round 17
        else if (store.creditsOpen) store.closeCredits();
        else if (store.phase === 'paused') store.setPhase('flying');
        else store.setPhase('paused');
        return;
      }
      if (e.key !== 'l' && e.key !== 'L') return;
      // Held keys must not strobe the overlay, and the Atlas search field is a
      // real text input — L belongs to whoever is typing.
      if (e.repeat) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (store.logbookOpen) {
        store.setLogbookOpen(false);
      } else if (!store.inspectHex && !store.atlasOpen) {
        // From the pause menu L resumes first — the same shape as PauseMenu's
        // M-to-Atlas, but kept in THIS listener on purpose: PauseMenu's
        // keydown effect is a CHILD effect and therefore registers on window
        // BEFORE this one, so a duplicate handler there would open the logbook
        // and then have this toggle close it on the very same keypress.
        if (store.phase === 'paused') {
          store.closeCredits();
          store.setPhase('flying');
        }
        store.setLogbookOpen(true);
      }
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
    <div
      className="fixed inset-0 z-50 bg-black"
      // Round 17 mobile overhaul. These three attributes are the whole device
      // contract: `data-fly-root` scopes the globals.css game-surface rules
      // (no rubber-band scroll, no double-tap zoom, no grey tap flash) to this
      // subtree, and data-device/data-orient drive the phone:/phone-land:/
      // phone-port: custom variants. On desktop they resolve to
      // device="desktop" / orient="portrait|landscape" and NO variant matches,
      // so every desktop pixel is unchanged.
      data-fly-root=""
      data-device={deviceAttr(device)}
      data-orient={device.orientation}
    >
      <FlyErrorBoundary onExit={onClose}>
        {spawn && <FlyCanvas runtime={runtimeRef.current} />}
      </FlyErrorBoundary>

      {/* Named layout zones (MOBILE_UI.zones). Empty scaffolding until the
          overlays migrate in — an empty pointer-events-none absolute div has
          zero size and paints nothing, so this mount is inert on every
          device. Mounted here, early, because every zone member is z-10 and
          every overlay that must cover them is z-20+. */}
      <LayoutRoot />

      {/* Round 17 photo mode: the flying HUD is HIDDEN, never unmounted.
          `contents` makes the wrapper invisible to layout AND to stacking, so
          every child keeps positioning/painting against the fixed root exactly
          as before; `hidden` is display:none, which keeps Contracts' progress
          refs, the SpotToast queue and their intervals alive — an unmount
          would silently reset a session's contract progress every time someone
          framed a shot.
          FOUR wrappers, not one, and NOTHING is re-ordered: half of these
          overlays share a z-index (six sit at z-20, six at z-10), so among
          equals DOM order IS paint order. One wrapper would have meant moving
          InspectModal/Atlas/ArrivalBanner past each other and quietly
          re-stacking the non-photo HUD — the round's "default is
          bit-identical" rule covers pixels, not just numbers.
          AttributionBar, PauseMenu, WarpFlash, BootScreen and PhotoModeBar
          stay OUTSIDE: the Esri credit is required in EVERY UI state, and the
          shutter/exit must survive the state that hides everything else. */}
      <HudGroup hidden={photoActive}>
        {/* POI names are in-world 3D letters (PoiLetters) in every style */}
        <LabelCanvas runtime={runtimeRef.current} />
        <FlyHUD runtime={runtimeRef.current} />
        <Minimap runtime={runtimeRef.current} />
        <InfoCard runtime={runtimeRef.current} />
      </HudGroup>
      <InspectModal runtime={runtimeRef.current} />
      <HudGroup hidden={photoActive}>
        <SpotToast runtime={runtimeRef.current} />
        <Contracts runtime={runtimeRef.current} />
      </HudGroup>
      <Atlas runtime={runtimeRef.current} />
      <Logbook />
      <HangarPanel />
      <HudGroup hidden={photoActive}>
        <ArrivalBanner />
      </HudGroup>
      <WarpFlash runtime={runtimeRef.current} />
      <CrashFlash />
      <HudGroup hidden={photoActive}>
        {isTouch && <TouchControls runtime={runtimeRef.current} />}
      </HudGroup>
      <PhotoModeBar />
      {/* Round 18 (A4): combo chip + boost meter + end-of-run summary, all in
          one component so the round costs FlyMode a single line. */}
      <JuiceHud />
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
        <Zone name="exit">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Exit Fly Mode"
            className="pointer-events-auto bg-zinc-900/60 text-zinc-100 hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </Button>
        </Zone>
      )}
    </div>
  );
}

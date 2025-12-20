'use client';

import { useEffect, useCallback, useMemo, memo, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';
import { useUIStore } from '@/stores/ui-store';
import { useFilteredAircraftAsync } from '@/hooks/use-filters';
import { useAircraftByLocation } from '@/hooks/use-aircraft';
import { useAircraftWorker } from '@/hooks/use-aircraft-worker';
import { MapControls } from './MapControls';
import { isEmergency } from '@/lib/classify';
import { altitudeToMeters, getShadowRadius } from '@/lib/altitude';
import { getPitchBracket } from '@/lib/icon-bitmap-cache';

// Dark map style
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// Lazy loaded modules (client-only)
let MapGL = null;
let DeckGL = null;
let IconLayer = null;
let PathLayer = null;
let ScatterplotLayer = null;
let maplibreLoaded = false;

// SVG paths for aircraft icons
const ICON_PATHS = {
  airliner:
    'M16 2c-1.1 0-2 .9-2 2v7L3 16v3l11-3v8l-4 2.5v2.5l6-2 6 2v-2.5L18 24v-8l11 3v-3L18 11V4c0-1.1-.9-2-2-2z',
  jet:
    'M16 3c-.8 0-1.5.7-1.5 1.5V10L4 14.5v2l10.5-2V21l-3.5 2v2l5-1.5 5 1.5v-2l-3.5-2v-6.5l10.5 2v-2L17.5 10V4.5c0-.8-.7-1.5-1.5-1.5z',
  military:
    'M16 1l-2 3v6L3 15v2l11-2v7l-4 3v2l6-2 6 2v-2l-4-3v-7l11 2v-2L18 10V4l-2-3z',
  cargo:
    'M16 2c-1.1 0-2 .9-2 2v7L3 16v3l11-3v8l-4 2.5v2.5l6-2 6 2v-2.5L18 24v-8l11 3v-3L18 11V4c0-1.1-.9-2-2-2z',
  helicopter:
    'M4 7h24v2H4z M15 9h2v4h-2z M10 13h12c2 0 3 1.5 3 3v4c0 1.5-1 3-3 3H10c-2 0-3-1.5-3-3v-4c0-1.5 1-3 3-3z',
  prop:
    'M16 4c-.6 0-1 .4-1 1v6L5 14v2l10-2v7l-3 2v2l4-1 4 1v-2l-3-2v-7l10 2v-2L17 11V5c0-.6-.4-1-1-1z',
  glider:
    'M16 5c-.3 0-.5.2-.5.5v6L2 14v1.5l13.5-2v6l-3 2v1.5l3.5-1 3.5 1V20.5l-3-2v-6L30 15.5V14L16.5 11.5V5.5c0-.3-.2-.5-.5-.5z',
  drone:
    'M8 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M24 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M8 24m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M24 24m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M13 13h6v6h-6z',
  government:
    'M16 3c-.8 0-1.5.7-1.5 1.5V10L4 14.5v2l10.5-2V21l-3.5 2v2l5-1.5 5 1.5v-2l-3.5-2v-6.5l10.5 2v-2L17.5 10V4.5c0-.8-.7-1.5-1.5-1.5z',
  unknown: 'M16 8l5 10H11l5-10z',
};

// Icon cache (type -> dataURL)
const iconCache = new Map();
function getIconUrl(type) {
  const key = type || 'unknown';
  const cached = iconCache.get(key);
  if (cached) return cached;

  const path = ICON_PATHS[key] || ICON_PATHS.unknown;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64"><path d="${path}" fill="white"/></svg>`;
  const url = `data:image/svg+xml;base64,${btoa(svg)}`;

  iconCache.set(key, url);
  return url;
}

// Icon config cache (type -> object) to avoid per-aircraft allocations
const ICON_CONFIG_CACHE = new Map();
function getIconConfig(type) {
  const key = type || 'unknown';
  const cached = ICON_CONFIG_CACHE.get(key);
  if (cached) return cached;

  const cfg = {
    url: getIconUrl(key),
    width: 64,
    height: 64,
    anchorY: 32,
    mask: true, // keep dynamic tinting
  };
  ICON_CONFIG_CACHE.set(key, cfg);
  return cfg;
}

// Color converter with caching for performance
function hexToRgba(hex, alpha = 255) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [128, 128, 128, alpha];
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16), alpha];
}

const COLOR_CACHE = new Map();
function getCachedColor(hex) {
  if (!COLOR_CACHE.has(hex)) COLOR_CACHE.set(hex, hexToRgba(hex));
  return COLOR_CACHE.get(hex);
}

const COMMON_COLORS = [
  '#60a5fa',
  '#ef4444',
  '#9ca3af',
  '#4ade80',
  '#fbbf24',
  '#f87171',
  '#a78bfa',
  '#22d3ee',
  '#f472b6',
  '#fb923c',
];
COMMON_COLORS.forEach(getCachedColor);

// Fast darken without allocations
function darkenRgba([r, g, b, a], factor = 0.55, alphaOverride = null) {
  const na = alphaOverride == null ? a : alphaOverride;
  return [r * factor, g * factor, b * factor, na];
}

/**
 * Calculate pitch-responsive depth offset for 3D icon layer
 * Offset scales with camera pitch angle to create more convincing depth
 * @param {number} pitch - Camera pitch in degrees (0-85)
 * @param {number} zoom - Current zoom level
 * @returns {[number, number]} Pixel offset [x, y]
 */
function getPitchResponsiveOffset(pitch, zoom) {
  const pitchFactor = Math.sin((pitch * Math.PI) / 180);
  const zoomScale = Math.max(0.5, zoom / 12);
  return [
    2 + pitchFactor * 3 * zoomScale,  // X offset
    2 + pitchFactor * 4 * zoomScale   // Y offset (more pronounced)
  ];
}

/**
 * Calculate depth layer darkening factor based on pitch
 * Steeper angles = darker depth layer for more contrast
 * @param {number} pitch - Camera pitch in degrees
 * @returns {number} Darkening factor (0.4 to 0.55)
 */
function getDepthDarkenFactor(pitch) {
  const pitchFactor = Math.min(pitch / 85, 1);
  return 0.55 - pitchFactor * 0.15; // Range: 0.55 (flat) to 0.40 (steep)
}

/**
 * Calculate viewport bounds from map view state
 * Uses approximate degrees per pixel based on zoom level
 * @param {object} viewState - Map view state { latitude, longitude, zoom }
 * @param {number} width - Viewport width in pixels (default 1920)
 * @param {number} height - Viewport height in pixels (default 1080)
 * @returns {object|null} Bounds { north, south, east, west } or null
 */
function computeViewportBounds(viewState, width = 1920, height = 1080) {
  if (!viewState || viewState.latitude == null || viewState.longitude == null) {
    return null;
  }

  const { latitude, longitude, zoom } = viewState;
  
  // Approximate degrees per pixel at current zoom (at equator)
  // zoom 0 = 360 degrees / 256 pixels, zoom increases halve the degrees
  const degreesPerPixel = 360 / (256 * Math.pow(2, zoom));
  
  // Adjust for latitude (longitude degrees shrink toward poles)
  const latRadians = (latitude * Math.PI) / 180;
  const lonDegreesPerPixel = degreesPerPixel / Math.cos(latRadians);
  
  // Calculate bounds with some extra padding
  const latSpan = (degreesPerPixel * height) / 2;
  const lonSpan = (lonDegreesPerPixel * width) / 2;
  
  return {
    north: latitude + latSpan,
    south: latitude - latSpan,
    east: longitude + lonSpan,
    west: longitude - lonSpan,
  };
}

/**
 * Main FlightMap component
 * - 2-layer extrusion in 3D: depth layer (offset + darker + slightly larger) + top layer (pickable)
 * - 1 layer in 2D
 */
export const FlightMap = memo(function FlightMap() {
  const searchParams = useSearchParams();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    async function loadMapLibraries() {
      try {
        const [maplibreModule, deckModule, layersModule] = await Promise.all([
          import('react-map-gl/maplibre'),
          import('@deck.gl/react'),
          import('@deck.gl/layers'),
        ]);

        MapGL = maplibreModule.default;
        DeckGL = deckModule.DeckGL;
        IconLayer = layersModule.IconLayer;
        PathLayer = layersModule.PathLayer;
        ScatterplotLayer = layersModule.ScatterplotLayer;

        await import('maplibre-gl/dist/maplibre-gl.css');

        maplibreLoaded = true;
        setIsReady(true);
      } catch (error) {
        console.error('Failed to load map libraries:', error);
      }
    }

    if (!maplibreLoaded) loadMapLibraries();
    else setIsReady(true);
  }, []);

  // Store selectors
  const center = useMapStore((s) => s.center);
  const storeZoom = useMapStore((s) => s.zoom);
  const storePitch = useMapStore((s) => s.pitch);
  const storeBearing = useMapStore((s) => s.bearing);
  const setMapViewState = useMapStore((s) => s.setViewState);

  const setAircraft = useAircraftStore((s) => s.setAircraft);
  const aircraftMap = useAircraftStore((s) => s.aircraft);
  const selectedAircraftId = useAircraftStore((s) => s.selectedAircraftId);
  const selectAircraft = useAircraftStore((s) => s.selectAircraft);
  const followedAircraftId = useAircraftStore((s) => s.followedAircraftId);
  const getTrailsInBounds = useAircraftStore((s) => s.getTrailsInBounds);
  const setCurrentZoom = useAircraftStore((s) => s.setCurrentZoom);
  const setViewportBounds = useAircraftStore((s) => s.setViewportBounds);

  const openDetailPanel = useUIStore((s) => s.openDetailPanel);
  const closeDetailPanel = useUIStore((s) => s.closeDetailPanel);

  const { processAircraft, isReady: workerReady } = useAircraftWorker();

  const [viewState, setViewState] = useState({
    longitude: center[1],
    latitude: center[0],
    zoom: storeZoom,
    pitch: storePitch,
    bearing: storeBearing,
  });

  const isUserInteractingRef = useRef(false);
  const storeSyncTimeoutRef = useRef(null);
  const lastStorePitch = useRef(storePitch);
  const lastStoreBearing = useRef(storeBearing);
  const lastStoreZoom = useRef(storeZoom);
  const lastStoreCenter = useRef(center);

  const allAircraft = useMemo(() => Array.from(aircraftMap.values()), [aircraftMap]);
  const filteredAircraft = useFilteredAircraftAsync(allAircraft);

  const fetchDist = viewState.zoom <= 5 ? 500 : viewState.zoom <= 7 ? 300 : viewState.zoom <= 9 ? 150 : 100;
  const { data } = useAircraftByLocation(viewState.latitude, viewState.longitude, fetchDist);

  useEffect(() => {
    if (!data?.ac) return;

    if (workerReady) {
      processAircraft(data.ac).then((processed) => setAircraft(processed));
    } else {
      setAircraft(data.ac);
    }
  }, [data, setAircraft, workerReady, processAircraft]);

  useEffect(() => {
    if (isUserInteractingRef.current) return;

    const pitchChanged = lastStorePitch.current !== storePitch;
    const bearingChanged = lastStoreBearing.current !== storeBearing;
    const zoomChanged = lastStoreZoom.current !== storeZoom;
    const centerChanged =
      lastStoreCenter.current[0] !== center[0] || lastStoreCenter.current[1] !== center[1];

    lastStorePitch.current = storePitch;
    lastStoreBearing.current = storeBearing;
    lastStoreZoom.current = storeZoom;
    lastStoreCenter.current = center;

    if (pitchChanged || bearingChanged || zoomChanged || (!followedAircraftId && centerChanged)) {
      setViewState((prev) => ({
        ...prev,
        pitch: storePitch,
        bearing: storeBearing,
        zoom: storeZoom,
        ...(followedAircraftId ? {} : { longitude: center[1], latitude: center[0] }),
      }));
    }
  }, [storePitch, storeBearing, storeZoom, center, followedAircraftId]);

  useEffect(() => {
    if (!followedAircraftId) return;

    const aircraft = aircraftMap.get(followedAircraftId);
    if (!aircraft?.lat || !aircraft?.lon) return;

    setViewState((prev) => ({
      ...prev,
      longitude: aircraft.lon,
      latitude: aircraft.lat,
      bearing: prev.pitch > 0 && aircraft.track != null ? aircraft.track : prev.bearing,
    }));
  }, [followedAircraftId, aircraftMap]);

  useEffect(() => {
    return () => {
      if (storeSyncTimeoutRef.current) clearTimeout(storeSyncTimeoutRef.current);
    };
  }, []);

  // Sync zoom level and viewport bounds to aircraft store for trail tracking decisions
  useEffect(() => {
    setCurrentZoom(viewState.zoom);
    
    // Compute and set viewport bounds for trail culling
    const bounds = computeViewportBounds(viewState);
    if (bounds) {
      setViewportBounds(bounds);
    }
  }, [viewState.zoom, viewState.latitude, viewState.longitude, setCurrentZoom, setViewportBounds]);

  useEffect(() => {
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const zoom = searchParams.get('z');
    const hex = searchParams.get('hex');

    if (lat && lon) {
      setViewState((prev) => ({
        ...prev,
        latitude: parseFloat(lat),
        longitude: parseFloat(lon),
        zoom: zoom ? parseInt(zoom) : prev.zoom,
      }));
    }

    if (hex) {
      setTimeout(() => {
        selectAircraft(hex);
        openDetailPanel();
      }, 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleViewStateChange = useCallback(
    ({ viewState: newViewState }) => {
      isUserInteractingRef.current = true;
      setViewState(newViewState);

      if (storeSyncTimeoutRef.current) clearTimeout(storeSyncTimeoutRef.current);

      storeSyncTimeoutRef.current = setTimeout(() => {
        isUserInteractingRef.current = false;
        lastStorePitch.current = newViewState.pitch;
        lastStoreBearing.current = newViewState.bearing;
        lastStoreZoom.current = newViewState.zoom;
        lastStoreCenter.current = [newViewState.latitude, newViewState.longitude];
        setMapViewState(newViewState);
      }, 200);
    },
    [setMapViewState]
  );

  const handleAircraftClick = useCallback(
    (info) => {
      if (info.object) {
        selectAircraft(info.object.hex);
        openDetailPanel();
      }
    },
    [selectAircraft, openDetailPanel]
  );

  const handleAircraftClickRef = useRef(handleAircraftClick);
  handleAircraftClickRef.current = handleAircraftClick;

  const handleMapClick = useCallback(
    (info) => {
      if (!info.object && selectedAircraftId) {
        selectAircraft(null);
        closeDetailPanel();
      }
    },
    [selectedAircraftId, selectAircraft, closeDetailPanel]
  );

  // Compute viewport bounds for trail filtering
  const viewportBounds = useMemo(
    () => computeViewportBounds(viewState),
    [viewState.latitude, viewState.longitude, viewState.zoom]
  );

  // Get only visible trails for rendering (performance optimization)
  const allTrailsData = useMemo(
    () => getTrailsInBounds(viewportBounds),
    [getTrailsInBounds, viewportBounds]
  );

  const baseSize = viewState.zoom < 7 ? 24 : viewState.zoom <= 10 ? 32 : 40;
  const is3DMode = viewState.pitch > 0;

  const airborneAircraft = useMemo(
    () => filteredAircraft.filter((ac) => typeof ac.alt_baro === 'number' && ac.alt_baro > 500),
    [filteredAircraft]
  );

  // 3D depth tuning: pitch-responsive offset creates more convincing depth at steep angles
  const depthPixelOffset = useMemo(
    () => (is3DMode ? getPitchResponsiveOffset(viewState.pitch, viewState.zoom) : [0, 0]),
    [is3DMode, viewState.pitch, viewState.zoom]
  );

  // Depth layer scale and darkening respond to pitch for enhanced 3D effect
  const depthScale = 1.08; // "thickness" size bump
  const depthDarkenFactor = useMemo(() => getDepthDarkenFactor(viewState.pitch), [viewState.pitch]);

  // Get current pitch bracket for icon foreshortening (memoized to avoid recalc)
  const pitchBracket = useMemo(() => getPitchBracket(viewState.pitch), [viewState.pitch]);

  const layers = useMemo(() => {
    if (!IconLayer || !PathLayer) return [];
    const result = [];

    // Render trails for all tracked aircraft (when zoomed in)
    const use3DTrail = is3DMode && viewState.zoom >= 10;
    const maxAge = 300000; // 5 minutes

    // Batch all trail segments for a single PathLayer (performance optimization)
    // Previously: N PathLayers per trail for gradient effect
    // Now: 1 PathLayer for all 3D segments, 1 PathLayer for all 2D trails
    const trail3DSegments = [];
    const trail2DData = [];

    allTrailsData.forEach(({ hex, trail, color, isSelected }) => {
      if (trail.length < 2) return;

      // Parse color for this trail
      const trailColor = getCachedColor(color);

      if (use3DTrail) {
        // 3D trail with altitude - create segments for gradient effect
        const path3D = trail.map((p) => [
          p.lon,
          p.lat,
          altitudeToMeters(p.alt || 0, viewState.pitch),
        ]);

        // Add segments with metadata for gradient rendering
        for (let i = 0; i < path3D.length - 1; i++) {
          const progress = i / Math.max(1, path3D.length - 1);
          const avgAlt = ((trail[i].alt || 0) + (trail[i + 1].alt || 0)) / 2;

          trail3DSegments.push({
            path: [path3D[i], path3D[i + 1]],
            progress,
            avgAlt,
            isSelected,
            trailColor,
          });
        }
      } else {
        // 2D trail - batch all trails together
        const path2D = trail.map((p) => [p.lon, p.lat]);
        trail2DData.push({
          path: path2D,
          isSelected,
          trailColor,
        });
      }
    });

    // Create single PathLayer for all 3D trail segments
    if (trail3DSegments.length > 0) {
      result.push(
        new PathLayer({
          id: 'trails-3d-batched',
          data: trail3DSegments,
          getPath: (d) => d.path,
          // Width varies with altitude; selected trails are slightly thicker
          getWidth: (d) => (d.isSelected ? 2.5 : 1.5) + (d.avgAlt / 40000) * 1.5,
          // Color gradient using aircraft's color
          getColor: (d) => {
            const baseOpacity = d.isSelected ? 180 : 120;
            const opacity = (0.3 + d.progress * 0.7) * baseOpacity / 180 * 255;
            return [...d.trailColor.slice(0, 3), Math.round(opacity)];
          },
          widthUnits: 'pixels',
          widthMinPixels: 1,
          widthMaxPixels: 6,
          jointRounded: true,
          capRounded: true,
          billboard: false,
          pickable: false,
        })
      );
    }

    // Create single PathLayer for all 2D trails
    if (trail2DData.length > 0) {
      result.push(
        new PathLayer({
          id: 'trails-2d-batched',
          data: trail2DData,
          getPath: (d) => d.path,
          getWidth: (d) => (d.isSelected ? 3 : 2),
          getColor: (d) => [...d.trailColor.slice(0, 3), d.isSelected ? 180 : 120],
          widthUnits: 'pixels',
          jointRounded: true,
          capRounded: true,
          pickable: false,
        })
      );
    }

    if (is3DMode && ScatterplotLayer && airborneAircraft.length > 0) {
      result.push(
        new ScatterplotLayer({
          id: 'shadow-layer',
          data: airborneAircraft,
          getPosition: (d) => [d.lon, d.lat, 0],
          getRadius: (d) => getShadowRadius(d.alt_baro),
          getFillColor: [0, 0, 0, 60],
          radiusUnits: 'meters',
          pickable: false,
        })
      );
    }

    if (filteredAircraft.length > 0) {
      // Depth/rim layer (non-pickable), only in 3D
      if (is3DMode) {
        result.push(
          new IconLayer({
            id: 'aircraft-depth-layer',
            data: filteredAircraft,
            pickable: false,

            getPosition: (d) => [d.lon, d.lat, altitudeToMeters(d.alt_baro, viewState.pitch)],
            getIcon: (d) => getIconConfig(d._iconType || 'unknown'),

            // Slightly bigger + offset in screen space creates a consistent “thickness”
            getSize: (d) => (d.hex === selectedAircraftId ? baseSize * 1.4 * depthScale : baseSize * depthScale),
            getAngle: (d) => -(d.track || 0),

            // Darkened tint reads as the side wall/rim
            // Darkening intensifies with pitch for better depth perception
            getColor: (d) => {
              const base =
                d.hex === selectedAircraftId
                  ? getCachedColor('#60a5fa')
                  : isEmergency(d)
                    ? getCachedColor('#ef4444')
                    : getCachedColor(d._color || '#9ca3af');

              // Use pitch-responsive darkening for enhanced 3D effect
              return darkenRgba(base, depthDarkenFactor, 200);
            },

            getPixelOffset: () => depthPixelOffset,

            sizeUnits: 'pixels',
            sizeMinPixels: 16,
            sizeMaxPixels: 56,
            billboard: false,

            updateTriggers: {
              getSize: [selectedAircraftId, baseSize, is3DMode],
              getColor: [selectedAircraftId, depthDarkenFactor],
              getPixelOffset: [is3DMode, viewState.pitch, viewState.zoom],
              getPosition: [is3DMode, viewState.pitch],
              getIcon: [pitchBracket.name], // Update icons when pitch bracket changes
            },
          })
        );
      }

      // Top face layer (pickable)
      result.push(
        new IconLayer({
          id: 'aircraft-layer',
          data: filteredAircraft,
          pickable: true,

          getPosition: (d) =>
            is3DMode ? [d.lon, d.lat, altitudeToMeters(d.alt_baro, viewState.pitch)] : [d.lon, d.lat, 0],

          getIcon: (d) => getIconConfig(d._iconType || 'unknown'),
          getSize: (d) => (d.hex === selectedAircraftId ? baseSize * 1.4 : baseSize),
          getAngle: (d) => -(d.track || 0),

          getColor: (d) => {
            if (d.hex === selectedAircraftId) return getCachedColor('#60a5fa');
            if (isEmergency(d)) return getCachedColor('#ef4444');
            return getCachedColor(d._color || '#9ca3af');
          },

          getPixelOffset: () => [0, 0],

          sizeUnits: 'pixels',
          sizeMinPixels: 16,
          sizeMaxPixels: 56,
          billboard: false,

          onClick: (info) => handleAircraftClickRef.current(info),

          updateTriggers: {
            getSize: [selectedAircraftId, baseSize],
            getColor: [selectedAircraftId],
            getPosition: [is3DMode, viewState.pitch],
            getIcon: [pitchBracket.name], // Update icons when pitch bracket changes for foreshortening
          },
        })
      );
    }

    return result;
  }, [
    filteredAircraft,
    airborneAircraft,
    selectedAircraftId,
    baseSize,
    allTrailsData,
    is3DMode,
    viewState.pitch,
    viewState.zoom,
    depthPixelOffset,
    depthDarkenFactor,
    pitchBracket,
  ]);

  // Enhanced controller configuration for better 3D rotation control
  // Must be before conditional return to maintain hooks order
  const controllerConfig = useMemo(
    () => ({
      // Basic controls
      keyboard: true,
      doubleClickZoom: true,
      
      // Pan controls
      dragPan: true, // Left-click + drag to pan
      
      // Rotation controls (right-click drag for bearing + pitch)
      // deck.gl MapController: right-click drag = bearing, Ctrl+drag = pitch
      dragRotate: true,
      
      // Smooth motion with inertia
      inertia: 300,
      
      // Touch controls
      touchZoom: true,
      touchRotate: true, // Two-finger rotate
      
      // Scroll zoom (disable if handling wheel ourselves)
      scrollZoom: true,
      
      // Pitch constraints
      minPitch: 0,
      maxPitch: 85,
    }),
    []
  );

  // Intercept wheel events for Shift+scroll pitch control
  // Must be before conditional return to maintain hooks order
  const handleContainerWheel = useCallback(
    (event) => {
      if (event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.deltaY > 0 ? -5 : 5;
        setViewState((prev) => {
          const newPitch = Math.max(0, Math.min(85, prev.pitch + delta));
          return { ...prev, pitch: newPitch };
        });
      }
    },
    []
  );

  if (!isReady || !DeckGL || !MapGL) {
    return (
      <div className="h-full w-full relative flex items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-sm text-zinc-500">Initializing map...</p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className="h-full w-full relative"
      onWheel={handleContainerWheel}
    >
      <DeckGL
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        controller={controllerConfig}
        layers={layers}
        onClick={handleMapClick}
        getCursor={({ isDragging, isHovering }) =>
          isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'
        }
        pickingRadius={10}
      >
        <MapGL mapStyle={MAP_STYLE} attributionControl={false} reuseMaps />
      </DeckGL>
      <MapControls />
    </div>
  );
});

export default FlightMap;

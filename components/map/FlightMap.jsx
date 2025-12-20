'use client';

import { useEffect, useCallback, useMemo, memo, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';
import { useUIStore } from '@/stores/ui-store';
import { useFilteredAircraft } from '@/hooks/use-filters';
import { useAircraftByLocation } from '@/hooks/use-aircraft';
import { MapControls } from './MapControls';
import { isEmergency } from '@/lib/classify';
import { altitudeToMeters, getShadowRadius } from '@/lib/altitude';

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
  airliner: 'M16 2c-1.1 0-2 .9-2 2v7L3 16v3l11-3v8l-4 2.5v2.5l6-2 6 2v-2.5L18 24v-8l11 3v-3L18 11V4c0-1.1-.9-2-2-2z',
  jet: 'M16 3c-.8 0-1.5.7-1.5 1.5V10L4 14.5v2l10.5-2V21l-3.5 2v2l5-1.5 5 1.5v-2l-3.5-2v-6.5l10.5 2v-2L17.5 10V4.5c0-.8-.7-1.5-1.5-1.5z',
  military: 'M16 1l-2 3v6L3 15v2l11-2v7l-4 3v2l6-2 6 2v-2l-4-3v-7l11 2v-2L18 10V4l-2-3z',
  cargo: 'M16 2c-1.1 0-2 .9-2 2v7L3 16v3l11-3v8l-4 2.5v2.5l6-2 6 2v-2.5L18 24v-8l11 3v-3L18 11V4c0-1.1-.9-2-2-2z',
  helicopter: 'M4 7h24v2H4z M15 9h2v4h-2z M10 13h12c2 0 3 1.5 3 3v4c0 1.5-1 3-3 3H10c-2 0-3-1.5-3-3v-4c0-1.5 1-3 3-3z',
  prop: 'M16 4c-.6 0-1 .4-1 1v6L5 14v2l10-2v7l-3 2v2l4-1 4 1v-2l-3-2v-7l10 2v-2L17 11V5c0-.6-.4-1-1-1z',
  glider: 'M16 5c-.3 0-.5.2-.5.5v6L2 14v1.5l13.5-2v6l-3 2v1.5l3.5-1 3.5 1V20.5l-3-2v-6L30 15.5V14L16.5 11.5V5.5c0-.3-.2-.5-.5-.5z',
  drone: 'M8 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M24 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M8 24m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M24 24m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M13 13h6v6h-6z',
  government: 'M16 3c-.8 0-1.5.7-1.5 1.5V10L4 14.5v2l10.5-2V21l-3.5 2v2l5-1.5 5 1.5v-2l-3.5-2v-6.5l10.5 2v-2L17.5 10V4.5c0-.8-.7-1.5-1.5-1.5z',
  unknown: 'M16 8l5 10H11l5-10z',
};

// Icon cache
const iconCache = new Map();
function getIconUrl(type) {
  if (iconCache.has(type)) return iconCache.get(type);
  const path = ICON_PATHS[type] || ICON_PATHS.unknown;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="64" height="64"><path d="${path}" fill="white"/></svg>`;
  const url = `data:image/svg+xml;base64,${btoa(svg)}`;
  iconCache.set(type, url);
  return url;
}

// Color converter
function hexToRgba(hex, alpha = 255) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [128, 128, 128, alpha];
  return [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16), alpha];
}

/**
 * Main FlightMap component - simplified for performance
 */
export const FlightMap = memo(function FlightMap() {
  const searchParams = useSearchParams();
  const [isReady, setIsReady] = useState(false);

  // Load WebGL libraries on client side
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
        
        // Import CSS
        await import('maplibre-gl/dist/maplibre-gl.css');
        
        maplibreLoaded = true;
        setIsReady(true);
      } catch (error) {
        console.error('Failed to load map libraries:', error);
      }
    }
    
    if (!maplibreLoaded) {
      loadMapLibraries();
    } else {
      setIsReady(true);
    }
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
  const getSelectedTrail = useAircraftStore((s) => s.getSelectedTrail);
  
  const openDetailPanel = useUIStore((s) => s.openDetailPanel);
  const closeDetailPanel = useUIStore((s) => s.closeDetailPanel);

  // View state - single source of truth
  const [viewState, setViewState] = useState({
    longitude: center[1],
    latitude: center[0],
    zoom: storeZoom,
    pitch: storePitch,
    bearing: storeBearing,
  });

  // Refs for tracking updates and preventing loops
  const isUserInteractingRef = useRef(false);
  const storeSyncTimeoutRef = useRef(null);
  const lastStorePitch = useRef(storePitch);
  const lastStoreBearing = useRef(storeBearing);
  const lastStoreZoom = useRef(storeZoom);
  const lastStoreCenter = useRef(center);

  // Aircraft array from map
  const allAircraft = useMemo(() => Array.from(aircraftMap.values()), [aircraftMap]);
  const filteredAircraft = useFilteredAircraft(allAircraft);

  // Calculate fetch distance based on zoom
  const fetchDist = viewState.zoom <= 5 ? 500 : viewState.zoom <= 7 ? 300 : viewState.zoom <= 9 ? 150 : 100;

  // Fetch aircraft data
  const { data } = useAircraftByLocation(viewState.latitude, viewState.longitude, fetchDist);

  // Update aircraft store when data arrives
  useEffect(() => {
    if (data?.ac) {
      setAircraft(data.ac);
    }
  }, [data, setAircraft]);

  // Sync pitch/bearing/zoom from store (for controls like 3D toggle)
  // Don't sync center when following - the follow effect handles that
  useEffect(() => {
    if (isUserInteractingRef.current) return;
    
    const pitchChanged = lastStorePitch.current !== storePitch;
    const bearingChanged = lastStoreBearing.current !== storeBearing;
    const zoomChanged = lastStoreZoom.current !== storeZoom;
    const centerChanged = lastStoreCenter.current[0] !== center[0] || lastStoreCenter.current[1] !== center[1];
    
    // Update refs
    lastStorePitch.current = storePitch;
    lastStoreBearing.current = storeBearing;
    lastStoreZoom.current = storeZoom;
    lastStoreCenter.current = center;
    
    // Only update if something actually changed
    if (pitchChanged || bearingChanged || zoomChanged || (!followedAircraftId && centerChanged)) {
      setViewState(prev => ({
        ...prev,
        pitch: storePitch,
        bearing: storeBearing,
        zoom: storeZoom,
        // Only update center if NOT following
        ...(followedAircraftId ? {} : { longitude: center[1], latitude: center[0] }),
      }));
    }
  }, [storePitch, storeBearing, storeZoom, center, followedAircraftId]);

  // Follow aircraft position updates
  useEffect(() => {
    if (!followedAircraftId) return;
    
    const aircraft = aircraftMap.get(followedAircraftId);
    if (!aircraft?.lat || !aircraft?.lon) return;
    
    setViewState(prev => ({
      ...prev,
      longitude: aircraft.lon,
      latitude: aircraft.lat,
      // Rotate bearing with aircraft heading in 3D mode
      bearing: prev.pitch > 0 && aircraft.track != null ? aircraft.track : prev.bearing,
    }));
  }, [followedAircraftId, aircraftMap]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (storeSyncTimeoutRef.current) {
        clearTimeout(storeSyncTimeoutRef.current);
      }
    };
  }, []);

  // Handle URL params on mount
  useEffect(() => {
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const zoom = searchParams.get('z');
    const hex = searchParams.get('hex');

    if (lat && lon) {
      setViewState(prev => ({
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
  }, []);

  // Handle view state changes from map interaction
  const handleViewStateChange = useCallback(({ viewState: newViewState }) => {
    isUserInteractingRef.current = true;
    setViewState(newViewState);
    
    // Debounced sync to store - clear any pending timeout first
    if (storeSyncTimeoutRef.current) {
      clearTimeout(storeSyncTimeoutRef.current);
    }
    storeSyncTimeoutRef.current = setTimeout(() => {
      isUserInteractingRef.current = false;
      // Update refs before syncing to store to prevent re-triggering
      lastStorePitch.current = newViewState.pitch;
      lastStoreBearing.current = newViewState.bearing;
      lastStoreZoom.current = newViewState.zoom;
      lastStoreCenter.current = [newViewState.latitude, newViewState.longitude];
      setMapViewState(newViewState);
    }, 200);
  }, [setMapViewState]);

  // Handle aircraft click
  const handleAircraftClick = useCallback((info) => {
    if (info.object) {
      selectAircraft(info.object.hex);
      openDetailPanel();
    }
  }, [selectAircraft, openDetailPanel]);

  // Handle map click (deselect)
  const handleMapClick = useCallback((info) => {
    if (!info.object && selectedAircraftId) {
      selectAircraft(null);
      closeDetailPanel();
    }
  }, [selectedAircraftId, selectAircraft, closeDetailPanel]);

  // Trail data
  const trailData = getSelectedTrail();

  // Base size for icons
  const baseSize = viewState.zoom < 7 ? 24 : viewState.zoom <= 10 ? 32 : 40;

  // Check if we're in 3D mode (pitch > 0)
  const is3DMode = viewState.pitch > 0;

  // Create layers
  const layers = useMemo(() => {
    if (!IconLayer || !PathLayer) return [];
    
    const result = [];

    // Trail layer
    if (trailData && trailData.length >= 2 && selectedAircraftId) {
      const path = trailData.map(p => [p.lon, p.lat]);
      result.push(new PathLayer({
        id: 'trail-layer',
        data: [{ path }],
        getPath: d => d.path,
        getWidth: 3,
        getColor: [59, 130, 246, 180],
        widthUnits: 'pixels',
        jointRounded: true,
        capRounded: true,
      }));
    }

    // Shadow layer - only visible in 3D mode
    // Renders dark circles on the ground beneath aircraft for depth perception
    if (is3DMode && ScatterplotLayer && filteredAircraft.length > 0) {
      const airborneAircraft = filteredAircraft.filter(ac => {
        const alt = ac.alt_baro;
        return typeof alt === 'number' && alt > 500;
      });
      if (airborneAircraft.length > 0) {
        result.push(new ScatterplotLayer({
          id: 'shadow-layer',
          data: airborneAircraft,
          getPosition: d => [d.lon, d.lat, 0], // Always on ground
          getRadius: d => getShadowRadius(d.alt_baro),
          getFillColor: [0, 0, 0, 60], // Semi-transparent black
          radiusUnits: 'meters',
          pickable: false, // Don't intercept clicks
        }));
      }
    }

    // Aircraft layer
    if (filteredAircraft.length > 0) {
      result.push(new IconLayer({
        id: 'aircraft-layer',
        data: filteredAircraft,
        pickable: true,
        // 3D positioning: use altitude when in 3D mode
        getPosition: d => {
          if (!is3DMode) return [d.lon, d.lat, 0];
          // Use altitudeToMeters for consistent scaling (20x exaggeration)
          const z = altitudeToMeters(d.alt_baro, viewState.pitch);
          return [d.lon, d.lat, z];
        },
        getIcon: d => ({
          url: getIconUrl(d._iconType || 'unknown'),
          width: 64,
          height: 64,
          anchorY: 32,
          mask: true,
        }),
        getSize: d => d.hex === selectedAircraftId ? baseSize * 1.4 : baseSize,
        getAngle: d => -(d.track || 0),
        getColor: d => {
          if (d.hex === selectedAircraftId) return hexToRgba('#60a5fa');
          if (isEmergency(d)) return hexToRgba('#ef4444');
          return hexToRgba(d._color || '#9ca3af');
        },
        sizeUnits: 'pixels',
        sizeMinPixels: 16,
        sizeMaxPixels: 56,
        billboard: false,
        onClick: handleAircraftClick,
        updateTriggers: {
          getSize: [selectedAircraftId, baseSize],
          getColor: [selectedAircraftId],
          getPosition: [is3DMode, viewState.pitch], // Re-compute positions when 3D mode changes
        },
      }));
    }

    return result;
  }, [filteredAircraft, selectedAircraftId, baseSize, trailData, handleAircraftClick, isReady, is3DMode, viewState.pitch]);

  // Show loading while libraries load
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
    <div className="h-full w-full relative">
      <DeckGL
        viewState={viewState}
        onViewStateChange={handleViewStateChange}
        controller={{ touchRotate: true, keyboard: true, doubleClickZoom: true }}
        layers={layers}
        onClick={handleMapClick}
        getCursor={({ isDragging, isHovering }) => isDragging ? 'grabbing' : isHovering ? 'pointer' : 'grab'}
        pickingRadius={10}
      >
        <MapGL mapStyle={MAP_STYLE} attributionControl={false} reuseMaps />
      </DeckGL>
      <MapControls />
    </div>
  );
});

export default FlightMap;

'use client';

import { useEffect, useCallback, useMemo, memo } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useSearchParams } from 'next/navigation';
import { useAircraftStore } from '@/stores/aircraft-store';
import { useMapStore } from '@/stores/map-store';
import { useUIStore } from '@/stores/ui-store';
import { useFilteredAircraft } from '@/hooks/use-filters';
import { useAircraftByLocation } from '@/hooks/use-aircraft';
import { useDebouncedCallback } from '@/hooks/use-debounce';
import { AircraftMarker } from './AircraftMarker';
import { FlightTrail } from './FlightTrail';
import { MapControls } from './MapControls';
import { CanvasAircraftLayer } from './CanvasAircraftLayer';
import { MAP_CONFIG, CLUSTER_CONFIG } from '@/lib/constants';
import { preWarmCache } from '@/lib/icon-bitmap-cache';


// Fix Leaflet default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  iconUrl: '/leaflet/marker-icon.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

/**
 * Map event handler component
 */
function MapEventHandler() {
  const setView = useMapStore((s) => s.setView);
  const setBounds = useMapStore((s) => s.setBounds);
  const setMapRef = useMapStore((s) => s.setMapRef);
  const selectAircraft = useAircraftStore((s) => s.selectAircraft);
  const selectedAircraftId = useAircraftStore((s) => s.selectedAircraftId);
  const closeDetailPanel = useUIStore((s) => s.closeDetailPanel);
  const openDetailPanel = useUIStore((s) => s.openDetailPanel);
  const map = useMap();
  const searchParams = useSearchParams();

  // Restore state from URL on mount
  useEffect(() => {
    const lat = searchParams.get('lat');
    const lon = searchParams.get('lon');
    const zoom = searchParams.get('z');
    const hex = searchParams.get('hex');

    if (lat && lon) {
      map.setView([parseFloat(lat), parseFloat(lon)], zoom ? parseInt(zoom) : map.getZoom());
    }

    if (hex) {
      // Small delay to let data load or just set selected ID
      setTimeout(() => {
        selectAircraft(hex);
        openDetailPanel();
      }, 500);
    }
  }, []); // Run once on mount

  // Set map ref on mount
  useEffect(() => {
    setMapRef(map);
    return () => setMapRef(null);
  }, [map, setMapRef]);

  // Debounced bounds update
  const debouncedSetBounds = useDebouncedCallback((bounds) => {
    setBounds(bounds);
  }, 300);

  useMapEvents({
    moveend: () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      setView([center.lat, center.lng], zoom);
      debouncedSetBounds(map.getBounds());
    },
    zoomend: () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      setView([center.lat, center.lng], zoom);
      debouncedSetBounds(map.getBounds());
    },
    load: () => {
      setBounds(map.getBounds());
    },
    // Deselect aircraft when clicking on empty map space
    click: (e) => {
      // Only deselect if we're not clicking on an aircraft marker
      // The marker click handler will stop propagation
      if (selectedAircraftId) {
        selectAircraft(null);
        closeDetailPanel();
      }
    },
  });

  return null;
}

/**
 * Follow aircraft handler
 */
function FollowHandler() {
  const map = useMap();
  const followedAircraftId = useAircraftStore((s) => s.followedAircraftId);
  const aircraftMap = useAircraftStore((s) => s.aircraft);
  
  const followedAircraft = useMemo(() => {
    if (!followedAircraftId) return null;
    return aircraftMap.get(followedAircraftId) || null;
  }, [followedAircraftId, aircraftMap]);

  useEffect(() => {
    if (followedAircraft && followedAircraft.lat && followedAircraft.lon) {
      map.panTo([followedAircraft.lat, followedAircraft.lon], {
        animate: true,
        duration: 0.5,
      });
    }
  }, [followedAircraft, map]);

  return null;
}

/**
 * Aircraft layer with data fetching
 */
function AircraftLayer() {
  const center = useMapStore((s) => s.center);
  const zoom = useMapStore((s) => s.zoom);
  const setAircraft = useAircraftStore((s) => s.setAircraft);
  // Select the Map directly (stable reference) and convert to array in useMemo
  const aircraftMap = useAircraftStore((s) => s.aircraft);

  const allAircraft = useMemo(() => {
    return Array.from(aircraftMap.values());
  }, [aircraftMap]);

  // Calculate distance based on zoom level
  const dist = useMemo(() => {
    if (zoom <= 5) return 500;
    if (zoom <= 7) return 300;
    if (zoom <= 9) return 150;
    return 100;
  }, [zoom]);

  // Fetch aircraft data
  const { data } = useAircraftByLocation(center[0], center[1], dist);

  // Update store when data changes
  useEffect(() => {
    if (data?.ac) {
      setAircraft(data.ac);
    }
  }, [data, setAircraft]);

  const filteredAircraft = useFilteredAircraft(allAircraft);

  // Create custom cluster icon
  const createClusterCustomIcon = useCallback((cluster) => {
    const count = cluster.getChildCount();
    let size = 'small';
    let diameter = 40;

    if (count >= 100) {
      size = 'large';
      diameter = 50;
    } else if (count >= 10) {
      size = 'medium';
      diameter = 45;
    }

    return L.divIcon({
      html: `<div><span>${count}</span></div>`,
      className: `marker-cluster marker-cluster-${size}`,
      iconSize: L.point(diameter, diameter, true),
    });
  }, []);

  const showClusters = zoom < CLUSTER_CONFIG.disableClusteringAtZoom;

  if (!showClusters) {
    return <CanvasAircraftLayer aircraft={filteredAircraft} />;
  }

  return (
    <MarkerClusterGroup
      chunkedLoading={CLUSTER_CONFIG.chunkedLoading}
      maxClusterRadius={CLUSTER_CONFIG.maxClusterRadius}
      disableClusteringAtZoom={CLUSTER_CONFIG.disableClusteringAtZoom}
      animate={CLUSTER_CONFIG.animate}
      showCoverageOnHover={CLUSTER_CONFIG.showCoverageOnHover}
      spiderfyOnMaxZoom={CLUSTER_CONFIG.spiderfyOnMaxZoom}
      removeOutsideVisibleBounds={CLUSTER_CONFIG.removeOutsideVisibleBounds}
      iconCreateFunction={createClusterCustomIcon}
    >
      {filteredAircraft.map((aircraft) => (
        <AircraftMarker key={aircraft.hex} aircraft={aircraft} />
      ))}
    </MarkerClusterGroup>
  );
}

/**
 * Cache pre-warming component
 */
function CachePreWarmer() {
  useEffect(() => {
    // Pre-warm icon cache on mount using idle time
    const timer = setTimeout(() => {
      preWarmCache();
    }, 2000); // Wait 2 seconds after initial load
    
    return () => clearTimeout(timer);
  }, []);
  
  return null;
}

/**
 * Main FlightMap component
 */
export const FlightMap = memo(function FlightMap() {
  const { center, zoom } = useMapStore();

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      minZoom={MAP_CONFIG.minZoom}
      maxZoom={MAP_CONFIG.maxZoom}
      className="h-full w-full"
      zoomControl={false}
      attributionControl={true}
    >
      <TileLayer
        url={MAP_CONFIG.tileUrl}
        attribution={MAP_CONFIG.attribution}
        subdomains="abcd"
        maxZoom={MAP_CONFIG.maxZoom}
      />

      <MapEventHandler />
      <FollowHandler />
      <AircraftLayer />
      <FlightTrail />
      <MapControls />
      <CachePreWarmer />
    </MapContainer>
  );
});

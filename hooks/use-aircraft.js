'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchAircraftByLocation,
  fetchAircraftByHex,
  fetchMilitaryAircraft,
  fetchAircraftPhoto,
  fetchAircraftInBounds,
} from '@/lib/api';
import { UPDATE_INTERVALS } from '@/lib/constants';
import { useDevStore } from '@/stores/dev-store';
import { useEffect, useMemo } from 'react';
import { useMapStore } from '@/stores/map-store';
import { useAircraftStore } from '@/stores/aircraft-store';
import { getPollingInterval } from '@/lib/utils';

/**
 * Hook to fetch aircraft by location
 * Coordinates are rounded to reduce query key changes during panning
 */
export function useAircraftByLocation(lat, lon, dist = 250, options = {}) {
  const setMetric = useDevStore(s => s.setMetric);
  const zoom = useMapStore(s => s.zoom);
  const aircraftCount = useAircraftStore(s => s.getAircraftCount());
  const followedAircraftId = useAircraftStore(s => s.followedAircraftId);

  const refetchInterval = useMemo(() => {
    return getPollingInterval(zoom, aircraftCount, !!followedAircraftId);
  }, [zoom, aircraftCount, followedAircraftId]);

  // Round coordinates to 2 decimal places (~1km precision at equator)
  // This prevents excessive API calls during smooth panning
  // Query will reuse cached data until user moves > ~1km
  const roundedLat = useMemo(() => Math.round(lat * 100) / 100, [lat]);
  const roundedLon = useMemo(() => Math.round(lon * 100) / 100, [lon]);

  const query = useQuery({
    // Use rounded coordinates in query key to reduce refetches
    queryKey: ['aircraft', 'location', roundedLat, roundedLon, dist],
    queryFn: async () => {
      const start = performance.now();
      // Fetch using actual coordinates for accuracy
      const result = await fetchAircraftByLocation(lat, lon, dist);
      const end = performance.now();
      setMetric('pollLatencyMs', end - start);
      setMetric('lastPollMs', Date.now());
      return result;
    },
    refetchInterval,
    staleTime: 2000,
    gcTime: 30000,
    enabled: lat !== undefined && lon !== undefined,
    ...options,
  });

  return query;
}

/**
 * Hook to fetch aircraft in map bounds
 */
export function useAircraftInBounds(bounds, options = {}) {
  return useQuery({
    queryKey: ['aircraft', 'bounds', bounds?.toBBoxString?.()],
    queryFn: () => fetchAircraftInBounds(bounds),
    refetchInterval: UPDATE_INTERVALS.aircraft,
    staleTime: 2000,
    gcTime: 30000,
    enabled: !!bounds,
    ...options,
  });
}

/**
 * Hook to fetch specific aircraft by hex
 */
export function useAircraftByHex(hex, options = {}) {
  return useQuery({
    queryKey: ['aircraft', 'hex', hex],
    queryFn: () => fetchAircraftByHex(hex),
    refetchInterval: UPDATE_INTERVALS.selectedAircraft,
    staleTime: 1000,
    gcTime: 60000,
    enabled: !!hex,
    ...options,
  });
}

/**
 * Hook to fetch military aircraft
 */
export function useMilitaryAircraft(options = {}) {
  return useQuery({
    queryKey: ['aircraft', 'military'],
    queryFn: fetchMilitaryAircraft,
    refetchInterval: UPDATE_INTERVALS.aircraft,
    staleTime: 2000,
    gcTime: 30000,
    ...options,
  });
}

/**
 * Hook to fetch aircraft photo
 */
export function useAircraftPhoto(hex, options = {}) {
  return useQuery({
    queryKey: ['photo', hex],
    queryFn: () => fetchAircraftPhoto(hex),
    staleTime: Infinity, // Photos don't change
    gcTime: 1000 * 60 * 60, // Cache for 1 hour
    enabled: !!hex,
    ...options,
  });
}

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

  // Round to 0.05° (~5km) — matches proxy/client cache grid
  const roundedLat = useMemo(() => Math.round(lat * 20) / 20, [lat]);
  const roundedLon = useMemo(() => Math.round(lon * 20) / 20, [lon]);

  const query = useQuery({
    // Use rounded coordinates in query key to reduce refetches
    queryKey: ['aircraft', 'location', roundedLat, roundedLon, dist],
    queryFn: async () => {
      const start = performance.now();
      // Same rounding as the query key — avoids unique URLs on every pan tick
      const result = await fetchAircraftByLocation(roundedLat, roundedLon, dist);
      const end = performance.now();
      setMetric('pollLatencyMs', end - start);
      setMetric('lastPollMs', Date.now());
      return result;
    },
    refetchInterval: (q) => {
      // Back off when rate-limited or proxy reports soft upstream failure
      if (q.state.error?.status === 429) return Math.max(refetchInterval, 30_000);
      if (q.state.data?.error === 'rate_limited') return Math.max(refetchInterval, 15_000);
      if (q.state.data?.error === 'unavailable' || q.state.data?.error === 'all upstream sources unavailable') {
        return Math.max(refetchInterval, 8_000);
      }
      return refetchInterval;
    },
    // Keep last successful aircraft on screen when a poll fails (429/5xx)
    placeholderData: (previousData) => previousData,
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

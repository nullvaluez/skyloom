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

/**
 * Hook to fetch aircraft by location
 */
export function useAircraftByLocation(lat, lon, dist = 250, options = {}) {
  return useQuery({
    queryKey: ['aircraft', 'location', lat, lon, dist],
    queryFn: () => fetchAircraftByLocation(lat, lon, dist),
    refetchInterval: UPDATE_INTERVALS.aircraft,
    staleTime: 2000,
    gcTime: 30000,
    enabled: lat !== undefined && lon !== undefined,
    ...options,
  });
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

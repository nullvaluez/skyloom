'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchAircraftPhoto } from '@/lib/api';

/**
 * Hook to fetch aircraft photo
 * Extracted from the retired use-aircraft.js in Round 9 (fly-only pivot) —
 * the inspect card and info card are its only consumers.
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

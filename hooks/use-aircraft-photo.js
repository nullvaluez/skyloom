'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchAircraftPhoto } from '@/lib/api';

/**
 * Hook to fetch aircraft photo
 * Extracted from the retired use-aircraft.js in Round 9 (fly-only pivot) —
 * the inspect card and info card are its only consumers.
 *
 * Round 15: `staleTime: Infinity` is right for a HIT (photos don't change)
 * but brutal for a transient failure — one flaky fetch used to mean "no
 * photo" for the rest of the session. fetchAircraftPhoto now throws on
 * transport errors, so `retry` gives the lookup a real second chance; a
 * resolved `null` (genuinely unphotographed tail) still sticks.
 */
export function useAircraftPhoto(hex, options = {}) {
  return useQuery({
    queryKey: ['photo', hex],
    queryFn: () => fetchAircraftPhoto(hex),
    staleTime: Infinity, // Photos don't change
    gcTime: 1000 * 60 * 60, // Cache for 1 hour
    enabled: !!hex,
    retry: 2,
    retryDelay: (attempt) => 600 * 2 ** attempt,
    refetchOnWindowFocus: false,
    ...options,
  });
}

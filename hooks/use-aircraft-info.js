'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchAircraftInfo } from '@/lib/api';

/**
 * Round 15 "Ground Truth" — aircraft REGISTRY record for the inspect card.
 *
 * Mirrors use-aircraft-photo: registry data is near-static, so `staleTime:
 * Infinity` (one lookup per hex per session) with a long gcTime; the server
 * proxy (`/api/aircraft/[hex]/info`, adsbdb → hexdb, keyless) holds a 24h
 * memo of its own, so re-inspecting the same plane after a reload is free.
 *
 * Resolves to `{ found: false }` — NOT an error — for tails with no public
 * registry entry (military, blocked, PIA). Callers render an honest empty
 * state instead of inventing an owner.
 *
 * @param {string} hex - ICAO 24-bit address
 */
export function useAircraftInfo(hex, options = {}) {
  return useQuery({
    queryKey: ['aircraft-info', hex],
    queryFn: () => fetchAircraftInfo(hex),
    staleTime: Infinity, // registry records change on the order of months
    gcTime: 1000 * 60 * 60 * 6,
    enabled: !!hex,
    retry: 1,
    refetchOnWindowFocus: false,
    ...options,
  });
}

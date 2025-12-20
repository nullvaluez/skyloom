'use client';

import { useState, useEffect, useSyncExternalStore, useCallback } from 'react';

/**
 * Get a snapshot of the current media query match state
 */
function getSnapshot(query) {
  return window.matchMedia(query).matches;
}

/**
 * Server snapshot - always returns the default value
 */
function getServerSnapshot(defaultValue) {
  return defaultValue;
}

/**
 * Subscribe to media query changes
 */
function subscribe(query, callback) {
  const media = window.matchMedia(query);
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

/**
 * Hook to match media queries with SSR-safe handling
 * Uses useSyncExternalStore for proper SSR/hydration handling
 * @param {string} query - Media query string
 * @param {boolean} defaultValue - Default value during SSR (defaults to false)
 * @returns {boolean} - Whether the query matches
 */
export function useMediaQuery(query, defaultValue = false) {
  const subscribeToQuery = useCallback(
    (callback) => subscribe(query, callback),
    [query]
  );
  
  const getSnapshotForQuery = useCallback(
    () => getSnapshot(query),
    [query]
  );
  
  const getServerSnapshotForQuery = useCallback(
    () => getServerSnapshot(defaultValue),
    [defaultValue]
  );

  return useSyncExternalStore(
    subscribeToQuery,
    getSnapshotForQuery,
    getServerSnapshotForQuery
  );
}

/**
 * Hook to check if screen is mobile
 * Returns false during SSR to prevent hydration mismatch
 */
export function useIsMobile() {
  return useMediaQuery('(max-width: 767px)', false);
}

/**
 * Hook to check if screen is tablet
 */
export function useIsTablet() {
  return useMediaQuery('(min-width: 768px) and (max-width: 1023px)', false);
}

/**
 * Hook to check if screen is desktop
 * Returns true during SSR (desktop-first approach)
 */
export function useIsDesktop() {
  return useMediaQuery('(min-width: 1024px)', true);
}

/**
 * Hook to check if user prefers reduced motion
 */
export function usePrefersReducedMotion() {
  return useMediaQuery('(prefers-reduced-motion: reduce)', false);
}

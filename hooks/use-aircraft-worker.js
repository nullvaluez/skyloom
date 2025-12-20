'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { wrap } from 'comlink';

/**
 * Hook to use the aircraft processor web worker
 * Moves heavy computation off the main thread
 */
export function useAircraftWorker() {
  const workerRef = useRef(null);
  const apiRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState(null);

  // Initialize worker on mount
  useEffect(() => {
    let mounted = true;

    async function initWorker() {
      try {
        // Create worker - using dynamic import for Next.js compatibility
        const worker = new Worker(
          new URL('../lib/workers/aircraft-processor.worker.js', import.meta.url),
          { type: 'module' }
        );

        workerRef.current = worker;
        apiRef.current = wrap(worker);

        if (mounted) {
          setIsReady(true);
        }
      } catch (err) {
        console.error('Failed to initialize aircraft worker:', err);
        if (mounted) {
          setError(err);
        }
      }
    }

    initWorker();

    return () => {
      mounted = false;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
        apiRef.current = null;
      }
    };
  }, []);

  /**
   * Process aircraft data (classification, icon type, color)
   */
  const processAircraft = useCallback(async (rawAircraft) => {
    if (!apiRef.current) {
      console.warn('Worker not ready, processing on main thread');
      return rawAircraft;
    }

    try {
      return await apiRef.current.processAircraft(rawAircraft);
    } catch (err) {
      console.error('Worker processAircraft error:', err);
      return rawAircraft;
    }
  }, []);

  /**
   * Filter aircraft based on filters
   */
  const filterAircraft = useCallback(async (aircraft, filters) => {
    if (!apiRef.current) {
      return aircraft;
    }

    try {
      return await apiRef.current.filterAircraft(aircraft, filters);
    } catch (err) {
      console.error('Worker filterAircraft error:', err);
      return aircraft;
    }
  }, []);

  /**
   * Update spatial index
   */
  const updateSpatialIndex = useCallback(async (aircraft) => {
    if (!apiRef.current) return 0;

    try {
      return await apiRef.current.updateSpatialIndex(aircraft);
    } catch (err) {
      console.error('Worker updateSpatialIndex error:', err);
      return 0;
    }
  }, []);

  /**
   * Query aircraft within bounds
   */
  const queryBounds = useCallback(async (bounds) => {
    if (!apiRef.current) return [];

    try {
      return await apiRef.current.queryBounds(bounds);
    } catch (err) {
      console.error('Worker queryBounds error:', err);
      return [];
    }
  }, []);

  /**
   * Combined process and filter operation
   */
  const processAndFilter = useCallback(async (rawAircraft, filters) => {
    if (!apiRef.current) {
      return {
        processed: rawAircraft,
        filtered: rawAircraft,
        indexedCount: 0,
        totalCount: rawAircraft.length,
        filteredCount: rawAircraft.length,
      };
    }

    try {
      return await apiRef.current.processAndFilter(rawAircraft, filters);
    } catch (err) {
      console.error('Worker processAndFilter error:', err);
      return {
        processed: rawAircraft,
        filtered: rawAircraft,
        indexedCount: 0,
        totalCount: rawAircraft.length,
        filteredCount: rawAircraft.length,
      };
    }
  }, []);

  return {
    isReady,
    error,
    processAircraft,
    filterAircraft,
    updateSpatialIndex,
    queryBounds,
    processAndFilter,
  };
}

export default useAircraftWorker;

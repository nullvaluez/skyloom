'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { wrap } from 'comlink';
import { fetchAircraftByLocation } from '@/lib/api';
import { TRAFFIC } from '@/lib/fly/fly-constants';
import { mercatorWorldXZ } from '@/lib/fly/traffic-engine';
import { useFlyStore } from '@/stores/fly-store';

/**
 * Fly-mode traffic polling: its own worker instance (classify + project off
 * the main thread) and its own React Query — deliberately NOT
 * useAircraftByLocation, which couples to map-store zoom and rounds keys
 * differently. Query key = player position rounded to queryKeyRoundDeg so
 * flying inside a ~5km cell reuses the cache; the fetch itself uses the
 * freshest full-precision runtime.geo. Results flow into runtime.traffic
 * (TrafficEngine) — never through React state.
 */
export function useFlyTraffic(runtime, enabled) {
  const spawn = useFlyStore((s) => s.spawn);
  const workerApi = useRef(null);
  const lastServerNow = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const worker = new Worker(
      new URL('../lib/workers/aircraft-processor.worker.js', import.meta.url),
      { type: 'module' }
    );
    workerApi.current = wrap(worker);
    return () => {
      workerApi.current = null;
      worker.terminate();
    };
  }, [enabled]);

  // Fix the worker's projection origin to the spawn point (per session) and
  // mirror it into the traffic engine as soon as the scene publishes it.
  useEffect(() => {
    if (!enabled || !spawn || !workerApi.current) return undefined;
    workerApi.current.setFlyAnchor(spawn.lon, spawn.lat);
    const { x, z } = mercatorWorldXZ(spawn.lon, spawn.lat);
    let cancelled = false;
    const tryWire = () => {
      if (cancelled) return;
      if (runtime.traffic) runtime.traffic.setOrigin(x, z);
      else setTimeout(tryWire, 200); // scene mounts a beat after the DOM shell
    };
    tryWire();
    return () => {
      cancelled = true;
    };
  }, [enabled, spawn, runtime]);

  // Query key: player position rounded to a coarse grid, refreshed at 1Hz
  // from the frame loop's runtime.geo.
  const [keyPos, setKeyPos] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const round = (v) => Math.round(v / TRAFFIC.queryKeyRoundDeg) * TRAFFIC.queryKeyRoundDeg;
    const id = setInterval(() => {
      const geo = runtime.geo; // Vector3(lon, lat, altM)
      if (!geo) return;
      const lat = round(geo.y);
      const lon = round(geo.x);
      setKeyPos((prev) => (prev && prev.lat === lat && prev.lon === lon ? prev : { lat, lon }));
    }, 1000);
    return () => clearInterval(id);
  }, [enabled, runtime]);

  const query = useQuery({
    queryKey: ['fly-traffic', keyPos?.lat, keyPos?.lon],
    enabled: enabled && !!keyPos,
    queryFn: () => {
      const geo = runtime.geo;
      return fetchAircraftByLocation(geo?.y ?? keyPos.lat, geo?.x ?? keyPos.lon, TRAFFIC.pollDistNm);
    },
    refetchInterval: (q) => {
      // Don't hammer the proxy while upstreams are cooling — dead reckoning
      // covers the gap. stale payloads are fine to keep ingesting.
      if (q.state.error) return Math.max(TRAFFIC.pollIntervalMs, 10_000);
      const err = q.state.data?.error;
      if (err === 'rate_limited') return Math.max(TRAFFIC.pollIntervalMs, 12_000);
      if (err && err !== 'serving_stale') return Math.max(TRAFFIC.pollIntervalMs, 6_000);
      return TRAFFIC.pollIntervalMs;
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
    placeholderData: (previousData) => previousData,
  });

  // Ingest: worker-project then hand the transferable batch to the engine.
  const { data } = query;
  useEffect(() => {
    if (!enabled || !data || !workerApi.current) return;
    // Soft-fail / empty payloads mean "no new data", never "all aircraft left".
    // Stale (serving_stale) still has ac[] — ingest if `now` advanced.
    if (!Array.isArray(data.ac) || (data.error && data.error !== 'serving_stale' && data.ac.length === 0)) {
      return;
    }
    // Identical payloads share `now` — skip before paying the worker trip.
    if (typeof data.now !== 'number' || data.now === lastServerNow.current) return;
    lastServerNow.current = data.now;

    let stale = false;
    workerApi.current
      .processForFly(data.ac, data.now)
      .then((batch) => {
        if (stale || !runtime.traffic) return;
        runtime.traffic.ingest(batch, performance.now() / 1000);
        useFlyStore.getState().setTrafficStats(runtime.traffic.size, Date.now());
      })
      .catch((err) => console.error('[fly-traffic] worker error:', err));
    return () => {
      stale = true;
    };
  }, [enabled, data, runtime]);

  return query;
}

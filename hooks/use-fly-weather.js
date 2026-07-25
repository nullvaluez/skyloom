'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WEATHER } from '@/lib/fly/fly-constants';
import {
  computeTargets,
  createWeatherState,
  proceduralWeather,
} from '@/lib/fly/weather-model';
import { useFlyStore } from '@/stores/fly-store';

// Round 16 "Living World" — real weather at the player's position.
//
// The runtime plumbing lives in module-scope helpers below (not inline in the
// effects) so the mutation of the shared `runtime` object reads as what it is:
// publishing to an external system, exactly like TrafficEngine ingest.

const dev = process.env.NODE_ENV === 'development';

/** The dev telemetry object, created ONCE and mutated in place afterwards, so
 *  FlyScene's per-frame block can patch `fogDensity` onto it without racing
 *  this hook's 1Hz publisher. */
function devStats() {
  if (!dev || typeof window === 'undefined' || !window.__flyStats) return null;
  return window.__flyStats.weather ?? (window.__flyStats.weather = {});
}

/** Create runtime.weather if it isn't there yet (idempotent). */
function attachWeather(runtime) {
  if (!runtime || runtime.weather) return;
  runtime.weather = {
    data: null,
    state: 'baseline',
    targets: computeTargets(null, WEATHER, {}),
    wx: createWeatherState(WEATHER),
    epoch: 0,
  };
}

/** Toy / disabled: no weather object at all, so every consumer degrades. */
function detachWeather(runtime) {
  if (runtime?.weather) runtime.weather = null;
}

/** Recompute the targets in place from the last payload + the override. */
function refreshWeatherTargets(runtime) {
  const w = runtime?.weather;
  if (!w) return;
  let payload = w.data && w.data.found ? w.data : null;
  // Designed-but-OFF fallback (WEATHER.fallback ships 'baseline'): invent
  // plausible weather when both upstreams miss. An explicit override still
  // wins inside computeTargets — harness determinism is not negotiable.
  if (!payload && WEATHER.fallback === 'procedural' && runtime.geo) {
    payload = proceduralWeather(runtime.geo.y, runtime.geo.x, Date.now(), WEATHER);
  }
  computeTargets(payload, WEATHER, w.targets);
  w.state = w.targets.state;

  const s = devStats();
  if (s) {
    const wx = w.wx;
    s.state = wx.state;
    s.presenceFrac = wx.presenceFrac;
    s.overcastT = wx.overcastT;
    s.fogT = wx.fogT;
    s.windMps = [wx.windX, wx.windZ];
    s.precip = wx.precip;
    s.precipT = wx.precipT;
    s.source = wx.source;
    s.epoch = w.epoch;
  }
}

/** Store a fresh payload (the frame loop reads it through the targets). */
function publishPayload(runtime, data) {
  const w = runtime?.weather;
  if (!w) return;
  w.data = data;
  w.epoch += 1;
}

/** Toy / disabled telemetry: state 'off', everything neutral. */
function publishOffStats() {
  const s = devStats();
  if (!s) return;
  s.state = 'off';
  s.presenceFrac = 1;
  s.overcastT = 0;
  s.fogT = 0;
  s.windMps = [0, 0];
  s.precip = 'none';
  s.precipT = 0;
  s.fogDensity = null;
}

/**
 * Real weather at the player's position.
 *
 * A use-fly-traffic mirror: its own React Query keyed on the player's position
 * snapped to the WEATHER.cellDeg grid, resolving into `runtime.weather` — the
 * payload NEVER becomes React state (a 60fps consumer must not re-render the
 * scene because the cloud cover changed).
 *
 *   runtime.weather = {
 *     data,     // last /api/weather payload (or null)
 *     state,    // coarse deck state ('baseline' when there is no weather)
 *     targets,  // where the weather wants to be — refreshed at ~1Hz, reused
 *     wx,       // where it IS — damped per frame by FlyScene's -50 block
 *     epoch,    // bumps on every new payload (consumer refresh signal)
 *   }
 *
 * SATELLITE ONLY. Toy/Neon never creates the object and never issues a single
 * request: it is a stylized night world with a certified look, and this round
 * must leave it byte-unchanged.
 *
 * Baseline = exactly neutral. Until a payload lands (and forever, if both
 * upstreams miss or `window.__flyWeatherOverride = 'baseline'`), `wx` holds
 * the identity multipliers and the +X 5 m/s drift the deck has always had, so
 * every existing harness sees precisely the R15 world.
 *
 * MOUNTING: one line beside `useFlyTraffic(runtimeRef.current, true)` in
 * FlyMode.jsx — `useFlyWeather(runtimeRef.current, true)`. Until that lands,
 * `runtime.weather` is simply never created and everything downstream takes
 * its exactly-neutral no-weather branch.
 */
export function useFlyWeather(runtime, enabled = true) {
  const mapStyle = useFlyStore((s) => s.mapStyle);
  const on = !!(WEATHER.enabled && enabled && mapStyle === 'satellite' && runtime);

  // --- runtime.weather ownership (idempotent — StrictMode-safe) ------------
  // No cleanup function: a double-invoked effect must not destroy a live
  // object the frame loop is already reading. Style-off clears it instead, so
  // toy takes the no-weather branch everywhere.
  useEffect(() => {
    if (on) attachWeather(runtime);
    else detachWeather(runtime);
  }, [on, runtime]);

  // --- targets (~1Hz, allocation-free) ------------------------------------
  // Recomputed on a discrete cadence rather than per frame: it is the only
  // place `window.__flyWeatherOverride` is read, so a harness that sets the
  // override mid-session sees it applied within one tick — and the per-frame
  // stepper stays a pure damping loop with zero allocation.
  const refreshTargets = useCallback(() => {
    refreshWeatherTargets(runtime);
  }, [runtime]);

  useEffect(() => {
    if (!on) {
      publishOffStats();
      return undefined;
    }
    refreshTargets();
    const id = setInterval(refreshTargets, WEATHER.smooth.targetMs);
    return () => clearInterval(id);
  }, [on, refreshTargets]);

  // --- query key: the player's 0.25° weather cell (15s cadence) ------------
  // While no cell is known yet the sampler runs fast (runtime.geo only appears
  // once the frame loop is alive — a 15s first poll would leave the player
  // under a baseline sky for a quarter minute after boot); once armed it drops
  // to the slow cadence. Style-off just stops sampling: the stale key is
  // harmless because the query itself is disabled.
  const [cell, setCell] = useState(null);
  const armed = !!cell;
  useEffect(() => {
    if (!on) return undefined;
    const snap = (v) => Math.round(v / WEATHER.cellDeg) * WEATHER.cellDeg;
    const sample = () => {
      const geo = runtime.geo; // Vector3(lon, lat, altM)
      if (!geo) return;
      const lat = snap(geo.y);
      const lon = snap(geo.x);
      // Functional set + bail: flying inside one cell re-renders nothing.
      setCell((prev) => (prev && prev.lat === lat && prev.lon === lon ? prev : { lat, lon }));
    };
    sample();
    const id = setInterval(sample, armed ? WEATHER.smooth.cellMs : WEATHER.smooth.targetMs);
    return () => clearInterval(id);
  }, [on, runtime, armed]);

  const query = useQuery({
    queryKey: ['fly-weather', cell?.lat, cell?.lon],
    enabled: on && !!cell,
    queryFn: async () => {
      const res = await fetch(`/api/weather?lat=${cell.lat}&lon=${cell.lon}`);
      // The route answers 200 for every outcome (misses included), so a
      // non-ok here is a real transport failure — let React Query hold the
      // previous payload rather than flapping the sky back to baseline.
      if (!res.ok) throw new Error(`weather ${res.status}`);
      return res.json();
    },
    refetchInterval: WEATHER.poll.refetchMs,
    refetchIntervalInBackground: false,
    staleTime: WEATHER.poll.staleMs,
    gcTime: 30 * 60 * 1000,
    retry: false,
    placeholderData: (previousData) => previousData,
  });

  // --- ingest: payload → runtime (never React state) -----------------------
  const { data } = query;
  const lastData = useRef(null);
  useEffect(() => {
    if (!on || !data || data === lastData.current) return;
    lastData.current = data;
    publishPayload(runtime, data);
    refreshTargets(); // don't wait up to a second for the first real sky
  }, [on, data, runtime, refreshTargets]);

  return query;
}

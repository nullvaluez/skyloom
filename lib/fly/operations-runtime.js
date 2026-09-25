import { invalidate } from '@react-three/fiber';
import { installOperationsTerrain } from './operations-terrain';
import { airportById, airportPoint } from './operations-airports';
import { resolveAircraft, saveAircraft } from './player-aircraft';
import { FLIGHT_PLAN, FRONT_DOOR, WARP } from './fly-constants';
import { distKm, flightPlanOn, freeFlightPlacement, normalizeSetup, readLastSetup, resolveDestination, saveLastSetup } from './flight-plan';
import { worldReadiness } from './world-readiness';
import { useFlyStore } from '@/stores/fly-store';

// R25 B: a staged destination closer than this is "already there" (the title
// spot / the flight's own position) — no warp, readiness is only polled.
const STAGE_HERE_KM = 0.5;
// R25 B: an ops airport is only pre-streamed when the flight is genuinely far
// from it (a title spot on another continent). The three Columbus airports sit
// within ~25 km of each other, so today's ops flows never stage-warp.
const OPS_STAGE_MIN_KM = 50;

// This adapter owns imperative game services; React only manages its lifetime.
export function connectFlightOperations({runtime,operations,flight,input,autopilot,chase,engine,rebase,crashSys,crashRef}) {
    const releaseTerrain = installOperationsTerrain(engine);
    runtime.operations = operations;
    flight.operations = operations;
    const sync = () => {
      input.neutralize(); autopilot.disengage(); chase.snap();
      input.speedPreset='cruise';
      rebase(flight.pos.x, flight.pos.z);
      const geo = engine.worldToGeo(flight.pos); runtime.geo = geo;
      engine.notifyWarp?.(geo.x, geo.y);
      useFlyStore.getState().setPhase('flying');
      useFlyStore.getState().bumpWarpEpoch('far');
      crashSys.disarm(); crashRef.current.state = 'idle';
    };
    runtime.beginDeparture = (id, airportId, start='apron') => {
      if (!operations.begin(flight, id, airportId)) return false;
      flight.setConfig(resolveAircraft(id).cfg);
      operations.chooseRunway(runtime.weather?.wx);
      if(start==='runway')operations.lineUp(flight);
      if(start==='approach')operations.retry(flight);
      useFlyStore.getState().setAircraftId(id);
      sync(); return true;
    };
    runtime.retryApproach = () => { if (operations.retry(flight)) sync(); };
    runtime.lineUpRunway = () => { if(operations.lineUp(flight))sync(); };
    // The ops-mode glider: today's KOSU practice start, byte-for-byte (the
    // KOSU practice alias). Free Flight's generalisation of it is
    // launchFreeFlight below — the featured 'columbus-practice' destination is
    // this same spot for any aircraft.
    runtime.launchGlider = () => {
      const a = airportById('KOSU'), p = airportPoint(a, 0);
      useFlyStore.getState().setAircraftId('glider');
      flight.setConfig(resolveAircraft('glider').cfg);
      operations.profile = null; operations.phase = 'airborne'; operations.assisted = true;operations.lowSpeed=false;operations.summary=null;operations.gear=0;operations.flaps=0;
      flight.pos.set(p.x,p.y+600,p.z); flight.speed=flight.cfg.speeds.cruise;
      flight.pitch=0;flight.bank=0;flight.heading=0;flight.groundElev=p.y;flight.agl=600;sync();
    };

    // ------------------------------------------------------------------
    // R25 B FLIGHT PLAN — Free Flight launch, destination staging, Continue.
    // ------------------------------------------------------------------
    let stageTimer = null;
    const stopStaging = () => {
      if (stageTimer) clearInterval(stageTimer);
      stageTimer = null;
    };
    const stagedFor = (key) => {
      const s = runtime.staging;
      return s && s.key === key ? { ready: s.ready, ageMs: Math.round(performance.now() - s.since), warped: s.warped } : null;
    };

    /**
     * Airborne start for ANY of the nine aircraft at a destination (featured
     * id / destination / searched POI). Generalises launchGlider and the
     * scripts/_boot.js airborne skip: aircraft config, operations profile null
     * + phase 'airborne', altitude max(dest.altM, ground + minAglM), the
     * destination heading, cruise speed, the arrival trim, then sync() (far
     * warp hold, crash disarm).
     */
    runtime.launchFreeFlight = (aircraftId, destIn) => {
      const dest = resolveDestination(destIn);
      if (!dest || dest.kind === 'airport-ops') return false;
      const ac = resolveAircraft(aircraftId);
      const ground = engine.getElevationAt(dest.lon, dest.lat);
      const p = freeFlightPlacement(dest, Number.isFinite(ground) ? ground : null, ac.cfg);
      const staged = stagedFor(dest.id);
      stopStaging();
      if (runtime.staging) runtime.staging.launched = true;
      useFlyStore.getState().setAircraftId(ac.id);
      flight.setConfig(ac.cfg);
      operations.profile = null; operations.phase = 'airborne'; operations.assisted = true; operations.lowSpeed = false; operations.summary = null;
      operations.warp(flight); // phase is airborne: clears brake / contacts / touchdown like an Atlas warp
      flight.pos.copy(engine.geoToWorld(p.lon, p.lat, p.altM));
      flight.heading = p.headingRad; flight.pitch = 0; flight.bank = 0; flight.turnRate = 0; flight.pitchRate = 0;
      flight.speed = p.speed;
      flight.latDeg = p.lat;
      flight.groundElev = p.groundM ?? 0;
      flight.agl = p.aglM ?? p.altM;
      flight.armWarpTrim(flight.pos.y);
      runtime.flightPlanDest = dest;
      runtime.titleSpot = dest.title ?? null; // A's title orbit params for this spot (exit to title)
      runtime.lastLaunch = { kind: 'free', destId: dest.id, aircraftId: ac.id, lat: p.lat, lon: p.lon, altM: p.altM, groundM: p.groundM, headingRad: p.headingRad, speed: p.speed, at: performance.now(), staged };
      sync();
      return true;
    };

    // --- staging: pre-stream the chosen destination behind the hangar -------
    const readinessOf = (elapsedMs) => {
      const ts = runtime.toyStats;
      if (useFlyStore.getState().mapStyle !== 'satellite' && ts) {
        // Toy: WarpFlash's own far-warp content test (chunk counts).
        const ready = ts.ready >= WARP.far.readyChunks || (ts.chunks > 0 && ts.ready / ts.chunks >= WARP.far.readyFrac);
        return { ready, progress: ts.chunks > 0 ? Math.min(1, ts.ready / ts.chunks) : 0, missing: ready ? [] : ['chunks'] };
      }
      const r = worldReadiness(runtime, elapsedMs);
      return { ready: r.ready, progress: r.progress, missing: r.blocking };
    };
    const pollStaging = () => {
      const s = runtime.staging;
      if (!s) return stopStaging();
      const now = performance.now();
      const el = now - s.since;
      const r = readinessOf(el);
      s.polls++; s.progress = r.progress; s.missing = r.missing;
      // WarpFlash's own guards against reading the DEPARTURE area's stats
      // right after a stage warp: toy waits WARP.far.holdMinMs, satellite needs
      // 600 ms of continuous readiness past the flash.
      const toy = useFlyStore.getState().mapStyle !== 'satellite';
      const minMs = s.warped ? (toy ? WARP.far.holdMinMs : WARP.flashMs) : 0;
      if (r.ready) s.readySince ??= now; else s.readySince = null;
      const settled = r.ready && el >= minMs && (toy || !s.warped || now - s.readySince >= 600);
      if (settled && !s.ready) { s.ready = true; s.readyAt = now; s.readyMs = Math.round(el); }
      if (s.ready) return stopStaging();
      // With the front door ON, A's <StagePump> (FlyCanvas) invalidates the
      // 'demand' canvas behind the opaque hangar. With it OFF nothing would —
      // that pump mounts only under FRONT_DOOR.enabled — so the staging poll
      // feeds the frames itself, at the phone rate (4 Hz), and only while the
      // hangar covers an unready destination on a visible tab.
      if (!FRONT_DOOR.enabled && useFlyStore.getState().hangarOpen && !(typeof document !== 'undefined' && document.hidden)) {
        s.pumped++;
        invalidate();
      }
    };

    /**
     * Pre-stream a destination (featured id / destination / searched POI, or
     * an operations airport id) while a menu is open: a stage warp
     * (warpToGeo {stage:true} keeps the flight frozen in phase 'hangar'), then
     * a 4 Hz readiness poll publishing runtime.staging {key, dest, since,
     * ready, readyAt, readyMs, progress, missing, warped}. Already there ⇒ no
     * warp. Returns true when staging is (now) in effect for that destination.
     */
    runtime.stageDestination = (input) => {
      if (!flightPlanOn() || FLIGHT_PLAN.stage?.enabled === false) return false;
      const dest = resolveDestination(input);
      if (!dest) return false;
      // Idempotent while that staging is live; once launched, the flight has
      // moved on and a re-pick of the same place must re-check the distance.
      if (runtime.staging?.key === dest.id && !runtime.staging.launched) return true;
      const g = engine.worldToGeo(flight.pos);
      const dKm = distKm(g.y, g.x, dest.lat, dest.lon);
      if (dest.kind === 'airport-ops' && dKm < OPS_STAGE_MIN_KM) return false;
      let warped = false;
      if (dKm > STAGE_HERE_KM) {
        const warp = runtime.warpToGeo;
        if (typeof warp !== 'function') return false;
        if (!warp(dest.lat, dest.lon, { altM: dest.altM, headingRad: ((dest.headingDeg ?? 0) * Math.PI) / 180, stage: true })) return false;
        warped = true;
      }
      stopStaging();
      runtime.titleSpot = dest.title ?? null; // ‹ Title from the hangar orbits the staged spot with its own params
      runtime.staging = { key: dest.id, dest, since: performance.now(), ready: false, readyAt: null, readyMs: null, readySince: null, progress: 0, missing: [], warped, polls: 0, pumped: 0 };
      stageTimer = setInterval(pollStaging, 250);
      pollStaging();
      return true;
    };

    /**
     * Relaunch a setup (Continue, or the hangar's own launch): free → Free
     * Flight, ops glider → KOSU practice, ops → beginDeparture. Persists it
     * (fly-last-setup-v1 + fly-aircraft + fly-departure) and closes every menu.
     */
    runtime.launchSetup = (input) => {
      const setup = normalizeSetup(input);
      if (!setup) return false;
      let ok;
      if (setup.flightMode === 'free') ok = runtime.launchFreeFlight(setup.aircraftId, setup.dest);
      else if (setup.aircraftId === 'glider') { runtime.launchGlider(); ok = true; }
      else ok = runtime.beginDeparture(setup.aircraftId, setup.airportId, setup.start);
      if (!ok) return false;
      stopStaging();
      if (runtime.staging) runtime.staging.launched = true;
      saveAircraft(setup.aircraftId);
      if (setup.flightMode === 'ops') { try { localStorage.setItem('fly-departure', setup.airportId); } catch { /* storage blocked */ } }
      saveLastSetup(setup);
      const s = useFlyStore.getState();
      s.setFlightMode(setup.flightMode);
      s.setSettingsOpen?.(false);
      s.setHangarDismissible(false);
      s.setHangarOpen(false); // → screen 'flight' (also leaves the title)
      return true;
    };

    // The validated last setup (Continue's source) — the title reads the
    // module directly; this handle is for harnesses without a title.
    runtime.readLastSetup = () => readLastSetup();

    return () => {
      releaseTerrain(); stopStaging();
      delete runtime.beginDeparture; delete runtime.retryApproach; delete runtime.lineUpRunway; delete runtime.launchGlider; delete runtime.operations;
      delete runtime.launchFreeFlight; delete runtime.stageDestination; delete runtime.launchSetup; delete runtime.readLastSetup;
    };

}

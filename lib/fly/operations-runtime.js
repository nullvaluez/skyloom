import { installOperationsTerrain } from './operations-terrain';
import { airportById, airportPoint } from './operations-airports';
import { resolveAircraft } from './player-aircraft';
import { useFlyStore } from '@/stores/fly-store';

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
    runtime.launchGlider = () => {
      const a = airportById('KOSU'), p = airportPoint(a, 0);
      useFlyStore.getState().setAircraftId('glider');
      flight.setConfig(resolveAircraft('glider').cfg);
      operations.profile = null; operations.phase = 'airborne'; operations.assisted = true;operations.lowSpeed=false;operations.summary=null;
      flight.pos.set(p.x,p.y+600,p.z); flight.speed=flight.cfg.speeds.cruise;
      flight.pitch=0;flight.bank=0;flight.heading=0;flight.groundElev=p.y;flight.agl=600;sync();
    };
    return () => { releaseTerrain(); delete runtime.beginDeparture; delete runtime.retryApproach; delete runtime.lineUpRunway; delete runtime.launchGlider; delete runtime.operations; };

}

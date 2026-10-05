// Production source of adventure conditions. Test pins remain explicit inputs;
// ordinary play never writes globals. The profile belongs to the active flight.
export function adventureSunTime(environment,now=Date.now(),pin) {
  if(Number.isFinite(pin)&&pin>0)return pin;
  if(!environment||environment.mode!=='curated')return now;
  // A fixed equinox date makes authored light reproducible between visits.
  return Date.UTC(2026,8,22)+((environment.preset.localHour-environment.lon/15)*3600000);
}
export function adventureWeather(environment,live) {
  return environment?.mode==='curated'?{...environment.preset,found:true,source:'adventure'}:live;
}
export function createAdventureEnvironment(route,mode='curated') {
  return {mode:mode==='live'?'live':'curated',routeId:route.id,lon:route.start.lon,preset:route.conditions};
}

// Feed the existing cloud renderer. Keep the flight below the cloud base so
// a scenic approach does not begin inside a cloud. Explicit weather pins win.
export function applyAdventureAtmosphere(environment,state,weatherPin) {
  if(environment?.mode!=='curated'||weatherPin!==undefined)return state;
  const p=environment.preset;
  state.cloudBase=p.cloudBaseM;
  state.cloudThickness=p.cloudThicknessM;
  state.cloudCoverage=.22+p.cloudCoverPct*.0035;
  return state;
}

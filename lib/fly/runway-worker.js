import { nearbyOperationsAirports } from './operations-airports';
import { livingAirportsOn } from './airport-feature-policy';
import { useFlyStore } from '@/stores/fly-store';
// Additive worker request data. The worker uses the same locked runway geometry
// for every terrain/scenery layer; no second interpretation of airport bounds.
export function withRunwayGeometry(api){
  return new Proxy(api,{get(target,key){
    if(key!=='buildTile')return target[key];
    return (z,x,y,detail,options={})=>{
      const circumference=40075016.68557849,span=circumference/2**z;
      const cx=-circumference/2+(x+.5)*span,cz=-circumference/2+(y+.5)*span;
      const state=useFlyStore.getState();
      return target.buildTile(z,x,y,detail,{...options,airportLandmarks:livingAirportsOn('scenery')&&state.mapStyle==='satellite'&&state.visuals==='enhanced',operationsAirports:nearbyOperationsAirports(cx,cz,span+1000).filter(a=>a.authored===false)});
    };
  }});
}

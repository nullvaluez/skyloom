import { nearbyOperationsAirports } from './operations-airports';
// Additive worker request data. The worker uses the same locked runway geometry
// for every terrain/scenery layer; no second interpretation of airport bounds.
export function withRunwayGeometry(api){
  return new Proxy(api,{get(target,key){
    if(key!=='buildTile')return target[key];
    return (z,x,y,detail,options={})=>{
      const circumference=40075016.68557849,span=circumference/2**z;
      const cx=-circumference/2+(x+.5)*span,cz=-circumference/2+(y+.5)*span;
      return target.buildTile(z,x,y,detail,{...options,operationsAirports:nearbyOperationsAirports(cx,cz,span+1000).filter(a=>a.authored===false)});
    };
  }});
}

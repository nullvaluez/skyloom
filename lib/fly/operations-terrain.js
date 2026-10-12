import { Vector3, Sphere } from 'three';
import { findAirportSurface, nearestOperationsAirport, nearbyOperationsAirports, airportRegistryRevision, subscribeAirports } from './operations-airports.js';

// Stable authored runway profile, with a 160 m shoulder blend. Surface geometry
// sits 2.5 cm above this result. Applies before streamed actors sample terrain.
export function airportTerrainHeight(x,z,height) {
  // Almost all streamed points are outside airport shoulders. Use the exact
  // indexed surface query before the global nearest-airport distance scan.
  // Retain that scan inside the small footprint to preserve the old boundary.
  const outer=findAirportSurface(x,z,160);
  if(!outer)return height;
  const nearest=nearestOperationsAirport(x,z);
  if(nearest.distance>650)return height;
  const exact=findAirportSurface(x,z,4);
  if(exact)return exact.height;
  let lo=4,hi=160;
  for(let i=0;i<8;i++){const m=(lo+hi)/2;if(findAirportSurface(x,z,m))hi=m;else lo=m;}
  const t=1-(hi-4)/156,smooth=t*t*(3-2*t);
  return height+(outer.height-height)*smooth;
}

/** Deform loaded terrain once, in the actual mesh coordinate frame. Geometry
 * belongs to its tile; no disposal or material ownership is transferred. */
export function installOperationsTerrain(engine) {
  const world=new Vector3(),local=new Vector3(),bounds=new Sphere();
  const patch=root=>{
    root?.traverse?.(mesh=>{
      if(!mesh.isMesh||!mesh.geometry?.attributes?.position||mesh.geometry.userData.operationsRevision===airportRegistryRevision())return;
      mesh.updateWorldMatrix(true,false);
      const g=mesh.geometry,p=g.attributes.position;
      // Skip the overwhelming majority of terrain tiles before vertex work.
      if(!g.boundingBox)g.computeBoundingBox();
      // Rendering's sphere includes a very large globe-bend margin. It is
      // unsuitable for a terrain edit census; use the physical tile bounds.
      g.boundingBox.getBoundingSphere(bounds);
      world.copy(bounds.center).applyMatrix4(mesh.matrixWorld).add(engine._anchor);
      const worldRadius=bounds.radius*mesh.matrixWorld.getMaxScaleOnAxis();
      const key=nearbyOperationsAirports(world.x,world.z,worldRadius+700).map(a=>a.id).join('|');
      if(g.userData.operationsKey===key)return;
      if(!key&&!g.userData.operationsOriginal){g.userData.operationsKey=key;return;}
      const restored=!!g.userData.operationsOriginal;
      if(restored){p.array.set(g.userData.operationsOriginal);p.needsUpdate=true;}
      g.userData.operationsOriginal??=p.array.slice();
      // A skirt repeats the surface XZ at a lower Y. Moving both vertices to
      // the pavement height flattens its vertical faces into zero-area
      // triangles. Translate each complete column by the surface delta instead.
      const columns=new Map(),points=new Float64Array(p.count*3),keys=[];
      for(let i=0;i<p.count;i++){
        world.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld).add(engine._anchor);
        world.toArray(points,i*3);
        const key=`${Math.round(world.x*1000)}/${Math.round(world.z*1000)}`;keys.push(key);
        const top=columns.get(key);
        if(!top||world.y>top.y)columns.set(key,{x:world.x,y:world.y,z:world.z,index:i});
      }
      for(const top of columns.values())top.delta=airportTerrainHeight(top.x,top.z,top.y)-top.y;
      let changed=restored;
      for(let i=0;i<p.count;i++){
        const delta=columns.get(keys[i]).delta;if(Math.abs(delta)<.001)continue;
        world.fromArray(points,i*3);world.y+=delta;
        local.copy(world).sub(engine._anchor);mesh.worldToLocal(local);p.setXYZ(i,local.x,local.y,local.z);changed=true;
      }
      g.userData.operationsSurface=true;
      g.userData.operationsRevision=airportRegistryRevision();
      g.userData.operationsKey=key;
      if(!key)delete g.userData.operationsOriginal;
      if(changed){
        p.needsUpdate=true;g.computeVertexNormals();g.computeBoundingBox();g.computeBoundingSphere();
        if(g.type==='TileGeometry'){
          let minZ=0;for(const top of columns.values())minZ=Math.min(minZ,p.getZ(top.index));
          g.userData.surfaceMinZ=minZ;
          for(let tile=mesh.parent;tile?.isTile;tile=tile.parent)tile._maxZ=Math.max(tile._maxZ,g.boundingBox.max.z);
        }
        // Rebuilding the sphere must retain the terrain engine's bend margin.
        if(g.boundingSphere.userData?.r24Bent)g.boundingSphere.userData.r24Bent=false;
        engine._bendSphereHandler?.({tile:mesh});
      }
    });
  };
  patch(engine.object);
  const handler=e=>patch(e.tile?.model??e.tile);
  engine.map.addEventListener('tile-loaded',handler);
  const unsubscribe=subscribeAirports(()=>patch(engine.object));
  return()=>{unsubscribe();engine.map.removeEventListener('tile-loaded',handler);};
}

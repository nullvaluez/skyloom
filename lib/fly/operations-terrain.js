import { Box3, Vector3, Matrix4 } from 'three';
import { findAirportSurface, nearestOperationsAirport, terrainAirportsInBounds, airportRegistryRevision, subscribeAirports } from './operations-airports.js';

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
  const world=new Vector3(),local=new Vector3(),bounds=new Box3(),inverse=new Matrix4();
  const candidatesByGeometry = new WeakMap();
  const patch=root=>{
    const revision=airportRegistryRevision();
    root?.traverse?.(mesh=>{
      if(!mesh.isMesh||!mesh.geometry?.attributes?.position||mesh.geometry.userData.operationsRevision===revision)return;
      mesh.updateWorldMatrix(true,false);
      const g=mesh.geometry,p=g.attributes.position;
      if(!g.boundingBox)g.computeBoundingBox();
      // Tile XY is normalized, while height and skirts are already metres.
      // Scaling a local sphere by the widest axis inflated its height term
      // by an entire tile width and admitted runways far outside the mesh.
      bounds.copy(g.boundingBox).applyMatrix4(mesh.matrixWorld).translate(engine._anchor);
      const airports=terrainAirportsInBounds(bounds);
      const previous=candidatesByGeometry.get(g);
      candidatesByGeometry.set(g,airports);
      g.userData.operationsRevision=revision;
      if(previous && previous.length===airports.length && airports.every((a,i)=>a===previous[i]))return;
      const restored=!!g.userData.operationsOriginal;
      if(!restored){
        if(!airports.length)return;
        // A coarse tile can cover an airport with no DEM vertex on its
        // runway or shoulder. No column can move unless its top passes this
        // exact surface predicate. Avoid storing an untouched vertex buffer.
        let touches=false;
        for(let i=0;i<p.count&&!touches;i++){
          world.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld).add(engine._anchor);
          touches=!!findAirportSurface(world.x,world.z,160);
        }
        if(!touches)return;
      }
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
      inverse.copy(mesh.matrixWorld).invert();
      for(let i=0;i<p.count;i++){
        const delta=columns.get(keys[i]).delta;if(Math.abs(delta)<.001)continue;
        world.fromArray(points,i*3);world.y+=delta;
        local.copy(world).sub(engine._anchor).applyMatrix4(inverse);p.setXYZ(i,local.x,local.y,local.z);changed=true;
      }
      g.userData.operationsSurface=true;
      if(!airports.length||!changed)delete g.userData.operationsOriginal;
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

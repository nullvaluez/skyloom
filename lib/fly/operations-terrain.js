import { Vector3 } from 'three';
import { airportSurface, nearbyOperationsAirports, airportRegistryRevision } from './operations-airports.js';

// Stable authored runway profile, with a 160 m shoulder blend. Surface geometry
// sits 2.5 cm above this result. Applies before streamed actors sample terrain.
export function airportTerrainHeight(x,z,height,airports=nearbyOperationsAirports(x,z,650)) {
  // A tile supplies its local candidates once. Repeating the registry search
  // at every vertex and every shoulder bisection made arrivals stall as the
  // worldwide registry grew. Geometry and the eight-step blend stay unchanged.
  // A coarse tile's sphere can include an entire region. For that case use
  // the point's spatial query instead of scanning thousands of runways at
  // every vertex. Fine tiles retain the inexpensive shared candidate list.
  if(airports.length>16)airports=nearbyOperationsAirports(x,z,650);
  const surface=margin=>{for(const a of airports){const s=airportSurface(a,x,z,margin);if(s)return s;}return null;};
  const exact=surface(4);
  if(exact)return exact.height;
  const outer=surface(160);
  if(!outer)return height;
  let lo=4,hi=160;
  for(let i=0;i<8;i++){const m=(lo+hi)/2;if(surface(m))hi=m;else lo=m;}
  const t=1-(hi-4)/156,smooth=t*t*(3-2*t);
  return height+(outer.height-height)*smooth;
}

/** Deform loaded terrain once, in the actual mesh coordinate frame. Geometry
 * belongs to its tile; no disposal or material ownership is transferred. */
export function installOperationsTerrain(engine) {
  const world=new Vector3(),local=new Vector3();
  const patch=root=>{
    root?.traverse?.(mesh=>{
      if(!mesh.isMesh||!mesh.geometry?.attributes?.position||mesh.geometry.userData.operationsRevision===airportRegistryRevision())return;
      mesh.updateWorldMatrix(true,false);
      const g=mesh.geometry,p=g.attributes.position;
      // Skip the overwhelming majority of terrain tiles before vertex work.
      if(!g.boundingSphere)g.computeBoundingSphere();
      world.copy(g.boundingSphere.center).applyMatrix4(mesh.matrixWorld).add(engine._anchor);
      const worldRadius=g.boundingSphere.radius*mesh.matrixWorld.getMaxScaleOnAxis();
      const airports=nearbyOperationsAirports(world.x,world.z,worldRadius+700);
      if(!airports.length)return;
      // Reapplying after another catalog region arrives must start from the
      // original DEM, otherwise the feathered shoulder creeps on every pass.
      const original=g.userData.operationsOriginalPositions;
      if(original)p.array.set(original);
      else g.userData.operationsOriginalPositions=p.array.slice();
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
      for(const top of columns.values())top.delta=airportTerrainHeight(top.x,top.z,top.y,airports)-top.y;
      let changed=false;
      for(let i=0;i<p.count;i++){
        const delta=columns.get(keys[i]).delta;if(Math.abs(delta)<.001)continue;
        world.fromArray(points,i*3);world.y+=delta;
        local.copy(world).sub(engine._anchor);mesh.worldToLocal(local);p.setXYZ(i,local.x,local.y,local.z);changed=true;
      }
      g.userData.operationsSurface=true;
      g.userData.operationsRevision=airportRegistryRevision();
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
  let revision=airportRegistryRevision();
  const rescan=setInterval(()=>{if(revision===airportRegistryRevision())return;revision=airportRegistryRevision();patch(engine.object);},2000);
  return()=>{clearInterval(rescan);engine.map.removeEventListener('tile-loaded',handler);};
}

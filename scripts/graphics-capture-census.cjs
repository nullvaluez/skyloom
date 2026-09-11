/* Serialized into page.evaluate/waitForFunction. Read-only; no forced placement. */
function captureStreamersSettled() {
  const rt=window.__fly;
  if(!rt)return false;
  for(const key of ['satBuildings','satRoads','satSkyline','satVeg']){
    const stats=rt[key]?.stats;
    if(stats&&['queued','building','sampling'].some(field=>Number(stats[field]??0)!==0))return false;
  }
  return !rt.groundDetail?.scanning;
}
function captureSceneCensus() {
  const rt=window.__fly;
  if(!rt)return {available:false};
  const streamers={};let streamersSettled=true;
  for(const key of ['satBuildings','satRoads','satSkyline','satVeg']){
    const stats=rt[key]?.stats;
    streamers[key]=stats?{...stats}:null;
    if(stats&&['queued','building','sampling'].some(field=>Number(stats[field]??0)!==0))streamersSettled=false;
  }
  if(rt.groundDetail?.scanning)streamersSettled=false;
  let scene=rt.engine?.object;while(scene?.parent)scene=scene.parent;
  const meshes=[];
  scene?.traverse(object=>{
    if(!object.isInstancedMesh||!(object.userData?.__satVegInit||object.name==='sat-ground-detail'))return;
    const parents=[];let parentVisible=true;
    for(let parent=object.parent;parent;parent=parent.parent){
      parentVisible&&=parent.visible!==false;
      if(parents.length<8)parents.push({id:parent.id,name:parent.name,type:parent.type,visible:parent.visible});
    }
    const local=object.boundingSphere??object.geometry?.boundingSphere;
    const world=local?.clone().applyMatrix4(object.matrixWorld);
    const sphere=s=>s?{center:s.center.toArray(),radius:s.radius}:null;
    const matrix=object.matrixWorld?.elements;
    meshes.push({kind:object.userData?.__satVegInit?'canopy':'groundDetail',id:object.id,name:object.name,
      count:object.count,capacity:object.instanceMatrix?.count,visible:object.visible,parentVisible,parents,
      frustumCulled:object.frustumCulled,castShadow:object.castShadow,receiveShadow:object.receiveShadow,
      localPosition:object.position.toArray(),worldPosition:matrix?[matrix[12],matrix[13],matrix[14]]:null,
      localBounds:sphere(local),worldBounds:sphere(world),boundsSource:object.boundingSphere?'object':'geometry',
      materialVisible:Array.isArray(object.material)?object.material.map(m=>m.visible):object.material?.visible,
      materialKey:Array.isArray(object.material)?null:object.material?.customProgramCacheKey?.()});
  });
  return {available:!!scene,streamers,streamersSettled,meshes,groundDetail:rt.groundDetail?{...rt.groundDetail}:null,
    camera:rt.camera?{position:rt.camera.position.toArray(),quaternion:rt.camera.quaternion.toArray(),fov:rt.camera.fov}:null,
    origin:rt.origin?.anchor?.toArray?.()??null};
}
module.exports={captureStreamersSettled,captureSceneCensus};

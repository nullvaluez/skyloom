import * as T from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MONUMENT_MANIFEST } from '../lib/fly/monument-models.js';
import { resolveLandmarkEntry } from '../lib/fly/landmark-fidelity.js';
import { loadOne, loadMonumentDetail } from '../lib/fly/monument-loader.js';
import { attachCinematicModelAttributes, createCinematicModelMaterial, updateCinematicModelNight } from '../lib/fly/cinematic-models.js';

const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.setSize(1800,1350);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
document.body.appendChild(renderer.domElement);
const scene=new T.Scene(),camera=new T.PerspectiveCamera(32,4/3,.01,100);
const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room);scene.environment=env.texture;room.dispose();pmrem.dispose();
const hemi=new T.HemisphereLight('#ffffff','#667174',1.2),sun=new T.DirectionalLight('#fff0d7',2.4);sun.position.set(-3,5,4);scene.add(hemi,sun);
const names=MONUMENT_MANIFEST.filter(e=>e.poi!=='Statue of Liberty').map(e=>e.poi),meshes=new Map();let current;
async function show(name,level='high',before=false,night=false){
  const key=[name,level,before].join(':');
  window.__flyLandmarkFidelityOverride={enabled:!before};
  if(!meshes.has(key)){
    const original=MONUMENT_MANIFEST.find(e=>e.poi===name),entry=resolveLandmarkEntry(original);
    const g=level!=='far'&&entry.detail?.[level]?await loadMonumentDetail(entry,level,'sat'):await loadOne(entry,'sat');
    attachCinematicModelAttributes(g,{...entry,...entry.detail?.[level]});
    const mesh=new T.Mesh(g,createCinematicModelMaterial(()=>{},{merged:true}));mesh.visible=false;scene.add(mesh);meshes.set(key,mesh);
  }
  if(current)current.visible=false;current=meshes.get(key);current.visible=true;
  const box=new T.Box3().setFromObject(current),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
  const radius=Math.max(size.y*.5,Math.hypot(size.x,size.z)/(camera.aspect*2))+.09;
  const dist=radius/Math.sin(camera.fov*Math.PI/360);
  camera.position.copy(center).add(new T.Vector3(1.2,.53,1.8).normalize().multiplyScalar(dist));camera.lookAt(center);
  scene.background=new T.Color(night?'#101b29':'#b8c6cb');scene.environmentIntensity=night?.12:1;
  hemi.intensity=night?.14:1.2;sun.intensity=night?.15:2.4;updateCinematicModelNight(current.material,night?0:1);
  renderer.render(scene,camera);
  return {name,level,before,night,triangles:current.geometry.index.count/3,vertices:current.geometry.attributes.position.count,bounds:size.toArray()};
}
window.review={names,show,
  async gallery(level='high',before=false,night=false){
    renderer.setSize(1800,1350);scene.background=new T.Color(night?'#101b29':'#b8c6cb');renderer.setViewport(0,0,1800,1350);renderer.clear();renderer.setScissorTest(true);camera.aspect=450/450;camera.updateProjectionMatrix();
    const rows=[];
    for(let i=0;i<names.length;i++){
      const x=i%4*450,y=900-Math.floor(i/4)*450;renderer.setViewport(x,y,450,450);renderer.setScissor(x,y,450,450);
      rows.push(await show(names[i],level,before,night));
    }
    renderer.setScissorTest(false);return rows;
  },
  reset(){renderer.setSize(1300,1100);renderer.setViewport(0,0,1300,1100);camera.aspect=1300/1100;camera.updateProjectionMatrix();},
  stats(){const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext&&gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),programs:renderer.info.programs.map(p=>({name:p.name,runnable:p.diagnostics?.runnable!==false})),textures:renderer.info.memory.textures};}
};window.reviewReady=true;

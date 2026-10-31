// Offline asset review using the actual player paint, live fleet and landmark loaders.
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { COMMERCIAL_PRESETS } from '../lib/fly/commercial-liveries.mjs';
import { FLEET_PRESENTATION } from '../lib/fly/fleet-aircraft.mjs';
import { applyFleetLivery, disposeFleetGeometry } from '../lib/fly/fleet-animation.js';
import { MONUMENT_MANIFEST } from '../lib/fly/monument-models.js';
import { loadOne, loadMonumentDetail } from '../lib/fly/monument-loader.js';
import { resolveLibertyEntry, monumentPresence } from '../lib/fly/liberty-detail.js';
import { attachCinematicModelAttributes, createCinematicModelMaterial, updateCinematicModelNight } from '../lib/fly/cinematic-models.js';

const renderer=new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(1500,1000);renderer.setPixelRatio(1);renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
document.body.appendChild(renderer.domElement);
const scene=new T.Scene();scene.background=new T.Color('#c3cdd4');
const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room);scene.environment=env.texture;room.dispose();pmrem.dispose();
const hemi=new T.HemisphereLight('#ffffff','#728083',1.3);scene.add(hemi);
const sun=new T.DirectionalLight('#fff3e2',2.5);sun.position.set(-65,110,-80);scene.add(sun);
const camera=new T.PerspectiveCamera(32,1.5,.1,2000);
let current=null;const planes=new Map(),landmarks=new Map();
function show(o){if(current)current.visible=false;current=o;o.visible=true;}
const loader=new GLTFLoader();
async function plane(id,mobile=false){const key=id+(mobile?'-mobile':'');if(planes.has(key))return planes.get(key);
  const entry=FLEET_PRESENTATION[id],gltf=await loader.loadAsync(mobile?entry.mobileUrl:entry.url),root=gltf.scene;
  root.traverse(o=>{if(o.isMesh)o.material=o.material.clone();});root.visible=false;scene.add(root);planes.set(key,root);return root;
}
async function paint(id,skinId,{side=false,mobile=false,night=false}={}){
  const root=await plane(id,mobile);applyFleetLivery(root,id,skinId);show(root);
  const L=FLEET_PRESENTATION[id].length??61.66;
  camera.position.set((side?1:-1)*L*1.25,L*.30,-L*.65);camera.lookAt(0,0,0);
  hemi.intensity=night?.2:1.3;sun.intensity=night?.5:2.5;renderer.render(scene,camera);
  return {id,skinId,mobile,paint:root.userData.fleetPaint?.skinId,programs:renderer.info.programs.map(p=>({key:p.name,runnable:p.diagnostics?.runnable!==false}))};
}
async function statue(level='high',before=false,night=false){
  const key=`${level}-${before}`;
  if(!landmarks.has(key)){
    window.__flyLibertyDetailOverride={enabled:!before};
    const entry=resolveLibertyEntry(MONUMENT_MANIFEST.find(e=>e.poi==='Statue of Liberty'));
    const g=level==='far'||before?await loadOne(entry,'sat'):await loadMonumentDetail(entry,level,'sat');
    attachCinematicModelAttributes(g,entry);
    const mesh=new T.Mesh(g,createCinematicModelMaterial(()=>{},{merged:true}));
    mesh.scale.setScalar(125.55*monumentPresence(entry.poi));
    mesh.visible=false;scene.add(mesh);landmarks.set(key,mesh);
  }
  const mesh=landmarks.get(key);show(mesh);
  camera.position.set(170,130,360);camera.lookAt(0,88,0);
  scene.environmentIntensity=night?.12:1;scene.background.set(night?'#0b1523':'#c3cdd4');
  hemi.intensity=night?.15:1.3;sun.intensity=night?.1:2.5;
  updateCinematicModelNight(mesh.material,night?0:1);renderer.render(scene,camera);
  return {level,before,triangles:mesh.geometry.index.count/3,height:mesh.scale.y};
}
window.review={paint,statue,async gallery(id='airliner',side=false,mobile=false){
  const rows=COMMERCIAL_PRESETS[id];const cols=4,nrows=Math.ceil(rows.length/cols),w=1500,h=nrows*255;
  renderer.setSize(w,h);renderer.setScissorTest(true);camera.aspect=(w/cols)/255;camera.updateProjectionMatrix();
  const labels=[];
  for(let i=0;i<rows.length;i++){
    const x=i%cols*(w/cols),y=h-(Math.floor(i/cols)+1)*255;
    renderer.setViewport(x,y,w/cols,255);renderer.setScissor(x,y,w/cols,255);
    await paint(id,rows[i].id,{side,mobile});labels.push({id:rows[i].id,name:rows[i].name,x,y:h-y-255});
  }
  renderer.setScissorTest(false);return labels;
},reset(){renderer.setSize(1500,1000);renderer.setViewport(0,0,1500,1000);camera.aspect=1.5;camera.updateProjectionMatrix();},
stats(){const ext=renderer.getContext().getExtension('WEBGL_debug_renderer_info');return {renderer:ext&&renderer.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL),programs:renderer.info.programs.map(p=>({name:p.name,runnable:p.diagnostics?.runnable!==false})),textures:renderer.info.memory.textures};},
dispose(){planes.forEach(o=>disposeFleetGeometry(o));renderer.dispose();env.dispose();}};
window.reviewReady=true;

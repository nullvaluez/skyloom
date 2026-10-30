'use client';
import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, MeshReflectorMaterial, OrbitControls, useGLTF } from '@react-three/drei';
import { Vector3 } from 'three';
import { HangarExterior } from './HangarExterior';
import { CameraGlide, advanceHaze, createMoteMaterial, createShaftMaterial, hangarCameraGoal, hangarExposureScale, hangarReflectorResolution, liveryLuminance, moteGeometry, shaftGeometry } from './hangar-stage';
import { lightBlock, shipPassOn } from '@/lib/fly/ship-light';
import { livingWorldBlock, livingWorldOn } from '@/lib/fly/living-world';
import { readReducedMotion } from '@/lib/fly/immersive';
import { isPhoneClass } from '@/lib/fly/device-class';
import { useFlyStore } from '@/stores/fly-store';
import { computeModelCorrection } from '@/lib/fly/model-loader';
import { operationsProfile } from '@/lib/fly/operations-profiles';
import { LandingGear } from '../LandingGear';
import { attachVectorControls, fleetAnimator, applyFleetLivery, disposeFleetGeometry } from '@/lib/fly/fleet-animation';
import { useAdventureStore } from '@/stores/adventure-store';
import { applyAirframeDetail } from '@/lib/fly/airframe-detail';
class ModelBoundary extends Component {
  state={error:false};
  static getDerivedStateFromError(){return {error:true};}
  componentDidCatch(){this.props.onError();}
  render(){return this.state.error?null:this.props.children;}
}
function Aircraft({aircraft,onReady,earnedPreview=false,onLuma}){
  const {scene}=useGLTF(aircraft.entry.url);
  const clone=useMemo(()=>{const object=scene.clone(true);if(aircraft.id==='fighter'&&aircraft.entry.parts)attachVectorControls(object);object.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;const copy=m=>{const c=m.clone();c.vertexColors=!!o.geometry.attributes.color;return c;};o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);}});
    return object;},[scene,aircraft.id,aircraft.entry.parts]);
  const livery=useAdventureStore(s=>s.progress.liveries[aircraft.id]);
  useEffect(()=>{applyFleetLivery(clone,aircraft.id,earnedPreview?'earned':livery);onLuma?.(liveryLuminance(clone));},[clone,aircraft.id,livery,earnedPreview,onLuma]);
  // LIVING WORLD AIRFRAME_DETAIL: the flight model's panel lines, glass and pilot on the display model.
  // After the paint, so a livery change re-applies it; materials here are per-mount copies. Null on Neon, Classic, Low and phone.
  useEffect(()=>{const finish=applyAirframeDetail(clone,aircraft.id,{mode:'hangar',canopyMaterial:aircraft.entry.canopyMaterial});return()=>finish?.dispose();},[clone,aircraft.id,aircraft.entry.canopyMaterial,livery,earnedPreview]);
  const animate=useMemo(()=>fleetAnimator(clone,aircraft.entry.parts),[clone,aircraft.entry.parts]);
  useFrame((_,dt)=>animate(null,dt,true));
  useEffect(()=>()=>disposeFleetGeometry(clone),[clone]);
  useEffect(()=>()=>clone.traverse(o=>{if(o.isMesh)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}),[clone]);
  const correction=useMemo(()=>computeModelCorrection(clone,aircraft.entry.targetLenM,aircraft.entry.yawFixRad),[clone,aircraft]);
  const p=operationsProfile(aircraft.id);
  useEffect(()=>{onReady(aircraft.id);},[onReady,aircraft.id,clone]);
  return <group position={[0,p?.clearance??.35,0]}>
    <group position-y={p?.modelOffsetY??0}><group rotation-y={correction.rotY} scale={correction.scale}><primitive object={clone} dispose={null}/></group></group>
    <LandingGear flight={{speed:0}} aircraftId={aircraft.id} preview/>
  </group>;
}
function Bay({aircraft,airport,onReady,onError,onExteriorReady,view}){
  // A flying wing is far wider than it is long: frame (and house) its span too.
  // For every other airframe span*.7 stays below its length or the 15/28 m floors,
  // so their framing is unchanged.
  const reach=Math.max(aircraft.entry.targetLenM,(aircraft.entry.span||0)*.7);
  const length=Math.max(28,reach),width=length*1.65,depth=length*1.5,height=Math.max(13,length*.4);
  const viewLength=Math.max(15,reach),cutaway=useRef(),controls=useRef();
  const {camera,size}=useThree();
  useFrame(()=>{cutaway.current?.traverse(mesh=>{const side=mesh.userData.cutawaySide;if(side===undefined)return;
    mesh.visible=side==='roof'?camera.position.y<height-.5:camera.position.x*side<width*.48;
  });});
  useEffect(()=>{
    const positions={quarter:[.65,.46,-1.35],front:[0,.25,-1.65],side:[1.65,.32,.08],rear:[-.62,.36,1.5]};
    const portrait=size.width<size.height;
    // Near-square desktop panels also need horizontal room for the fleet's
    // wings and the dispatch column. Avoid the old landscape/portrait cliff.
    const aspect=size.width/Math.max(1,size.height);
    const distanceScale=Math.max(portrait?(viewLength>25?1.8:1.55):1,Math.min(2,1.4/aspect));
    const position=positions[view||'quarter'].map(v=>v*viewLength*distanceScale);
    position[1]=Math.min(position[1],height*.7);
    camera.position.set(...position);
    camera.setViewOffset(size.width,size.height,size.width>900?size.width*.08:0,portrait?size.height*.17:0,size.width,size.height);
    camera.lookAt(0,viewLength*.07,0);camera.updateProjectionMatrix();controls.current?.target.set(0,viewLength*.07,0);controls.current?.update();
  },[camera,viewLength,height,view,aircraft.id,size.width,size.height]);
  return <>
    <color attach="background" args={['#7d9fb4']}/>
    <fog attach="fog" args={['#a6bbc6',900,4000]}/>
    <Suspense fallback={null}><Environment files="/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr" background backgroundRotation={[0,2.6,0]} environmentIntensity={.65}/></Suspense>
    <hemisphereLight args={['#d6edff','#17212e',.65]}/>
    <directionalLight position={[width*.6,height*1.4,depth*1.5]} intensity={3} color="#ffe6bb" castShadow shadow-mapSize={[1024,1024]} shadow-camera-left={-width} shadow-camera-right={width} shadow-camera-top={width} shadow-camera-bottom={-width} shadow-camera-far={length*6} shadow-normalBias={.025} shadow-bias={-.0001}/>
    <directionalLight position={[-width,height,-depth]} intensity={.8} color="#9aeaff"/>
    <HangarExterior airport={airport} onLoaded={onExteriorReady}/>
    <group ref={cutaway} name="hangar-architecture">
      <mesh rotation-x={-Math.PI/2} position-y={-.025} receiveShadow><planeGeometry args={[width,depth]}/><meshStandardMaterial color="#263844" metalness={.48} roughness={.36}/></mesh>
      <mesh castShadow userData={{cutawaySide:'roof'}} position={[0,height,0]}><boxGeometry args={[width,.7,depth]}/><meshStandardMaterial color="#172630" metalness={.5} roughness={.48}/></mesh>
      {[-1,1].map(side=><group key={side}>
        <mesh castShadow userData={{cutawaySide:side}} position={[side*width/2,height/2,0]}><boxGeometry args={[.65,height,depth]}/><meshStandardMaterial color="#1b303e" metalness={.4} roughness={.5}/></mesh>
        {/* Open portal: daylight, runway and airport remain visible behind the aircraft. */}
        <mesh position={[side*(width/2-.6),height/2,depth/2]}><boxGeometry args={[1.2,height,1.5]}/><meshStandardMaterial color="#344e5c" metalness={.65}/></mesh>
        <mesh position={[side*(width/2-1.3),height/2,depth/2-.8]}><boxGeometry args={[.1,height*.92,.08]}/><meshBasicMaterial color="#a9edff" toneMapped={false}/></mesh>
        <mesh position={[side*width*.42,.012,0]} rotation-x={-Math.PI/2}><planeGeometry args={[.10,depth*.9]}/><meshBasicMaterial color="#76defb" toneMapped={false}/></mesh>
      </group>)}
      <mesh position={[0,height-.5,depth/2]}><boxGeometry args={[width,1.4,1.6]}/><meshStandardMaterial color="#233b49" metalness={.6}/></mesh>
      {Array.from({length:5},(_,i)=><group key={i} position={[0,0,-depth/2+i*depth/4]}>
        <mesh userData={{cutawaySide:'roof'}} position={[0,height-.6,0]}><boxGeometry args={[width,.5,.45]}/><meshStandardMaterial color="#0e1b26" metalness={.6}/></mesh>
        <mesh userData={{cutawaySide:'roof'}} position={[0,height-.92,0]}><boxGeometry args={[width*.64,.07,.16]}/><meshBasicMaterial color="#dbf4ff" toneMapped={false}/></mesh>
        {[-1,1].map(side=><mesh userData={{cutawaySide:side}} key={side} position={[side*(width/2-.6),height/2,0]}><boxGeometry args={[.55,height,.55]}/><meshStandardMaterial color="#111f2b" metalness={.5}/></mesh>)}
        <mesh position={[0,.001,0]} rotation-x={-Math.PI/2}><planeGeometry args={[width,.025]}/><meshBasicMaterial color="#4b626c"/></mesh>
      </group>)}
      {/* Curved service-bay paint is a ground reference, clear of the wheels. */}
      <mesh rotation-x={-Math.PI/2} position-y={.007}><ringGeometry args={[viewLength*.66,viewLength*.66+.035,96,1,.2,Math.PI*1.6]}/><meshBasicMaterial color="#6ea2b7" transparent opacity={.65}/></mesh>
      <mesh position={[0,.008,-viewLength*.59]} rotation-x={-Math.PI/2}><planeGeometry args={[viewLength*.24,.09]}/><meshBasicMaterial color="#b3e8f4"/></mesh>
      {[-1,1].map(side=><group key={side} position={[side*width*.43,0,depth*.14]}>
        <mesh position={[0,.65,0]}><boxGeometry args={[1.8,1.3,3]}/><meshStandardMaterial color="#263b49" metalness={.65} roughness={.32}/></mesh>
        <mesh position={[0,1.33,0]}><boxGeometry args={[1.9,.07,3.1]}/><meshStandardMaterial color="#7596a3" metalness={.8}/></mesh>
      </group>)}
    </group>
    <ModelBoundary key={aircraft.id} onError={onError}><Suspense fallback={null}>
      <Aircraft aircraft={aircraft} onReady={onReady}/>
      <ContactShadows position={[0,.004,0]} opacity={.8} scale={width} blur={1.8} far={Math.min(height,viewLength*.25)} resolution={512} frames={1} color="#020713"/>
    </Suspense></ModelBoundary>
    <OrbitControls ref={controls} target={[0,viewLength*.07,0]} minDistance={viewLength*.8} maxDistance={length*2.5} maxPolarAngle={Math.PI*.485} minPolarAngle={.25} enablePan={false} enableDamping dampingFactor={.1}/>
  </>;
}
/*
 * LIVING WORLD — HANGAR_STAGE (FLY_LIVING_WORLD.md, UI-FLIGHT). The same bay,
 * dressed as a studio: a key spot and an overhead pool, two rim lights from
 * the door side, sunlight through the open door with haze shafts and dust, a
 * reflective floor (not on phones or the Low tier, which keep the classic
 * floor), eased camera moves when the aircraft or the view changes, and a slow
 * turntable after a few idle seconds. Reduced motion: cuts, no turntable, no
 * drifting dust. Flag off renders the classic Bay above, untouched.
 */
const STAGE = livingWorldOn('HANGAR_STAGE');
const cfg = livingWorldBlock('HANGAR_STAGE') ?? {};
// SHIP PASS LIGHT (HANGAR_EXPOSURE, LT-7): null with the flag off, so the
// studio intensities and the reflector size are exactly today's.
const EXPOSURE = shipPassOn('HANGAR_EXPOSURE') ? lightBlock('HANGAR_EXPOSURE') : null;
/** A spot light aimed at a point (its target is not in the scene, so its matrix is set here). */
function StageSpot({aim,...props}){
  const ref=useRef();
  const [x,y,z]=aim;
  useEffect(()=>{const l=ref.current;if(!l)return;l.target.position.set(x,y,z);l.target.updateMatrixWorld();},[x,y,z]);
  return <spotLight ref={ref} {...props}/>;
}
const _goal = new Vector3();
const _goalTarget = new Vector3();
const _revealFrom = new Vector3();
function StageBay({aircraft,airport,onReady,onError,onExteriorReady,view}){
  const tier=useFlyStore(s=>s.qualityTier);
  const cheap=isPhoneClass()||tier==='low';
  const reach=Math.max(aircraft.entry.targetLenM,(aircraft.entry.span||0)*.7);
  const length=Math.max(28,reach),width=length*1.65,depth=length*1.5,height=Math.max(13,length*.4);
  const viewLength=Math.max(15,reach),cutaway=useRef(),controls=useRef(),turntable=useRef();
  const {camera,size,gl}=useThree();
  const glide=useMemo(()=>new CameraGlide(),[]);
  const look=useMemo(()=>new Vector3(0,viewLength*.07,0),[viewLength]);
  const motion=useRef({idle:0,spin:0,yaw:0,homing:false,dragging:false});
  const key=useRef(null);
  const turn={idleSec:6,speed:.11,...cfg.turntable};
  useFrame(()=>{cutaway.current?.traverse(mesh=>{const side=mesh.userData.cutawaySide;if(side===undefined)return;
    mesh.visible=side==='roof'?camera.position.y<height-.5:camera.position.x*side<width*.48;
  });});
  // Selection or view change: glide there (a cut under reduced motion or on a
  // resize). The first framing of a session is a short push-in.
  useEffect(()=>{
    const goal=hangarCameraGoal(view,viewLength,height,size.width,size.height);
    _goal.set(...goal.position);_goalTarget.set(...goal.target);
    camera.setViewOffset(size.width,size.height,goal.offset[0],goal.offset[1],size.width,size.height);camera.updateProjectionMatrix();
    const next=`${aircraft.id}|${view||'quarter'}`,previous=key.current;key.current=next;
    const c=controls.current,m=motion.current;
    if(readReducedMotion()||previous===next){
      glide.stop();camera.position.copy(_goal);look.copy(_goalTarget);camera.lookAt(look);
      if(c){c.enabled=true;c.target.copy(look);c.update();}
      if(previous!==next){m.yaw=0;m.homing=false;}
      return;
    }
    if(previous===null){
      _revealFrom.copy(_goal).sub(_goalTarget).multiplyScalar(cfg.reveal?.distance??1.28).add(_goalTarget);
      _revealFrom.y=Math.min(height*.85,_revealFrom.y*1.12);
      camera.position.copy(_revealFrom);look.copy(_goalTarget);camera.lookAt(look);
      glide.start(_revealFrom,_goalTarget,_goal,_goalTarget,{minSec:cfg.reveal?.seconds??1.7,maxSec:cfg.reveal?.seconds??1.7});
    }else glide.start(camera.position,c?c.target:look,_goal,_goalTarget,cfg.glide);
    if(c)c.enabled=false;
    m.homing=true;m.idle=0;
  },[camera,viewLength,height,view,aircraft.id,size.width,size.height,glide,look]);
  // A press on the canvas takes the camera back at once: the glide stops where
  // it is and the orbit controls (re-enabled in the capture phase, before
  // their own listener) start the drag from there.
  useEffect(()=>{
    const el=gl.domElement;
    const take=()=>{const c=controls.current,m=motion.current;m.idle=0;if(glide.active){glide.stop();if(c){c.target.copy(look);c.enabled=true;c.update();}}};
    el.addEventListener('pointerdown',take,{capture:true});el.addEventListener('wheel',take,{capture:true,passive:true});
    return()=>{el.removeEventListener('pointerdown',take,{capture:true});el.removeEventListener('wheel',take,{capture:true});};
  },[gl,glide,look]);
  const haze=useMemo(()=>{
    // A high sun beyond the open door: it lays a bright band across the floor
    // inside the door, and its shafts fall steeply through the doorway, so
    // they cross the frame from every orbit instead of pointing at the lens.
    const el=(cfg.sun?.elevationDeg??40)*Math.PI/180,az=(cfg.sun?.azimuthDeg??25)*Math.PI/180;
    const sun=new Vector3(-Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el)).multiplyScalar(length*2.4),axis=sun.clone().normalize().negate();
    const n=cheap?3:6,shafts=[];
    for(let i=0;i<n;i++){
      const start=[(i/(n-1)-.5)*width*.8,height*.96,depth/2-.3],len=Math.min(height*.9/Math.abs(axis.y),depth*1.2);
      shafts.push({start,axis:axis.toArray(),length:len,width:width*.8/n*(i%3?.75:1.15),color:'#ffe4bd',intensity:(cfg.haze?.shaft??.32)*(i%2?.7:1),seed:i*1.37});
    }
    const curtain={start:[0,0,depth/2-.4],axis:[0,1,0],length:height,width:width*.98,color:'#ffeedd',intensity:cfg.haze?.door??.16,seed:9,curtain:true};
    const materials=[...shafts,curtain].map(createShaftMaterial);
    const geometry=shaftGeometry();
    const motes=moteGeometry(cheap?60:140,shafts),moteMaterial=createMoteMaterial({color:'#fff1d6',size:cheap?1.8:2.1,intensity:cfg.haze?.dust??.6});
    return {sun:sun.toArray(),materials,geometry,motes,moteMaterial};
  },[width,height,depth,length,cheap]);
  useEffect(()=>()=>{haze.materials.forEach(m=>m.dispose());haze.geometry.dispose();haze.motes.dispose();haze.moteMaterial.dispose();},[haze]);
  useFrame((_,delta)=>{
    const dt=Math.min(delta,.1),m=motion.current,c=controls.current,reduced=readReducedMotion();
    if(glide.active){
      glide.step(dt,camera.position,look);camera.lookAt(look);
      if(!glide.active&&c){c.target.copy(look);c.enabled=true;c.update();}
    }
    if(!m.dragging)m.idle+=dt;
    if(m.homing||reduced){
      const d=Math.atan2(Math.sin(-m.yaw),Math.cos(-m.yaw));
      m.yaw=reduced?0:m.yaw+d*(1-Math.exp(-dt/.32));m.spin=0;
      if(reduced||Math.abs(d)<1e-3){m.yaw=0;m.homing=false;}
    }else{
      const want=!glide.active&&!m.dragging&&m.idle>turn.idleSec?turn.speed:0;
      m.spin+=(want-m.spin)*(1-Math.exp(-dt/(want>m.spin?1.4:.22)));
      // A portrait screen frames the aircraft three-quarter on: a full turn
      // would swing its length out of the frame, so it sways about the pose.
      if(size.width<size.height){
        const amp=turn.swayRad??.55;
        if(m.spin>1e-4&&!m.swaying){m.phase=Math.asin(Math.max(-1,Math.min(1,m.yaw/amp)));m.swaying=true;}
        if(m.swaying){m.phase+=m.spin/amp*dt;m.yaw=amp*Math.sin(m.phase);}
        if(m.spin<1e-4)m.swaying=false;
      }else m.yaw+=m.spin*dt;
    }
    if(turntable.current)turntable.current.rotation.y=m.yaw;
    if(!reduced)advanceHaze(haze,dt);
  });
  const [liveryLuma,setLiveryLuma]=useState(null);
  const exposure=EXPOSURE&&liveryLuma!==null?hangarExposureScale(liveryLuma,EXPOSURE):1;
  const spot=(from,to,e)=>Math.hypot(from[0]-to[0],from[1]-to[1],from[2]-to[2])**2*e*exposure;
  const aim=[0,viewLength*.1,0];
  const keyPos=[-width*.22,height*.92,-depth*.42],poolPos=[0,height-.6,0],rims=[[width*.3,height*.9,depth*.45],[-width*.34,height*.86,depth*.4]];
  const L=cfg.light??{};
  return <>
    <color attach="background" args={['#7d9fb4']}/>
    <fog attach="fog" args={['#a6bbc6',900,4000]}/>
    <Suspense fallback={null}><Environment files="/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr" background backgroundRotation={[0,2.6,0]} environmentIntensity={L.env??.5}/></Suspense>
    <hemisphereLight args={['#d6edff','#17212e',L.hemi??.3]}/>
    {/* Sun through the open door (the shadow caster), and the classic cool fill. */}
    <directionalLight name="hangar-stage-sun" position={haze.sun} intensity={(L.sun??3.6)*exposure} color="#ffe3b8" castShadow shadow-mapSize={[1024,1024]} shadow-camera-left={-width} shadow-camera-right={width} shadow-camera-top={width} shadow-camera-bottom={-width} shadow-camera-far={length*7} shadow-normalBias={.025} shadow-bias={-.0001}/>
    <directionalLight position={[-width,height,-depth]} intensity={L.fill??.55} color="#9aeaff"/>
    {/* Studio: a key from the camera side, a soft pool overhead, two rims from the door. */}
    <StageSpot name="hangar-stage-key" position={keyPos} aim={aim} angle={.55} penumbra={.75} decay={2} intensity={spot(keyPos,aim,L.key??2.6)} color="#f4f8ff"/>
    <StageSpot name="hangar-stage-pool" position={poolPos} aim={[0,0,0]} angle={Math.min(1.15,Math.atan(reach*.95/height))} penumbra={1} decay={2} intensity={spot(poolPos,[0,0,0],L.pool??1.2)} color="#fff4e6"/>
    {rims.map((p,i)=><StageSpot key={i} name="hangar-stage-rim" position={p} aim={aim} angle={.5} penumbra={.6} decay={2} intensity={spot(p,aim,(L.rim??4.5)*(i?.75:1))} color="#cfe8ff"/>)}
    <HangarExterior airport={airport} onLoaded={onExteriorReady}/>
    <group ref={cutaway} name="hangar-architecture">
      <mesh name="hangar-stage-floor" rotation-x={-Math.PI/2} position-y={-.025} receiveShadow><planeGeometry args={[width,depth]}/>
        {cheap?<meshStandardMaterial color="#4a5864" metalness={.12} roughness={.64}/>
          :<MeshReflectorMaterial resolution={hangarReflectorResolution(tier,EXPOSURE)} blur={[320,110]} mixBlur={.9} mixStrength={cfg.floor?.mixStrength??1.8} mixContrast={1.05} depthScale={.7} minDepthThreshold={.3} maxDepthThreshold={1.3} mirror={0} color={cfg.floor?.color??"#56636d"} metalness={cfg.floor?.metalness??.15} roughness={cfg.floor?.roughness??.58}/>}
      </mesh>
      <mesh castShadow userData={{cutawaySide:'roof'}} position={[0,height,0]}><boxGeometry args={[width,.7,depth]}/><meshStandardMaterial color="#172630" metalness={.5} roughness={.48}/></mesh>
      {[-1,1].map(side=><group key={side}>
        <mesh castShadow userData={{cutawaySide:side}} position={[side*width/2,height/2,0]}><boxGeometry args={[.65,height,depth]}/><meshStandardMaterial color="#1b303e" metalness={.4} roughness={.5}/></mesh>
        <mesh position={[side*(width/2-.6),height/2,depth/2]}><boxGeometry args={[1.2,height,1.5]}/><meshStandardMaterial color="#344e5c" metalness={.65}/></mesh>
        <mesh position={[side*(width/2-1.3),height/2,depth/2-.8]}><boxGeometry args={[.1,height*.92,.08]}/><meshBasicMaterial color="#a9edff" toneMapped={false}/></mesh>
        <mesh position={[side*width*.42,.012,0]} rotation-x={-Math.PI/2}><planeGeometry args={[.10,depth*.9]}/><meshBasicMaterial color="#76defb" toneMapped={false}/></mesh>
      </group>)}
      <mesh position={[0,height-.5,depth/2]}><boxGeometry args={[width,1.4,1.6]}/><meshStandardMaterial color="#233b49" metalness={.6}/></mesh>
      {Array.from({length:5},(_,i)=><group key={i} position={[0,0,-depth/2+i*depth/4]}>
        <mesh userData={{cutawaySide:'roof'}} position={[0,height-.6,0]}><boxGeometry args={[width,.5,.45]}/><meshStandardMaterial color="#0e1b26" metalness={.6}/></mesh>
        <mesh userData={{cutawaySide:'roof'}} position={[0,height-.92,0]}><boxGeometry args={[width*.64,.07,.16]}/><meshBasicMaterial color="#dbf4ff" toneMapped={false}/></mesh>
        {[-1,1].map(side=><mesh userData={{cutawaySide:side}} key={side} position={[side*(width/2-.6),height/2,0]}><boxGeometry args={[.55,height,.55]}/><meshStandardMaterial color="#111f2b" metalness={.5}/></mesh>)}
        <mesh position={[0,.001,0]} rotation-x={-Math.PI/2}><planeGeometry args={[width,.025]}/><meshBasicMaterial color="#4b626c"/></mesh>
      </group>)}
      <mesh rotation-x={-Math.PI/2} position-y={.007}><ringGeometry args={[viewLength*.66,viewLength*.66+.035,96,1,.2,Math.PI*1.6]}/><meshBasicMaterial color="#6ea2b7" transparent opacity={.65}/></mesh>
      <mesh position={[0,.008,-viewLength*.59]} rotation-x={-Math.PI/2}><planeGeometry args={[viewLength*.24,.09]}/><meshBasicMaterial color="#b3e8f4"/></mesh>
      {[-1,1].map(side=><group key={side} position={[side*width*.43,0,depth*.14]}>
        <mesh position={[0,.65,0]}><boxGeometry args={[1.8,1.3,3]}/><meshStandardMaterial color="#263b49" metalness={.65} roughness={.32}/></mesh>
        <mesh position={[0,1.33,0]}><boxGeometry args={[1.9,.07,3.1]}/><meshStandardMaterial color="#7596a3" metalness={.8}/></mesh>
      </group>)}
    </group>
    {/* Door light: haze shafts, a curtain of glow in the doorway, dust. */}
    <group name="hangar-stage-haze" renderOrder={2}>
      {haze.materials.map((material,i)=><mesh key={i} geometry={haze.geometry} material={material} frustumCulled={false} renderOrder={2}/>)}
      <points geometry={haze.motes} material={haze.moteMaterial} frustumCulled={false} renderOrder={3}/>
    </group>
    <group ref={turntable} name="hangar-stage-turntable">
      <ModelBoundary key={aircraft.id} onError={onError}><Suspense fallback={null}>
        <Aircraft aircraft={aircraft} onReady={onReady} onLuma={EXPOSURE?setLiveryLuma:undefined}/>
        <ContactShadows position={[0,.004,0]} opacity={.85} scale={width} blur={1.8} far={Math.min(height,viewLength*.25)} resolution={512} frames={1} color="#020713"/>
      </Suspense></ModelBoundary>
    </group>
    <OrbitControls ref={controls} target={[0,viewLength*.07,0]} minDistance={viewLength*.8} maxDistance={length*2.5} maxPolarAngle={Math.PI*.485} minPolarAngle={.25} enablePan={false} enableDamping dampingFactor={.1}
      onStart={()=>{motion.current.dragging=true;motion.current.idle=0;}} onEnd={()=>{motion.current.dragging=false;motion.current.idle=0;}}/>
  </>;
}
export function HangarScene({aircraft,airport,onReady,onError,onExteriorReady,view}){
  return <ModelBoundary onError={onError}>
    <Canvas shadows dpr={[1,1.5]} camera={{fov:42,near:.1,far:6000}} aria-label={`${aircraft.entry.name} in the open hangar at ${airport.id}; drag to inspect`}>
      {STAGE
        ?<StageBay aircraft={aircraft} airport={airport} onReady={onReady} onError={onError} onExteriorReady={onExteriorReady} view={view}/>
        :<Bay aircraft={aircraft} airport={airport} onReady={onReady} onError={onError} onExteriorReady={onExteriorReady} view={view}/>}
    </Canvas>
  </ModelBoundary>;
}

const previewReady=()=>{};
/** A stationary reward inspection using the same private model/material clone.
 * Demand rendering releases the GPU between drags; no extra scenery pipeline. */
export function RewardAircraftPreview({aircraft,onError=previewReady}) {
  const length=Math.max(12,aircraft.entry.targetLenM);
  return <ModelBoundary onError={onError}><Canvas frameloop="demand" dpr={[1,1.25]} camera={{position:[length*.65,length*.42,-length*1.4],fov:42,near:.1,far:600}} aria-label={`${aircraft.entry.name} wearing your earned livery; drag to inspect`}>
    <hemisphereLight args={['#d6edff','#233744',2]}/>
    <directionalLight position={[length,length,length]} intensity={3} color="#ffe6bb"/>
    <Suspense fallback={null}><Environment files="/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr" environmentIntensity={.65}/><Aircraft aircraft={aircraft} onReady={previewReady} earnedPreview/></Suspense>
    <OrbitControls target={[0,length*.07,0]} enablePan={false} enableZoom={false} enableDamping={false}/>
  </Canvas></ModelBoundary>;
}

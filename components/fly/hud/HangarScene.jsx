'use client';
import { Component, Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, OrbitControls, useGLTF } from '@react-three/drei';
import { HangarExterior } from './HangarExterior';
import { computeModelCorrection } from '@/lib/fly/model-loader';
import { operationsProfile } from '@/lib/fly/operations-profiles';
import { LandingGear } from '../LandingGear';
class ModelBoundary extends Component {
  state={error:false};
  static getDerivedStateFromError(){return {error:true};}
  componentDidCatch(){this.props.onError();}
  render(){return this.state.error?null:this.props.children;}
}
function Aircraft({aircraft,onReady}){
  const {scene}=useGLTF(aircraft.entry.url);
  const clone=useMemo(()=>{const object=scene.clone(true);object.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;const copy=m=>{const c=m.clone();c.vertexColors=!!o.geometry.attributes.color;return c;};o.material=Array.isArray(o.material)?o.material.map(copy):copy(o.material);}});return object;},[scene]);
  useEffect(()=>()=>clone.traverse(o=>{if(o.isMesh)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}),[clone]);
  const correction=useMemo(()=>computeModelCorrection(clone,aircraft.entry.targetLenM,aircraft.entry.yawFixRad),[clone,aircraft]);
  const p=operationsProfile(aircraft.id);
  useEffect(()=>{onReady(aircraft.id);},[onReady,aircraft.id,clone]);
  return <group position={[0,p?.clearance??2,0]}>
    <group position-y={p?.modelOffsetY??0}><group rotation-y={correction.rotY} scale={correction.scale}><primitive object={clone} dispose={null}/></group></group>
    <LandingGear flight={{speed:0}} aircraftId={aircraft.id} preview/>
  </group>;
}
function Bay({aircraft,airport,onReady,onError,onExteriorReady,view}){
  const length=Math.max(28,aircraft.entry.targetLenM),width=length*1.65,depth=length*1.5,height=Math.max(13,length*.4);
  const viewLength=Math.max(15,aircraft.entry.targetLenM),cutaway=useRef(),controls=useRef();
  const {camera,size}=useThree();
  useFrame(()=>{cutaway.current?.traverse(mesh=>{const side=mesh.userData.cutawaySide;if(side===undefined)return;
    mesh.visible=side==='roof'?camera.position.y<height-.5:camera.position.x*side<width*.48;
  });});
  useEffect(()=>{
    const positions={quarter:[.65,.46,-1.35],front:[0,.25,-1.65],side:[1.65,.32,.08],rear:[-.62,.36,1.5]};
    const portrait=size.width<size.height;
    const distanceScale=portrait?(viewLength>25?1.8:1.55):1;
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
export function HangarScene({aircraft,airport,onReady,onError,onExteriorReady,view}){
  return <ModelBoundary onError={onError}>
    <Canvas shadows dpr={[1,1.5]} camera={{fov:42,near:.1,far:6000}} aria-label={`${aircraft.entry.name} in the open hangar at ${airport.id}; drag to inspect`}>
      <Bay aircraft={aircraft} airport={airport} onReady={onReady} onError={onError} onExteriorReady={onExteriorReady} view={view}/>
    </Canvas>
  </ModelBoundary>;
}

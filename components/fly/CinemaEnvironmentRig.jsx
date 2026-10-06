'use client';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, CubeUVReflectionMapping, HalfFloatType, Mesh, OrthographicCamera, PlaneGeometry, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, WebGLRenderTarget } from 'three';
import { CINEMA_GLSL, CINEMA_UNIFORMS, cinemaEnvironment } from '@/lib/fly/cinema-frame';
import { PHYS_SKY_TEXT_ACTIVE } from '@/lib/fly/cinema-sky';
import { isMobileGraphicsClass } from '@/lib/fly/device-class';
import {registerCinemaResources} from '@/lib/fly/cinema-resources';

// PHYS_SKY: the lower hemisphere is lit ground (albedo x sun + sky
// irradiance) instead of a near-black fill, which lit the aircraft bellies
// at 5% of the horizon. Flag off: the legacy text, unchanged.
const LOWER_HEMISPHERE = PHYS_SKY_TEXT_ACTIVE ? 'uPskyGround' : 'uCinemaFill*.045';

/** A fixed-size, owned environment. Visible sky and IBL evaluate identical radiance. */
export function CinemaEnvironmentRig({runtime}) {
  const gl=useThree(s=>s.gl),scene=useThree(s=>s.scene),rig=useRef(null);
  useEffect(()=>{
    const previous={environment:scene.environment,intensity:scene.environmentIntensity};
    const sky=new Scene(),geometry=new SphereGeometry(10,24,12);
    const material=new ShaderMaterial({side:BackSide,depthWrite:false,toneMapped:false,uniforms:CINEMA_UNIFORMS,
      vertexShader:'varying vec3 direction; void main(){direction=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader:`varying vec3 direction;${CINEMA_GLSL}\nvoid main(){vec3 ray=normalize(direction);vec3 c=cinemaSky(ray);if(ray.y<0.)c=mix(c,${LOWER_HEMISPHERE},1.-smoothstep(-.55,0.,ray.y));gl_FragColor=vec4(c,1.);}`});
    sky.add(new Mesh(geometry,material));
    const pmrem=new PMREMGenerator(gl),blendScene=new Scene(),camera=new OrthographicCamera(-1,1,1,-1,0,1);
    const quadGeometry=new PlaneGeometry(2,2),blend=new ShaderMaterial({depthTest:false,depthWrite:false,toneMapped:false,
      uniforms:{a:{value:null},b:{value:null},amount:{value:1}},
      vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader:'varying vec2 vUv;uniform sampler2D a,b;uniform float amount;void main(){gl_FragColor=mix(texture2D(a,vUv),texture2D(b,vUv),amount);}'});
    blendScene.add(new Mesh(quadGeometry,blend));
    const next={sky,pmrem,blendScene,camera,blend,current:null,next:null,display:null,elapsed:0,last:-Infinity,signature:null,fade:1,size:isMobileGraphicsClass()?128:256};
    rig.current=next;
    const release=registerCinemaResources('sky-environment',()=>({current:next.current,next:next.next,display:next.display}));
    const lost=()=>{
      next.lost=true;scene.environment=null;
      next.current?.dispose();next.next?.dispose();next.display?.dispose();next.pmrem.dispose();
      next.current=next.next=next.display=null;next.pmrem=null;
    };
    const restore=()=>{next.pmrem=new PMREMGenerator(gl);next.signature=null;next.last=-Infinity;next.lost=false;};
    gl.domElement.addEventListener('webglcontextlost',lost);
    gl.domElement.addEventListener('webglcontextrestored',restore);
    return()=>{release();scene.environment=previous.environment;scene.environmentIntensity=previous.intensity;
      gl.domElement.removeEventListener('webglcontextlost',lost);
      gl.domElement.removeEventListener('webglcontextrestored',restore);
      next.current?.dispose();next.next?.dispose();next.display?.dispose();next.pmrem?.dispose();material.dispose();geometry.dispose();blend.dispose();quadGeometry.dispose();rig.current=null;delete runtime.cinemaIBL;};
  },[gl,scene,runtime]);
  useFrame((_,dt)=>{
    const r=rig.current;if(!r||r.lost||!runtime.cinemaEnvironment)return;
    const e=cinemaEnvironment;r.elapsed+=Math.min(dt,.1);
    const signature=[...e.horizon,...e.zenith,...e.keyDir,e.overcast];
    const changed=!r.signature||signature.some((v,i)=>Math.abs(v-r.signature[i])>.012);
    if(!r.next&&changed&&r.elapsed-r.last>=2){
      const baked=r.pmrem.fromScene(r.sky,0,.1,30,{size:r.size});r.last=r.elapsed;r.signature=signature;
      if(!r.current){r.current=baked;r.display=new WebGLRenderTarget(baked.width,baked.height,{type:HalfFloatType,depthBuffer:false});r.display.texture.mapping=CubeUVReflectionMapping;r.display.texture.name='cinema-environment';}
      else r.next=baked;
      r.fade=r.next?0:1;r.dirty=true;
    }
    if(r.current){
      r.fade=Math.min(1,r.fade+dt/1.2);
      r.blend.uniforms.a.value=r.current.texture;r.blend.uniforms.b.value=(r.next||r.current).texture;r.blend.uniforms.amount.value=r.fade;
      if(r.next||r.dirty){
        const previous=gl.getRenderTarget();
        try{gl.setRenderTarget(r.display);gl.render(r.blendScene,r.camera);}
        finally{gl.setRenderTarget(previous);}
        r.dirty=false;
      }
      scene.environment=r.display.texture;scene.environmentIntensity=e.environment;
      if(r.next&&r.fade>=1){r.current.dispose();r.current=r.next;r.next=null;}
      runtime.cinemaIBL={size:r.size,width:r.display.width,height:r.display.height,blending:!!r.next};
    }
  },-.8);
  return null;
}

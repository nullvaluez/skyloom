'use client';

import { useEffect, useRef, useState } from 'react';
import { addAfterEffect, useFrame, useThree } from '@react-three/fiber';
import { DirectionalLight, HemisphereLight, MathUtils, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Quaternion, Scene, Vector3 } from 'three';
import { buildF35Interior } from '@/lib/fly/f35-interior';
import { createPilotDisplays } from '@/lib/fly/pilot-displays';
import { useFlyStore } from '@/stores/fly-store';

export function F35Interior(props) {
  // Outside-only flights do not allocate the panel, textures or geometry.
  // Keep a visited cockpit warm for subsequent cuts within this airframe.
  const [visited, setVisited] = useState(() => useFlyStore.getState().f35PilotSeat);
  useEffect(() => {
    if (visited) return;
    return useFlyStore.subscribe(s => s.f35PilotSeat, selected => {
      if (selected) setVisited(true);
    }, { fireImmediately: true });
  }, [visited]);
  return visited ? <PilotInteriorPass {...props} /> : null;
}

/** A second depth range on the existing canvas. Only the centimetre-scale
 * interior uses it. World depth, postprocessing, and terrain LOD keep using
 * the normal flight projection on both conventional and reversed depth. */
function PilotInteriorPass({ runtime, pilot }) {
  const gl = useThree(s => s.gl);
  const camera = useThree(s => s.camera);
  const outside = useThree(s => s.scene);
  const framePending = useRef(false);
  useFrame(() => { framePending.current = pilot.active; }, -29);
  useEffect(() => {
    const scene = new Scene();
    const optical = new PerspectiveCamera(62, 1, .016, 14);
    const fill = new HemisphereLight('#c8dbeb', '#8c8175', 1.32);
    const sun = new DirectionalLight('#fff0d6', 2.0);
    const bounce = new DirectionalLight('#b1c8d6', .60);
    bounce.position.set(-.4,.8,1);
    scene.add(fill,sun,bounce);
    const compact = Math.min(gl.domElement.clientWidth, gl.domElement.clientHeight) < 600;
    const displays = createPilotDisplays(compact);
    const interior = buildF35Interior(scene, displays);
    // The bow casts across the instrument tray as the aircraft turns. Its
    // shadow fits this one-metre space and is reused between lighting changes.
    sun.castShadow = !compact;
    sun.target.position.set(0,-.36,-.52);
    scene.add(sun.target);
    sun.shadow.mapSize.set(1024,1024);
    Object.assign(sun.shadow.camera,{left:-1.25,right:1.25,top:1.25,bottom:-1.25,near:.15,far:6});
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias=.0018;
    sun.shadow.autoUpdate=false;
    const direction = new Vector3(), shadowDirection = new Vector3();
    scene.traverse(object => {
      if (!object.isMesh || object.material.transparent) return;
      object.receiveShadow = true;
      object.castShadow = object.material !== interior.panel && !object.material.alphaTest;
    });
    const visor = new Mesh(new PlaneGeometry(1,206/520), new MeshBasicMaterial({
      map:displays.hud.texture, transparent:true, depthTest:false, depthWrite:false, toneMapped:false,
    }));
    visor.renderOrder=3;
    visor.position.set(0,.18,-1);
    optical.add(visor); scene.add(optical);
    pilot.setInteriorReady(true);
    const inverse = new Quaternion();
    let lastDraw = -1, nextDisplay = -1;
    const paint = addAfterEffect((now) => {
      if (!framePending.current || !pilot.active) return;
      framePending.current = false;
      const main = gl.__flyMainDraw;
      if (main?.enabled && main.frames === lastDraw) return;
      lastDraw = main?.frames;
      if (optical.aspect !== camera.aspect || optical.fov !== camera.fov) {
        optical.aspect = camera.aspect; optical.fov = camera.fov;
        optical.updateProjectionMatrix();
      }
      const visorWidth = MathUtils.clamp(2*Math.tan(camera.fov*Math.PI/360)*camera.aspect*.62,.67,compact ? .90 : .68);
      visor.scale.setScalar(visorWidth);
      if (now >= nextDisplay) {
        displays.update(runtime,pilot.world,visorWidth,visor.position.y);
        nextDisplay = now + (compact ? 100 : 65);
      }
      optical.quaternion.copy(pilot.head);
      const sky = runtime.sun;
      const elevation = MathUtils.clamp(sky?.sinEl ?? .72, -1, 1);
      const day = MathUtils.smoothstep(elevation,-.12,.25);
      const az = sky?.az ?? -.8, horizontal = Math.sqrt(1 - elevation * elevation);
      inverse.copy(pilot.body).invert();
      direction.set(-Math.sin(az)*horizontal, elevation, Math.cos(az)*horizontal).applyQuaternion(inverse);
      sun.position.copy(sun.target.position).addScaledVector(direction,3);
      if (sun.castShadow && direction.dot(shadowDirection)<.9998) {
        sun.shadow.needsUpdate=true;
        shadowDirection.copy(direction);
      }
      fill.position.set(0,1,0).applyQuaternion(inverse);
      sun.intensity = .06 + 2.65 * day;
      fill.intensity = .24 + 1.30 * day;
      bounce.color.setRGB(.36+.32*day,.62+.16*day,.56+.30*day);
      bounce.intensity = .30 + .32 * day;
      interior.panel.emissiveIntensity = .39 + .57 * day;
      visor.material.opacity = .52 + .46 * day;
      const cmd = pilot.command;
      if (cmd) {
        interior.stick.rotation.set((cmd.pitch ?? 0)*.14,0,-(cmd.turn ?? 0)*.14);
        const ops = runtime.operations;
        const thrust = ops?.lowSpeed ? ops.throttle : cmd.boost || cmd.speedPreset === 'boost' ? 1 : cmd.speedPreset === 'slow' ? .15 : .55;
        interior.throttle.rotation.x = .39 - .72*thrust;
      }
      scene.environment = outside.environment;
      scene.environmentIntensity = (.20 + .90 * day) * Math.min(2, outside.environmentIntensity ?? 1);
      scene.environmentRotation.setFromQuaternion(inverse);
      const autoClear = gl.autoClear, currentTarget = gl.getRenderTarget(), autoReset = gl.info.autoReset;
      try {
        gl.setRenderTarget(null);
        gl.autoClear = false;
        gl.info.autoReset = false;
        gl.state.buffers.depth.setMask(true);
        gl.clearDepth();
        gl.render(scene,optical);
      } finally {
        gl.autoClear = autoClear;
        gl.info.autoReset = autoReset;
        gl.setRenderTarget(currentTarget);
      }
    });
    return () => {
      pilot.setInteriorReady(false);
      paint();
      displays.dispose();
      sun.shadow.dispose();
      for (const map of interior.maps) map.dispose();
      const materials = new Set();
      scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); materials.add(o.material); } });
      for (const material of materials) material.dispose();
      scene.clear();
    };
  }, [camera, gl, outside, pilot, runtime]);
  return null;
}

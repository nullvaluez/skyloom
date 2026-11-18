'use client';

import { useEffect, useRef } from 'react';
import { addAfterEffect, useFrame, useThree } from '@react-three/fiber';
import { DirectionalLight, HemisphereLight, MathUtils, PerspectiveCamera, Quaternion, Scene } from 'three';
import { buildF35Interior } from '@/lib/fly/f35-interior';
import { createPilotDisplays } from '@/lib/fly/pilot-displays';

/** A second depth range on the existing canvas. Only the centimetre-scale
 * interior uses it. World depth, postprocessing, and terrain LOD keep using
 * the normal flight projection on both conventional and reversed depth. */
export function F35Interior({ runtime, pilot }) {
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
    const displays = createPilotDisplays();
    const maps = buildF35Interior(scene, displays);
    const inverse = new Quaternion();
    let lastDraw = -1, nextDisplay = -1;
    const paint = addAfterEffect((now) => {
      if (!framePending.current || !pilot.active) return;
      framePending.current = false;
      const main = gl.__flyMainDraw;
      if (main?.enabled && main.frames === lastDraw) return;
      lastDraw = main?.frames;
      if (now >= nextDisplay) { displays.update(runtime); nextDisplay = now + 110; }
      if (optical.aspect !== camera.aspect || optical.fov !== camera.fov) {
        optical.aspect = camera.aspect; optical.fov = camera.fov;
        optical.updateProjectionMatrix();
      }
      optical.quaternion.copy(pilot.head);
      const sky = runtime.sun;
      const elevation = MathUtils.clamp(sky?.sinEl ?? .72, -1, 1);
      const day = MathUtils.smoothstep(elevation,-.12,.25);
      const az = sky?.az ?? -.8, horizontal = Math.sqrt(1 - elevation * elevation);
      sun.position.set(-Math.sin(az)*horizontal, elevation, Math.cos(az)*horizontal)
        .applyQuaternion(inverse.copy(pilot.body).invert());
      sun.intensity = .12 + 2.38 * day;
      fill.intensity = .27 + 1.45 * day;
      bounce.intensity = .23 + .42 * day;
      scene.environment = outside.environment;
      scene.environmentIntensity = (.20 + .90 * day) * Math.min(2, outside.environmentIntensity ?? 1);
      scene.environmentRotation.setFromQuaternion(inverse.copy(pilot.body).invert());
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
      paint();
      displays.dispose();
      for (const map of maps) map.dispose();
      scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      scene.clear();
    };
  }, [camera, gl, outside, pilot, runtime]);
  return null;
}

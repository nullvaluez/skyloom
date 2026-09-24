'use client';

import { useEffect } from 'react';
import { useEnvironment } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { PMREMGenerator } from 'three';

/** Same HDR and conversion as EnvironmentCube, with an owned scratch target.
 * Automatic conversion retains 24 MiB until renderer disposal, even after
 * leaving Neon. Satellite already owns a separate PMREM generator.
 */
export function NeonEnvironment({ files, background = false, environmentIntensity = 1, backgroundIntensity = 1 }) {
  const texture = useEnvironment({ files });
  const { scene, gl } = useThree();
  // Satellite releases its generator in a passive cleanup. React runs those
  // cleanups before passive mounts; a layout bake overlaps both style budgets.
  useEffect(() => {
    const previous = {
      environment: scene.environment, background: scene.background,
      environmentIntensity: scene.environmentIntensity, backgroundIntensity: scene.backgroundIntensity,
      environmentRotation: scene.environmentRotation.clone(), backgroundRotation: scene.backgroundRotation.clone(),
      backgroundBlurriness: scene.backgroundBlurriness,
    };
    const generator = new PMREMGenerator(gl);
    const target = generator.fromEquirectangular(texture);
    // The converted output is independent of the scratch target.
    generator.dispose();
    scene.environment = target.texture;
    if (background) scene.background = texture;
    scene.environmentIntensity = environmentIntensity;
    scene.backgroundIntensity = backgroundIntensity;
    scene.environmentRotation.set(0, 0, 0);
    scene.backgroundRotation.set(0, 0, 0);
    scene.backgroundBlurriness = 0;
    return () => {
      if (scene.environment === target.texture) scene.environment = previous.environment;
      if (background && scene.background === texture) scene.background = previous.background;
      scene.environmentIntensity = previous.environmentIntensity;
      scene.backgroundIntensity = previous.backgroundIntensity;
      scene.environmentRotation.copy(previous.environmentRotation);
      scene.backgroundRotation.copy(previous.backgroundRotation);
      scene.backgroundBlurriness = previous.backgroundBlurriness;
      target.dispose();
      texture.dispose(); // same cleanup as EnvironmentCube; CPU data stays cached
    };
  }, [scene, gl, texture, background, environmentIntensity, backgroundIntensity]);
  return null;
}

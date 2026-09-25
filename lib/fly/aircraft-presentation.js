import { AdditiveBlending, Box3, BufferAttribute, BufferGeometry, Color, DoubleSide, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { playerEngineOffsets } from './aircraft-effects.js';

/** Capture in the unmounted clone's corrected frame. Swept-wing lights and
 * vapor use actual outer-wing vertices, rather than empty bounding-box corners.
 * No mutation of the cached GLTF scene, geometry, textures or materials. */
export function measureAircraftAnchors(model, correction, id) {
  model.updateMatrixWorld(true);
  const transform = new Matrix4().makeRotationY(correction.rotY)
    .multiply(new Matrix4().makeScale(correction.scale, correction.scale, correction.scale));
  const box = new Box3().setFromObject(model).applyMatrix4(transform);
  const center = box.getCenter(new Vector3()), size = box.getSize(new Vector3());
  const tips = [new Vector3(), new Vector3()], counts = [0, 0], v = new Vector3(), matrix = new Matrix4();
  model.traverse(o => {
    if (!o.isMesh || !o.geometry?.attributes.position) return;
    matrix.multiplyMatrices(transform, o.matrixWorld);
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      const side = v.x < box.min.x + size.x * .018 ? 0 : v.x > box.max.x - size.x * .018 ? 1 : -1;
      if (side >= 0) { tips[side].add(v); counts[side]++; }
    }
  });
  return { id, size, center, box,
    tips: tips.map((p, i) => (counts[i] ? p.divideScalar(counts[i]) : p.copy(center)).toArray()),
    engines: playerEngineOffsets(id).map(([x, y, z]) => [x + center.x, y + center.y, z + center.z]),
  };
}

/** Circular lights with a white-hot center and a soft halo, not square Points.
 * gl_PointCoord is available without a texture; one draw for the whole rig. */
export function softenAircraftLights(material) {
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
float lightR = length(gl_PointCoord - .5) * 2.0;
float halo = exp(-5.0 * lightR * lightR) * (1.0 - smoothstep(.7, 1.0, lightR));
diffuseColor.a *= halo;
diffuseColor.rgb += vec3(.32) * max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) * pow(max(0.0, 1.0 - lightR * 4.0), 2.0);`);
  };
  material.customProgramCacheKey = () => 'aircraft-light-halo-v1';
}

/** Two crossed, feathered sheets per nozzle, all merged into ONE draw.
 * The jet is open at the nozzle and narrows downstream; analytic shock cells
 * and a moving shear layer replace the old solid orange cone. */
export function createEngineExhaust(stations, scale = 1) {
  const positions = [], uvs = [], indices = [], length = 12 * scale, radius = .8 * scale;
  for (const [x, y, z] of stations) for (let axis = 0; axis < 2; axis++) {
    const start = positions.length / 3;
    for (let j = 0; j <= 12; j++) {
      const t = j / 12, w = radius * (1 - t * .84);
      for (const sign of [-1, 1]) {
        positions.push(x + (axis ? 0 : sign * w), y + (axis ? sign * w : 0), z + t * length);
        uvs.push(sign, t);
      }
      if (j < 12) { const v = start + j * 2; indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    }
  }
  // Circular nozzle cores retain a readable glow when looking straight down
  // the exhaust axis, where both crossed sheets are edge-on.
  for (const [x, y, z] of stations) {
    const start = positions.length / 3;
    positions.push(x, y, z + .03); uvs.push(0, 0);
    for (let i = 0; i <= 16; i++) {
      const a = i / 16 * Math.PI * 2;
      positions.push(x + Math.cos(a) * radius, y + Math.sin(a) * radius, z + .03); uvs.push(1, 0);
      if (i < 16) indices.push(start, start + i + 1, start + i + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('aExhaust', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  const uniforms = { uExhaustTime: { value: 0 }, uExhaustPower: { value: 0 } };
  const material = new MeshBasicMaterial({ color: new Color('#c6dcff'), transparent: true, blending: AdditiveBlending,
    side: DoubleSide, depthWrite: false, toneMapped: false, fog: false });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aExhaust; varying vec2 vExhaust;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvExhaust = aExhaust;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vExhaust; uniform float uExhaustTime; uniform float uExhaustPower;')
      .replace('#include <color_fragment>', `#include <color_fragment>
float along = vExhaust.y;
float shear = sin(along * 62.0 - uExhaustTime * 18.0) * .05 * along;
float radial = abs(vExhaust.x + shear);
float core = exp(-7.0 * radial * radial);
float cells = pow(max(0.0, cos(along * 31.0)), 8.0);
float reach = .12 + .88 * uExhaustPower;
float fade = 1.0 - smoothstep(reach * .45, reach, along);
diffuseColor.rgb = mix(vec3(.35,.32,1.0), vec3(1.0,.48,.13), smoothstep(.12,.8,along));
diffuseColor.rgb += vec3(.65,.8,1.0) * core * (.7 + .8 * cells);
diffuseColor.a = (1.0 - smoothstep(.4,1.0,radial)) * fade * uExhaustPower * (.5 + .35 * core);`);
  };
  material.customProgramCacheKey = () => 'aircraft-exhaust-cells-v1';
  const mesh = new Mesh(geometry, material); mesh.name = 'player-engine-exhaust'; mesh.frustumCulled = false; mesh.visible = false;
  return { mesh, uniforms, dispose() { geometry.dispose(); material.dispose(); } };
}

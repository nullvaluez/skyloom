import {
  BufferGeometry, DoubleSide, Float32BufferAttribute, Mesh, MeshPhysicalMaterial,
  SRGBColorSpace, TextureLoader,
} from 'three';

// The cross-section runs from the far seam over the crown to the face nearest
// the pilot. The worn portion of the leather wraps the part's actual rolled lip.
const bolster = [
  [-.39,-.092,.77,0],[-.30,-.042,.87,.16],[-.22,-.017,.94,.30],
  [-.12,-.005,.985,.46],[-.052,0,1,.59],[.004,-.002,1,.69],
  [.026,-.008,1,.76],[.040,-.017,1,.82],[.046,-.031,1,.88],
  [.043,-.045,1,.93],[.027,-.070,1,1],
];

function skin(scene, material, columns, rows, sample) {
  const positions = [], uvs = [], colors = [], index = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i <= columns; i++) {
      const u = i / columns;
      const { p, v, ambient } = sample(u,j);
      positions.push(...p);
      uvs.push(u,1-v);
      colors.push(ambient,ambient,ambient);
      if (i && j) {
        const d = j * (columns+1) + i, a = d - columns - 2;
        index.push(a,a+1,d-1,a+1,d,d-1);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position',new Float32BufferAttribute(positions,3));
  geo.setAttribute('uv',new Float32BufferAttribute(uvs,2));
  geo.setAttribute('color',new Float32BufferAttribute(colors,3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  scene.add(new Mesh(geo,material));
}

export function fitServiceFinishes(scene, crown, bow) {
  const loader = new TextureLoader();
  const maps = [];
  function material(name, {color, ...options}) {
    const finish = new MeshPhysicalMaterial({color:0x25282a,vertexColors:true,side:DoubleSide,...options});
    let alive = true;
    finish.addEventListener('dispose',() => { alive = false; });
    const map = loader.load('/materials/cockpit-v1/' + name + '.webp',() => {
      if (!alive) return;
      finish.map = map;
      finish.color.setHex(color);
      finish.needsUpdate = true;
    });
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 4;
    maps.push(map);
    return finish;
  }
  const hide = material('coaming',{color:0xa8a19a,roughness:.64,metalness:.02,
    clearcoat:.15,clearcoatRoughness:.48});
  const enamel = material('edge',{color:0xa6aaad,roughness:.49,metalness:.42,
    clearcoat:.21,clearcoatRoughness:.39});
  skin(scene,hide,64,bolster.length,(u,j) => {
    const [dz,dy,spread,v] = bolster[j], x = (2*u-1)*.68;
    const p = [x*spread,crown(x)+dy,-.89+dz-.040*(1-(x/.68)**2)];
    return {p,v,ambient:.62+.38*Math.sin(Math.PI*Math.min(.95,v+.1))};
  });

  // This rim remains in view during a side glance. The original machined
  // fixings and rubber gasket sit proud of the paint.
  const bowSection = [[.729,.925,.014],[.733,.929,.023],[.747,.945,.028],[.760,.961,.027],[.769,.972,.016]];
  skin(scene,enamel,74,bowSection.length,(u,j) => {
    const [rx,ry,z] = bowSection[j];
    return {p:bow((u-.5)*Math.PI,rx,ry,z),v:j/4,ambient:j===0?.64:.97};
  });
  return maps;
}

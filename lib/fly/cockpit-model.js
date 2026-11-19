import {
  BoxGeometry, BufferGeometry, CanvasTexture, CatmullRomCurve3, CircleGeometry, Color,
  CylinderGeometry, DoubleSide, Euler, Float32BufferAttribute, Group, LinearFilter,
  Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
  SRGBColorSpace, TubeGeometry, Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applyCockpitSurface, cockpitFinishMap } from './cockpit-finishes.js';
import { makeInstrumentAtlas } from './cockpit-instruments.js';

const origin = [0, 0, 0];
const white = '#ffffff';
const up = new Vector3(0, 1, 0);
const point = p => new Vector3(...p);

// Keep the optical pass small. Even a four-engine panel with hundreds of
// individual knobs, scales and screws costs one draw per finish and pivot.
export function createCockpitModel(scene, compact) {
  const instruments = makeInstrumentAtlas(compact);
  const maps = [];
  const mat = (roughness, metalness) => new MeshStandardMaterial({ vertexColors:true, side:DoubleSide, roughness, metalness });
  const materials = {
    paint: mat(.63, .15), rubber: mat(.87, .025), alloy: mat(.34, .68),
    cloth: mat(.94, .01), leather: mat(.66, .035),
    glass: new MeshPhysicalMaterial({ vertexColors:true, side:DoubleSide, roughness:.11,
      metalness:.17, clearcoat:1, transparent:true, opacity:.10, depthWrite:false }),
    lettering: new MeshStandardMaterial({ vertexColors:true, side:DoubleSide, roughness:.72, alphaTest:.19 }),
    dial: mat(.6, .035), display: mat(.34, .04),
    hud: new MeshStandardMaterial({ side:DoubleSide, transparent:true, depthWrite:false, toneMapped:false }),
  };
  // Paint colour belongs to the airframe. Reuse the grain of the graphite
  // F-35 scans without dyeing an ivory sailplane tub or a tan cargo deck black.
  maps.push(applyCockpitSurface(materials.paint, 'fascia', .00045, false),
    applyCockpitSurface(materials.rubber, 'grip', .00060, false),
    applyCockpitSurface(materials.cloth, 'twill', .00084, false));
  for (const type of ['alloy','leather']) {
    const map = cockpitFinishMap(type === 'leather');
    materials[type].map = materials[type].bumpMap = map;
    materials[type].bumpScale = type === 'leather' ? .00054 : .00016;
    maps.push(map);
  }
  materials.paint.map = materials.alloy.map;
  materials.cloth.map = materials.rubber.map = materials.leather.map;
  const letterCells = new Map(), faces = [];
  const controls = { stick: [], yoke: [], throttle: [], plunger: [] };
  const batches = new Map();
  const local = new Object3D(), color = new Color();
  function toolkit(parent, frame) {
    if (!batches.has(parent)) batches.set(parent, new Map());
    const bins = batches.get(parent);
    function add(type, tint, geo, position = origin, rotation = origin, uvRect) {
      local.position.fromArray(position);
      local.rotation.set(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0);
      local.updateMatrix();
      geo.applyMatrix4(new Matrix4().multiplyMatrices(frame, local.matrix));
      const g = geo.index ? geo.toNonIndexed() : geo;
      if (g !== geo) geo.dispose();
      const pos = g.attributes.position;
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) g.setAttribute('uv', new Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
      const {normal, uv} = g.attributes;
      const rgb = new Float32Array(pos.count * 3);
      color.set(tint);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const shade = uvRect ? 1 : .77 + .23 * Math.min(1, Math.max(0, y + 1));
        rgb[3*i] = color.r * shade;
        rgb[3*i+1] = color.g * shade;
        rgb[3*i+2] = color.b * shade;
        if (uvRect) {
          uv.setXY(i, uvRect[0] + uv.getX(i)*uvRect[2], uvRect[1] + uv.getY(i)*uvRect[3]);
        } else {
          const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
          uv.setXY(i, (nx > ny && nx > nz ? z : x) * 4, (ny > nx && ny > nz ? z : y) * 4);
        }
      }
      g.setAttribute('color', new Float32BufferAttribute(rgb, 3));
      if (!bins.has(type)) bins.set(type, []);
      bins.get(type).push(g);
    }
    const k = {
      frame(p, r, draw) {
        const m = new Matrix4().makeRotationFromEuler(new Euler(...r)).setPosition(...p);
        draw(toolkit(parent, new Matrix4().multiplyMatrices(frame, m)));
      },
      box(type, tint, p, size, r = origin, bevel = .004) {
        const g = bevel ? new RoundedBoxGeometry(...size, 1, Math.min(bevel, Math.min(...size)*.45)) : new BoxGeometry(...size);
        add(type, tint, g, p, r);
      },
      rod(type, tint, a, b, radius, sides = 10, endRadius = radius) {
        const start = point(a), delta = point(b).sub(start), length = delta.length();
        if (length < .000001) return;
        const g = new CylinderGeometry(endRadius, radius, length, sides);
        g.applyQuaternion(local.quaternion.setFromUnitVectors(up, delta.normalize()));
        add(type, tint, g, start.addScaledVector(delta, length/2).toArray());
      },
      tube(type, tint, points, radius, segments = 24, radial = 8) {
        const g = new TubeGeometry(new CatmullRomCurve3(points.map(point)), segments, radius, radial);
        add(type, tint, g);
      },
      skin(type, tint, rows, smooth = false) {
        const indices = [], columns = rows[0].length;
        for (let j = 1; j < rows.length; j++) {
          for (let i = 1; i < columns; i++) {
            const a = (j-1)*columns+i-1, b = a+columns;
            indices.push(a,a+1,b,a+1,b+1,b);
          }
        }
        const g = new BufferGeometry();
        g.setAttribute('position', new Float32BufferAttribute(rows.flat(2), 3));
        g.setIndex(indices);
        if (smooth) g.computeVertexNormals();
        add(type, tint, g);
      },
      label(words, p, size, r = origin, tint = '#e3dfcd') {
        const key = words + '|' + (size[0]/size[1]).toFixed(1);
        if (!letterCells.has(key)) letterCells.set(key, { words, aspect:size[0]/size[1], index:letterCells.size });
        faces.push({ add, p, size, r, tint, label:letterCells.get(key) });
      },
      gauge(kind, p, diameter, opts = {}) {
        k.frame(p, opts.rotation || origin, f => {
          const d = diameter;
          f.box('paint','#343938',[0,0,-.003],[d*1.065,d*1.065,.009],origin,d*.09);
          for(const sx of [-1,1]) for(const sy of [-1,1]) {
            const x=sx*d*.43, y=sy*d*.43;
            f.rod('alloy','#7b7c70',[x,y,.001],[x,y,.0036],d*.031,8);
            f.box('rubber','#353430',[x,y,.0039],[d*.044,d*.009,.0006],[0,0,sx*sy*.56],0);
          }
          f.rod('rubber', '#171a19', [0,0,-.009], [0,0,.004], d*.53, 32);
          f.rod('alloy', '#555957', [0,0,.004], [0,0,.007], d*.50, 36, d*.49);
          f.rod('paint', '#252826', [0,0,.007], [0,0,.009], d*.477, 36);
        });
        const face = instruments.register(kind, opts, true);
        faces.push({add, p, r:opts.rotation || origin, size:[diameter*.92,diameter*.92], face, dial:true, lift:.0093});
      },
      screen(kind, p, size, opts = {}) {
        k.frame(p, opts.rotation || origin, f => {
          f.box('rubber', '#141a1d', [0,0,-.004], [size[0]+.028,size[1]+.028,.028], origin, .008);
          f.box('paint', '#30383a', [0,0,.006], [size[0]+.012,size[1]+.012,.011], origin, .005);
        });
        const face = instruments.register(kind, {...opts,aspect:size[0]/size[1]}, false);
        faces.push({add, p, size, r:opts.rotation || origin, face, lift:.012});
      },
      hud(p, size, opts = {}) {
        const face = instruments.register('hud', opts, false);
        faces.push({add, p, size, r:opts.rotation || origin, face, hud:true});
      },
      control(which, pivot, draw) {
        const group = new Group();
        group.name = which;
        frame.decompose(group.position, group.quaternion, group.scale);
        group.position.copy(point(pivot).applyMatrix4(frame));
        parent.add(group);
        const joint = new Group();
        group.add(joint);
        controls[which].push(joint);
        draw(toolkit(joint, new Matrix4()));
      },
    };
    return k;
  }
  const kit = toolkit(scene, new Matrix4());
  function finish() {
    const cols = 4, cellW = 256, cellH = 40;
    const rows = Math.max(1, Math.ceil(letterCells.size / cols));
    const canvas = document.createElement('canvas');
    canvas.width = cellW*cols; canvas.height = cellH*rows;
    const c = canvas.getContext('2d');
    c.fillStyle = 'white'; c.textBaseline = 'middle'; c.textAlign = 'center'; c.font = '600 28px Arial, sans-serif';
    for (const cell of letterCells.values()) {
      const x = cell.index % cols * cellW, y = Math.floor(cell.index / cols) * cellH;
      const w = Math.min(cellW-4, (cellH-6)*cell.aspect);
      c.fillText(cell.words, x+cellW/2, y+cellH/2, w);
      cell.rect = [(x+(cellW-w)/2)/canvas.width, 1-(y+cellH-2)/canvas.height, w/canvas.width, (cellH-4)/canvas.height];
    }
    const lettering = new CanvasTexture(canvas);
    lettering.colorSpace = SRGBColorSpace; lettering.anisotropy = 4;
    materials.lettering.map = lettering; maps.push(lettering);
    const atlas = instruments.bake();
    for (const m of [materials.dial, materials.display, materials.hud]) {
      m.map = m.emissiveMap = atlas; m.emissive.set(white);
    }
    atlas.minFilter = LinearFilter;
    for (const {add,p,r,size,label,face,dial,hud,lift,tint} of faces) {
      const g = dial ? new CircleGeometry(size[0]/2, 40) : new PlaneGeometry(...size);
      if (lift) g.translate(0,0,lift);
      add(label ? 'lettering' : dial ? 'dial' : hud ? 'hud' : 'display', tint || white, g, p, r, label?.rect ?? face.rect);
    }
    for (const [parent, bins] of batches) {
      for (const [name, parts] of bins) {
        const mesh = new Mesh(mergeGeometries(parts), materials[name]);
        mesh.name = 'Cockpit ' + name;
        parent.add(mesh);
        for (const part of parts) part.dispose();
      }
    }
    batches.clear(); faces.length = 0; letterCells.clear();
    // Some decks have neither cloth nor glazing. Dispose their unused materials
    // here; the optical pass owns and releases everything attached to the scene.
    const used = new Set();
    scene.traverse(o => { if (o.material) used.add(o.material); });
    for (const m of Object.values(materials)) if (!used.has(m)) m.dispose();
    return {
      maps: [...maps, atlas], panel: materials.display, controls,
      update(runtime, thrust) { instruments.update(runtime, thrust); },
      illumination(day) {
        materials.dial.emissiveIntensity = .18 + .10*day;
        materials.display.emissiveIntensity = .68 + .38*day;
      },
    };
  }
  return { kit, finish };
}

// Physical instruments share their exact layout with proximity interactions.
import { BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, Float32BufferAttribute, Group, LinearFilter, Mesh, MeshBasicMaterial, SRGBColorSpace } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { observatoryStations } from './observatory-stations.mjs';
import { softBox } from './geometry-kit.js';

const WIDTH = 1024, HEIGHT = 512;
const faceFont = '"Inter", "Segoe UI", Arial, sans-serif';

/** Two draws, one 2 MiB atlas. All positions originate in the interaction contract. */
export function createObservatoryInstruments(variant, doc = typeof document === 'undefined' ? null : document) {
  const stations = observatoryStations(variant);
  const solid = [], screens = [], color = new Color();
  const add = (geometry, x, y, z, tint, roughness = .4, metalness = .65) => {
    geometry.translate(x, y, z);
    const count = geometry.attributes.position.count;
    if (!geometry.attributes.uv) {
      const uv = new Float32Array(count * 2), p = geometry.attributes.position, n = geometry.attributes.normal;
      for (let i = 0; i < count; i++) {
        uv[i * 2] = Math.abs(n.getX(i)) > .7 ? p.getZ(i) : p.getX(i);
        uv[i * 2 + 1] = Math.abs(n.getY(i)) > .7 ? p.getZ(i) : p.getY(i);
      }
      geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    }
    color.set(tint);
    geometry.setAttribute('color', new Float32BufferAttribute(Array.from({ length: count }, () => [color.r, color.g, color.b]).flat(), 3));
    geometry.setAttribute('aSurf', new Float32BufferAttribute(Array.from({ length: count }, () => [roughness, metalness, 1, 0]).flat(), 4));
    solid.push(geometry);
  };
  const box = (x, y, z, w, h, d, tint = '#837357') => add(new BoxGeometry(w, h, d), x, y, z, tint);
  // Small machined supports use a chamfer; the display head keeps its smooth
  // three-segment radius. Avoid tessellating every flat support like a cushion.
  const bevel = (x, y, z, w, h, d, r, tint, roughness = .4, metalness = .65) => add(softBox({ w, h, d, r, seg: 1, div: 1 }), x, y, z, tint, roughness, metalness);
  const screen = (points, rect) => {
    const geometry = new BufferGeometry(), pos = [], uv = [];
    const [x, y, w, h] = rect;
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...points[i]);
      const corners = [[x, y + h], [x + w, y + h], [x + w, y], [x, y]];
      uv.push(corners[i][0] / WIDTH, 1 - corners[i][1] / HEIGHT);
    }
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geometry.computeVertexNormals(); screens.push(geometry);
  };
  const tiles = [];
  for (const s of stations) {
    const [x, y, z] = s.position;
    const floor = s.floorY || 0;
    if (s.kind === 'table') {
      box(x, y - .018, z, 3.88, .035, .91, '#342f26');
      // Opaque optical coating: avoids a transparent sort and keeps the diagram crisp.
      screen([[x - 1.9, y + .003, z + .435], [x + 1.9, y + .003, z + .435], [x + 1.9, y + .003, z - .435], [x - 1.9, y + .003, z - .435]], [0, 0, 640, 147]);
      continue;
    }
    if (s.kind === 'support') {
      bevel(x, y - .04, z, 1, .065, .21, .012, '#8d7957');
      bevel(x, y, z, .86, .035, .17, .012, '#293438', .88, .04);
      for (const offset of [-.36, .36]) {
        bevel(x + offset, floor + .023, z, .14, .045, .14, .009, '#5b5a4f');
        bevel(x + offset, (floor + y - .04) / 2, z, .045, y - floor - .04, .045, .008, '#8d7957');
      }
      continue;
    }
    const back = s.side === 'back', sign = back ? -1 : 1;
    // A joined bronze pedestal and hinge carry the display. The previous
    // 40 mm pole stopped 105 mm below its housing, leaving the head floating.
    bevel(x, floor + .025, z, .30, .05, .25, .012, '#55584e');
    bevel(x, floor + .064, z, .18, .035, .13, .009, '#9b8765');
    bevel(x, (floor + .06 + y) / 2, z, .105, y - floor - .06, .07, .015, '#8c7b5e');
    const hinge = new CylinderGeometry(.041, .041, .20, 24);
    hinge.rotateZ(Math.PI / 2);
    add(hinge, x, y - .018, z + sign * .045, '#b1a181', .32, .78);
    // Rounded casing follows the actual optical plane, with a narrow inset
    // gasket. The display sits 4 mm clear of its front, never inside a box.
    const housing = softBox({ w: .452, h: .166, d: .064, r: .012, seg: 3, div: 1 });
    housing.rotateX(-Math.atan(.5037037));
    if (back) housing.rotateY(Math.PI);
    add(housing, x, y - .0087, z + sign * .10385, '#424b49', .38, .65);
    // Match the physical face's 2.65:1 aspect; the former 4:1 atlas slot
    // squeezed every letter horizontally on the real instrument.
    const rect = [640, tiles.length * 96, 256, 96];
    const left = back ? x + .2 : x - .2, right = back ? x - .2 : x + .2;
    screen([[left, y - .06, z + sign * .17], [right, y - .06, z + sign * .17], [right, y + .075, z + sign * .102], [left, y + .075, z + sign * .102]], rect);
    // No non-functional dial: the exterior microphone follows the view.
    tiles.push({ station: s, rect });
  }
  const geometry = mergeGeometries(solid), screenGeometry = mergeGeometries(screens);
  for (const g of [...solid, ...screens]) g.dispose();
  const canvas = doc?.createElement('canvas');
  if (canvas) { canvas.width = WIDTH; canvas.height = HEIGHT; }
  const context = canvas?.getContext('2d');
  const texture = canvas ? new CanvasTexture(canvas) : null;
  if (texture) { texture.colorSpace = SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = texture.magFilter = LinearFilter; }
  const fallback = new MeshBasicMaterial({ vertexColors: true, color: '#9a9a9a' });
  const displayMaterial = new MeshBasicMaterial({ map: texture, color: texture ? '#ffffff' : '#162c36', toneMapped: false, transparent: true });
  const bodies = new Mesh(geometry, fallback), displays = new Mesh(screenGeometry, displayMaterial);
  bodies.name = 'observatory:instrument-bodies'; displays.name = 'observatory:instrument-displays';
  bodies.frustumCulled = displays.frustumCulled = false;
  bodies.renderOrder = -11; displays.renderOrder = -10;
  const group = new Group(); group.name = 'living-observatory-instruments'; group.add(bodies, displays); group.visible = false;
  let last = -Infinity;
  const text = (value, x, y, size = 15, tint = '#bed6db', align = 'left') => {
    context.fillStyle = tint; context.font = `500 ${size}px ${faceFont}`; context.textAlign = align; context.fillText(value, x, y);
  };
  return {
    group, bodies, displays, texture,
    stats: { draws: 2, triangles: geometry.index.count / 3 + screenGeometry.attributes.position.count / 3, textureBytes: WIDTH * HEIGHT * 4 },
    update(now, state) {
      if (!context || !state || now - last < 250) return;
      last = now;
      context.fillStyle = '#0c1a22'; context.fillRect(0, 0, WIDTH, HEIGHT);
      // Airport table: real geometry in a room-aligned frame, with uniform scale.
      const pts = state.runways.flatMap((r) => [r.a, r.b]);
      const extentX = Math.max(1000, ...pts.map((p) => Math.abs(p.x)));
      const extentZ = Math.max(1000, ...pts.map((p) => Math.abs(p.z)));
      const scale = Math.min(290 / extentX, 49 / extentZ);
      const project = (p) => [320 + p.x * scale, 79 + p.z * scale];
      text('LIVE AIRPORT', 15, 20, 12, '#9fe6e8');
      text('FRONT WINDOW', 320, 16, 10, '#a4bac3', 'center');
      for (const r of state.runways) {
        const a = project(r.a), b = project(r.b);
        context.strokeStyle = '#8a9eaa'; context.lineWidth = Math.max(2, r.widthM * scale);
        context.beginPath(); context.moveTo(...a); context.lineTo(...b); context.stroke();
        text(r.label, a[0] + 4, a[1] - 5, 9);
      }
      context.fillStyle = '#ffffff'; context.beginPath(); context.moveTo(320, 74); context.lineTo(324, 82); context.lineTo(316, 82); context.fill();
      for (const c of state.contacts) {
        const [x, y] = project(c);
        if (x < 5 || x > 635 || y < 26 || y > 130) continue;
        context.fillStyle = c.selected ? '#ffca88' : '#82e3e6'; context.beginPath(); context.arc(x, y, c.selected ? 3.5 : 2, 0, Math.PI * 2); context.fill();
      }
      text(state.contacts.length ? `${state.contacts.length} LIVE POSITIONS` : 'WAITING FOR FRESH POSITIONS', 15, 139, 10);
      text('OPEN TABLE TO EXPLORE', 625, 139, 10, '#a4bac3', 'right');
      for (const { station: s, rect: [x, y, w, h] } of tiles) {
        context.fillStyle = '#132730'; context.fillRect(x + 1, y + 1, w - 2, h - 2);
        const title = s.kind === 'listen' ? 'WINDOW AUDIO' : s.kind === 'night' ? 'LOUNGE LIGHTING' : s.side === 'back' ? 'REAR WINDOW' : 'FRONT WINDOW';
        text(title, x + 14, y + 23, 14, '#9fced4');
        if (s.kind === 'compass') {
          const suggestion = state.suggestions[s.side];
          text(suggestion?.label || 'Watch the airport', x + 14, y + 52, 21, '#edf6f5');
          text((suggestion?.text || 'LIVE ACTIVITY APPEARS HERE').slice(0, 35), x + 14, y + 77, 12);
        } else if (s.kind === 'listen') {
          const live = state.listening?.side === s.side;
          text(live ? `${String(Math.round(state.listening.worldBearing)).padStart(3, '0')}°` : 'Hear outside', x + 14, y + 54, 21, '#edf6f5');
          text(live ? 'LISTEN WHERE YOU LOOK' : 'STEP CLOSER · PRESS ENTER', x + 14, y + 78, 11);
        } else {
          text(state.night ? 'Observation lighting' : 'Dim the room', x + 14, y + 55, 22, '#edf6f5');
          text('WALKING ROUTES STAY LIT', x + 14, y + 78, 11);
        }
      }
      texture.needsUpdate = true;
      displayMaterial.color.setScalar(state.night ? .65 : 1);
    },
    dispose() { geometry.dispose(); screenGeometry.dispose(); texture?.dispose(); fallback.dispose(); displayMaterial.dispose(); },
  };
}

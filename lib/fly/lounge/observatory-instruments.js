// Physical instruments share their exact layout with proximity interactions.
import { BoxGeometry, BufferGeometry, CanvasTexture, Color, CylinderGeometry, Float32BufferAttribute, Group, LinearFilter, Mesh, MeshBasicMaterial, SRGBColorSpace } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { observatoryStations } from './observatory-stations.mjs';

const WIDTH = 1024, HEIGHT = 512;
const faceFont = '"Inter", "Segoe UI", Arial, sans-serif';

/** Two draws, one 2 MiB atlas. All positions originate in the interaction contract. */
export function createObservatoryInstruments(variant, doc = typeof document === 'undefined' ? null : document) {
  const stations = observatoryStations(variant);
  const solid = [], screens = [], color = new Color();
  const add = (geometry, x, y, z, tint) => {
    geometry.translate(x, y, z);
    const count = geometry.attributes.position.count;
    color.set(tint);
    geometry.setAttribute('color', new Float32BufferAttribute(Array.from({ length: count }, () => [color.r, color.g, color.b]).flat(), 3));
    geometry.setAttribute('aSurf', new Float32BufferAttribute(Array.from({ length: count }, () => [.36, .75, 1, 0]).flat(), 4));
    solid.push(geometry);
  };
  const box = (x, y, z, w, h, d, tint = '#837357') => add(new BoxGeometry(w, h, d), x, y, z, tint);
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
    if (s.kind === 'table') {
      box(x, y - .018, z, 3.88, .035, .91, '#342f26');
      // Opaque optical coating: avoids a transparent sort and keeps the diagram crisp.
      screen([[x - 1.9, y + .003, z + .435], [x + 1.9, y + .003, z + .435], [x + 1.9, y + .003, z - .435], [x - 1.9, y + .003, z - .435]], [0, 0, 640, 147]);
      continue;
    }
    if (s.kind === 'support') {
      box(x, y - .04, z, 1, .065, .21, '#735f42');
      box(x, y, z, .86, .025, .17, '#263138');
      for (const offset of [-.36, .36]) box(x + offset, y / 2 - .02, z, .035, y - .08, .035);
      continue;
    }
    box(x, y / 2 - .09, z, .04, y - .18, .04);
    box(x, .035, z, .21, .04, .16, '#3e423f');
    const back = s.side === 'back', sign = back ? -1 : 1;
    // The housing follows the display slope. Keep its front 2 mm behind
    // the optical face; a rectangular box would bury the lower screen.
    const housing = new BoxGeometry(.44, .16, .18);
    const hp = housing.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      if (hp.getZ(i) > 0) hp.setZ(i, .1377778 - .5037037 * (hp.getY(i) + .005));
    }
    housing.computeVertexNormals();
    if (back) housing.rotateY(Math.PI);
    add(housing, x, y + .005, z, '#343e40');
    const rect = [640, tiles.length * 96, 384, 96];
    const left = back ? x + .2 : x - .2, right = back ? x - .2 : x + .2;
    screen([[left, y - .06, z + sign * .17], [right, y - .06, z + sign * .17], [right, y + .075, z + sign * .102], [left, y + .075, z + sign * .102]], rect);
    if (s.kind === 'listen') {
      const dial = new CylinderGeometry(.038, .038, .025, 20);
      dial.rotateX(Math.PI / 2);
      add(dial, x + (back ? -.16 : .16), y - .055, z + sign * .185, '#bba17d');
    }
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
        const title = s.kind === 'listen' ? 'LISTENING WINDOW' : s.kind === 'night' ? 'NIGHT WATCH' : s.side === 'back' ? 'REAR WINDOW' : 'FRONT WINDOW';
        text(title, x + 14, y + 23, 14, '#9fced4');
        if (s.kind === 'compass') {
          const suggestion = state.suggestions[s.side];
          text(suggestion?.label || 'A quiet window', x + 14, y + 52, 21, '#edf6f5');
          text((suggestion?.text || 'No clear live view yet').slice(0, 45), x + 14, y + 77, 12);
        } else if (s.kind === 'listen') {
          const live = state.listening?.side === s.side;
          text(live ? `${String(Math.round(state.listening.worldBearing)).padStart(3, '0')}°` : 'Tune into the airport', x + 14, y + 54, 21, '#edf6f5');
          text(live ? 'EXTERIOR MICROPHONE' : 'STEP CLOSER TO LISTEN', x + 14, y + 78, 11);
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

// Shot 1 — the live planet from orbit: every streak is a flight.
import * as THREE from 'three';
import { CITIES } from '/lib/fly/poi/cities.js';
import { clamp, lerp, easeInOut, smooth, rng, glowTexture } from './common.js';

const R = 100;
const RES = +(new URLSearchParams(location.search).get('h') || 1080) / 1080;
const D2R = Math.PI / 180;
export function llToVec(lat, lon, r = R, out = new THREE.Vector3()) {
  const la = lat * D2R, lo = lon * D2R;
  return out.set(r * Math.cos(la) * Math.cos(lo), r * Math.sin(la), -r * Math.cos(la) * Math.sin(lo));
}

function stitch(lines) {
  const open = []; const rings = [];
  const near = (a, b) => Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05;
  for (const l of lines) {
    const pts = []; for (let i = 0; i < l.length; i += 2) pts.push([l[i], l[i + 1]]);
    if (near(pts[0], pts[pts.length - 1])) rings.push(pts); else open.push(pts);
  }
  while (open.length) {
    let cur = open.shift(); let grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const o = open[i]; const end = cur[cur.length - 1];
        if (near(end, o[0])) { cur = cur.concat(o.slice(1)); } else if (near(end, o[o.length - 1])) { cur = cur.concat(o.slice().reverse().slice(1)); } else continue;
        open.splice(i, 1); grew = true; break;
      }
    }
    rings.push(cur);
  }
  return rings;
}

async function buildEarthTexture() {
  const buf = await (await fetch('/public/atlas/coastlines.bin')).arrayBuffer();
  const n = new Uint32Array(buf, 0, 1)[0]; const counts = new Uint32Array(buf, 4, n); let off = 4 + n * 4; const lines = [];
  for (let i = 0; i < n; i++) { lines.push(new Float32Array(buf, off, counts[i] * 2)); off += counts[i] * 8; }
  const W = 4096, H = 2048; const X = (lo) => ((lo + 180) / 360) * W, Y = (la) => ((90 - la) / 180) * H;
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'lighter';
  const rings = stitch(lines);
  // land (red)
  g.fillStyle = '#ff0000';
  for (const r of rings) {
    g.beginPath(); r.forEach(([lo, la], i) => (i ? g.lineTo(X(lo), Y(la)) : g.moveTo(X(lo), Y(la))));
    if (r.some(([, la]) => la < -80)) { g.lineTo(X(180), H); g.lineTo(X(-180), H); }
    g.closePath(); g.fill('evenodd');
  }
  // coast glow (green): wide soft + crisp core
  const stroke = (w, a, blur) => {
    g.save(); g.filter = blur ? `blur(${blur}px)` : 'none'; g.strokeStyle = `rgba(0,255,0,${a})`; g.lineWidth = w;
    for (const l of lines) { g.beginPath(); for (let i = 0; i < l.length; i += 2) { const x = X(l[i]), y = Y(l[i + 1]); if (i && Math.abs(l[i] - l[i - 2]) > 90) g.moveTo(x, y); else i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    g.restore();
  };
  stroke(10, 0.35, 8); stroke(2.2, 0.9, 0);
  // city lights (blue)
  const rnd = rng(7);
  for (const [, la, lo] of CITIES) {
    const x = X(lo), y = Y(la);
    const big = rnd();
    const rr = 1.2 + Math.pow(big, 3) * 4;
    const gr = g.createRadialGradient(x, y, 0, x, y, rr * 3);
    gr.addColorStop(0, 'rgba(0,0,255,0.8)'); gr.addColorStop(0.2, 'rgba(0,0,255,0.22)'); gr.addColorStop(1, 'rgba(0,0,255,0)');
    g.fillStyle = gr; g.fillRect(x - rr * 3, y - rr * 3, rr * 6, rr * 6);
    // suburbs speckle
    for (let k = 0; k < 8; k++) { const a = rnd() * 6.28, d = rnd() * rr * 5; g.fillStyle = `rgba(0,0,255,${0.15 + rnd() * 0.3})`; g.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.6, 1.6); }
  }
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

export async function createGlobe() {
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.5, 20000);
  const sunDir = new THREE.Vector3(-0.55, 0.28, -0.79).normalize();
  const tex = await buildEarthTexture();

  const earthMat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, uSun: { value: sunDir }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(position); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform sampler2D uTex; uniform vec3 uSun; uniform float uTime; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 n = normalize(vN);
        float lat = asin(clamp(n.y,-1.0,1.0)); float lon = atan(-n.z, n.x);
        vec2 uv = vec2(lon/6.2831853 + 0.5, lat/3.1415927 + 0.5);
        vec3 t = texture2D(uTex, uv).rgb;
        vec3 V = normalize(cameraPosition - vW);
        float ndl = dot(n, uSun);
        float day = smoothstep(-0.12, 0.25, ndl);
        float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
        vec3 ocean = mix(vec3(0.002,0.006,0.016), vec3(0.008,0.028,0.07), fres*0.7);
        vec3 land = vec3(0.018,0.03,0.04);
        vec3 dayOcean = vec3(0.02,0.09,0.2), dayLand = vec3(0.10,0.13,0.10);
        vec3 col = mix(mix(ocean, land, t.r), mix(dayOcean, dayLand, t.r) * (0.35 + 0.9*max(ndl,0.0)), day);
        // sun glint on the ocean
        vec3 H = normalize(uSun + V); col += vec3(1.0,0.75,0.5) * pow(max(dot(n,H),0.0), 260.0) * (1.0 - t.r) * day * 1.2;
        col += vec3(0.22,0.85,1.0) * t.g * (0.55 + 0.45*(1.0-day)) * 0.9;
        float lights = t.b * (1.0 - day);
        col += vec3(1.0,0.66,0.3) * lights * 1.5;
        // terminator warm band
        col += vec3(1.0,0.45,0.15) * exp(-pow(ndl*9.0, 2.0)) * 0.08;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R, 192, 96), earthMat); scene.add(earth);

  // atmosphere shell
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 128, 64), new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir } }, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(position); vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 V = normalize(cameraPosition - vW); vec3 n = normalize(vN);
        float rim = pow(clamp(1.0 + dot(V, n) * 1.0, 0.0, 1.0), 1.0);
        float edge = smoothstep(0.0, 0.35, -dot(V,n));
        float d = dot(n, uSun);
        float lit = smoothstep(-0.35, 0.4, d);
        vec3 c = mix(vec3(0.05,0.18,0.5), vec3(0.35,0.7,1.2), lit) + vec3(1.2,0.55,0.2) * exp(-pow(d*5.0,2.0)) * 0.9;
        float a = pow(edge, 3.0) * (0.15 + 0.9*lit);
        gl_FragColor = vec4(c * a, 1.0); }`,
  }));
  scene.add(atmo);
  // inner atmosphere haze on the disc
  const haze = new THREE.Mesh(new THREE.SphereGeometry(R * 1.004, 128, 64), new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(position); vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uSun; varying vec3 vN; varying vec3 vW; void main(){ vec3 V = normalize(cameraPosition - vW); float f = pow(1.0 - max(dot(V, normalize(vN)),0.0), 4.0); float lit = smoothstep(-0.3,0.5,dot(normalize(vN),uSun)); gl_FragColor = vec4(mix(vec3(0.02,0.05,0.16), vec3(0.25,0.5,0.9), lit) * f * (0.25+0.6*lit), 1.0); }`,
  }));
  scene.add(haze);

  // stars
  {
    const n = 7000; const p = new Float32Array(n * 3); const s = new Float32Array(n); const r = rng(3);
    for (let i = 0; i < n; i++) { const u = r() * 2 - 1, a = r() * 6.283; const q = Math.sqrt(1 - u * u); p.set([q * Math.cos(a) * 8000, u * 8000, q * Math.sin(a) * 8000], i * 3); s[i] = Math.pow(r(), 6) * 7 + 0.9; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('size', new THREE.BufferAttribute(s, 1));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTex: { value: glowTexture() } }, defines: { RESF: RES.toFixed(3) },
      vertexShader: `attribute float size; varying float vS; void main(){ vS=size; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = size * 1.6 * RESF; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying float vS; void main(){ float a = texture2D(uTex, gl_PointCoord).a; gl_FragColor = vec4(vec3(0.75,0.85,1.0) * a * min(1.0, vS*0.35), 1.0); }` });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; scene.add(pts);
  }
  // sun
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(1.0, 0.85, 0.65).multiplyScalar(6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  sunSprite.scale.setScalar(700); scene.add(sunSprite);

  // flights: great-circle arcs between cities, heads + fading tails
  const rnd = rng(42); const flights = [];
  const hubs = CITIES.filter((_, i) => i % 3 === 0);
  const TAIL = 14;
  while (flights.length < 900) {
    const a = hubs[Math.floor(rnd() * hubs.length)], b = hubs[Math.floor(rnd() * hubs.length)];
    const va = llToVec(a[1], a[2], 1), vb = llToVec(b[1], b[2], 1);
    const ang = va.angleTo(vb); if (ang < 0.08 || ang > 1.9) continue;
    flights.push({ va, vb, ang, phase: rnd(), speed: (0.018 + rnd() * 0.02) / ang, amber: rnd() < 0.18, h: 0.8 + ang * 3.2 });
  }
  const headPos = new Float32Array(flights.length * 3); const headCol = new Float32Array(flights.length * 3);
  const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(headPos, 3)); hg.setAttribute('color', new THREE.BufferAttribute(headCol, 3));
  const heads = new THREE.Points(hg, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, uniforms: { uTex: { value: glowTexture() }, uScale: { value: 1 }, uRes: { value: 1 } },
    vertexShader: `uniform float uScale; uniform float uRes; varying vec3 vC; void main(){ vC=color; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = clamp(900.0 / -mv.z, 2.5, 9.0) * uScale * uRes; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform sampler2D uTex; varying vec3 vC; void main(){ float a = texture2D(uTex, gl_PointCoord).a; gl_FragColor = vec4(vC * a * 2.2, 1.0); }` }));
  heads.frustumCulled = false; scene.add(heads);
  const tailPos = new Float32Array(flights.length * (TAIL - 1) * 2 * 3); const tailCol = new Float32Array(tailPos.length);
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(tailPos, 3)); tg.setAttribute('color', new THREE.BufferAttribute(tailCol, 3));
  const tails = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  tails.frustumCulled = false; scene.add(tails);
  const tmp = new THREE.Vector3(); const q = new THREE.Quaternion();
  function arcPoint(f, s, out) {
    s = clamp(s);
    out.copy(f.va); q.setFromAxisAngle(tmp.crossVectors(f.va, f.vb).normalize(), f.ang * s); out.applyQuaternion(q);
    return out.multiplyScalar(R + f.h * Math.sin(Math.PI * s));
  }
  function updateFlights(t) {
    const p = new THREE.Vector3(), p2 = new THREE.Vector3();
    flights.forEach((f, i) => {
      const s = (f.phase + t * f.speed) % 1; const fade = smooth(0, 0.05, s) * smooth(1, 0.95, s);
      arcPoint(f, s, p); headPos.set([p.x, p.y, p.z], i * 3);
      const c = f.amber ? [1.0, 0.7, 0.3] : [0.55, 0.95, 1.0];
      headCol.set(c.map((x) => x * fade), i * 3);
      for (let k = 0; k < TAIL - 1; k++) {
        const s0 = s - k * 0.012, s1 = s - (k + 1) * 0.012;
        arcPoint(f, s0, p); arcPoint(f, s1, p2);
        const a0 = (1 - k / (TAIL - 1)) * fade * (s0 > 0 ? 1 : 0), a1 = (1 - (k + 1) / (TAIL - 1)) * fade * (s1 > 0 ? 1 : 0);
        const o = (i * (TAIL - 1) + k) * 6;
        tailPos.set([p.x, p.y, p.z, p2.x, p2.y, p2.z], o);
        tailCol.set([c[0] * a0 * 0.8, c[1] * a0 * 0.8, c[2] * a0 * 0.8, c[0] * a1 * 0.8, c[1] * a1 * 0.8, c[2] * a1 * 0.8], o);
      }
    });
    hg.attributes.position.needsUpdate = true; hg.attributes.color.needsUpdate = true; tg.attributes.position.needsUpdate = true; tg.attributes.color.needsUpdate = true;
  }

  // --- camera rig: end pose hangs over the North Atlantic at night, looking
  // east at the limb where the sun is about to rise.
  const east = (la, lo) => new THREE.Vector3(-Math.sin(lo * D2R), 0, -Math.cos(lo * D2R));
  function pose(lat, lon, alt, head, tilt) {
    const P = llToVec(lat, lon, 1); const E = east(lat, lon); const N = new THREE.Vector3().crossVectors(P, E).normalize();
    const Lh = E.clone().multiplyScalar(Math.cos(head)).addScaledVector(N, Math.sin(head)).normalize();
    const C = P.clone().multiplyScalar(R + alt);
    const dip = Math.acos(R / (R + alt));
    const L = Lh.clone().multiplyScalar(Math.cos(dip + tilt)).addScaledVector(P, -Math.sin(dip + tilt)).normalize();
    return { C, L, Lh, P, dip };
  }
  const END = pose(41, -48, 26, 0.25, -0.1);
  // sun sits just above the limb, slightly right of centre
  const S = END.Lh.clone().multiplyScalar(Math.cos(-END.dip + 0.02)).addScaledVector(END.P, Math.sin(-END.dip + 0.02));
  S.applyAxisAngle(END.P, -0.16).normalize();
  sunDir.copy(S); sunSprite.position.copy(S).multiplyScalar(6000);

  const shots = {
    globe(lt, gt, sh) {
      const u = clamp(lt / sh.dur);
      updateFlights(gt * 1.0);
      const e = easeInOut(u);
      const dir0 = S.clone().multiplyScalar(-1).addScaledVector(END.P, 0.35).add(new THREE.Vector3(0, 0.2, 0)).normalize();
      const dir1 = END.C.clone().normalize();
      const dir = dir0.clone().lerp(dir1, Math.pow(e, 1.3)).normalize();
      const dist = Math.exp(lerp(Math.log(470), Math.log(END.C.length()), Math.pow(e, 0.9)));
      const C = dir.multiplyScalar(dist);
      const tgt0 = new THREE.Vector3(0, 0, 0), tgt1 = END.C.clone().addScaledVector(END.L, 300);
      const tgt = tgt0.lerp(tgt1, Math.pow(e, 1.6));
      const dive = Math.pow(smooth(0.8, 1.0, u), 2);
      C.addScaledVector(END.L, dive * 12).addScaledVector(END.P, dive * 1.5);
      tgt.addScaledVector(END.P, dive * 10);
      camera.position.copy(C); camera.up.copy(END.P).lerp(new THREE.Vector3(0, 1, 0), 1 - e).normalize(); camera.lookAt(tgt);
      camera.rotateZ(lerp(0.18, 0.04, e));
      camera.fov = lerp(26, 42, e); camera.updateProjectionMatrix();
      heads.material.uniforms.uScale.value = lerp(0.8, 1.1, e); heads.material.uniforms.uRes.value = RES;
    },
  };
  const post = { globe: { bloom: [0.42, 0.4, 0.72], exposure: 0.95, grade: { tint: [1.0, 0.98, 0.96], sat: 1.12, con: 1.08, ca: 0.002 } } };
  const flares = { globe: (lt) => [{ pos: sunSprite.position.clone(), i: 0.9 * smooth(1.0, 6.0, lt), color: [255, 200, 150], len: 1.1, thick: 2.5, core: 120 }] };
  return { scene, camera, shots, post, flares };
}

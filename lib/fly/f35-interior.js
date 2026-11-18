/**
 * Original pilot-eye interior, built in metres around the seated eye. Opaque
 * parts with the same finish share a draw, including fasteners and stitching.
 * The glass combiner and the panoramic navigation display have their own UVs.
 */
import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, DoubleSide,
  CanvasTexture, Float32BufferAttribute, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  Object3D, PlaneGeometry, SphereGeometry, SRGBColorSpace, TubeGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { cockpitFinishMap, wingFinish } from './cockpit-finishes.js';
import { FLIGHT_RELIEF_ON } from './world-clarity';
import { fitServiceFinishes } from './cockpit-service-finish.js';

const vec = (p) => new Vector3(...p);

export function buildF35Interior(scene, displays) {
  const metalMap=cockpitFinishMap(), grain=cockpitFinishMap(true), wingMap=wingFinish();
  const finish = {
    paint: new MeshPhysicalMaterial({ vertexColors: true, roughness: .50, metalness: .23, clearcoat:.28,clearcoatRoughness:.33, map:metalMap,bumpMap:metalMap,bumpScale:.00045,side: DoubleSide }),
    rubber: new MeshStandardMaterial({ vertexColors: true, roughness: .71, metalness: .03,map:grain,bumpMap:grain,bumpScale:.0011,side: DoubleSide }),
    alloy: new MeshStandardMaterial({ vertexColors: true, roughness: .32, metalness: .57,map:metalMap,bumpMap:metalMap,bumpScale:.00023,side: DoubleSide }),
  };
  const bins = { paint: [], rubber: [], alloy: [] };
  const transform = new Object3D();
  const colors = new Color();
  const decals = [];
  const atlas = document.createElement('canvas');
  atlas.width = 512; atlas.height = 1024;
  const ink = atlas.getContext('2d');
  function label(words, p, size, r = [0,0,0], caution = false) {
    const line = decals.length;
    const y = line*48;
    ink.fillStyle = caution ? '#b6a36b' : '#243035';
    ink.fillRect(0,y,512,46);
    ink.strokeStyle = caution ? '#5c5542' : '#566063';
    ink.lineWidth=1.6;ink.strokeRect(3,y+3,506,40);
    ink.font = 'bold 29px ui-monospace, Consolas, monospace';
    ink.textAlign='center';ink.fillStyle=caution?'#35342a':'#b3bdb7';ink.fillText(words,256,y+33,475);
    const g = new PlaneGeometry(...size);
    transform.rotation.set(...r);transform.position.fromArray(p);transform.scale.set(1,1,1);transform.updateMatrix();g.applyMatrix4(transform.matrix);
    const uv = g.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setY(i,1-(y+46-46*uv.getY(i))/atlas.height);
    decals.push(g);
  }
  function part(type, hex, geom, p = [0, 0, 0], r = [0, 0, 0], scale = [1, 1, 1]) {
    transform.position.fromArray(p);
    transform.rotation.set(...r);
    transform.scale.fromArray(scale);
    transform.updateMatrix();
    geom.applyMatrix4(transform.matrix);
    const tri = geom.index ? geom.toNonIndexed() : geom;
    if (tri !== geom) geom.dispose();
    for (const attr of Object.keys(tri.attributes)) {
      if (attr !== 'position' && attr !== 'normal') tri.deleteAttribute(attr);
    }
    if (!tri.attributes.normal) tri.computeVertexNormals();
    const position=tri.attributes.position,normal=tri.attributes.normal;
    const rgb = new Float32Array(position.count * 3);
    const uv = new Float32Array(position.count * 2);
    colors.set(hex);
    for (let i=0;i<position.count;i++) {
      const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
      const nx=Math.abs(normal.getX(i)),ny=Math.abs(normal.getY(i)),nz=Math.abs(normal.getZ(i));
      const span=type==='rubber'?5.6:3.2;
      uv[2*i]=(nx>ny&&nx>nz?z:x)*span;
      uv[2*i+1]=(ny>nz&&ny>nx?z:y)*span;
      // Recesses below the deck receive less sky fill.
      const shade=.65+.35*Math.min(1,Math.max(0,(y+.67)*2.35));
      rgb[3*i]=colors.r*shade;rgb[3*i+1]=colors.g*shade;rgb[3*i+2]=colors.b*shade;
    }
    tri.setAttribute('color', new Float32BufferAttribute(rgb, 3));
    tri.setAttribute('uv',new Float32BufferAttribute(uv,2));
    bins[type].push(tri);
  }
  function block(type, c, p, size, r = [0, 0, 0], bevel = .004) {
    const geo = bevel ? new RoundedBoxGeometry(...size, 1, Math.min(bevel, ...size.map(n => n * .4))) : new BoxGeometry(...size);
    part(type, c, geo, p, r);
  }
  function tube(type, c, coords, radius, detail = 20, radial = 7) {
    const path = new CatmullRomCurve3(coords.map(vec), false, 'centripetal');
    part(type, c, new TubeGeometry(path, detail, radius, radial, false));
  }
  function rod(type, c, a, b, radius, sides = 8, otherRadius = radius) {
    const start = vec(a), end = vec(b), dir = end.clone().sub(start);
    const geo = new CylinderGeometry(otherRadius, radius, dir.length(), sides);
    const rot = new Object3D();
    rot.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    geo.applyMatrix4(new Matrix4().makeRotationFromQuaternion(rot.quaternion));
    part(type, c, geo, start.lerp(end, .5).toArray());
  }
  function surface(type, c, rows) {
    const points = [];
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      for (let j = 1; j < b.length; j++) points.push(...a[j - 1], ...a[j], ...b[j - 1], ...a[j], ...b[j], ...b[j - 1]);
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(points, 3));
    part(type, c, geo);
  }
  const dark = '#171d21', anthracite = '#2d3336', gasket = '#131916', edge = '#576066';
  // Laminated canopy bow: inner seal, broad formed spar, a slim rebate and
  // the bright rolled edge that catches the actual sun as the pilot banks.
  function bow(a, rx = .75, ry = .94, depth = 0) {
    return [Math.sin(a) * rx, -.54 + Math.cos(a) * (ry+.27), -.63 - .17 * Math.cos(a) + depth];
  }
  function arch(rx, ry, z) {
    return Array.from({ length: 55 }, (_, i) => bow(-Math.PI / 2 + i * Math.PI / 54, rx, ry, z));
  }
  if (!FLIGHT_RELIEF_ON) surface('paint', '#36404a', [arch(.729,.925,.014),arch(.733,.929,.023),arch(.747,.945,.028),arch(.760,.961,.027),arch(.769,.972,.016)]);
  surface('paint', '#22282b', [arch(.729, .925, -.036), arch(.729, .925, .018)]);
  tube('rubber', '#13191a', arch(.723, .919, .013), .008, 62);
  tube('alloy', '#939797', arch(.772, .977, .011), .006, 62);
  tube('rubber', '#242725', arch(.783, .990, -.003), .007, 62);
  tube('alloy', '#58574d', arch(.791, .999, -.018), .0026, 62);
  for (let i = -8; i <= 8; i++) {
    const a = i * .182, p = bow(a, .749, .949, FLIGHT_RELIEF_ON ? .029 : .021);
    rod('alloy', '#161c1e', p, [p[0], p[1], p[2] + .004], .011, 12);
    rod('alloy', i % 3 ? '#6f7472' : '#827e73', [p[0],p[1],p[2]+.004], [p[0],p[1],p[2]+.008], .0068, 8);
    block('paint', '#212729', [p[0],p[1],p[2]+.0084], [.0065,.0018,.001], [0,0,a + .5], 0);
  }
  // A second, low-contrast image of the polished rim lives in the glazing
  // behind it. The reflected line is broken along the curvature of the pane.
  const paneGeo = new BufferGeometry(), panePos=[], paneAlpha=[];
  for(let j=0;j<48;j++) {
    const a=-Math.PI/2+j*Math.PI/48,b=a+Math.PI/48;
    for(const [t,k] of [[a,0],[a,1],[b,0],[a,1],[b,1],[b,0]]) {
      panePos.push(...bow(t,.790+k*.034,.996+k*.04,-.022-k*.032));
      paneAlpha.push(.56,.74,.81,k ? .004 : .058*(.25+.75*Math.sin(t*3-1)**2));
    }
  }
  paneGeo.setAttribute('position',new Float32BufferAttribute(panePos,3));
  paneGeo.setAttribute('color',new Float32BufferAttribute(paneAlpha,4));
  scene.add(new Mesh(paneGeo,new MeshBasicMaterial({vertexColors:true,transparent:true,depthWrite:false,side:DoubleSide,toneMapped:false})));
  for (const sign of [-1, 1]) {
    const sidePath = [[.42,-.496,-1.40],[.64,-.51,-.93],[.739,-.54,-.63],[.754,-.54,-.10],[.725,-.47,.49],[.65,-.38,1.0]];
    const profile = (dx, dy) => sidePath.map(([x,y,z])=>[sign*(x+dx),y+dy,z]);
    surface('paint', '#303b40', [profile(-.045,.005), profile(.06,-.021), profile(.115,-.12)]);
    surface('rubber', '#171b1d', [profile(-.045,.005),profile(-.055,-.065),profile(-.13,-.37)]);
    tube('rubber', gasket, profile(-.033,.012), .015, 26);
    tube('alloy', edge, profile(.045,-.007), .0065, 26);
    tube('alloy', '#76766a', profile(.072,-.032), .003, 26);
    tube('alloy','#42576a',profile(-.047,-.088),.01,28);
    tube('rubber','#1b2126',profile(-.047,-.111),.014,28);
    // Clamps, stepped edge flanges and the latch anchor remain distinct under
    // side light. The screws sit on shouldered collars rather than flush dots.
    for(const t of [-1,1]) {
      const a=sign*(t>0?.96:1.34),p=bow(a,.751,.951,.03);
      block('alloy','#48535a',p,[.054,.079,.027],[0,0,-a*.77],.007);
      const q=[p[0],p[1],p[2]+.016];rod('paint','#1b2226',q,[q[0],q[1],q[2]+.005],.013,12);
      rod('alloy','#98968a',[q[0],q[1],q[2]+.005],[q[0],q[1],q[2]+.012],.007,6);
    }
    for (let j=0;j<6;j++) {
      const [x,y,z]=profile(-.045,-.035)[j];
      rod('alloy', '#777a77', [x,y,z], [x-sign*.006,y,z],.009,8);
    }
    // Structural shoulder and wing, visible through the side window on a
    // head turn. Panel lines follow the wing sweep and remain on its surface.
    const wp = (x,z,lift=0)=>[sign*x,-.81-.052*(x-.83)+lift,z];
    const inner = [wp(.77,-1.0),wp(.80,1.64)], outer=[wp(5.18,.84),wp(5.03,1.98)];
    const wing=new BufferGeometry();
    const wpPos=[], wpUv=[], wpIx=[];
    const chords=[0,.012,.045,.10,.20,.34,.54,.72,.87,.96,1];
    const spans=[0,.05,.13,.24,.4,.62,.82,.96,1];
    for(let s=0;s<spans.length;s++) {
      const u=spans[s];
      const lead=vec(inner[0]).lerp(vec(outer[0]),u);
      const trail=vec(inner[1]).lerp(vec(outer[1]),u);
      for(let j=0;j<chords.length;j++) {
        const v=chords[j],p=lead.clone().lerp(trail,v);
        // An actual airfoil shoulder catches a broad highlight. Chord and
        // thickness taper independently, meeting at the thin trailing edge.
        p.y+=(.22*(1-u)**1.6+.054)*Math.sin(Math.PI*Math.sqrt(v))*(1-.57*v);
        wpPos.push(p.x,p.y,p.z);wpUv.push(u,1-v);
        if(s>0&&j>0) {
          const d=s*chords.length+j,c=d-1,b=d-chords.length,a=b-1;
          wpIx.push(...(sign>0?[a,b,c,b,d,c]:[a,c,b,b,c,d]));
        }
      }
    }
    wing.setAttribute('position',new Float32BufferAttribute(wpPos,3));
    wing.setAttribute('uv',new Float32BufferAttribute(wpUv,2));
    wing.setIndex(wpIx);wing.computeVertexNormals();
    scene.add(new Mesh(wing,new MeshPhysicalMaterial({map:wingMap,roughness:.44,metalness:.28,clearcoat:.3,clearcoatRoughness:.39,side:DoubleSide})));
    rod('alloy','#849198',inner[0],outer[0],.008,8);
    surface('paint','#626e78',[[inner[0],wp(.77,-1.0,-.13)],[outer[0],wp(5.18,1.14,-.027)]]);
    // Recessed switch decks, their sidewalls and two differently shaped
    // controls visible below the sill when looking down.
    block('paint', dark, [sign*.51,-.747,-.09], [.24,.17,1.12], [.06,0,sign*.08], .026);
    for (let j=0;j<5;j++) {
      const z=-.53+j*.17;
      block('paint', anthracite, [sign*.52,-.652,z], [.167,.021,.145], [0,0,sign*.09]);
      for (let m=0;m<3;m++) {
        const x=sign*(.468+m*.046);
        rod('alloy', '#69737a', [x,-.643,z], [x,-.624,z+.009],.0056,7);
        block('rubber', '#31393b', [x,-.621,z+.009], [.020,.014,.011]);
      }
    }
    // Small illuminated index marks, a ribbed dimmer and asymmetrical trim
    // give the two switch decks a distinct silhouette.
    label(sign<0 ? 'CONSOLE  LT' : 'CABIN  AIR',[sign*.52,-.631,-.35],[.14,.024],[-Math.PI/2,0,sign*Math.PI/2]);
    block('paint','#41494b',[sign*.43,-.626,-.39],[.093,.025,.12],[0,0,0],.009);
    rod('alloy','#6b7171',[sign*.43,-.613,-.39],[sign*.43,-.600,-.39],.030,20);
    rod('rubber','#222b2c',[sign*.43,-.60,-.39],[sign*.43,-.576,-.39],.025,14);
    block('alloy','#bdc3bc',[sign*.43,-.575,-.40],[.004,.002,.015],[0,0,0],0);
    const sx=sign*.678;
    block('paint','#35414a',[sx,-.579,-.62],[.019,.11,.17],[0,0,sign*.11],.008);
    label(sign<0 ? 'CANOPY  SEAL' : 'CANOPY  LATCH',[sx-sign*.013,-.59,-.62],[.134,.018],[0,-sign*Math.PI/2,0],sign>0);
    tube('alloy','#434e53',[[sx-sign*.014,-.572,-.68],[sx-sign*.04,-.552,-.68],[sx-sign*.041,-.546,-.58],[sx-sign*.018,-.566,-.58]],.007,12,8);
    // Flight suit knees and inset webbing below the instrument panel.
    part('rubber', '#485044', new SphereGeometry(1,22,16), [sign*.235,-.715,-.27], [.28,sign*.13,sign*.12], [.15,.17,.39]);
    block('rubber','#303731',[sign*.235,-.57,-.25],[.235,.016,.056],[.18,sign*.13,sign*.12],.007);
    block('alloy','#697064',[sign*.27,-.559,-.25],[.046,.009,.046],[.16,0,sign*.12],.004);
  }
  // The footwell, centre console, and fabric along the lower seat close the
  // view when the pilot looks down or uses a tall phone screen.
  block('rubber','#1a2024',[0,-.94,-.25],[1.20,.17,1.9],[0,0,0],.045);
  block('paint','#30373a',[0,-.78,-.69],[.195,.245,.38],[-.28,0,0],.036);
  for(let i=0;i<9;i++)block('rubber','#12191e',[0,-.719-i*.013,-.485+i*.002],[.132,.006,.009],[-.23,0,0]);
  // The forward deck marries the sloping nose and sill below the windshield.
  const nose = (w,y,z) => [[-w,y-.065,z],[0,y,z],[w,y-.065,z]];
  surface('paint','#495460',[nose(.43,-.394,-1.35),nose(.32,-.66,-2.15),nose(.07,-1.22,-3.68)]);
  // A padded coaming with a curved front silhouette, side cheeks and a
  // narrow stitched welt, above the recessed panoramic screen.
  const xs = [-.68,-.59,-.48,-.34,0,.34,.48,.59,.68];
  const crown = x => -.292 - .165 * Math.pow(Math.abs(x)/.68,2.8);
  const row = (dz,dy,spread=1) => xs.map(x=>[x*spread,crown(x)+dy,-.89+dz-.040*(1-(x/.68)**2)]);
  const serviceMaps = FLIGHT_RELIEF_ON ? fitServiceFinishes(scene,crown,bow) : [];
  if (!FLIGHT_RELIEF_ON) surface('rubber', '#212728', [row(-.39,-.092,.77),row(-.25,-.023,.92),row(-.052,0),row(.033,-.008),row(.047,-.039),row(.028,-.070)]);
  surface('paint','#1e252b',[row(.027,-.067),row(-.014,-.142,.94)]);
  tube('rubber','#343a39',row(.041,-.018),FLIGHT_RELIEF_ON ? .0038 : .009,48);
  tube('alloy','#474c4a',row(.041,-.041),.0032,46);
  for (let i=0;i<70;i++) {
    const x=-.66+i*.019;
    const dy=FLIGHT_RELIEF_ON ? -.004 : -.012;
    const thread=FLIGHT_RELIEF_ON ? '#827c6d' : '#606259';
    rod('rubber',thread,[x,crown(x)+dy,-.868-.04*(1-(x/.68)**2)],[x+.008,crown(x+.008)+dy,-.868-.04*(1-((x+.008)/.68)**2)],.0013,4);
  }
  block('paint', '#262d30',[0,-.575,-.913],[1.18,.433,.13],[-.25,0,0],.036);
  block('rubber','#101817',[0,-.522,-.841],[.984,.295,.046],[-.25,0,0],.014);
  const display = new Mesh(new PlaneGeometry(.949,.256), new MeshBasicMaterial({ map: displays.panel.texture, toneMapped: false }));
  display.position.set(0,-.513,-.808); display.rotation.x=-.25; scene.add(display);
  for (const sign of [-1,1]) {
    // Knurled brightness and volume controls bolted to the screen fascia.
    const cx=sign*.517;
    rod('alloy','#697277',[cx,-.644,-.805],[cx,-.644,-.790],.030,24);
    rod('rubber','#292f32',[cx,-.644,-.79],[cx,-.644,-.765],.025,16);
    rod('paint','#42494a',[cx,-.644,-.765],[cx,-.644,-.762],.019,16);
    block('alloy','#c2c8b8',[cx+.004,-.632,-.76],[.003,.009,.001],[0,0,-.35],0);
    label(sign<0?'DIM':'VOL',[cx,-.684,-.758],[.049,.012],[-.25,0,0]);
    for (let j=0;j<3;j++) {
      const y=-.402-j*.067;
      block('rubber', '#171d1e',[sign*.53,y,-.822+(.402+y)*-.25],[.054,.035,.025],[-.25,0,0]);
      label((sign<0?['PFD','MAP','NAV']:['ALT','HDG','DATA'])[j],[sign*.53,y+.001,-.807+(.402+y)*-.25],[.036,.011],[-.25,0,0]);
    }
    for (const y of [-.39,-.665]) {
      rod('alloy','#717573',[sign*.564,y,-.84],[sign*.564,y,-.823],.008,8);
      block('paint',dark,[sign*.564,y,-.822],[.009,.002,.002],[0,0,.7],0);
    }
    // Raked support forks and inset screws holding the combiner glass.
    rod('paint',anthracite,[sign*.18,-.315,-1.075],[sign*.17,-.137,-1.104],.013,8);
    surface('alloy','#525c61',[
      [[sign*.205,-.312,-1.068],[sign*.162,-.313,-1.04]],
      [[sign*.175,-.146,-1.112],[sign*.159,-.163,-1.09]]
    ]);
    block('alloy','#626a6a',[sign*.179,-.3,-1.076],[.066,.017,.091],[0,0,0],.006);
    if (FLIGHT_RELIEF_ON) {
      for (const z of [-1.101,-1.050]) {
        const x=sign*.197;
        rod('rubber','#202324',[x,-.2915,z],[x,-.290,z],.0055,12);
        rod('alloy','#9d988c',[x,-.290,z],[x,-.287,z],.0037,6);
      }
    }
    rod('alloy','#666e6b',[sign*.17,-.15,-1.10],[sign*.17,-.15,-1.078],.012,10);
    block('paint','#303638',[sign*.178,-.119,-1.101],[.025,.084,.028],[-.09,0,-sign*.08],.006);
    block('rubber','#21272a',[sign*.34,-.717,-.788],[.38,.079,.045],[-.25,0,0],.009);
    for (let j=0;j<7;j++) {
      const x=sign*(.192+j*.047);
      block('paint','#353e3e',[x,-.709,-.761],[.036,.036,.021],[-.25,0,0]);
      block('alloy','#818e7e',[x,-.705,-.749],[.012,.002,.001],[-.25,0,0],0);
    }
  }
  block('rubber','#191d1e',[0,-.29,-1.037],[.246,.078,.16],[.02,0,0],.017);
  block('alloy','#424e4f',[0,-.25,-1.034],[.157,.012,.086],[.02,0,0]);
  block('alloy','#65877d',[0,-.243,-1.03],[.131,.004,.068],[.02,0,0],.007);
  label('FLIGHT  DISPLAY',[0,-.286,-.953],[.179,.015],[0,0,0]);
  for (const sign of [-1,1]) {
    // A raised demist grille and an inset annunciator below the coaming lip.
    const x=sign*.291;
    block('rubber','#1a2022',[x,-.333,-1.067],[.23,.027,.115],[0,0,-sign*.09],.012);
    for(let i=0;i<10;i++){
      const vx=x-.094+i*.021;
      block('alloy','#424a4d',[vx,-.318-sign*(vx-x)*.09,-1.062],[.006,.006,.076],[.09,sign*.24,-sign*.09],.002);
    }
    const y=-.378,z=-.89;
    block('paint','#1f282c',[x,y,z],[.208,.041,.040],[-.15,0,0],.008);
    label(sign<0?'NAV     SYNC':'AIR     DATA',[x,y+.002,z+.022],[.164,.017],[-.15,0,0]);
    block('alloy',sign<0?'#84aa6c':'#b0965a',[x-sign*.085,y+.002,z+.022],[.009,.008,.003],[-.15,0,0],.002);
  }
  // Faceted optical combiner; halo only on its cut polished edge. World
  // pixels remain visible in the clear space between and around the forks.
  const border = [[-.17,-.159],[.17,-.159],[.17,.018],[.131,.092],[-.131,.092],[-.17,.018]];
  function glassPoint(x,y) { return [x,y,-1.107-.12*(y+.16)]; }
  const tri = [];
  for(let i=1;i<border.length-1;i++)tri.push(...glassPoint(...border[0]),...glassPoint(...border[i]),...glassPoint(...border[i+1]));
  const glass = new BufferGeometry();
  glass.setAttribute('position',new Float32BufferAttribute(tri,3));
  scene.add(new Mesh(glass,new MeshBasicMaterial({color:'#31534b',opacity:.10,transparent:true,depthWrite:false,side:DoubleSide,toneMapped:false})));
  for(let i=0;i<border.length;i++)rod('alloy','#68918d',glassPoint(...border[i]),glassPoint(...border[(i+1)%border.length]),.0022,6);
  const hud = new Mesh(new PlaneGeometry(.319,.219),new MeshBasicMaterial({map:displays.hud.texture,transparent:true,depthWrite:false,toneMapped:false}));
  hud.position.set(0,-.034,-1.12);hud.rotation.x=-.12;hud.renderOrder=2;scene.add(hud);
  for (const [type,geometries] of Object.entries(bins)) {
    const geo = mergeGeometries(geometries);
    const mesh = new Mesh(geo, finish[type]);
    mesh.name = 'F35 cockpit ' + type;
    scene.add(mesh);
    for (const g of geometries) g.dispose();
  }
  const inkMap=new CanvasTexture(atlas);
  inkMap.colorSpace=SRGBColorSpace;inkMap.anisotropy=4;
  scene.add(new Mesh(mergeGeometries(decals),new MeshStandardMaterial({map:inkMap,roughness:.62,metalness:.16,side:DoubleSide})));
  for(const g of decals)g.dispose();
  return [metalMap,grain,wingMap,inkMap,...serviceMaps];
}

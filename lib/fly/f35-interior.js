/**
 * Original pilot-eye interior, built in metres around the seated eye. Opaque
 * parts with the same finish share a draw, including fasteners and stitching.
 * The panoramic flight display is recessed in its own angled instrument tray.
 */
import {
  BackSide, BoxGeometry, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry, DoubleSide,
  CanvasTexture, Float32BufferAttribute, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  Object3D, PlaneGeometry, SphereGeometry, SRGBColorSpace, TubeGeometry, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { applyCockpitSurface, cockpitFinishMap, wingFinish } from './cockpit-finishes.js';
import { fitServiceFinishes } from './cockpit-service-finish.js';
import { fitFlightDeck } from './f35-flight-deck.js';

const vec = (p) => new Vector3(...p);

export function buildF35Interior(scene, displays) {
  const metalMap=cockpitFinishMap(), wingMap=wingFinish();
  const finish = {
    paint: new MeshPhysicalMaterial({ vertexColors:true, roughness:.61, metalness:.19, clearcoat:.19, clearcoatRoughness:.37, side:DoubleSide }),
    rubber: new MeshStandardMaterial({ vertexColors:true, roughness:.82, metalness:.02, side:DoubleSide }),
    suit: new MeshPhysicalMaterial({ vertexColors:true, roughness:.92, sheen:.45, sheenColor:'#999782', sheenRoughness:.88, side:DoubleSide }),
    belt: new MeshStandardMaterial({ vertexColors:true, roughness:.73, side:DoubleSide }),
    alloy: new MeshStandardMaterial({ vertexColors: true, roughness: .32, metalness: .57,map:metalMap,bumpMap:metalMap,bumpScale:.00023,side: DoubleSide }),
  };
  const surfaceMaps = [
    applyCockpitSurface(finish.paint,'fascia',.00048),
    applyCockpitSurface(finish.rubber,'grip',.00075),
    applyCockpitSurface(finish.suit,'twill',.00085),
    applyCockpitSurface(finish.belt,'webbing',.0006),
  ];
  const bins = { paint: [], rubber: [], alloy: [], suit: [], belt: [] };
  const transform = new Object3D();
  const colors = new Color();
  const decals = [];
  const atlas = document.createElement('canvas');
  atlas.width = 512; atlas.height = 1024;
  const ink = atlas.getContext('2d');
  function label(words, p, size, r = [0,0,0], caution = false) {
    const line = decals.length;
    const y = line*48;
    if (caution) {
      ink.fillStyle = '#bdab6f'; ink.fillRect(0,y,512,46);
    }
    const labelWidth = Math.min(480, 38 * size[0] / size[1]);
    ink.font = '600 35px Arial, sans-serif';
    ink.textAlign='center';ink.fillStyle=caution?'#272724':'#d3d7ca';ink.fillText(words,256,y+35,labelWidth);
    const g = new PlaneGeometry(...size);
    transform.rotation.set(...r);transform.position.fromArray(p);transform.scale.set(1,1,1);transform.updateMatrix();g.applyMatrix4(transform.matrix);
    const uv = g.attributes.uv;
    for(let i=0;i<uv.count;i++){
      uv.setX(i,.5+(uv.getX(i)-.5)*labelWidth/atlas.width);
      uv.setY(i,1-(y+46-46*uv.getY(i))/atlas.height);
    }
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
    // Cloth is cut around the thigh. Keep its continuous cylindrical UV
    // seam, instead of changing projection axis halfway across a fold.
    const clothUv = type === 'suit' || type === 'belt' ? tri.getAttribute('uv') : null;
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
      uv[2*i]=clothUv ? clothUv.getX(i)*3.8 : (nx>ny&&nx>nz?z:x)*span;
      uv[2*i+1]=clothUv ? clothUv.getY(i)*(type==='belt'?.24:3.2) : (ny>nz&&ny>nx?z:y)*span;
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
  surface('paint', '#22282b', [arch(.729, .925, -.036), arch(.729, .925, .018)]);
  tube('rubber', '#13191a', arch(.723, .919, .013), .008, 62);
  tube('alloy', '#939797', arch(.772, .977, .011), .006, 62);
  tube('rubber', '#242725', arch(.783, .990, -.003), .007, 62);
  tube('alloy', '#58574d', arch(.791, .999, -.018), .0026, 62);
  for (let i = -8; i <= 8; i++) {
    const a = i * .182, p = bow(a, .749, .949, .029);
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
      block('alloy','#48535a',p,[.040,.061,.014],[0,0,-a*.77],.004);
      const q=[p[0],p[1],p[2]+.009];rod('paint','#20282b',q,[q[0],q[1],q[2]+.002],.008,16);
      rod('alloy','#747870',[q[0],q[1],q[2]+.002],[q[0],q[1],q[2]+.005],.005,10);
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
    label(sign<0 ? 'CONSOLE  LT' : 'CABIN  AIR',[sign*.52,-.631,-.35],[.14,.024],[-Math.PI/2+.14,0,0]);
    block('paint','#41494b',[sign*.43,-.626,-.39],[.093,.025,.12],[0,0,0],.009);
    rod('alloy','#6b7171',[sign*.43,-.613,-.39],[sign*.43,-.600,-.39],.030,20);
    rod('rubber','#222b2c',[sign*.43,-.60,-.39],[sign*.43,-.576,-.39],.025,14);
    block('alloy','#bdc3bc',[sign*.43,-.575,-.40],[.004,.002,.015],[0,0,0],0);
    const sx=sign*.678;
    block('paint','#35414a',[sx,-.579,-.62],[.019,.11,.17],[0,0,sign*.11],.008);
    label(sign<0 ? 'CANOPY  SEAL' : 'CANOPY  LATCH',[sx-sign*.013,-.59,-.62],[.134,.018],[0,-sign*Math.PI/2,0],sign>0);
    tube('alloy','#434e53',[[sx-sign*.014,-.572,-.68],[sx-sign*.04,-.552,-.68],[sx-sign*.041,-.546,-.58],[sx-sign*.018,-.566,-.58]],.007,12,8);
    // Flight suit knees and inset webbing below the instrument panel.
    const legPosition=[sign*.235,-.715,-.27], legRotation=[.28,sign*.13,sign*.12];
    const knee = new SphereGeometry(1,36,26).rotateX(Math.PI/2), vertices = knee.attributes.position;
    for (let i=0;i<vertices.count;i++) {
      const z=vertices.getZ(i), x=vertices.getX(i);
      const fold=.022*Math.sin(z*34+sign*x*4)*Math.exp(-((z+.12)**2)/.16);
      vertices.setY(i,vertices.getY(i)*(1+fold));
    }
    knee.computeVertexNormals();
    part('suit','#77816b',knee,legPosition,legRotation,[.15,.17,.39]);
    tube('suit','#777962',[[sign*.34,-.652,-.53],[sign*.36,-.610,-.39],[sign*.365,-.625,-.23],[sign*.36,-.665,-.11]],.003,20,6);
    const band=new SphereGeometry(1,36,3,0,Math.PI*2,Math.PI/2-.09,.135).rotateX(Math.PI/2);
    part('belt','#646a5f',band,legPosition,legRotation,[.155,.180,.394]);
    const buckle=vec([sign*.036,.178,.008]).applyEuler(transform.rotation).add(vec(legPosition));
    const buckleRotation=[.28,sign*.13,-sign*.11];
    block('alloy','#8a8a79',buckle.toArray(),[.055,.010,.053],buckleRotation,.004);
    buckle.y+=.006;
    block('rubber','#41483d',buckle.toArray(),[.039,.004,.037],buckleRotation,.002);
  }
  // The footwell, centre console, and fabric along the lower seat close the
  // view when the pilot looks down or uses a tall phone screen.
  block('rubber','#1a2024',[0,-.94,-.25],[1.20,.17,1.9],[0,0,0],.045);
  block('paint','#30373a',[0,-.90,-.75],[.195,.195,.32],[-.28,0,0],.022);
  for(let i=0;i<7;i++)block('rubber','#151c20',[0,-.841-i*.013,-.578+i*.002],[.132,.006,.009],[-.23,0,0]);
  // The forward deck marries the sloping nose and sill below the windshield.
  const nose = (w,y,z) => [[-w,y-.065,z],[0,y,z],[w,y-.065,z]];
  surface('paint','#495460',[nose(.43,-.394,-1.35),nose(.32,-.66,-2.15),nose(.07,-1.22,-3.68)]);
  // A padded coaming with a curved front silhouette, side cheeks and a
  // narrow stitched welt, above the recessed panoramic screen.
  const xs = Array.from({length:49},(_,i) => .68 * (i/24-1));
  const crown = x => {
    const shoulder = Math.max(0,(Math.abs(x)-.47)/.21);
    return -.275 - .024*(x/.53)**2 - .125*shoulder**2;
  };
  const row = (dz,dy,spread=1) => xs.map(x=>[x*spread,crown(x)+dy,-.89+dz-.040*(1-(x/.68)**2)]);
  const serviceMaps = fitServiceFinishes(scene,crown,bow);
  // Close the bay behind the display all the way to the sills. Otherwise
  // the ground shows through the narrow gap beside each fascia corner.
  surface('paint','#343a3d',[
    row(-.29,-.10,.91),row(-.25,-.22,1.03),row(-.18,-.46,1.07),row(-.10,-.69,1.04),
  ]);
  surface('paint','#343a3d',[row(.027,-.067),row(-.014,-.080,.98)]);
  tube('rubber','#343a39',row(.041,-.018),.0038,48);
  tube('alloy','#474c4a',row(.041,-.041),.0032,46);
  for (let i=0;i<70;i++) {
    const x=-.66+i*.019;
    const dy=-.004, thread='#827c6d';
    rod('rubber',thread,[x,crown(x)+dy,-.868-.04*(1-(x/.68)**2)],[x+.008,crown(x+.008)+dy,-.868-.04*(1-((x+.008)/.68)**2)],.0013,4);
  }
  // Demister ducts follow the crown. Recessed slats and countersunk
  // retaining rings break the grazing highlight across the glareshield.
  for (const side of [-1,1]) {
    const x=side*.315;
    const base=crown(x)-.028;
    block('rubber','#151b1c',[x,base,-1.124],[.243,.031,.094],[.12,0,-side*.13],.013);
    for (let j=0;j<12;j++) {
      const dx=(j-5.5)*.017;
      block('alloy','#505557',[x+dx,base+.014-side*dx*.13,-1.124],[.004,.006,.072],[.12,-side*.32,-side*.13],.001);
    }
    // Layered cheek plates carry the glass unit into the side consoles.
    const cheek = (z, inset) => [[side*(.48-inset),-.36,z],[side*(.58-inset),-.39,z],
      [side*(.68-inset),-.48,z],[side*(.63-inset),-.73,z],[side*(.49-inset),-.75,z]];
    surface('paint','#41484a',[cheek(-.99,0),cheek(-.79,-.02),cheek(-.74,.012)]);
    const seam=[[side*.573,-.402,-.763],[side*.637,-.477,-.741],[side*.61,-.672,-.741]];
    tube('rubber','#171c1f',seam,.0045,12);
    for (const [x,y,z] of seam)
      rod('alloy','#747a79',[x,y,z],[x,y,z+.004],.006,8);

    // Forward canopy sill and avionics cabling recede into the footwell.
    for(let j=0;j<3;j++){
      const z=-.81+j*.018;
      tube('rubber','#252b2c',[[side*.575,-.68,z],[side*.6,-.72,z+.04],
        [side*.6,-.76,z+.11],[side*.54,-.795,z+.20]],.008,13,6);
    }
  }
  const panel = fitFlightDeck(scene,displays,{block,rod,label});

  // This is shell glazing only; the outside world remains the main camera's
  // live render. Rough coating at glancing angles picks up the sky environment.
  const canopy=new Mesh(new SphereGeometry(1,64,34,0,Math.PI*2,0,Math.PI*.51),
    new MeshPhysicalMaterial({color:'#a8a68c',roughness:.20,metalness:.19,clearcoat:.85,
      clearcoatRoughness:.12,envMapIntensity:.42,transparent:true,opacity:.034,
      depthWrite:false,side:BackSide}));
  canopy.scale.set(.81,1.30,2.20); canopy.position.set(0,-.53,-.04);
  canopy.renderOrder=1; scene.add(canopy);

  function flushParts(parent) {
    for (const [type,geometries] of Object.entries(bins)) {
      if (!geometries.length) continue;
      const mesh=new Mesh(mergeGeometries(geometries),finish[type]);
      mesh.name='F35 cockpit '+type;
      parent.add(mesh);
      for(const geo of geometries) geo.dispose();
      geometries.length=0;
    }
  }
  // Flexible bellows and throttle quadrant remain fixed to their consoles.
  for(let j=0;j<4;j++)
    rod('rubber',j%2?'#323738':'#202626',[.487,-.647+j*.012,-.18],[.487,-.632+j*.012,-.18],.068-.008*j,24,.060-.008*j);
  block('alloy','#606668',[-.483,-.635,-.175],[.148,.022,.33],[0,0,0],.012);
  block('rubber','#171b1c',[-.483,-.621,-.175],[.100,.016,.30],[0,0,0],.009);
  for(let j=0;j<7;j++){
    block('paint','#a8a897',[-.545,-.619,-.285+j*.036],[.014,.002,.002],[0,0,0],0);
  }
  flushParts(scene);

  const stick=new Object3D();
  stick.position.set(.487,-.591,-.18); scene.add(stick);
  tube('rubber','#373c3e',[[0,0,0],[-.004,.038,.005],[-.013,.082,.018],
    [-.017,.134,.015],[-.016,.172,-.003]],.027,24,14);
  part('rubber','#41484a',new SphereGeometry(1,24,16),[-.025,.167,.005],[-.24,.16,.15],[.047,.047,.040]);
  rod('alloy','#535c5e',[-.048,.180,.028],[-.048,.184,.036],.013,16);
  rod('rubber','#676f68',[-.048,.184,.036],[-.048,.186,.041],.009,12);
  for(let j=0;j<3;j++)
    tube('rubber','#252b2d',[[-.033,.067+j*.023,.016],[-.015,.071+j*.022,.041],[.006,.077+j*.022,.034]],.004,9);
  flushParts(stick);

  const throttle=new Object3D();
  throttle.position.set(-.483,-.62,-.175); scene.add(throttle);
  rod('alloy','#515b60',[0,0,0],[.002,.066,-.013],.015,12);
  block('rubber','#333a3c',[0,.083,-.014],[.13,.057,.069],[-.19,0,.09],.023);
  block('paint','#4d5658',[.012,.102,-.021],[.080,.022,.041],[-.2,0,.09],.009);
  for(let j=0;j<5;j++)
    tube('rubber','#202728',[[-.049+j*.020,.065,.016],[-.049+j*.020,.084,.023],[-.049+j*.020,.103,.015]],.0028,8);
  flushParts(throttle);
  const inkMap=new CanvasTexture(atlas);
  inkMap.colorSpace=SRGBColorSpace;inkMap.anisotropy=4;
  scene.add(new Mesh(mergeGeometries(decals),new MeshStandardMaterial({map:inkMap,alphaTest:.24,roughness:.62,metalness:.16,side:DoubleSide})));
  for(const g of decals)g.dispose();
  return { maps:[metalMap,wingMap,inkMap,...serviceMaps,...surfaceMaps], panel, stick, throttle };
}

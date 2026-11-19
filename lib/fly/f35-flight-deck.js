import { Mesh, MeshPhysicalMaterial, PlaneGeometry } from 'three';

// All fascia hardware is placed in the plane of the tilted display. Depth is
// measured from the outer glass, so the rings, fasteners and keys cast their
// own silhouettes even viewed edge-on from the seat.
export function fitFlightDeck(scene, displays, { block, rod, label }) {
  const rake = -.36, sin = Math.sin(rake), cos = Math.cos(rake);
  const mount = (x,y,z) => [x, -.58+y*cos-z*sin, -.905+y*sin+z*cos];
  const rotation = [rake,0,0];
  const slab = (type,color,x,y,z,w,h,d,radius) =>
    block(type,color,mount(x,y,z),[w,h,d],rotation,radius);
  const disc = (type,color,x,y,base,cap,r,segments) =>
    rod(type,color,mount(x,y,base),mount(x,y,cap),r,segments);
  const legend = (name,x,y,z,w,h) => label(name,mount(x,y,z),[w,h],rotation);

  slab('paint','#353c41',0,0,-.069,1.19,.518,.118,.025);
  slab('alloy','#657077',0,0,-.020,1.045,.427,.026,.012);
  slab('rubber','#151b1d',0,0,-.009,1.034,.417,.022,.012);
  const glass = new MeshPhysicalMaterial({
    color:'#11191b', roughness:.36, metalness:.16, clearcoat:.55, clearcoatRoughness:.19,
    emissive:0xffffff, emissiveMap:displays.panel.texture, envMapIntensity:.26, toneMapped:false,
  });
  const panel = new Mesh(new PlaneGeometry(1,.40),glass);
  panel.position.fromArray(mount(0,0,.004)); panel.rotation.x=rake; scene.add(panel);

  for (const side of [-1,1]) {
    const x = side*.551;
    const names = side<0 ? ['PFD','NAV','MAP'] : ['ALT','HDG','DATA'];
    for (let i=0;i<names.length;i++) {
      const y=.119-i*.064;
      slab('rubber','#151a1d',x,y,-.003,.066,.047,.024,.005);
      slab('paint','#454b4c',x,y,.010,.052,.034,.012,.004);
      legend(names[i],x,y,.017,.036,.015);
    }
    const y=-.134;
    disc('alloy','#899291',x,y,-.010,.000,.031,28);
    disc('paint','#22292c',x,y,.001,.027,.025,32);
    for(let j=0;j<18;j++) {
      const a=j*Math.PI/9, dx=.024*Math.cos(a), dy=.024*Math.sin(a);
      rod('rubber','#41474a',mount(x+dx,y+dy,.004),mount(x+dx,y+dy,.024),.0024,5);
    }
    disc('rubber','#414749',x,y,.027,.032,.020,24);
    slab('paint','#d1c9a9',x+.004,y+.011,.033,.003,.012,.002,.0005);
    legend(side<0?'BRT':'VOL',x,y-.045,.002,.045,.014);
    for(const yy of [-.225,.224]) {
      disc('paint','#191f22',x,yy,-.010,-.004,.009,16);
      disc('alloy','#888c87',x,yy,-.004,-.001,.0068,12);
      block('paint','#24292c',mount(x,yy,0),[.009,.002,.0015],[rake,0,.65*side],0);
    }
  }
  // The glass fits inside a continuous compressible seal. A slim reveal
  // above it catches reflected sky without putting a shine across the LCD.
  slab('alloy','#626a6a',0,.215,-.004,.97,.004,.005,.001);
  for(const side of [-1,1]) {
    const x=side*.353;
    slab('rubber','#171c1f',x,-.227,-.003,.21,.020,.012,.002);
    for(let j=0;j<9;j++)
      slab('paint','#464e4f',x-.088+j*.022,-.227,.004,.003,.014,.003,.0008);
  }
  // Independent standby attitude window in a shrouded instrument pod. Its
  // UVs sample the actual PFD attitude picture on the same dynamic texture.
  const podX=-.19;
  block('paint','#4c5355',[podX,-.258,-1.095],[.182,.111,.178],[-.20,0,0],.012);
  block('rubber','#252b2c',[podX,-.239,-1.007],[.159,.096,.020],[-.20,0,0],.007);
  const standbyGeo=new PlaneGeometry(.137,.074);
  const uv=standbyGeo.attributes.uv;
  for(let i=0;i<uv.count;i++) {
    uv.setXY(i,(76+uv.getX(i)*224)/1000,(400-280+uv.getY(i)*169)/400);
  }
  const standby=new Mesh(standbyGeo,glass);
  standby.rotation.x=-.20; standby.position.set(podX,-.239,-.994); scene.add(standby);
  block('paint','#4d5453',[podX,-.188,-1.011],[.177,.009,.049],[-.15,0,0],.003);
  for(const side of [-1,1]){
    const x=podX+side*.082;
    rod('alloy','#9a9b8f',[x,-.211,-1.013],[x,-.211,-1.008],.0034,10);
  }
  return glass;
}

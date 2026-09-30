/** First-party Vector airframe. No downloaded geometry, textures, or trademarks.
 * Reproducible hero + mobile LOD; metres, nose -Z. Run with Node. */
import fs from 'node:fs';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, SphereGeometry, CylinderGeometry, TorusGeometry, BoxGeometry, TubeGeometry, CatmullRomCurve3, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
};

function build(low) {
  const materials = {
    hull: new MeshStandardMaterial({ name: 'Painted pearl alloy', color: '#9dabb1', roughness: .38, metalness: .12 }),
    trim: new MeshStandardMaterial({ name: 'Midnight wing panels', color: '#263b48', roughness: .36, metalness: .22 }),
    accent: new MeshStandardMaterial({ name: 'Copper recognition stripe', color: '#bd6038', roughness: .32, metalness: .28 }),
    metal: new MeshStandardMaterial({ name: 'Exposed titanium nozzle', color: '#64717c', roughness: .29, metalness: .82 }),
    dark: new MeshStandardMaterial({ name: 'Intake interior', color: '#101b24', roughness: .58, metalness: .12 }),
    glass: new MeshStandardMaterial({ name: 'Canopy glass', color: '#284354', roughness: .1, metalness: .3 }),
  };
  const buckets = Object.fromEntries(Object.keys(materials).map(k => [k, []]));
  function add(g, role, p = [0,0,0], rot = [0,0,0]) {
    g.rotateX(rot[0]); g.rotateY(rot[1]); g.rotateZ(rot[2]); g.translate(...p);
    const plain = g.index ? g.toNonIndexed() : g;
    plain.deleteAttribute('uv'); buckets[role].push(plain);
  }
  function seam(points, radius=.022, role='trim') {
    add(new TubeGeometry(new CatmullRomCurve3(points.map(p=>new Vector3(...p))), low?12:28, radius, low?3:4, false),role);
  }
  function loft(sections, role, ox = 0, oy = 0) {
    const n = low ? 16 : 32, p = [], ix = [];
    for (const [z, rx, ry, cy] of sections) for (let j = 0; j <= n; j++) {
      const a = j/n*Math.PI*2; p.push(ox+Math.cos(a)*rx, oy+cy+Math.sin(a)*ry, z);
    }
    for (let i = 0; i < sections.length-1; i++) for (let j = 0; j < n; j++) {
      const a = i*(n+1)+j, b = a+n+1; ix.push(a,a+1,b,b,a+1,b+1);
    }
    const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(p,3)); g.setIndex(ix); g.computeVertexNormals(); add(g,role);
  }
  const body=[[-10,.015,.015,0],[-8.7,.34,.24,.02],[-6.7,.72,.5,.05],[-4.5,1.15,.7,.08],[-1.5,1.65,.8,.1],[2.5,1.8,.72,.08],[5.8,1.65,.56,0],[8.1,.85,.35,-.06],[8.4,.1,.08,-.06]];
  loft(body, 'hull');
  function top(x,z){
    const i=body.findIndex((p,i)=>i<body.length-1&&z>=p[0]&&z<=body[i+1][0]);
    const a=body[i],b=body[i+1],t=(z-a[0])/(b[0]-a[0]);
    const rx=a[1]+(b[1]-a[1])*t,ry=a[2]+(b[2]-a[2])*t,cy=a[3]+(b[3]-a[3])*t;
    return cy+ry*Math.sqrt(Math.max(0,1-(x/rx)**2))+.01;
  }
  // Cambered wedge surfaces: separate upper/lower skins and bevelled edge.
  function wing(points, y, thickness, role, vertical = false) {
    const p=[], ix=[], n=points.length;
    for (const d of [-1,1]) for(const [x,z] of points) p.push(x,y+d*thickness/2,z);
    for(let j=1;j<n-1;j++){ix.push(0,j,j+1,n,n+j+1,n+j);}
    for(let j=0;j<n;j++){const k=(j+1)%n;ix.push(j,n+j,k,k,n+j,n+k);}
    const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();
    if(vertical)g.rotateZ(Math.PI/2);add(g,role);
  }
  for (const side of [-1,1]) {
    const mirror = pts => side===1 ? pts : pts.map(([x,z])=>[-x,z]).reverse();
    wing(mirror([[1.2,-3.4],[8.9,3.5],[8.6,5.2],[2.4,5.4],[1.3,3.4]]),-.02,.22,'hull');
    wing(mirror([[3.2,.1],[8.5,3.9],[8.25,4.5],[3.2,3.3]]),.105,.016,'trim');
    wing(mirror([[7.3,3.2],[8.6,4.12],[8.48,4.45],[7.14,3.65]]),.12,.018,'accent');
    wing(mirror([[1.2,4.8],[4.95,7.1],[4.7,8.9],[1.3,7.5]]),.25,.17,'hull');
    // Authored control-surface joints and maintenance panels. They follow the
    // wing silhouette, instead of stamping a world-space grid onto the hull.
    seam([[side*2.9,.122,4.45],[side*5.4,.122,4.43],[side*8.48,.122,4.60]],.022);
    seam([[side*3.15,.122,1.03],[side*3.15,.122,3.63],[side*5.35,.122,4.43]],.019);
    seam([[side*1.55,.346,6.78],[side*3.25,.346,7.7],[side*4.70,.346,8.0]],.02);
    // House insignia and two recognition bars: solid geometry, no fonts,
    // brand assets or additional materials. Large enough for chase distance.
    wing(mirror([[4.35,2.40],[5.35,3.08],[4.35,3.77],[4.75,3.06]]),.135,.008,'hull');
    for(let j=0;j<2;j++)wing(mirror([[5.65+j*.28,3.48],[5.82+j*.28,3.60],[5.82+j*.28,4.08],[5.65+j*.28,3.98]]),.132,.008,'hull');
    // Swept and canted twin tail, expressed as an extruded fin in X/Y/Z.
    const tail = new BufferGeometry();
    const x=side*1.85, v=[x,.3,4.1, x+side*.7,3.6,6.15, x+side*.75,3.35,8.8, x,.3,7.9];
    const all=[...v,...v.map((q,i)=>i%3===0?q+side*.12:q)];
    const tailIndex=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,4,1,5,4,1,2,5,2,6,5,2,3,6,3,7,6,3,0,7,0,4,7];
    // Reflection changes handedness: keep both fins' normals facing outward.
    if(side<0)for(let i=0;i<tailIndex.length;i+=3)[tailIndex[i+1],tailIndex[i+2]]=[tailIndex[i+2],tailIndex[i+1]];
    tail.setAttribute('position',new Float32BufferAttribute(all,3));tail.setIndex(tailIndex);tail.computeVertexNormals();add(tail,'trim');
    loft([[-1.8,.85,.65,-.4],[1.2,.9,.66,-.35],[5.9,.76,.62,-.35],[7.7,.66,.61,-.35]],'hull',side*1.65);
    const seg=low?16:32;
    add(new CylinderGeometry(.64,.71,1.05,seg,1,true),'metal',[side*1.65,-.35,7.75],[Math.PI/2,0,0]);
    // Recessed throat, inward-facing nozzle lining, and a real lip. The old
    // disk sat at the mouth, making the exhaust look like a painted circle.
    const lining=new CylinderGeometry(.575,.38,.88,seg,1,true);
    const ids=lining.index.array;for(let i=0;i<ids.length;i+=3)[ids[i+1],ids[i+2]]=[ids[i+2],ids[i+1]];
    const normals=lining.attributes.normal;for(let i=0;i<normals.count;i++)normals.setXYZ(i,-normals.getX(i),-normals.getY(i),-normals.getZ(i));
    add(lining,'dark',[side*1.65,-.35,7.80],[Math.PI/2,0,0]);
    add(new CylinderGeometry(.38,.38,.05,seg),'dark',[side*1.65,-.35,7.34],[Math.PI/2,0,0]);
    add(new TorusGeometry(.42,.025,4,seg),'metal',[side*1.65,-.35,7.50]);
    add(new TorusGeometry(.64,.07,6,seg),'metal',[side*1.65,-.35,8.28]);
    add(new CylinderGeometry(.60,.63,.2,seg),'dark',[side*1.65,-.4,-1.8],[Math.PI/2,0,0]);
    if(!low)for(let j=0;j<16;j++){
      const a=j/16*Math.PI*2;
      add(new BoxGeometry(.055,.045,.84),'dark',[side*1.65+Math.cos(a)*.67,-.35+Math.sin(a)*.64,7.8],[0,0,a]);
    }
  }
  const canopy=new SphereGeometry(1,low?20:40,low?12:24);canopy.scale(.68,.73,2.3);add(canopy,'glass',[0,.75,-3.7]);
  // Frames lie on the actual ellipsoid, including a continuous sill and two
  // transverse arches. A free-floating circular torus cannot fit this canopy.
  for(const z of [-4.85,-2.45]){
    const section=Math.sqrt(1-((z+3.7)/2.3)**2),pts=[];
    for(let i=0;i<=12;i++){const a=i/12*Math.PI;pts.push([Math.cos(a)*.688*section,.75+Math.sin(a)*.738*section,z]);}
    seam(pts,.043,'trim');
  }
  for(const side of [-1,1]){
    const pts=[];for(let i=0;i<=20;i++){const a=i/20*Math.PI;pts.push([side*Math.sin(a)*.688,.77,-3.7+Math.cos(a)*2.30]);}seam(pts,.045,'trim');
  }
  // Conformal dorsal panels around the spine and service hatches aft of it.
  for(const side of [-1,1])seam([[-1.1,.54],[1.1,.57],[2.2,.52]].map(([z,x])=>[side*x,top(x,z),z]),.024);
  for(const z of [2.8,3.6,4.4])add(new BoxGeometry(.54,.024,.065),'trim',[0,top(0,z),z]);
  // Spine and a narrow contrasting nose panel give readable scale without texture shimmer.
  loft([[-8.4,.1,.03,.26],[-6,.22,.035,.61],[-5.9,.22,.035,.62]],'trim');
  seam([-.95,.3,1.55].map(z=>[0,top(0,z),z]),.055,'accent');
  const root=new Group();root.name='Vector — Skyloom original';
  root.userData={author:'Skyloom',license:'MIT',revision:2,units:'metres',nose:'-Z',lod:low?'mobile':'hero',engineAnchors:[[-1.65,-.35,8.28],[1.65,-.35,8.28]]};
  let triangles=0;
  for(const [role,list] of Object.entries(buckets))if(list.length){
    const g=mergeGeometries(list);triangles+=g.attributes.position.count/3;
    const mesh=new Mesh(g,materials[role]);mesh.name=role==='glass'?'canopy':role;root.add(mesh);
  }
  return {root,triangles};
}
const exporter=new GLTFExporter(),receipt=[];
for(const low of [false,true]){
  const {root,triangles}=build(low),file=`public/models/player-vector-${low?'mobile':'hero'}-v2.glb`;
  const data=await exporter.parseAsync(root,{binary:true});fs.writeFileSync(file,Buffer.from(data));receipt.push({file,triangles,bytes:data.byteLength});
}
console.log(JSON.stringify(receipt,null,2));

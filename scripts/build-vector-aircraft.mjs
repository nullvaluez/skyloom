/** First-party Vector airframe. No downloaded geometry, textures, or trademarks.
 * Reproducible hero + mobile LOD; metres, nose -Z. Run with Node. */
import fs from 'node:fs';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, SphereGeometry, CylinderGeometry, TorusGeometry, BoxGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(result => { this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`; this.onloadend?.(); }); }
};

function build(low) {
  const materials = {
    hull: new MeshStandardMaterial({ name: 'Painted pearl alloy', color: '#b6c3c8', roughness: .3, metalness: .18 }),
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
  loft([[-10,.015,.015,0],[-8.7,.34,.24,.02],[-6.7,.72,.5,.05],[-4.5,1.15,.7,.08],[-1.5,1.65,.8,.1],[2.5,1.8,.72,.08],[5.8,1.65,.56,0],[8.1,.85,.35,-.06],[8.4,.1,.08,-.06]], 'hull');
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
    add(new CylinderGeometry(.54,.54,.14,seg),'dark',[side*1.65,-.35,8.22],[Math.PI/2,0,0]);
    add(new TorusGeometry(.64,.07,6,seg),'metal',[side*1.65,-.35,8.28]);
    add(new CylinderGeometry(.60,.63,.2,seg),'dark',[side*1.65,-.4,-1.8],[Math.PI/2,0,0]);
    if(!low)for(let j=0;j<16;j++){
      const a=j/16*Math.PI*2;
      add(new BoxGeometry(.055,.045,.84),'dark',[side*1.65+Math.cos(a)*.67,-.35+Math.sin(a)*.64,7.8],[0,0,a]);
    }
  }
  const canopy=new SphereGeometry(1,low?20:40,low?12:24);canopy.scale(.68,.73,2.3);add(canopy,'glass',[0,.75,-3.7]);
  const frame=new TorusGeometry(.68,.043,6,low?20:40);frame.scale(1,1,1);add(frame,'metal',[0,.87,-2.8],[.32,0,0]);
  // Spine and a narrow contrasting nose panel give readable scale without texture shimmer.
  loft([[-8.4,.1,.03,.26],[-6,.22,.035,.61],[-5.9,.22,.035,.62]],'trim');
  add(new BoxGeometry(.22,.035,2.5),'accent',[0,.84,.3]);
  const root=new Group();root.name='Vector — Skyloom original';
  root.userData={author:'Skyloom',license:'MIT',units:'metres',nose:'-Z',lod:low?'mobile':'hero',engineAnchors:[[-1.65,-.35,8.28],[1.65,-.35,8.28]]};
  let triangles=0;
  for(const [role,list] of Object.entries(buckets))if(list.length){
    const g=mergeGeometries(list);triangles+=g.attributes.position.count/3;
    const mesh=new Mesh(g,materials[role]);mesh.name=role==='glass'?'canopy':role;root.add(mesh);
  }
  return {root,triangles};
}
const exporter=new GLTFExporter(),receipt=[];
for(const low of [false,true]){
  const {root,triangles}=build(low),file=`public/models/player-vector-${low?'mobile':'hero'}-v1.glb`;
  const data=await exporter.parseAsync(root,{binary:true});fs.writeFileSync(file,Buffer.from(data));receipt.push({file,triangles,bytes:data.byteLength});
}
console.log(JSON.stringify(receipt,null,2));

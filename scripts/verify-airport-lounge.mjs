import assert from 'node:assert/strict';
import {createAirportLounge} from '../lib/fly/airport-lounge.js';

// Geometry/resource contract only; actual texture pixels are browser-reviewed.
globalThis.document={createElement:()=>({getContext:()=>new Proxy({},{get:(o,k)=>o[k]??(k==='createRadialGradient'?()=>({addColorStop(){}}):()=>{}),set:(o,k,v)=>(o[k]=v,true)})})};
const room=createAirportLounge();
assert.ok(room.meshes.length<=6,'room must remain six merged draws or fewer');
let tris=0,bytes=0,disposed=0;
for(const {geometry,material} of room.meshes){
  assert.ok(geometry.boundingSphere.radius>0);
  for(const attribute of Object.values(geometry.attributes)) {assert.ok([...attribute.array].every(Number.isFinite));bytes+=attribute.array.byteLength;}
  tris+=geometry.attributes.position.count/3;
  geometry.addEventListener('dispose',()=>disposed++);material.addEventListener('dispose',()=>disposed++);
}
assert.ok(tris<30000,'close-up furnishing remains under 30k triangles');
assert.ok(bytes<5000000,'room geometry stays bounded');
for(const texture of room.textures)texture.addEventListener('dispose',()=>disposed++);
room.dispose();assert.equal(disposed,room.meshes.length*2+room.textures.length,'every owned GPU resource is released');
console.log(`PASS lounge: ${room.meshes.length} draws, ${tris} triangles, ${bytes} geometry bytes; finite geometry and complete disposal`);
delete globalThis.document;

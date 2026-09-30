// Original periodic Perlin/Worley-style volume. Shared decoded bytes supply the
// GPU and cloud-passage sampler. Loading never allocates a desktop-only volume.
export const CLOUD_VOLUME_SIZE=64;
let bytes=null,pending=null;
export function loadCinemaCloudVolume(){
  return pending??=(fetch('/materials/cinema-v1/cloud-density.rg').then(r=>{
    if(!r.ok)throw Error(`Cloud density: ${r.status}`);return r.arrayBuffer();
  }).then(b=>{if(b.byteLength!==64**3*2)throw Error('Invalid cloud volume');bytes=new Uint8Array(b);return bytes;}).catch(e=>{pending=null;throw e;}));
}
export function sampleCinemaCloudVolume(x,y,z,channel=0){
  if(!bytes)return 0;
  // q is in 1024 m units; one volume repeats over 8192 projected metres.
  const p=[x*8-.5,y*8-.5,z*8-.5],i=p.map(Math.floor),f=p.map((v,k)=>v-i[k]);let value=0;
  const wrap=v=>((v%64)+64)%64;
  for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
    const w=(dx?f[0]:1-f[0])*(dy?f[1]:1-f[1])*(dz?f[2]:1-f[2]);
    value+=bytes[(wrap(i[0]+dx)+64*(wrap(i[1]+dy)+64*wrap(i[2]+dz)))*2+channel]/255*w;
  }
  return value;
}

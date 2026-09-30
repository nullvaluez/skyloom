/** Original Skyloom material arrays, with device sizes selected before fetch.
 * BC3 blocks follow EXT_texture_compression_s3tc, with explicit linear-light
 * color mipmaps and independently filtered roughness/data channels. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {buildMaterialArrays,MATERIAL_NAMES} from '../lib/fly/cinematic-material-data.js';
const out='public/materials/cinema-v1';
const toLinear=n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4;
const toSRGB=n=>n<=.0031308?n*12.92:1.055*n**(1/2.4)-.055;
const c565=c=>((Math.round(c[0]*31/255)<<11)|(Math.round(c[1]*63/255)<<5)|Math.round(c[2]*31/255));
const rgb=c=>[(c>>11)*255/31,((c>>5)&63)*255/63,(c&31)*255/31];
function encode(data,size){
 const blocks=Math.ceil(size/4),buffer=new Uint8Array(blocks*blocks*8*16),pixels=Array.from({length:16},()=>new Uint8Array(4));
 let at=0;
 for(let layer=0;layer<8;layer++)for(let by=0;by<blocks;by++)for(let bx=0;bx<blocks;bx++){
  const min=[255,255,255,255],max=[0,0,0,0];
  for(let i=0;i<16;i++){
   const x=Math.min(size-1,bx*4+i%4),y=Math.min(size-1,by*4+(i>>2));
   for(let c=0;c<4;c++){const v=data[((layer*size+y)*size+x)*4+c];pixels[i][c]=v;min[c]=Math.min(min[c],v);max[c]=Math.max(max[c],v);}
  }
  buffer[at]=max[3];buffer[at+1]=min[3];
  const alpha=[max[3],min[3],...Array.from({length:6},(_,i)=>((6-i)*max[3]+(i+1)*min[3])/7)];
  const c0=c565(max),c1=c565(min),a=rgb(c0),b=rgb(c1),palette=[a,b,a.map((v,c)=>(2*v+b[c])/3),a.map((v,c)=>(v+2*b[c])/3)];
  buffer[at+8]=c0&255;buffer[at+9]=c0>>8;buffer[at+10]=c1&255;buffer[at+11]=c1>>8;
  for(let i=0;i<16;i++){
   let ai=0,ci=0,ae=Infinity,ce=Infinity;
   for(let j=0;j<8;j++){const e=Math.abs(alpha[j]-pixels[i][3]);if(e<ae){ae=e;ai=j;}}
   for(let j=0;j<4;j++){const e=palette[j].reduce((s,v,c)=>s+(v-pixels[i][c])**2,0);if(e<ce){ce=e;ci=j;}}
   const bit=i*3,byte=bit>>3,shift=bit&7;
   buffer[at+2+byte]|=ai<<shift;if(shift>5)buffer[at+3+byte]|=ai>>(8-shift);
   buffer[at+12+(i>>2)]|=ci<<((i&3)*2);
  }
  at+=16;
 }
 return buffer;
}
function halve(data,size,color){
 const next=Math.max(1,size>>1),out=new Uint8Array(next*next*8*4);
 for(let layer=0;layer<8;layer++)for(let y=0;y<next;y++)for(let x=0;x<next;x++)for(let c=0;c<4;c++){
  let sum=0;for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
   const v=data[((layer*size+y*2+dy)*size+x*2+dx)*4+c]/255;sum+=color&&c<3?toLinear(v):v;
  }
  out[((layer*next+y)*next+x)*4+c]=Math.round((color&&c<3?toSRGB(sum/4):sum/4)*255);
 }
 return out;
}
fs.mkdirSync(out,{recursive:true});
const manifest={version:1,license:'MIT',author:'Skyloom',generator:'scripts/build-cinema-materials.mjs',layers:MATERIAL_NAMES,variants:{}};
for(const size of [128,256,512,1024]){
 const arrays=buildMaterialArrays(size),entry={size,layers:8,files:{}};
 for(const name of ['color','detail']){
  const raw=arrays[name],rawPath=`${size}-${name}.rgba`;fs.writeFileSync(`${out}/${rawPath}`,raw);
  let data=raw,width=size,offset=0;const levels=[],chunks=[];
  for(;;){const bytes=encode(data,width);levels.push({width,height:width,offset,length:bytes.length});offset+=bytes.length;chunks.push(bytes);if(width===1)break;data=halve(data,width,name==='color');width=Math.max(1,width>>1);}
  const bc3=Buffer.concat(chunks),bc3Path=`${size}-${name}.bc3`;fs.writeFileSync(`${out}/${bc3Path}`,bc3);
  entry.files[name]={rgba:{file:rawPath,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex')},bc3:{file:bc3Path,bytes:bc3.length,levels,sha256:crypto.createHash('sha256').update(bc3).digest('hex')}};
 }
 manifest.variants[size]=entry;console.log(`Built original ${size}px material arrays`);
}
fs.writeFileSync(`${out}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');

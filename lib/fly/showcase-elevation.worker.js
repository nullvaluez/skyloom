import { buildRegionalElevation } from './showcase-elevation-core';
import { reliefFromGrid } from './r25-relief';
let fieldPromise=null,fieldSize=0;
async function loadField(size){
 if(fieldPromise&&size===fieldSize)return fieldPromise;
 fieldSize=size;
 fieldPromise=(async()=>{
  const root='/regions/yosemite-v1',r=await fetch(`${root}/manifest.json`,{signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error(`Regional manifest: ${r.status}`);const manifest=await r.json(),v=manifest.variants[size];
  if(!v)throw Error('Unsupported regional elevation tier');
  const response=await fetch(`${root}/${v.file}`,{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error(`Regional DEM: ${response.status}`);
  const buffer=await response.arrayBuffer();if(buffer.byteLength!==v.bytes)throw Error('Truncated regional DEM');
  const digest=await crypto.subtle.digest('SHA-256',buffer),sha=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  if(sha!==v.sha256)throw Error('Regional DEM checksum mismatch');
  return {...v,bounds:manifest.bounds,data:new Uint16Array(buffer),edgeM:manifest.edgeBlendM};
 })();
 fieldPromise.catch(()=>{fieldPromise=null;});return fieldPromise;
}
self.onmessage=async({data:request})=>{
 try{
  const field=await loadField(request.size),result=buildRegionalElevation({...request,field,edgeM:field.edgeM});
  const relief=request.reliefPx>1?reliefFromGrid(result.dem,result.gridSize,result.gridSize,request.z,request.reliefPx):null;
  delete result.dem;delete result.gridSize;if(relief)result.r25Relief=relief;
  const transfer=[result.indices.buffer,...Object.values(result.attributes).map(a=>a.value.buffer)];if(relief)transfer.push(relief.buffer);
  self.postMessage({id:request.id,result,fieldBytes:field.data.byteLength},transfer);
 }catch(error){self.postMessage({id:request.id,error:String(error.message)});}
};

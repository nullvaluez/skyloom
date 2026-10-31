// Optional offline-build input acquisition. Never called by the application.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const dir=process.argv[2]??'.graphics-review/landmark-fidelity/opera-source';
fs.mkdirSync(dir,{recursive:true});
for(const [file,hash]of [['scene.gltf','0d3b533d3dfd0c90a024d0b59121259fd4846b0a879d90f8a07a61ece38594fb'],['scene.bin','690fb7caffbe3e45e149a5aea82f267e97527ac234614b4f517437e722b74c9b']]){
  const r=await fetch('https://s3.us-east-005.backblazeb2.com/icosa-gallery/poly/1viSkN0IJ-6/'+file);
  if(!r.ok)throw Error(`${file}: HTTP ${r.status}`);
  let data=Buffer.from(await r.arrayBuffer());
  if(file.endsWith('.gltf'))data=Buffer.from(JSON.stringify(JSON.parse(data)));
  if(createHash('sha256').update(data).digest('hex')!==hash)throw Error(`${file}: source changed; no file written`);
  fs.writeFileSync(path.join(dir,file),data);console.log(`Verified ${file}: ${data.length} bytes`);
}

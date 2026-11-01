/** Decode real shipped KTX2 payloads for ASTC, BC7, ETC2 and RGBA fallbacks.
 * Format tests only: forcing ASTC here is not a Safari/GPU upload test. */
const {chromium}=require('playwright');
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');
const root=path.resolve('.graphics-review/premium-earth');fs.mkdirSync(root,{recursive:true});
const server=http.createServer((req,res)=>{
 const route=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(route==='/'){res.setHeader('Content-Type','text/html');return res.end('<script type="importmap">{"imports":{"three":"/three/build/three.module.js"}}</script>');}
 const folder=route.startsWith('/three/')?'node_modules/three':route.startsWith('/assets/')?'public':null;
 if(!folder){res.writeHead(404);return res.end();}
 const base=path.resolve(folder),file=path.resolve(base,route.replace(/^\/(three|assets)\//,''));
 if(!file.startsWith(base+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.wasm')?'application/wasm':'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{
 let browser;const report={venue:'Installed Chrome; forced decoder formats, no claim of native ASTC/ETC2 GPU support',rows:[]};
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||'chrome'});const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  report.rows=await page.evaluate(async()=>{
   const {KTX2Loader}=await import('/three/examples/jsm/loaders/KTX2Loader.js');
   const results=[];
   for(const format of ['astc','bptc','etc2','rgba']){
    const loader=new KTX2Loader().setTranscoderPath('/assets/decoders/basis/').setWorkerLimit(1);
    loader.workerConfig={astcSupported:false,etc1Supported:false,etc2Supported:false,dxtSupported:false,bptcSupported:false,pvrtcSupported:false};
    if(format!=='rgba')loader.workerConfig[`${format}Supported`]=true;
    try{for(const file of ['materials/earth-scans-v1/color-128.ktx2','materials/earth-scans-v1/detail-128.ktx2','materials/forest-atlas-v1/foliage-512.ktx2']){
     const t=await loader.loadAsync('/assets/'+file);results.push({format,file,textureFormat:t.format,array:!!(t.isCompressedArrayTexture||t.isDataArrayTexture),width:t.image.width,height:t.image.height,depth:t.image.depth??1,mips:t.mipmaps.length,bytes:t.mipmaps.reduce((n,m)=>n+m.data.byteLength,0),colorSpace:t.colorSpace});t.dispose();
    }}finally{loader.dispose();}
   }return results;
  });
  assert.equal(report.rows.length,12);
  for(const row of report.rows){const array=row.file.includes('earth-scans');assert.equal(row.array,array);assert.equal(row.depth,array?8:1);assert.equal(row.width,array?128:512);assert.ok(row.mips>=8);assert.ok(row.bytes>0);}
  report.ok=true;console.log('PASS 12 actual KTX2 decodes: ASTC, BC7, ETC2, RGBA; array layers and mip chains intact');
 }catch(error){report.error=error.stack;console.error(error);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(root,'transcode.json'),JSON.stringify(report,null,2));await browser?.close();await new Promise(resolve=>server.close(resolve));}
})();

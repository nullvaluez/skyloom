/** Offline USGS 3DEP crop. One public-domain download, no runtime USGS API.
 * The TIFF and export response are cached for reproducibility. Delete neither
 * to rebuild from the same source; use --refresh for an intentional data update.
 */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fromArrayBuffer } from 'geotiff';
const root='public/regions/yosemite-v1',cache='.graphics-review/premium-earth/elevation-source';
await fs.mkdir(root,{recursive:true});await fs.mkdir(cache,{recursive:true});
const service='https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';
const parameters={f:'json',bbox:'-119.72,37.69,-119.48,37.8',bboxSR:'4326',imageSR:'3857',size:'2048,1187',format:'tiff',pixelType:'F32',noData:'-9999',interpolation:'RSP_BilinearInterpolation',renderingRule:JSON.stringify({rasterFunction:'None'})};
let info,bytes;
try{if(process.argv.includes('--refresh'))throw Error('refresh');info=JSON.parse(await fs.readFile(`${cache}/export.json`,'utf8'));bytes=await fs.readFile(`${cache}/source.tif`);}catch{
 const response=await fetch(`${service}/exportImage?${new URLSearchParams(parameters)}`);if(!response.ok)throw Error(`3DEP export ${response.status}`);
 info=await response.json();if(!info.href)throw Error(JSON.stringify(info));
 const file=await fetch(info.href);if(!file.ok)throw Error(`3DEP TIFF ${file.status}`);bytes=Buffer.from(await file.arrayBuffer());
 await fs.writeFile(`${cache}/export.json`,JSON.stringify(info,null,2));await fs.writeFile(`${cache}/source.tif`,bytes);
}
const tiff=await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const image=await tiff.getImage();
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const manifest={schema:'skyloom-elevation-pack/1',id:'yosemite-v1',name:'Yosemite Valley',license:'Public domain',author:'U.S. Geological Survey',source:service,
 sourceSha256:sha(bytes),request:parameters,bounds:[info.extent.xmin,info.extent.ymin,info.extent.xmax,info.extent.ymax],crs:'EPSG:3857',
 heightUnit:'metres',verticalDatum:'USGS 3DEP orthometric elevations (NAVD88 in CONUS); feathered to the existing world at the pack boundary',
 pixelRegistration:'area; sample at pixel centres',quantizationM:.1,noData:65535,edgeBlendM:1200,variants:{}};
for(const width of [512,1024,2048]){
 const height=Math.round(width*info.height/info.width),raster=(await image.readRasters({width,height,resampleMethod:'bilinear'}))[0];
 const data=Buffer.alloc(width*height*2);let min=Infinity,max=-Infinity,valid=0;
 for(let i=0;i<raster.length;i++){
  const h=raster[i],ok=Number.isFinite(h)&&h>0&&h<6500;data.writeUInt16LE(ok?Math.round(h*10):65535,i*2);
  if(ok){min=Math.min(min,h);max=Math.max(max,h);valid++;}
 }
 if(valid/raster.length<.999)throw Error('Unexpected no-data in the Yosemite crop');
 const file=`height-${width}.u16`;await fs.writeFile(`${root}/${file}`,data);
 manifest.variants[width]={width,height,file,bytes:data.length,sha256:sha(data),minM:+min.toFixed(2),maxM:+max.toFixed(2)};
 console.log(`Yosemite ${width} x ${height}: ${valid} measured samples, ${min.toFixed(1)}–${max.toFixed(1)} m`);
}
await fs.writeFile(`${root}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');

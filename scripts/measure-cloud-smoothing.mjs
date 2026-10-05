import sharp from 'sharp';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root=process.argv[2]??'.graphics-review/cloud-smoothing/final';
const read=async file=>{const {data,info}=await sharp(`${root}/${file}.png`).removeAlpha().raw().toBuffer({resolveWithObject:true});return{data,info};};
const before=await read('before'),after=await read('after');assert.deepEqual(before.info,after.info);
const w=before.info.width,c=before.info.channels;
const luma=(im,x,y)=>{const i=(y*w+x)*c;return im.data[i]*.2126+im.data[i+1]*.7152+im.data[i+2]*.0722;};
// Fixed interior cloud region in the held 1440x900 canyon pose, excluding HUD,
// live labels, cloud silhouettes and sun. Measures high-frequency variation,
// not a universal perceptual quality score.
const roi={x:300,y:140,width:125,height:75};
// Work at the actual reduced cloud texel spacing. A one-output-pixel test is
// dominated by the final 8-bit dither, which this pass intentionally preserves.
const runtime=JSON.parse(fs.readFileSync(`${root}/report.json`));
const spacing=Math.max(1,Math.round(w/runtime.samples[0].clouds.width));
function grain(im,d=spacing){let sum=0,n=0;for(let y=roi.y;y<roi.y+roi.height;y++)for(let x=roi.x;x<roi.x+roi.width;x++){const high=4*luma(im,x,y)-luma(im,x-d,y)-luma(im,x+d,y)-luma(im,x,y-d)-luma(im,x,y+d);sum+=high*high;n++;}return Math.sqrt(sum/n);}
let diff=0,pixels=0;
for(let y=560;y<640;y++)for(let x=420;x<670;x++){diff+=Math.abs(luma(before,x,y)-luma(after,x,y));pixels++;}
const report={roi,spacing,before:grain(before),after:grain(after),outputPixelBefore:grain(before,1),outputPixelAfter:grain(after,1),terrainMeanDifference:diff/pixels};
report.reduction=1-report.after/report.before;
fs.writeFileSync(`${root}/pixel-metrics.json`,JSON.stringify(report,null,2));console.log(report);
assert.ok(report.reduction>.35,'cloud high-frequency variation did not fall by 35%');
assert.ok(report.terrainMeanDifference<1,'cloud filter blurred or changed clear foreground terrain');

// Extract cloud coverage and relative illumination from Greg Zaal's CC0
// Kloofendal 48d Partly Cloudy (Pure Sky), available through Poly Haven.
// https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky
// Its blue sky, sun, ground and absolute exposure are discarded.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { FloatType } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const source = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/8k/kloofendal_48d_partly_cloudy_puresky_8k.hdr';
const destination = new URL('../public/materials/cinema-v1/day-cloud-relief.webp', import.meta.url);
const bytes = process.argv[2] ? await fs.readFile(process.argv[2]) : Buffer.from(await (await fetch(source)).arrayBuffer());
if (createHash('sha1').update(bytes).digest('hex') !== '13c97c47152fff66fdaf3f86a863185f52eb6e85') {
  throw new Error('Expected the original Kloofendal 8K HDR. Pass its local path to build offline.');
}
const { width, height, data } = new HDRLoader().setDataType(FloatType).parse(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
);
const half = height / 2;
const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));
const mix = (a, b, k) => a + (b - a) * k;
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
const colour = new Float32Array(width * half);
const light = new Float32Array(width * half);
for (let p = 0; p < colour.length; p++) {
  const i = p * 4;
  colour[p] = data[i] / Math.max(.001, data[i + 2]);
  light[p] = Math.log2(Math.max(.001, .2126 * data[i] + .7152 * data[i+1] + .0722 * data[i+2]));
}
// The clear-sky colour varies sharply near the horizon and around the sun.
// Estimate it locally across a broad azimuth window. The lower percentile
// retains pale grey cloud bottoms as well as their illuminated white edges.
const scale=width/2048, step = 16*scale, columns = width / step, rows = half / step + 1;
const clearColour = new Float32Array(columns * rows);
const clearLight = new Float32Array(columns * rows);
for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
  const chroma = [], luminance = [];
  for (let dy = -6; dy <= 6; dy += 6) for (let dx = -200; dx <= 200; dx += 8) {
    const p = clamp(row * step + dy*scale, 0, half - 1) * width + (col * step + dx*scale + width) % width;
    chroma.push(colour[p]);
    luminance.push(light[p]);
  }
  chroma.sort((a, b) => a - b);
  luminance.sort((a, b) => a - b);
  const i = row * columns + col;
  clearColour[i] = chroma[Math.floor(chroma.length * .08)];
  clearLight[i] = luminance[Math.floor(luminance.length * .08)];
}
function baseline(grid, x, y) {
  const u = x / step, v = y / step, i = Math.floor(u), j = Math.floor(v);
  const k = (i + 1) % columns;
  return mix(mix(grid[j*columns+i], grid[j*columns+k], u-i),
    mix(grid[(j+1)*columns+i], grid[(j+1)*columns+k], u-i), v-j);
}

// Separate the photographed illumination of cloud from the clear-air
// background. Near the horizon, even a bright cloud top has almost the same
// absolute luminance as clear air; a global exposure crushes its grey base.
const cloudyLow=new Float32Array(columns*rows);
const cloudyHigh=new Float32Array(columns*rows);
for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
  const cloudy=[];
  for(let dy=-18;dy<=18;dy+=3)for(let dx=-144;dx<=144;dx+=6){
    const x=(col*step+dx*scale+width)%width;
    const y=clamp(row*step+dy*scale,0,half-1),p=y*width+x;
    const clear=baseline(clearColour,x,y);
    if((colour[p]-clear)/Math.max(.15,.92-clear)>.32)cloudy.push(light[p]);
  }
  cloudy.sort((a,b)=>a-b);
  const i=row*columns+col, floor=clearLight[i];
  cloudyLow[i]=cloudy.length>12?cloudy[Math.floor(cloudy.length*.10)]:floor+.25;
  cloudyHigh[i]=cloudy.length>12?cloudy[Math.floor(cloudy.length*.90)]:floor+1.8;
}
const result = Buffer.alloc(width * half * 3);
const sunAz = 2 * Math.PI * 1218 / 2048, sunEl = Math.PI * (0.5 - 239 / 1024);
for (let y = 0; y < half; y++) for (let x = 0; x < width; x++) {
  const p = y * width + x, elevation = Math.PI * (.5 - y / height);
  const chroma = baseline(clearColour, x, y);
  const whiteness = (colour[p] - chroma) / Math.max(.15, .92 - chroma);
  const solarDot = Math.sin(elevation)*Math.sin(sunEl) + Math.cos(elevation)*Math.cos(sunEl)*Math.cos(2*Math.PI*x/width-sunAz);
  const mask = smooth(.08, .62, whiteness) * (1-smooth(.94,.982,solarDot));
  const low=baseline(cloudyLow,x,y),high=baseline(cloudyHigh,x,y);
  const relative=(light[p]-(low+high)*.5)/Math.max(.40,(high-low)*.68);
  const lighting=.50+.45*Math.tanh(relative);
  result[3*p] = Math.round(255 * mask);
  result[3*p+1] = Math.round(255 * lighting);
  result[3*p+2] = 0;
}
// Lossless, continuous data (no JPEG ringing across cloud silhouettes).
const map = await sharp(result, {raw:{width,height:half,channels:3}})
  .resize(4096,1024).webp({lossless:true,effort:5}).toBuffer();
await fs.writeFile(destination, map);
console.log(`Wrote ${map.length} bytes to ${destination.pathname}`);

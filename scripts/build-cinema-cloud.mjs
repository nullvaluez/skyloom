import fs from 'node:fs';
import crypto from 'node:crypto';
// First-party procedural asset, MIT. Periodic cellular features avoid the
// axis-aligned interpolation cells and repeated four-lobe cloud silhouette.
const size=64,wrap=(v,n)=>((v%n)+n)%n;
function hash(x,y,z,s){let n=(Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(z,2147483647)+Math.imul(s,1274126177))>>>0;n=Math.imul(n^(n>>>13),1274126177);return((n^(n>>>16))>>>0)/4294967296;}
function cells(n){return Array.from({length:n**3},(_,i)=>{const x=i%n,y=Math.floor(i/n)%n,z=Math.floor(i/n/n);return [hash(x,y,z,1),hash(x,y,z,2),hash(x,y,z,3)];});}
const grids=Object.fromEntries([4,8,16].map(n=>[n,cells(n)]));
function worley(x,y,z,n){x*=n;y*=n;z*=n;const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);let d=10;
 for(let dz=-1;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
  const p=grids[n][wrap(ix+dx,n)+n*(wrap(iy+dy,n)+n*wrap(iz+dz,n))];
  d=Math.min(d,(ix+dx+p[0]-x)**2+(iy+dy+p[1]-y)**2+(iz+dz+p[2]-z)**2);
 }return Math.max(0,1-Math.sqrt(d)/1.15);
}
const out=new Uint8Array(size**3*2);
for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
 const a=(x+.5)/size,b=(y+.5)/size,c=(z+.5)/size,w4=worley(a,b,c,4),w8=worley(a,b,c,8),w16=worley(a,b,c,16),i=(x+size*(y+size*z))*2;
 out[i]=Math.round(Math.min(1,.15+w4*.55+w8*.22+w16*.08)*255);
 out[i+1]=Math.round((w8*.55+w16*.45)*255);
}
const root=new URL('../public/materials/cinema-v1/',import.meta.url);fs.writeFileSync(new URL('cloud-density.rg',root),out);
fs.writeFileSync(new URL('cloud-density.json',root),JSON.stringify({author:'Skyloom',license:'MIT',size,channels:2,periodMetres:8192,bytes:out.length,sha256:crypto.createHash('sha256').update(out).digest('hex')},null,2));
console.log(`Original cloud volume: ${out.length} bytes`);

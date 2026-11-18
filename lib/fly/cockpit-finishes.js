import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';

// Authored at one scale in metres, sampled through normal mipmaps. The
// daylight glances off the same scuffs, worn paint and leather in every frame.
export function cockpitFinishMap(leather = false) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const c = canvas.getContext('2d');
  let seed = leather ? 12841 : 68067;
  const random = () => ((seed = (Math.imul(seed,1664525)+1013904223)>>>0) / 4294967296);
  const pixels = c.createImageData(256,256);
  for (let i=0;i<pixels.data.length;i+=4) {
    const n = Math.round(208 + 42 * random());
    pixels.data.set([n,n,n,255],i);
  }
  c.putImageData(pixels,0,0);
  for (let i=0;i<85;i++) {
    const x=random()*256,y=random()*256,r=3+random()*28;
    const spot=c.createRadialGradient(x,y,0,x,y,r);
    spot.addColorStop(0,'rgba(54,54,54,.12)');spot.addColorStop(1,'rgba(100,100,100,0)');
    c.fillStyle=spot;c.fillRect(x-r,y-r,2*r,2*r);
  }
  for (let i=0;i<(leather?3600:820);i++) {
    const x=random()*256,y=random()*256;
    c.lineWidth=.5+random()*.7;c.strokeStyle=i%4?'rgba(30,30,30,.20)':'rgba(255,255,255,.66)';
    c.beginPath();c.moveTo(x,y);
    const l=(leather?2:1)+(leather?4:15)*random()**2;
    c.quadraticCurveTo(x+l*.35,y+1.2,x+l,y+random()*3-1.5);c.stroke();
  }
  const texture=new CanvasTexture(canvas);
  texture.wrapS=texture.wrapT=RepeatWrapping;
  texture.minFilter=LinearMipmapLinearFilter;
  texture.anisotropy=4;
  return texture;
}

/** One atlas for the exterior wing surface. The panel boundaries, access
 * doors, flush screws and stencils follow the geometry's chord and taper. */
export function wingFinish() {
  const canvas=document.createElement('canvas');
  canvas.width=768;canvas.height=512;
  const c=canvas.getContext('2d');
  c.fillStyle='#969ea4';c.fillRect(0,0,768,512);
  function panel(points, shade) {
    c.beginPath();c.moveTo(...points[0]);for(const p of points.slice(1))c.lineTo(...p);c.closePath();
    c.fillStyle=shade;c.fill();c.strokeStyle='#606b71';c.lineWidth=1.6;c.stroke();
    for(let i=1;i<points.length+1;i++) {
      const a=points[i-1],b=points[i%points.length],l=Math.hypot(a[0]-b[0],a[1]-b[1]);
      for(let j=8;j<l-3;j+=15) {
        const x=a[0]+(b[0]-a[0])*j/l,y=a[1]+(b[1]-a[1])*j/l;
        c.fillStyle='#727d83';c.fillRect(x+2,y+2,1.9,1.9);
        c.fillStyle='#b0b7b6';c.fillRect(x+2,y+2,1,1);
      }
    }
  }
  panel([[0,16],[220,18],[225,282],[185,328],[4,309]],'#8f999f');
  panel([[231,18],[519,25],[507,299],[471,334],[220,326],[244,286]],'#a0a8ab');
  panel([[534,24],[750,30],[741,330],[523,330]],'#939da4');
  panel([[0,373],[474,372],[440,507],[0,507]],'#848e96');
  panel([[493,371],[748,368],[743,507],[456,507]],'#969fa6');
  for(const [x,y,w,h] of [[70,163,53,28],[279,209,64,29],[527,222,48,24],[145,90,24,42]]) {
    c.beginPath();c.roundRect(x,y,w,h,6);c.lineWidth=2;c.strokeStyle='#69767e';c.stroke();
    for (const dx of [4,w-5])for(const dy of [4,h-5]){c.fillStyle='#505d64';c.fillRect(x+dx,y+dy,2,2);}
  }
  c.textAlign='center';c.font='bold 9px sans-serif';c.fillStyle='#5a676d';
  for(const x of [120,330,530])c.fillText('NO STEP',x,350);
  c.save();c.translate(529,134);c.rotate(-.04);c.strokeStyle='#657179';c.lineWidth=4;
  c.beginPath();c.moveTo(-39,0);c.lineTo(-12,2);c.lineTo(0,-15);c.lineTo(10,2);c.lineTo(39,0);c.lineTo(24,9);c.lineTo(7,11);c.lineTo(0,18);c.lineTo(-7,11);c.lineTo(-24,9);c.closePath();c.stroke();c.restore();
  const wash=c.createLinearGradient(0,0,0,512);
  wash.addColorStop(0,'rgba(33,46,54,.40)');wash.addColorStop(.05,'rgba(218,225,223,.32)');
  wash.addColorStop(.23,'rgba(215,217,204,.17)');wash.addColorStop(.68,'rgba(35,43,51,.06)');
  wash.addColorStop(.72,'rgba(37,49,59,.15)');wash.addColorStop(1,'rgba(28,41,52,.22)');
  c.fillStyle=wash;c.fillRect(0,0,768,512);
  let seed=73629;
  const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  for(let i=0;i<130;i++) {
    const x=rand()*768,y=rand()*512,r=7+rand()*43;
    const smudge=c.createRadialGradient(x,y,1,x,y,r);
    smudge.addColorStop(0,i%3?'rgba(225,224,208,.13)':'rgba(43,53,61,.11)');
    smudge.addColorStop(1,'rgba(127,134,135,0)');
    c.fillStyle=smudge;c.fillRect(x-r,y-r,2*r,2*r);
  }
  // Smaller stencil and inspection hatches at the root, where the seat can
  // see individual quarter-turn fasteners and the painted chord change line.
  c.font='bold 8px sans-serif';c.fillStyle='#515f68';c.fillText('WALKWAY',66,116);
  for(const [x,y] of [[42,83],[115,143],[169,220],[352,104],[644,116]]){
    c.lineWidth=2;c.strokeStyle='#73828a';
    c.beginPath();c.ellipse(x,y,11,6,.25,0,Math.PI*2);c.stroke();
    c.fillStyle='#536169';c.fillRect(x-6,y-1,2,2);c.fillRect(x+5,y,2,2);
  }
  const tex=new CanvasTexture(canvas);tex.colorSpace=SRGBColorSpace;tex.anisotropy=5;
  return tex;
}

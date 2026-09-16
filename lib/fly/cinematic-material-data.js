/** First-party, tileable material source. Metre-scale construction, not imagery inference. */
export const MATERIAL_NAMES = ['asphalt', 'concrete', 'masonry', 'roofing', 'soil-grass', 'rock', 'sand', 'snow'];
const fract = v => v - Math.floor(v);
const clamp = v => Math.max(0, Math.min(1, v));
function hash(x, y, seed) {
  let n = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ seed;
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
function noise(u, v, frequency, seed) {
  const x = u * frequency, y = v * frequency, ix = Math.floor(x), iy = Math.floor(y);
  const sx = fract(x), sy = fract(y), a = sx*sx*(3-2*sx), b = sy*sy*(3-2*sy);
  const h = (dx,dy) => hash(((ix+dx)%frequency+frequency)%frequency, ((iy+dy)%frequency+frequency)%frequency, seed);
  return (h(0,0)*(1-a)+h(1,0)*a)*(1-b)+(h(0,1)*(1-a)+h(1,1)*a)*b;
}
export function materialSample(layer, u, v) {
  u=fract(u); v=fract(v);
  const n=noise(u,v,8,71+layer), fine=noise(u,v,128,913+layer), broad=noise(u,v,2,190+layer);
  let value=.70+(n-.5)*.12+(fine-.5)*.14, height=.5+(fine-.5)*.16, rough=.86, warmth=0;
  if(layer===0){
    // Fine aggregate, repaired patches and narrow, branching pavement fissures.
    const seam=Math.abs(noise(u,v,4,751)-.50), crack=1-clamp((seam-.009)/.012);
    value=.67+(fine-.5)*.21+(broad-.5)*.10-crack*.16;
    height=.48+fine*.08-crack*.09; rough=.83+fine*.12;
  }else if(layer===1){
    const edge=Math.min(fract(u*2),1-fract(u*2),fract(v*2),1-fract(v*2));
    const joint=1-clamp(edge/.009);
    value=.75+(broad-.5)*.13+(fine-.5)*.07-joint*.18;
    height=.53-joint*.16+(fine-.5)*.035;rough=.84;warmth=.018;
  }else if(layer===2){
    const row=Math.floor(v*16), bx=fract(u*8+(row%2)*.5), by=fract(v*16);
    const edge=Math.min(bx,1-bx,by*.5,(1-by)*.5), mortar=1-clamp((edge-.015)/.020);
    const brick=hash(Math.floor(u*8+(row%2)*.5)%8,row,21);
    value=.70+(brick-.5)*.16+(fine-.5)*.055-mortar*.14;
    height=.61-mortar*.27+(fine-.5)*.055;rough=.89;warmth=.03;
  }else if(layer===3){
    const edge=Math.min(fract(u*4),1-fract(u*4)), seam=1-clamp(edge/.025);
    value=.68+(broad-.5)*.12+(fine-.5)*.07+seam*.11;
    height=.48+seam*.22;rough=.71+fine*.12;
  }else if(layer===4){
    const tufts=noise(u,v,32,888), soil=clamp((broad-.42)*3);
    value=.67+(tufts-.5)*.21+(fine-.5)*.16-soil*.06;
    height=.4+tufts*.27+(fine-.5)*.15;rough=.96;warmth=.02;
  }else if(layer===5){
    const ridge=Math.abs(noise(u,v,8,741)-.5)*2;
    value=.64+ridge*.21+(fine-.5)*.10;
    height=.24+ridge*.55;rough=.94;warmth=.022;
  }else if(layer===6){
    const ripple=Math.sin((u*16+noise(u,v,4,68)*.55)*Math.PI*2);
    value=.74+ripple*.035+(fine-.5)*.08;
    height=.5+ripple*.08;rough=.93;warmth=.022;
  }else{
    const drift=noise(u,v,8,571);
    value=.81+(drift-.5)*.08+(fine-.5)*.035;
    height=.43+drift*.15;rough=.79;warmth=-.012;
  }
  return {value:clamp(value), height:clamp(height), rough:clamp(rough), warmth};
}

/** Two RGBA8 arrays: sRGB albedo + linear roughness alpha; linear normal XY/height/AO. */
export function buildMaterialArrays(size=256) {
  const color=new Uint8Array(size*size*8*4), detail=new Uint8Array(color.length);
  for(let layer=0;layer<8;layer++){
    const samples=Array.from({length:size*size},(_,i)=>materialSample(layer,(i%size+.5)/size,(Math.floor(i/size)+.5)/size));
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      const s=samples[y*size+x],i=((layer*size+y)*size+x)*4;
      const dx=(samples[y*size+(x+1)%size].height-samples[y*size+(x+size-1)%size].height)*size*.012;
      const dy=(samples[((y+1)%size)*size+x].height-samples[((y+size-1)%size)*size+x].height)*size*.012;
      const length=Math.hypot(dx,dy,1);
      color[i]=Math.round(clamp(s.value+s.warmth)*255);color[i+1]=Math.round(s.value*255);color[i+2]=Math.round(clamp(s.value-s.warmth)*255);color[i+3]=Math.round(s.rough*255);
      detail[i]=Math.round((.5-dx/length*.5)*255);detail[i+1]=Math.round((.5-dy/length*.5)*255);
      detail[i+2]=Math.round(s.height*255);detail[i+3]=Math.round((.88+.12*s.height)*255);
    }
  }
  return {color,detail,size,layers:8};
}

/** Surface identity is data, independent of art palette changes. -1 = retain imagery. */
export function surfaceMaterialId(surface) {
  return ({1:4,2:4,3:4,4:5,5:6,6:7,9:4,12:0,13:1,14:5})[surface] ?? -1;
}

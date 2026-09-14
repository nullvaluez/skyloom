import { DataUtils } from 'three';

/** Area-average linear HDR before its first GPU upload. Keep half-float filtering on mobile. */
export function resizeEarthHdr(texture, width) {
  const image=texture.image;
  if(!image?.data||image.width<=width||!(image.data instanceof Uint16Array))return texture;
  const ratio=image.width/width;
  if(!Number.isInteger(ratio)||image.height%ratio)return texture;
  const height=image.height/ratio, source=image.data, data=new Uint16Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){
    let sum=0;
    for(let oy=0;oy<ratio;oy++)for(let ox=0;ox<ratio;ox++)sum+=DataUtils.fromHalfFloat(source[((y*ratio+oy)*image.width+x*ratio+ox)*4+c]);
    data[(y*width+x)*4+c]=DataUtils.toHalfFloat(sum/(ratio*ratio));
  }
  texture.image={...image,width,height,data};texture.needsUpdate=true;
  return texture;
}

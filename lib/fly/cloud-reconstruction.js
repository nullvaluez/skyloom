// Filter at cloud resolution, then reconstruct four depth-compatible neighbours
// at scene resolution. The old 5x5 full-resolution gather made the smoothing
// pass more expensive than the entire mobile cloud march.

// A cloud texel's centre can coincide with a scene-depth texel boundary (for
// example at 1/4 scale). Raster-interpolated vUv and reconstructed tap UVs may
// round to opposite sides of that boundary. Then a cloud marched behind the
// aircraft is later classified as foreground, painting a moving bright edge
// onto the hull. Use the same explicit integer address in every cloud stage.
// The 1/1000-pixel tie bias dominates float interpolation error and leaves
// full-resolution pixel centres unchanged. This is one depth read, as before.
export const CLOUD_DEPTH_GLSL = `
float cloudDepthAt(sampler2D depthMap,vec2 uv){
 ivec2 size=textureSize(depthMap,0);
 ivec2 pixel=clamp(ivec2(floor(uv*vec2(size)+.001)),ivec2(0),size-1);
 return texelFetch(depthMap,pixel,0).r;
}
`;

export const CLOUD_FILTER_GLSL = `
uniform sampler2D clouds;
uniform vec2 texel, filterAxis;
void main(){
 float dist=distanceAt(vUv),total=0.;vec4 sum=vec4(0.);
 for(int i=-2;i<=2;i++){
  vec2 uv=vUv+filterAxis*texel*float(i);
  float weight=exp(-float(i*i)*.32);
  weight*=exp(-abs(distanceAt(uv)-dist)/max(2.,dist*.008));
  sum+=texture2D(clouds,uv)*weight;total+=weight;
 }
 // RGB is premultiplied radiance; alpha is TRANSMISSION, not opacity.
 gl_FragColor=sum/max(total,.0001);
}`;

export const CLOUD_RECONSTRUCTION_GLSL = `
 vec2 cell=vUv/texel-.5,origin=floor(cell),fraction=fract(cell);
 vec4 sum=vec4(0);float total=0.;
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  vec2 corner=vec2(float(x),float(y));
  vec2 uv=(origin+corner+.5)*texel;
  vec2 w=mix(1.-fraction,fraction,corner);
  float weight=w.x*w.y;
  float sampleDistance=distanceAt(uv);
  weight*=exp(-abs(sampleDistance-dist)/max(2.,dist*.008));
  sum+=texture2D(clouds,uv)*weight;total+=weight;
 }
`;

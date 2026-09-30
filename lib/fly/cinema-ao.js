// Adapt the installed denoiser locally; dependency and rollback shaders stay
// untouched. Its Reverse define previously did not convert either depth read.
export function cinemaAoDenoise(source){
 const depthReads=[['float d = texture2D(sceneDepth, vUv).x;','d'],['float dSample = texture2D(sceneDepth, uv + offset).x;','dSample']];
 for(const [anchor,name] of depthReads){
  if(!source.includes(anchor))throw Error(`Cinema AO denoiser anchor missing: ${name}`);
  source=source.replace(anchor,`${anchor}\n#ifdef REVERSEDEPTH\n${name}=1.0-${name};\n#endif`);
 }
 // All inputs are single-level render targets/noise. Explicit level zero is
 // defined even across a sky rejection or divergent Poisson loop.
 return `vec4 cinemaAoSample(sampler2D image,vec2 uv){return textureLod(image,uv,0.);}\n${source.replaceAll('texture2D(', 'cinemaAoSample(')}`;
}

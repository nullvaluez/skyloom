import { Color, Vector3, Vector4 } from 'three';

// World materials, not a camera filter. The geographic classifications, DEM,
// coastlines and buildings remain the source of every surface's identity.
export const WORLD_ART = Object.freeze({
  revision: 1,
  palette: ['#92947a', '#729e48', '#326c50', '#b4a46a', '#aa9587',
    '#d5b57d', '#e4eeee', '#ada99d', '#246d7f', '#a49b63',
    '#748968', '#b0a17f', '#525a60', '#b7b5a6', '#b89d7e'],
  fullRangeM: 12000,
  fadeRangeM: 65000,
  dryGrass: '#b49a67',
  dryWood: '#8d8d62',
});
const pigment = WORLD_ART.palette.map(hex => new Color(hex));
const dryGrass=new Color(WORLD_ART.dryGrass),dryWood=new Color(WORLD_ART.dryWood);
const glslColor=c=>`vec3(${[c.r,c.g,c.b].map(x=>x.toFixed(5)).join(',')})`;
const smooth = (a,b,v) => { const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t); };
export const WORLD_ART_UNIFORMS = {
  uWorldArt: { value: 0 },
  uUrbanArt: { value: 0 },
  uWorldLight: { value: new Vector4(1,0,0,0) }, // day, night, golden, overcast
  uWorldKey: { value: new Vector3(0,1,0) },
  uWorldMetres: { value: 1 },
};

export function updateWorldArt(enabled, runtime, keyLight, urbanEnabled = enabled) {
  WORLD_ART_UNIFORMS.uWorldArt.value=enabled?1:0;
  WORLD_ART_UNIFORMS.uUrbanArt.value=enabled&&urbanEnabled?1:0;
  const raw=runtime?.sun?.sinEl;
  const elevation=Math.asin(Number.isFinite(raw)?Math.max(-1,Math.min(1,raw)):1)*180/Math.PI;
  const overcast=Math.max(0,Math.min(1,runtime?.weather?.wx?.overcastT||0));
  WORLD_ART_UNIFORMS.uWorldLight.value.set(smooth(-6,18,elevation),1-smooth(-12,-2,elevation),
    smooth(-5,1,elevation)*(1-smooth(8,25,elevation))*(1-overcast),overcast);
  if(keyLight?.target) WORLD_ART_UNIFORMS.uWorldKey.value.copy(keyLight.position).sub(keyLight.target.position).normalize();
  const lat=runtime?.flight?.latDeg;
  WORLD_ART_UNIFORMS.uWorldMetres.value=Number.isFinite(lat)?Math.max(.1,Math.cos(lat*Math.PI/180)):1;
}

export const WORLD_ART_DECL = `
uniform float uWorldArt;
uniform float uUrbanArt;
uniform vec4 uWorldLight;
uniform vec3 uWorldKey;
uniform float uWorldMetres;
`;

export const WORLD_TERRAIN_GLSL = `
vec3 worldPigment(float id) {
${pigment.map((c,i)=>` if(id<${(i+.5).toFixed(1)})return vec3(${[c.r,c.g,c.b].map(x=>x.toFixed(5)).join(',')});`).join('\n')}
 return vec3(.3);
}
vec4 worldClassSurface(vec3 source,float id,float vegetationSupport){
 float luma=max(.006,dot(source,vec3(.2126,.7152,.0722)));
 vec3 pigment=worldPigment(id);
 float vegetation=float(id==1.||id==2.||id==9.);
 // Geographic grass/shrub classes include desert cover. Author DRY pigments
 // instead of forcing green when the imagery has no green chroma witness.
 if(vegetation>.5){
   vec3 dry=id==2.?${glslColor(dryWood)}:${glslColor(dryGrass)};
   float foliageSupport=id==2.?max(.65,vegetationSupport):vegetationSupport;
   pigment=mix(dry,pigment,foliageSupport);
 }
 float pigmentLuma=max(.025,dot(pigment,vec3(.2126,.7152,.0722)));
 // Compress baked photographic shade; real DEM normals own the relief.
 // Large-scale field variation survives, without the grey photographic veil.
 float value=clamp(pow(luma/pigmentLuma,.14),.84,1.16);
 vec3 painted=pigment*value;
 // Minerals keep their local geological hue; fields keep their crop pattern.
 float localHue=float(id==4.||id==5.||id==14.)*.22+float(id==3.)*.25;
 painted=mix(painted,source*clamp(pigmentLuma/luma,.7,1.7),localHue);
 float excluded=float(id==0.||id==7.||id==8.||id==10.||id==11.||id==12.||id==13.);
 return vec4(painted*(1.-excluded),1.-excluded);
}
`;

/** Attach only to terrain, architecture and vegetation. No player/sky changes.
 * Shared live uniforms also restore the shipped rendering for review A/Bs. */
export function patchWorldLighting(shader, role) {
  if(!['terrain','architecture','forest'].includes(role))return;
  // The terrain pipeline deliberately flattens Standard's normal because its
  // hillshade owns relief. Read that SAME decoded DEM normal for world light;
  // otherwise authored albedo loses the photograph's shadows but stays flat.
  const surfaceNormal = role === 'terrain' && shader.fragmentShader.includes('varying vec3 vHillNW;')
    ? (shader.fragmentShader.includes('vec3 r25ReliefN(') ? 'r25ReliefN(normalize(vHillNW))' : 'normalize(vHillNW)')
    : 'inverseTransformDirection(normal,viewMatrix)';
  Object.assign(shader.uniforms,WORLD_ART_UNIFORMS);
  if(!shader.fragmentShader.includes('uniform float uWorldArt;'))
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${WORLD_ART_DECL}`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
if(uWorldArt>.5){
 vec3 worldN=${surfaceNormal};
 float skyAccess=.32+.68*max(0.,worldN.y);
 float moonFace=.30+.70*max(0.,dot(worldN,uWorldKey));
 vec3 sunTint=mix(vec3(1.12,1.035,.90),vec3(1.28,1.045,.78),uWorldLight.z);
 reflectedLight.directDiffuse*=mix(vec3(1.),sunTint,uWorldLight.x*(1.-uWorldLight.w*.8));
 // Blue open-sky bounce separates shadowed slopes from sunlit ochre/green.
 reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(.09,.145,.22)*skyAccess*uWorldLight.x;
 // Moonlit relief stays readable independently of HDRI or baked black pixels.
 reflectedLight.indirectDiffuse+=diffuseColor.rgb*vec3(.22,.34,.57)*moonFace*skyAccess*uWorldLight.y;
}
`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
if(uWorldArt>.5){
 ${role === 'terrain' ? `// Authored terrain needs directional value separation after its baked
 // photographic shadows retire. Use the real DEM and the actual sun/moon.
 vec3 terrainN=${surfaceNormal};
 float terrainKey=smoothstep(-.15,.72,dot(terrainN,uWorldKey));
 vec3 terrainShade=mix(vec3(.34,.46,.65),vec3(1.06,1.035,.98),terrainKey);
 outgoingLight*=mix(vec3(1.),terrainShade,(uWorldLight.x+uWorldLight.y)${shader.fragmentShader.includes('float earthWater') ? '*(1.-earthWater*uUrbanArt)' : ''});
 ` : ''}
 // Distant moonlit hills separate into blue layers instead of a black wall.
 // This remains world geometry only: sky, clouds and the aircraft are untouched.
 float worldMetres=length(vViewPosition)*uWorldMetres;
 float nightAir=(1.-exp(-max(0.,worldMetres-350.)*${role==='architecture' ? 'mix(.000065,.00015,uUrbanArt)' : '.000065'}))*uWorldLight.y;
 outgoingLight=mix(outgoingLight,vec3(.025,.048,.09),nightAir*.72);
}
#include <opaque_fragment>`);
}

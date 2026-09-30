// Kept dependency-free so the exact GLSL also runs in isolated GPU probes.
export const CINEMA_GLSL=`
uniform float uCinema;
uniform vec3 uCinemaKey,uCinemaKeyColor,uCinemaHorizon,uCinemaZenith,uCinemaFill;
uniform vec3 uCinemaCloudLower,uCinemaCloudUpper;
uniform vec4 uCinemaLight,uCinemaAir;
uniform vec3 uCinemaSun;
uniform vec4 uCinemaOptics;
vec3 cinemaSky(vec3 ray){
 float altitude=clamp(ray.y,0.,1.);
 float up=pow(altitude,.46);
 vec3 sky=mix(uCinemaHorizon,uCinemaZenith,up);
 float mu=dot(ray,uCinemaKey),facing=max(0.,mu);
 float clear=1.-uCinemaLight.w;
 // Broad Rayleigh separation and a narrow Mie aureole share the same sun
 // as the terrain and PMREM. No screen-space flare or camera-facing sprite.
 float rayleigh=.75*(1.+mu*mu);
 sky*=mix(1.,rayleigh,.22*uCinemaLight.x*clear);
 float mie=pow(facing,16.)*.16+pow(facing,128.)*.38;
 sky+=uCinemaKeyColor*mie*uCinemaOptics.x*mix(.09,1.,uCinemaLight.x);
 // The rose anti-solar belt belongs to the real sun, even during the smooth
 // key handover to the moon. It remains continuous across geographic warps.
 float antisolar=pow(max(0.,-dot(ray,uCinemaSun)),2.);
 float belt=exp(-pow((altitude-.10)*10.,2.))*antisolar*uCinemaLight.z;
 sky+=vec3(.11,.025,.036)*belt;
 return max(sky,vec3(0.));
}
`;

// Celestial detail only belongs in visible sky. Haze, water and diffuse IBL
// use cinemaSky without baking tiny stars or a solar disc into their fill.
export const CINEMA_CELESTIAL_GLSL=`
float cinemaStarHash(vec2 p){
 vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));
 q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);
}
vec3 cinemaCelestials(vec3 ray){
 float facing=dot(ray,uCinemaKey);
 float aa=max(fwidth(facing),.000002);
 float disc=smoothstep(.999989-aa,.999989+aa,facing);
 vec3 light=uCinemaKeyColor*disc*mix(.60,18.,uCinemaLight.x)*uCinemaOptics.x;
 // Stable sky coordinates, derivative-filtered points; no twinkling timer.
 vec2 uv=vec2(atan(ray.z,ray.x)*.159154943+.5,asin(clamp(ray.y,-1.,1.))*.318309886+.5)*vec2(720.,360.);
 vec2 cell=floor(uv);float star=cinemaStarHash(cell);
 vec2 at=vec2(cinemaStarHash(cell+17.),cinemaStarHash(cell+43.));
 float radius=.045+.035*cinemaStarHash(cell+71.);
 float pixel=max(length(fwidth(uv)),.001),size=max(radius,pixel*.6);
 float point=exp(-dot(fract(uv)-at,fract(uv)-at)/(size*size))*min(1.,radius*radius/(size*size));
 vec3 tint=mix(vec3(.64,.77,1.),vec3(1.,.82,.59),cinemaStarHash(cell+23.));
 light+=tint*point*step(.9975,star)*2.5*uCinemaOptics.y*smoothstep(.02,.30,ray.y);
 return light;
}
`;

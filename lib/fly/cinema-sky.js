// Kept dependency-free so the exact GLSL also runs in isolated GPU probes.
export const CINEMA_GLSL=`
uniform float uCinema;
uniform vec3 uCinemaKey,uCinemaKeyColor,uCinemaHorizon,uCinemaZenith,uCinemaFill;
uniform vec3 uCinemaCloudLower,uCinemaCloudUpper;
uniform vec4 uCinemaLight,uCinemaAir;
vec3 cinemaSky(vec3 ray){
 float up=pow(clamp(ray.y,0.,1.),.48);
 vec3 sky=mix(uCinemaHorizon,uCinemaZenith,up);
 float facing=max(0.,dot(ray,uCinemaKey));
 float glow=(pow(facing,12.)*.10+pow(facing,96.)*.22)*(1.-uCinemaLight.w);
 return sky+uCinemaKeyColor*glow*mix(.07,1.,uCinemaLight.x);
}
`;

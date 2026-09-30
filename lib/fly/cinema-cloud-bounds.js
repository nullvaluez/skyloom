// The rendered world bends downward, so unbending a view ray gives a quadratic
// altitude. A flat slab misses its second interval and clips clouds at the rim.
export function cloudRayBounds(eye,ray,limit,center,k,low,high){
 const dx=eye[0]-center[0],dz=eye[2]-center[1];
 const a=k*(ray[0]**2+ray[2]**2),b=ray[1]+2*k*(dx*ray[0]+dz*ray[2]),c=eye[1]+k*(dx*dx+dz*dz);
 const hits=[],inside=y=>y>=low&&y<=high,put=t=>{if(t>=0&&t<=limit)hits.push(t);};
 if(inside(c))put(0);if(inside((a*limit+b)*limit+c))put(limit);
 for(const h of [low,high]){
  if(Math.abs(a)<1e-12){if(Math.abs(b)>1e-9)put((h-c)/b);continue;}
  const d=b*b-4*a*(c-h);if(d<0)continue;
  const q=-.5*(b+(b<0?-1:1)*Math.sqrt(d));
  if(Math.abs(q)>1e-12){put(q/a);put((c-h)/q);}else put(-b/(2*a));
 }
 return hits.length?[Math.min(...hits),Math.max(...hits)]:[0,0];
}
export const CLOUD_BOUNDS_GLSL=`
void cloudHit(float t,float limit,inout vec2 hits){if(t>=0.&&t<=limit){hits.x=min(hits.x,t);hits.y=max(hits.y,t);}}
vec2 cloudRayBounds(vec3 eye,vec3 ray,float limit,vec2 center,float k,float low,float high){
 vec2 d=eye.xz-center;float a=k*dot(ray.xz,ray.xz),b=ray.y+2.*k*dot(d,ray.xz),c=eye.y+k*dot(d,d);
 vec2 hits=vec2(1e30,-1e30);float end=(a*limit+b)*limit+c;
 if(c>=low&&c<=high)cloudHit(0.,limit,hits);if(end>=low&&end<=high)cloudHit(limit,limit,hits);
 for(int i=0;i<2;i++){
  float h=i==0?low:high;
  if(abs(a)<1e-12){if(abs(b)>1e-9)cloudHit((h-c)/b,limit,hits);continue;}
  float disc=b*b-4.*a*(c-h);if(disc<0.)continue;
  float q=-.5*(b+(b<0.?-1.:1.)*sqrt(disc));
  if(abs(q)>1e-12){cloudHit(q/a,limit,hits);cloudHit((c-h)/q,limit,hits);}else cloudHit(-b/(2.*a),limit,hits);
 }return hits.y>=hits.x?hits:vec2(0.);
}
float cloudSampleJitter(vec2 pixel,int stepIndex){
 uvec3 p=uvec3(uvec2(pixel),uint(stepIndex));uint h=p.x*1597334677u+p.y*3812015801u+p.z*2798796415u;
 h=(h^(h>>16u))*2246822519u;h=(h^(h>>13u))*3266489917u;h^=h>>16u;
 return float(h&16777215u)/16777216.;
}
`;

// A road can run almost parallel to the view ray. Use the pixel footprint
// along the ribbon so moving the camera cannot turn an unresolved lamp or
// headlight into alternating black and bright pixels.
export const ROAD_LIGHT_FILTER_GLSL = `
float wbSmoothIntegral(float x, float a, float b) {
  float span = b - a;
  float t = clamp((x - a) / span, 0., 1.);
  return span * t*t*t * (1. - .5*t) + max(x-b, 0.);
}
float wbDashIntegral(float x, float duty) {
  float p = fract(x);
  return floor(x) * (.65*duty) + wbSmoothIntegral(p, 0., .4*duty) - wbSmoothIntegral(p, .7*duty, duty);
}
float wbFilteredDash(float phase, float duty, float width) {
  if (duty <= 0.) return 0.;
  float mean = .65*duty;
  if (width >= .65) return mean;
  if (width < max(.0001, .10*duty)) return wbDash(phase,duty);
  float h = .5*width;
  float area = (wbDashIntegral(phase+h,duty) - wbDashIntegral(phase-h,duty)) / width;
  return mix(clamp(area,0.,1.), mean, smoothstep(.35,.65,width));
}
// Bounded approximation of erf for the integral of the authored lamp
// exp(-sharp*x*x). The endpoints are periodic at half-integer phases.
float wbErf(float x) {
  float a = abs(x), d = 1. + a*(.278393 + a*(.230389 + a*(.000972 + a*.078108)));
  float q = 1. / (d*d);
  return sign(x) * (1. - q*q);
}
float wbLampIntegral(float x, float root, float scale, float mean) {
  return floor(x+.5) * mean + scale * wbErf((fract(x+.5)-.5)*root);
}
float wbFilteredLamp(float phase, float sharp, float width) {
  float d = min(phase,1.-phase);
  if (sharp <= .001 || width < .005) return exp(-sharp*d*d);
  float root = sqrt(sharp), scale = .886226925 / root;
  float mean = 2.*scale*wbErf(.5*root);
  if (width >= .65) return mean;
  float a = wbLampIntegral(phase+.5*width,root,scale,mean);
  float b = wbLampIntegral(phase-.5*width,root,scale,mean);
  return mix(clamp((a-b)/width,0.,1.),mean,smoothstep(.35,.65,width));
}`;

/** One scene-linear environment, authored for readable arcade flight. Pure and testable. */
import { moonDirFromSun } from './sun-model';
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,Number.isFinite(x)?x:a));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const rgb=(out,a,b,t)=>{for(let i=0;i<3;i++)out[i]=mix(a[i],b[i],t);};
export function createCinemaEnvironment(){return {day:1,night:0,golden:0,overcast:0,fog:0,sun:3.6,fill:.16,environment:.65,haze:1,
  sunDir:[0,1,0],moonDir:[0,1,0],keyDir:[0,1,0],keyColor:[1,1,1],fillColor:[.45,.65,1],groundColor:[.12,.10,.075],
  horizon:[0,0,0],zenith:[0,0,0],cloudUpper:[0,0,0],cloudLower:[0,0,0],sunTint:[1,1,1],
  exposureStops:0,exposure:1,extinction:.000045,heightM:1700,bloomIntensity:.26,bloomThreshold:1.4,
  cloudBase:1500,cloudThickness:2300,cloudCoverage:.5,sunVisibility:1,frame:0};}
export function evaluateCinemaEnvironment(out,sun={},weather={}) {
  const sin=clamp(sun.sinEl??1,-1,1),az=Number.isFinite(sun.az)?sun.az:0,cos=Math.sqrt(1-sin*sin);
  const elevation=Math.asin(sin)*180/Math.PI;
  out.day=smooth(-7,12,elevation);out.night=1-smooth(-12,-2,elevation);
  out.overcast=clamp(weather.overcastT);out.fog=clamp(weather.fogT);
  out.golden=smooth(-5,1,elevation)*(1-smooth(8,27,elevation))*(1-out.overcast);
  out.sunDir[0]=-Math.sin(az)*cos;out.sunDir[1]=sin;out.sunDir[2]=Math.cos(az)*cos;
  moonDirFromSun(az,out.moonDir);
  const moon=1-smooth(-6,1,elevation);
  let length=0;for(let i=0;i<3;i++){out.keyDir[i]=mix(out.sunDir[i],out.moonDir[i],moon);length+=out.keyDir[i]**2;}
  length=Math.sqrt(length)||1;for(let i=0;i<3;i++)out.keyDir[i]/=length;
  rgb(out.keyColor,[.57,.72,1],[1,.93,.78],out.day);
  rgb(out.keyColor,out.keyColor,[1,.68,.36],out.golden*.6);
  rgb(out.fillColor,[.20,.32,.55],[.48,.67,1],out.day);
  rgb(out.groundColor,[.025,.035,.065],[.15,.13,.10],out.day);
  out.sun=mix(.36,3.7,out.day)*(1-.78*out.overcast);
  out.fill=mix(.12,.18,out.day)*(1+.85*out.overcast);
  out.environment=mix(.42,.72,out.day)*(1-.2*out.overcast);
  rgb(out.horizon,[.014,.029,.060],[.34,.53,.77],out.day);
  rgb(out.horizon,out.horizon,[.82,.40,.19],out.golden*.65);
  rgb(out.zenith,[.0018,.0045,.015],[.018,.080,.24],out.day);
  const veil=1-(1-out.overcast)*(1-out.fog*.75);
  rgb(out.horizon,out.horizon,[mix(.018,.34,out.day),mix(.026,.39,out.day),mix(.044,.46,out.day)],veil*.85);
  rgb(out.zenith,out.zenith,[mix(.006,.13,out.day),mix(.012,.18,out.day),mix(.025,.25,out.day)],veil*.85);
  rgb(out.cloudUpper,[.045,.075,.135],[.66,.76,.90],out.day);
  rgb(out.cloudLower,[.012,.022,.047],[.075,.115,.19],out.day);
  rgb(out.sunTint,[.57,.72,1],out.keyColor,out.day);
  out.sunVisibility=(1-out.overcast)**2*(1-out.fog);
  out.extinction=.000040+out.overcast*.000025+out.fog*.00024;
  out.heightM=1700;out.haze=.35+.65*out.day;
  out.exposureStops=mix(.12,-.22,out.day)-.10*out.golden;out.exposure=2**out.exposureStops;
  out.bloomIntensity=mix(.38,.22,out.day);out.bloomThreshold=mix(1.15,1.55,out.day);
  out.cloudBase=1500;out.cloudThickness=2300+out.overcast*450;
  out.cloudCoverage=.41+.09*clamp(weather.presenceFrac??1)+.24*out.overcast;
  out.frame++;return out;
}

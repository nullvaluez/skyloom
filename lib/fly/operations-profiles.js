// Accessible-game tuning, not flight-manual performance. All speeds m/s.
const rows = {
  prop: [25,29,3.2,5,1.147349,9], 'warbird-prop':[40,45,4.8,6,2.2,10],
  fighter:[60,70,7,7,3,20], military:[65,74,6.5,7,3.2,17],
  'warbird-jet':[48,55,5.5,6,2.5,12], bizjet:[52,60,4,5,3,20],
  airliner:[70,78,3.1,4,7,57], cargo:[75,82,3,4,10,70],
  'flying-wing':[62,70,6,6,2.4,18],
  f35:[62,72,6.8,7,2.35,15.7],
  c17:[62,72,3.8,4.5,5.63,53],
  concorde:[85,92,4,4.5,3.45,61.66],
};
// Explicit attachment points on the authored models. Contact points remain
// wheel centers; the visible struts start at the skin, not a length heuristic.
const gear = {
  c17: { wheelRadius:.68, noseWheelRadius:.51, mainWheelRows:3, twinMainWheels:true, twinNoseWheels:true,
    gearMounts:[[-3.17,-3.06,3.1],[3.17,-3.06,3.1],[0,-3.15,-18.6]] },
  concorde: { wheelRadius:.58, noseWheelRadius:.39, mainWheelRows:2, twinMainWheels:true, twinNoseWheels:true,
    gearMounts:[[-2.48,-1.12,7.9],[2.48,-1.12,7.9],[0,-1.06,-18.9]] },
};
export function operationsProfile(id) {
  const r=rows[id]; if(!r)return null;
  const [rotate,approach,accel,braking,clearance,length]=r;
  const authored=gear[id];
  const result = {id,rotate,approach,accel,braking,clearance,length,stall:rotate*.72,fixedGear:id==='prop',modelOffsetY:id==='airliner'?-1:0,
    taxiSpeed: id==='prop'?5:7, wheelRadius:Math.max(.22,length*.012),
    gearPoints:[[-length*.12,-clearance+Math.max(.22,length*.012),length*.08],
      [length*.12,-clearance+Math.max(.22,length*.012),length*.08],
      [0,-clearance+Math.max(.22,length*.012),-length*.3]],
    maxSink:6, maxBank:.22, maxPitch:.28, ...authored };
  if(authored)result.gearPoints=authored.gearMounts.map(([x,,z],i)=>[x,-clearance+(i===2?authored.noseWheelRadius:authored.wheelRadius),z]);
  return result;
}

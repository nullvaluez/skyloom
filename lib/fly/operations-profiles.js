// Accessible-game tuning, not flight-manual performance. All speeds m/s.
const rows = {
  prop: [25,29,3.2,5,1.147349,9], 'warbird-prop':[40,45,4.8,6,2.2,10],
  fighter:[60,70,7,7,3,20], military:[65,74,6.5,7,3.2,17],
  'warbird-jet':[48,55,5.5,6,2.5,12], bizjet:[52,60,4,5,3,20],
  airliner:[70,78,3.1,4,7,57], cargo:[75,82,3,4,10,70],
};
export function operationsProfile(id) {
  const r=rows[id]; if(!r)return null;
  const [rotate,approach,accel,braking,clearance,length]=r;
  return {id,rotate,approach,accel,braking,clearance,length,stall:rotate*.72,fixedGear:id==='prop',modelOffsetY:id==='airliner'?-1:0,
    taxiSpeed: id==='prop'?5:7, wheelRadius:Math.max(.22,length*.012),
    gearPoints:[[-length*.12,-clearance+Math.max(.22,length*.012),length*.08],
      [length*.12,-clearance+Math.max(.22,length*.012),length*.08],
      [0,-clearance+Math.max(.22,length*.012),-length*.3]],
    maxSink:6, maxBank:.22, maxPitch:.28 };
}

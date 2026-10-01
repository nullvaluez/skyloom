// Presentation only. Metres, +Y up, nose -Z. Physics stays in HANGAR/operations.
const rows = [
  ['military','talon',17,13.6,'twin-jet','#899ba2','#223b46','#d59152'],
  ['warbird-jet','dart',12,9.6,'delta','#bec9ca','#284957','#d06a41'],
  ['warbird-prop','mustang',10,11.5,'warbird','#bdc6c3','#304f4a','#e2b660'],
  ['prop','skylark',9,11.8,'high-wing','#e4dfcd','#274c60','#d87748'],
  ['glider','whisper',8,19.2,'sailplane','#e9e6db','#376370','#d19055'],
  ['bizjet','meridian',20,21,'business','#dcded6','#264a57','#b18151'],
  ['airliner','stratoliner',57,59,'widebody','#dbded9','#2a4857','#c88348'],
  ['cargo','leviathan',70,65,'freighter','#9dadae','#294550','#d1a062'],
];
export const FLEET_PRESENTATION = Object.fromEntries(rows.map(([id,slug,length,span,type,hull,trim,accent])=>[id,{
  id,slug,length,span,type,colors:{hull,trim,accent},url:`/models/player-${slug}-hero-v1.glb`,mobileUrl:`/models/player-${slug}-mobile-v1.glb`,
  thumbnail:`/models/player-${slug}-v1.svg`,yawFixRad:0,forceVertexColors:false,canopyMaterial:'glass',
  parts:{ailerons:['aileron-left','aileron-right'],elevators:['elevator-left','elevator-right'],rudder:type==='twin-jet'?['rudder-left','rudder-right']:'rudder',propeller:['high-wing','warbird'].includes(type)?'propeller':null},
  liverySlots:['hull','trim','accent'],engines:type==='twin-jet'?[[-1.02,-.17,7.48],[1.02,-.17,7.48]]:type==='delta'?[[0,0,5.16]]:type==='business'?[-1,1].map(side=>[side*.13*length,.026*length,.3925*length]):['widebody','freighter'].includes(type)?[-1,1].flatMap(side=>(type==='freighter'?[.16,.29]:[.19]).map(x=>[side*x*length,-.087*length,(-.035+x*.45)*length])):[],
  author:'Skyloom',license:'MIT',revision:1,
}]));

export const VECTOR_PARTS = {ailerons:['vector-aileron-left','vector-aileron-right'],elevators:['vector-elevator-left','vector-elevator-right'],rudder:null,propeller:null};

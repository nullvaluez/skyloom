import { airportById, airportEligible, airportPoint, airportLocal, airportFrame, airportTaxiExits, findAirportSurface, nearestOperationsAirport, taxiRoute } from './operations-airports.js';
import { operationsProfile } from './operations-profiles.js';
import { approachPathPoint } from './operations-paths.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const angle=a=>Math.atan2(Math.sin(a),Math.cos(a));
const groundPhases=new Set(['parked','taxiOut','takeoffRoll','landingRoll','taxiIn']);

/** Owns one player flight. No React, renderer, storage, or network dependencies.
 * advance returns true when it owns the motion step; false delegates to cruise.
 * Contact/events only originate inside fixed-step integration. No renderer or
 * terrain-streaming callback may manufacture a touchdown. */
export class FlightOperations {
  constructor(){this.phase='hangar';this.accumulator=0;this.throttle=0;this.parkingBrake=true;this.events=[];this.elapsed=0;this.sequence=0;this.assisted=false;this.guidance=true;this.gear=1;this.flaps=1;this.vy=0;this.routeIndex=1;this.parkTime=0;this.contactCount=0;this.takeoffs=0;this.summary=null;}
  get grounded(){return groundPhases.has(this.phase);}
  setThrottle(value){this.throttle=clamp(value,0,1);this.taxiAssist=false;}
  toggleBrake(){this.parkingBrake=!this.parkingBrake;}
  toggleGuidance(){this.guidance=!this.guidance;}
  setPowerPreset(index){this.throttle=[0,.45,1][index];this.taxiAssist=index===1;}
  startTaxi(){if(!this.grounded)return false;this.setPowerPreset(1);this.parkingBrake=false;return true;}
  takeoffStatus(flight){
    if(!this.grounded||!this.airport)return {aligned:false,ready:false};
    const surface=findAirportSurface(flight.pos.x,flight.pos.z);
    if(surface?.kind!=='runway')return {aligned:false,ready:false};
    const error=Math.abs(angle(flight.heading-airportFrame(surface.airport).heading));
    return {aligned:Math.min(error,Math.abs(Math.PI-error))<.18&&Math.abs(surface.cross)<surface.airport.width*.4,ready:flight.speed>=this.profile.rotate,reverse:error>Math.PI/2};
  }
  startTakeoff(flight){
    const status=this.takeoffStatus(flight);
    if(!status.aligned||!['parked','taxiOut','takeoffRoll'].includes(this.phase))return false;
    this.reverse=status.reverse;this.parkingBrake=false;this.setPowerPreset(2);this.phase='takeoffRoll';return true;
  }
  lineUp(flight){
    if(!this.profile||!['parked','taxiOut'].includes(this.phase))return false;
    const frame=airportFrame(this.airport),point=airportPoint(this.airport,this.reverse?frame.length-65:65);
    flight.pos.set(point.x,point.y+this.profile.clearance,point.z);flight.heading=frame.heading+(this.reverse?Math.PI:0);
    flight.speed=0;flight.pitch=0;flight.bank=0;flight.turnRate=0;flight.pitchRate=0;flight.groundElev=point.y;flight.agl=this.profile.clearance;flight.floorContact=null;
    this.phase='parked';this.parkingBrake=true;this.setPowerPreset(0);this.vy=0;this.accumulator=0;this.routeWarning=null;this.routeIndex=4;this.assisted=true;this.emit('runway-lineup');return true;
  }
  setApproachRunway(reverse){if(!this.grounded)this.reverse=!!reverse;}
  returnToHangar(){this.phase='hangar';}
  markSaved(){this.saved=true;}
  goAround(flight){
    if(this.grounded||!this.profile)return false;
    this.phase='airborne';this.approachRequested=false;this.throttle=1;this.taxiAssist=false;this.lastTouchdown=null;this.parkingBrake=false;
    // The action must arrest the descent, not merely add power while leaving
    // a nose-down approach pointed at the runway. Pilot steering remains live.
    if(flight){flight.pitch=Math.max(flight.pitch,.10);flight.pitchRate=0;this.vy=Math.max(0,this.vy);}
    this.emit('go-around');return true;
  }
  setApproachPower(flight){if(this.grounded||!this.profile)return false;this.setThrottle(this.profile.approach/flight.cfg.speeds.cruise);return true;}
  chooseRunway(wind){const a=this.airport;if(!a)return;const f=airportFrame(a);this.reverse=Number.isFinite(wind?.windX)&&Number.isFinite(wind?.windZ)&&(wind.windX*f.ux+wind.windZ*f.uz)>1;}
  get runwayName(){return this.reverse?this.airport?.reciprocal:this.airport?.runway;}
  emit(type,detail={}){this.events.push({id:++this.sequence,type,...detail});if(this.events.length>32)this.events.shift();}
  begin(flight,aircraftId,airportId){
    const a=airportById(airportId), profile=operationsProfile(aircraftId);
    if(!profile||!airportEligible(a,aircraftId))return false;
    this.profile=profile;this.departure=a.id;this.destination=a.id;this.airport=a;this.phase='parked';this.reverse=false;
    this.throttle=0;this.taxiAssist=false;this.parkingBrake=true;this.elapsed=0;this.assisted=false;this.summary=null;this.saved=false;this.reason=null;this.bounced=false;this.bounceCooldown=0;this.contactCount=0;this.takeoffs=0;this.events=[];
    this.vy=0;this.accumulator=0;this.routeIndex=1;this.parkTime=0;this.gear=1;this.flaps=1;this.lastTouchdown=null;this.approachRequested=false;this.arrivalExit=null;this.routeWarning=null;
    const route=taxiRoute(a),p=airportPoint(a,...route[0]),q=airportPoint(a,...route[1]);
    flight.pos.set(p.x,p.y+profile.clearance,p.z);flight.heading=Math.atan2(q.x-p.x,-(q.z-p.z));
    flight.speed=0;flight.pitch=0;flight.bank=0;flight.pitchRate=0;flight.turnRate=0;flight.groundElev=p.y;flight.agl=profile.clearance;flight.latDeg=a.a.lat;flight.floorContact=null;flight._trimT=0;
    flight.operations=this;this.emit('departure');return true;
  }
  selectDestination(id){
    const a=airportById(id);if(!airportEligible(a,this.profile?.id))return false;
    this.destination=id;this.approachRequested=false;
    if(this.phase==='approach')this.phase='airborne';
    return true;
  }
  guideApproach(flight,wind){
    const a=airportById(this.destination);if(this.grounded||!flight||!airportEligible(a,this.profile?.id))return false;
    // Keep an assigned runway for a return circuit. At another airport wind
    // supplies the default, but an established final takes precedence.
    const sameAirport=this.airport?.id===a.id;this.airport=a;
    if(!sameAirport)this.chooseRunway(wind);
    const local=airportLocal(a,flight.pos.x,flight.pos.z),frame=airportFrame(a);
    const facing=Math.cos(flight.heading-frame.heading);
    if(Math.abs(local.cross)<1500 && ((local.along<0&&facing>.7)||(local.along>frame.length&&facing<-.7)))this.reverse=facing<0;
    this.approachRequested=true;
    const distance=Math.hypot(local.cross,Math.max(0,-local.along,local.along-frame.length));
    const agl=flight.pos.y-airportPoint(a,local.along).y;
    if(distance<5500&&agl<500){this.phase='approach';this.approachRequested=false;this.emit('approach');}
    return true;
  }
  approachGuidance(flight){
    const a=this.airport,local=airportLocal(a,flight.pos.x,flight.pos.z),length=airportFrame(a).length;
    const distance=this.reverse?local.along-(length-(a.thresholdB||0)):(a.thresholdA||0)-local.along;
    // Three-degree path runs to the touchdown aim point, 250 m beyond the
    // threshold, rather than levelling at 12 m over the whole runway.
    const targetHeight=approachPathPoint(a,this.profile,this.reverse,distance).y;
    const headingError=angle(airportFrame(a).heading+(this.reverse?Math.PI:0)-flight.heading);
    return {distance,lateral:local.cross*(this.reverse?-1:1),vertical:flight.pos.y-targetHeight,targetHeight,headingError};
  }
  groundRoute(){return taxiRoute(this.airport,this.phase==='taxiIn'||this.phase==='landingRoll',this.reverse,this.arrivalExit??undefined);}
  updateArrivalExit(flight){
    const local=airportLocal(this.airport,flight.pos.x,flight.pos.z),direction=this.reverse?-1:1;
    // Pick ahead of the rollout. If the player passes an exit while still on
    // the runway, advance to the next connector rather than pointing behind.
    if(this.routeIndex>1||Math.abs(local.cross)>this.airport.width/2)return;
    if(this.arrivalExit!=null&&(this.arrivalExit-local.along)*direction>=-20)return;
    const exits=airportTaxiExits(this.airport).sort((a,b)=>(a-b)*direction);
    this.arrivalExit=exits.find(s=>(s-local.along)*direction>=-20)??exits.at(-1);
    this.routeIndex=0;
  }
  warp(flight){if(this.phase==='hangar')return;this.assisted=true;this.phase='airborne';this.approachRequested=false;this.parkingBrake=false;this.vy=Math.sin(flight.pitch)*flight.speed;this.accumulator=0;this.contactCount=0;this.lastTouchdown=null;this.emit('warp');}
  retry(flight){const a=airportById(this.destination)||this.airport; if(!a||!this.profile)return false;
    const f=airportFrame(a),p=airportPoint(a,this.reverse?f.length-(a.thresholdB||0)+3000:(a.thresholdA||0)-3000);
    const height=this.profile.clearance+3250*Math.tan(Math.PI/60);
    flight.pos.set(p.x,p.y+height,p.z);flight.heading=f.heading+(this.reverse?Math.PI:0);flight.pitch=-Math.PI/60;flight.bank=0;flight.speed=this.profile.approach;flight.groundElev=p.y;flight.latDeg=a.a.lat;flight.floorContact=null;
    flight.turnRate=0;flight.pitchRate=0;flight.agl=height;
    this.airport=a;this.reason=null;this.bounced=false;this.bounceCooldown=0;this.phase='approach';this.lowSpeed=true;this.approachRequested=false;this.assisted=true;this.vy=Math.sin(flight.pitch)*flight.speed;this.throttle=clamp(this.profile.approach/flight.cfg.speeds.cruise,0,1);this.parkingBrake=false;this.accumulator=0;this.gear=1;this.lastTouchdown=null;this.emit('retry');return true;}
  advance(dt,flight,cmd,held=false){
    flight.operations=this;
    if(held||this.phase==='hangar'||this.phase==='completed'||this.phase==='crashed'){this.accumulator=0;return true;}
    if(!this.profile)return false;
    this.elapsed+=Math.min(dt,.1);
    const nearest=nearestOperationsAirport(flight.pos.x,flight.pos.z);
    const agl=flight.pos.y-(nearest.distance<4000?airportPoint(nearest.airport,airportLocal(nearest.airport,flight.pos.x,flight.pos.z).along).y:flight.groundElev);
    if(this.approachRequested&&!this.grounded&&nearest.airport.id===this.destination&&nearest.distance<5500&&agl<500){this.phase='approach';this.approachRequested=false;this.emit('approach');}
    const wasLowSpeed=this.lowSpeed;
    // Keep the current owner through a small band at the envelope boundary.
    // Otherwise a descending turn near 500 m can swap flight models each frame.
    this.lowSpeed=this.grounded||this.phase==='approach'||(nearest.distance<(wasLowSpeed?6000:5500)&&agl<(wasLowSpeed?550:500));
    if(this.lowSpeed&&wasLowSpeed===false&&!this.grounded&&this.phase!=='approach'){this.setThrottle(flight.speed/flight.cfg.speeds.cruise);this.vy=Math.sin(flight.pitch)*flight.speed;}
    if(!this.lowSpeed){this.gear=Math.max(0,this.gear-dt);this.flaps=0;this.vy=Math.sin(flight.pitch)*flight.speed;return false;}
    this.gear=Math.min(1,this.gear+dt);this.flaps=1;
    this.throttle=clamp(Number.isFinite(cmd.throttle)?cmd.throttle:this.throttle+(cmd.throttleDelta||0)*dt*.35,0,1);
    if(cmd.throttleDelta)this.taxiAssist=false;
    if(cmd.powerPreset!=null)this.setPowerPreset(cmd.powerPreset);
    if(cmd.toggleParkingBrake)this.parkingBrake=!this.parkingBrake;
    this.accumulator=Math.min(this.accumulator+dt,.1);
    while(this.accumulator>=1/120){this.step(1/120,flight,cmd);this.accumulator-=1/120;}
    return true;
  }
  step(dt,f,cmd){
    if(this.phase==='crashed'||this.phase==='completed')return;
    const p=this.profile,surface=findAirportSurface(f.pos.x,f.pos.z), wasGrounded=this.grounded;
    const ground=surface?.height??f.groundElev, floor=ground+p.clearance;
    this.bounceCooldown=Math.max(0,(this.bounceCooldown||0)-dt);
    const brake=clamp(cmd.brake||0,0,1);
    if(wasGrounded){
      const thrust=this.taxiAssist?Math.min(this.throttle,Math.max(0,(p.taxiSpeed-f.speed)*.5)):this.throttle;
      f.speed=Math.max(0,f.speed+(thrust*p.accel-(.10+f.speed*.012)-brake*p.braking-(this.parkingBrake?p.braking*2:0))*dt);
      if(this.parkingBrake && f.speed<.1)f.speed=0;
      // Nose-wheel authority arrives at walking speed. A small powered
      // steering floor makes tight turns recoverable without a run-up.
      const steering=this.parkingBrake||brake>.5?0:Math.min(p.length>40?.65:.8,(this.throttle>0?.22:0)+f.speed*.12)/(1+f.speed*.04);
      f.heading+=clamp(cmd.turn||0,-1,1)*steering*dt;
      f.bank=0;f.pitch+=((f.speed>=p.rotate*.85?clamp((cmd.pitch||0)*.18,0,.18):0)-f.pitch)*Math.min(1,dt*3);
      f.pos.y=floor;this.vy=0;
      if(this.phase==='parked'&&f.speed>.3)this.phase='taxiOut';
      if(this.phase==='taxiOut'&&surface?.kind==='runway'&&f.speed>p.taxiSpeed*1.5)this.phase='takeoffRoll';
      if(this.phase==='takeoffRoll'&&f.speed<p.taxiSpeed&&this.throttle<.5)this.phase='taxiOut';
      if(surface?.kind==='runway'&&f.speed>=p.rotate&&f.pitch>.065&&!this.parkingBrake){
        this.phase='airborne';this.vy=2;f.pos.y+=.03;this.takeoffs++;
        this.emit(this.lastTouchdown?'touch-and-go':'takeoff',{airport:this.airport.id});this.lastTouchdown=null;
      }
      if(!surface&&f.speed>p.taxiSpeed*2){this.fail('Runway excursion — reduce speed before leaving the pavement.');return;}
    }else{
      const target=this.throttle*f.cfg.speeds.cruise;
      // Cutting power in the flare must not apply the wheel-brake deceleration
      // in mid-air. Preserve glide energy while the pilot settles onto the
      // runway; the stronger brake rating is used only by ground contact.
      f.speed=Math.max(0,f.speed+clamp(target-f.speed,-p.accel*.3,p.accel)*dt);
      const yawRate=p.length>40?.14:p.id==='prop'?.24:.20;
      f.turnRate+=(clamp(cmd.turn||0,-1,1)*yawRate-f.turnRate)*Math.min(1,dt*3);
      f.heading+=f.turnRate*dt;
      f.pitch=clamp(f.pitch+(cmd.pitch||0)*.22*dt,-.45,.4);
      // Neutral stick holds the selected attitude. Levelling the nose every
      // frame erased a trimmed descent and forced constant pitch corrections
      // on final. This is attitude hold, not runway tracking or an autopilot.
      f.bank+=(clamp(Math.atan(f.speed*f.turnRate/9.81),-.65,.65)-f.bank)*Math.min(1,dt*4);
      const lift=clamp(f.speed/p.stall,0,1), desired=Math.sin(f.pitch)*f.speed-(1-lift)*12;
      this.vy+=(desired-this.vy)*Math.min(1,dt*2);f.pos.y+=this.vy*dt;
    }
    const k=1/Math.cos(f.latDeg*Math.PI/180);
    f.pos.x+=Math.sin(f.heading)*f.speed*Math.cos(f.pitch)*k*dt;
    f.pos.z-=Math.cos(f.heading)*f.speed*Math.cos(f.pitch)*k*dt;
    const contact=findAirportSurface(f.pos.x,f.pos.z), groundAfter=contact?.height??ground;
    if(wasGrounded&&this.grounded&&!contact){
      if(f.speed>p.taxiSpeed*2){this.fail('Runway excursion — brake earlier and stay on the pavement.');return;}
      // Low-speed shoulder contact is recoverable. Rewinding the position and
      // setting speed to zero made an invisible wall: steering also depended
      // on speed, so a slightly wide taxi turn could permanently trap a plane.
      // Let the player crawl and steer back. Rotation still requires runway
      // contact, and the high-speed excursion check above remains unchanged.
      f.speed=Math.min(f.speed,p.taxiSpeed*.65);
      this.routeWarning='Off the pavement. Use taxi power and steer back to the marked route.';
    }else this.routeWarning=null;
    if(!this.grounded&&f.pos.y<=groundAfter+p.clearance&&this.vy<=0){
      if(!contact||contact.kind!=='runway'||!airportEligible(contact.airport,p.id)){this.fail('Touchdown outside the runway. Line up again.');return;}
      const landingLocal=airportLocal(contact.airport,f.pos.x,f.pos.z), landingLength=airportFrame(contact.airport).length;
      const headingError=Math.abs(angle(f.heading-airportFrame(contact.airport).heading));
      const landingReverse=headingError>Math.PI/2;
      if(landingReverse?landingLocal.along>landingLength-(contact.airport.thresholdB||0):landingLocal.along<(contact.airport.thresholdA||0)){this.fail('Touchdown before the displaced threshold. Aim beyond the runway threshold bars.');return;}
      if(-this.vy>p.maxSink||Math.abs(f.bank)>p.maxBank||Math.abs(f.pitch)>p.maxPitch||Math.min(headingError,Math.abs(Math.PI-headingError))>.35||f.speed>p.approach*1.55){this.fail('Hard landing — approach slower, wings level, and flare gently.');return;}
      if(Math.abs(this.vy)>3 && !this.bounced && this.bounceCooldown===0){
        this.bounced=true;this.bounceCooldown=1.5;this.vy=Math.min(1.2,Math.abs(this.vy)*.2);f.pos.y=groundAfter+p.clearance+.03;this.emit('bounce');return;
      }
      this.lastTouchdown={sink:Math.abs(this.vy),quality:this.bounced?'Recovered bounce':Math.abs(this.vy)<1.5?'Smooth':Math.abs(this.vy)<3?'Good':'Firm',airport:contact.airport.id};
      this.airport=contact.airport;this.destination=contact.airport.id;this.reverse=landingReverse;this.contactCount++;this.emit('touchdown',this.lastTouchdown);
      this.phase='landingRoll';this.vy=0;f.pos.y=groundAfter+p.clearance;this.routeIndex=0;this.arrivalExit=null;
    }
    if(this.phase==='landingRoll'&&f.speed<=p.taxiSpeed)this.phase='taxiIn';
    if(this.phase==='taxiIn'||this.phase==='landingRoll')this.updateArrivalExit(f);
    if(this.phase==='taxiIn'){
      const stand=airportPoint(this.airport,...taxiRoute(this.airport)[0]);
      const inStand=Math.hypot(f.pos.x-stand.x,f.pos.z-stand.z)/k<Math.max(12,p.length*.45);
      this.parkTime=inStand&&f.speed<.5&&this.parkingBrake?this.parkTime+dt:0;
      if(this.parkTime>=2){this.phase='completed';this.summary={aircraft:p.id,departure:this.departure,destination:this.destination,duration:Math.round(this.elapsed),touchdown:this.lastTouchdown?.quality||'Practice',assisted:this.assisted,at:Date.now()};this.emit('completed',this.summary);}
    }
    if(this.grounded&&this.phase!=='landingRoll'){
      const route=this.groundRoute();
      this.routeIndex=Math.min(this.routeIndex,route.length-1);
      const point=airportPoint(this.airport,...route[this.routeIndex]);
      // Switch at the junction, not 25 m before a 20 m-wide KOSU connector.
      // Early marker changes encouraged diagonal shortcuts across the grass.
      const turnDistance=this.airport.id==='KOSU'?8:18;
      if(Math.hypot(f.pos.x-point.x,f.pos.z-point.z)/k<turnDistance&&this.routeIndex<route.length-1)this.routeIndex++;
    }
    f.groundElev=groundAfter;f.agl=f.pos.y-groundAfter;f.floorContact=null;f.boosting=false;
  }
  fail(reason){this.phase='crashed';this.reason=reason;this.emit('crashed',{reason});}
  guidanceTarget(f){
    if(!this.airport||['hangar','crashed','completed'].includes(this.phase))return null;
    if(this.phase==='takeoffRoll')return airportPoint(this.airport,this.reverse?65:airportFrame(this.airport).length-65);
    if(this.grounded){const route=this.groundRoute();
      return airportPoint(this.airport,...route[Math.min(this.routeIndex,route.length-1)]);}
    const a=airportById(this.destination),local=airportLocal(a,f.pos.x,f.pos.z);
    const length=airportFrame(a).length,before=this.reverse?local.along>length+3500:local.along < -3500;
    const point=airportPoint(a,this.reverse?(before?length+3000:length-(a.thresholdB||0)-250):(before?-3000:(a.thresholdA||0)+250));point.y+=before?160:12;return point;
  }
}

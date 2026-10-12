/** Four persistent positional voices, sharing the existing muted master gain.
 * Synthesized engine texture only; no radio or simulated aircraft. */
export class AirportAudio {
  constructor(base){this.base=base;this.voices=[];this.disposed=false;}
  update(runtime,state){
    const ctx=this.base.ctx;if(!ctx||this.disposed)return;
    const active=!!runtime.airportWatch?.active&&state.soundOn&&!document.hidden;
    if(!active&&!this.voices.length)return;
    if(active&&ctx.currentTime<(this.nextUpdate||0))return;
    this.nextUpdate=ctx.currentTime+.2;
    if(active&&!this.voices.length){for(let i=0;i<4;i++){
      const source=ctx.createOscillator(),filter=ctx.createBiquadFilter(),gain=ctx.createGain(),pan=ctx.createStereoPanner();
      source.type='sawtooth';source.frequency.value=45+i*3;filter.type='lowpass';filter.frequency.value=260;gain.gain.value=0;
      source.connect(filter).connect(gain).connect(pan).connect(this.base.master);source.start();this.voices.push({source,filter,gain,pan});
    }}
    const camera=runtime.camera,anchor=runtime.origin?.anchor;
    const eye=camera?{x:camera.position.x+(anchor?.x||0),y:camera.position.y,z:camera.position.z+(anchor?.z||0)}:null;
    const k=runtime.airportWatch?.frame?.k||1;
    const contacts=active&&eye?(runtime.traffic?.items||[]).filter(t=>t.stale===0).map(t=>({t,d:Math.hypot((t.rx-eye.x)/k,t.ry-eye.y,(t.rz-eye.z)/k)})).filter(t=>t.d<2400).sort((a,b)=>a.d-b.d).slice(0,4):[];
    for(let i=0;i<this.voices.length;i++){
      const v=this.voices[i],c=contacts[i],time=ctx.currentTime;
      v.gain.gain.setTargetAtTime(c?.025*Math.pow(1-c.d/2400,2):0,time,.22);
      if(c){const dx=c.t.rx-eye.x,dz=c.t.rz-eye.z;const rightX=camera.matrixWorld.elements[0],rightZ=camera.matrixWorld.elements[2];v.pan.pan.setTargetAtTime(Math.max(-1,Math.min(1,(dx*rightX+dz*rightZ)/Math.max(1,c.d*k))),time,.2);v.source.frequency.setTargetAtTime(42+Math.min(35,Math.hypot(c.t.fix1.vE,c.t.fix1.vN)*.12),time,.4);}
    }
  }
  dispose(){this.disposed=true;for(const v of this.voices){v.source.stop();for(const n of Object.values(v))n.disconnect();}this.voices=[];}
}

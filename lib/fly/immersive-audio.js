/** Optional CC0 audio texture layer; the existing synthesis remains the fallback. */
export class ImmersiveAudio {
  constructor(base){this.base=base;this.started=false;this.disposed=false;this.nodes=[];this.controller=new AbortController();this.status='idle';}
  async load(){
    if(this.started||!this.base.ctx||this.disposed)return;
    this.started=true;this.status='loading';const ctx=this.base.ctx;
    try {
      for(const name of ['wind','engine']){
        const response=await fetch(`/audio/immersive/${name}.${name==='wind'?'ogg':'mp3'}`,{signal:this.controller.signal});
        if(!response.ok)throw new Error(`Audio ${response.status}`);
        const decoded=await ctx.decodeAudioData(await response.arrayBuffer());
        if(this.disposed)return;
        // Fold a short tail into the head, producing a continuous loop boundary.
        const fade=Math.min(Math.floor(ctx.sampleRate*.2),Math.floor(decoded.length/4));
        const length=decoded.length-fade,buffer=ctx.createBuffer(decoded.numberOfChannels,length,ctx.sampleRate);
        for(let ch=0;ch<decoded.numberOfChannels;ch++){
          const input=decoded.getChannelData(ch),out=buffer.getChannelData(ch);out.set(input.subarray(0,length));
          for(let i=0;i<fade;i++){const t=i/fade;out[i]=input[length+i]*(1-t)+input[i]*t;}
        }
        const source=ctx.createBufferSource(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
        source.buffer=buffer;source.loop=true;gain.gain.value=0;filter.type='lowpass';filter.frequency.value=3000;
        source.connect(filter).connect(gain).connect(this.base.master);source.start();
        this.nodes.push({name,source,gain,filter});
      }
      this.status='ready';
    }catch(error){this.status=this.disposed?'disposed':'fallback';this.error=error.name;}
  }
  update(runtime,store,active){
    if(active&&!this.base.muted)this.load();
    const ctx=this.base.ctx;if(!ctx||ctx.state!=='running')return;
    const f=runtime.flight,t=ctx.currentTime,speed=Math.min(1,f.speed/(f.cfg?.speeds.boost||750));
    const inside=runtime.immersiveClouds?.inside||0;
    const distance=runtime.camera?.position.distanceTo({x:f.pos.x-(runtime.origin?.anchor.x||0),y:f.pos.y,z:f.pos.z-(runtime.origin?.anchor.z||0)})||80;
    const audible=active&&store.phase==='flying'&&store.soundOn;
    for(const node of this.nodes){
      const wind=node.name==='wind';
      const gain=!audible?0:wind?.14*Math.pow(speed,.8)*(1+inside*.25):this.base.profile.mode==='wind'?0:.09*(.4+speed)*Math.min(1,100/Math.max(40,distance));
      node.gain.gain.setTargetAtTime(gain,t,.35);
      node.filter.frequency.setTargetAtTime(wind?3800-inside*1800:1600+speed*2800,t,.5);
      node.source.playbackRate.setTargetAtTime(wind?.8+speed*.25:.65+speed*.55,t,.5);
    }
    runtime.immersiveAudio={status:this.status,loops:this.nodes.length,inside,paused:!audible};
  }
  dispose(){this.disposed=true;this.controller.abort();for(const n of this.nodes){n.source.stop();n.source.disconnect();n.filter.disconnect();n.gain.disconnect();}this.nodes=[];}
}

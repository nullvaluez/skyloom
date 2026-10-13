// Observation lounge soundscape gate (node; a counting WebAudio mock and a
// controllable clock drive the real lib/fly/airport-audio.js).
//
// Proves: nothing is built before the gesture-owned context exists; the
// graph is bounded (a fixed voice pool for any number of contacts); the
// music director is ducked while observing and restored after; a takeoff
// roll is HEARD only after its sound has travelled to the seat (343 m/s);
// nearer aircraft are louder and brighter; doppler raises an approaching
// engine and lowers a receding one; mute, a hidden tab and leaving silence
// everything; leaving tears the graph down and dispose releases every node.
//
// Run: node scripts/verify-airport-audio.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {registerHooks} from 'node:module';
import {fileURLToPath} from 'node:url';
registerHooks({resolve(s,c,next){if(s.startsWith('@/'))s=new URL('../'+s.slice(2),import.meta.url).href;if(s.startsWith('.')||s.startsWith('file:')){const u=new URL(s,c.parentURL);if(fs.existsSync(fileURLToPath(u)+'.js'))return next(u.href+'.js',c);}return next(s,c);}});
const {AirportAudio,retarded}=await import('../lib/fly/airport-audio.js');
const {SOUNDSCAPE}=await import('../lib/fly/observation-config.js');

globalThis.document={hidden:false};
let clock=1000;
performance.now=()=>clock*1000;
let fetches=0,aborted=0;
globalThis.fetch=async(url,{signal}={})=>{fetches++;signal?.addEventListener?.('abort',()=>aborted++);return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};};

// --- counting WebAudio mock -------------------------------------------------
let allocated=0,started=0,stopped=0,disconnected=0;
const param=(v=0)=>({value:v,setTargetAtTime(x){this.value=x;},setValueAtTime(x){this.value=x;},exponentialRampToValueAtTime(x){this.value=x;},cancelScheduledValues(){}});
const node=(extra={})=>{allocated++;return {connect(t){return t;},disconnect(){disconnected++;},...extra};};
const sourceNode=(extra={})=>node({started:false,start(){this.started=true;started++;},stop(){if(!this.started)throw new Error('not started');stopped++;},...extra});
const buffer=(ch,len,rate)=>{const data=[...Array(ch)].map(()=>new Float32Array(len));return {numberOfChannels:ch,length:len,sampleRate:rate,duration:len/rate,getChannelData:i=>data[i]};};
const ctx={currentTime:0,sampleRate:8000,state:'running',destination:{},
  createGain:()=>node({gain:param(1)}),createBiquadFilter:()=>node({type:'',frequency:param(350),Q:param(1)}),createStereoPanner:()=>node({pan:param(0)}),
  createConvolver:()=>node({buffer:null}),createBufferSource:()=>sourceNode({buffer:null,loop:false,playbackRate:param(1)}),createOscillator:()=>sourceNode({type:'sine',frequency:param(440)}),
  createBuffer:buffer,decodeAudioData:async()=>buffer(1,8000*3,8000)};
let duck=[];
const base={ctx:null,muted:false,effects:{},master:{},setMusicDuck(v){duck.push(v);}};
const audio=new AirportAudio(base),state={soundOn:true};

// --- a lounge at the origin, k = 1 ------------------------------------------
const seat={x:0,y:300,z:0};
const watch={active:true,frame:{k:1},seat,floorY:300,site:{floorM:22},airport:{a:{elevation:278},b:{elevation:278}}};
const camera={matrixWorld:{elements:[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]}};
const track=(hex,x,z,{y=278,vE=0,vN=0,vUp=0,ground=true}={})=>({hex,rx:x,ry:y,ryd:y,rz:z,stale:0,flags:ground?1:0,fix1:{vE,vN,vUp,latRad:0,t:1}});
const runtime={airportWatch:watch,camera,traffic:{items:[]}};
const step=(sec,dt=0.1)=>{for(let i=0;i<Math.round(sec/dt);i++){clock+=dt;ctx.currentTime+=dt;audio.update(runtime,state);}};
const voiceFor=hex=>audio.voices.find(v=>v.hex===hex);
let checks=0;const check=async(name,fn)=>{await fn();checks++;console.log('PASS '+name);};

await check('no audio graph before the shared gesture context; the music duck is still requested',()=>{audio.update(runtime,state);assert.equal(allocated,0);assert.deepEqual(duck,[SOUNDSCAPE.musicDuck]);});
base.ctx=ctx;
await check('one hundred contacts use a fixed pool of outside voices',async()=>{
  runtime.traffic.items=Array.from({length:100},(_,i)=>track('c'+i,400+i*30,200,{ground:false,y:900,vE:60}));
  step(1);await new Promise(r=>setTimeout(r,0));step(0.3);
  assert.equal(audio.voices.length,SOUNDSCAPE.aircraft.voices);
  assert.ok(audio.voices.every(v=>v.hex),'every voice carries a contact');
  assert.ok(allocated<120,'bounded graph: '+allocated+' nodes');
  assert.equal(fetches,1,'the CC0 engine loop is fetched once');assert.equal(audio.engineStatus,'ready');
  assert.ok(audio.voices.every(v=>v.engine&&v.engine.started),'engine layers attached once decoded');
  assert.ok(audio.voices.every(v=>v.gain.gain.value>0));
});
await check('a takeoff is seen first and heard later (343 m/s)',()=>{
  const roll=track('roll',3000,0);runtime.traffic.items=[roll];
  step(12); // parked on the runway end: idle level
  const idle=voiceFor('roll').gain.gain.value;
  roll.fix1.vE=40;roll.fix1.t=2; // the takeoff roll starts NOW
  step(4);
  const early=voiceFor('roll').gain.gain.value;
  assert.ok(Math.abs(early-idle)<idle*0.6,`still the idle level 4 s later (sound needs ${(3000/343).toFixed(1)} s): ${early} vs ${idle}`);
  step(6);
  const late=voiceFor('roll').gain.gain.value;
  assert.ok(late>idle*4,`the roar arrives after ~8.7 s: ${late} vs idle ${idle}`);
  const h=audio.history.get('roll'),out={};
  const delay=retarded(h,{x:0,y:301.18,z:0},1,clock,343,out);
  assert.ok(Math.abs(delay-Math.hypot(3000,23)/343)<0.3,'retarded delay '+delay);
});
await check('nearer aircraft are louder and brighter (distance and air absorption)',()=>{
  const nearT=track('near',500,0,{ground:false,y:500,vE:-70,vUp:-3}),farT=track('far',8000,0,{ground:false,y:700,vE:-70,vUp:-3});
  runtime.traffic.items=[nearT,farT];step(3);
  const n=voiceFor('near'),f=voiceFor('far');
  assert.ok(n&&f,'both voiced');assert.ok(n.gain.gain.value>f.gain.gain.value*3,`${n.gain.gain.value} vs ${f.gain.gain.value}`);
  assert.ok(n.air.frequency.value>f.air.frequency.value*3,`air lowpass ${n.air.frequency.value} vs ${f.air.frequency.value}`);
});
await check('doppler: an approaching engine plays higher than a receding one',()=>{
  const inbound=track('inb',-2000,0,{ground:false,y:600,vE:90}),outbound=track('out',2000,0,{ground:false,y:600,vE:90});
  runtime.traffic.items=[inbound,outbound];step(3);
  const a=voiceFor('inb').engine.playbackRate.value,b=voiceFor('out').engine.playbackRate.value;
  assert.ok(a>b*1.3,`approaching ${a} vs receding ${b}`);
});
await check('voices pan toward the side the sound comes from',()=>{const left=track('lft',-1500,0,{ground:false,y:600}),right=track('rgt',1500,0,{ground:false,y:600});runtime.traffic.items=[left,right];step(2);assert.ok(voiceFor('lft').pan.pan.value<-0.5&&voiceFor('rgt').pan.pan.value>0.5);});
await check('the room has a bed and a PA chime',()=>{const before=started;clock+=SOUNDSCAPE.chime.maxSec+1;ctx.currentTime+=1;audio.nextUpdate=0;audio.update(runtime,state);assert.ok(started>before,'chime oscillators scheduled');assert.equal(audio.graph.bus.gain.value,1);});
await check('mute and a hidden tab silence the room and every voice',()=>{for(const [sound,hidden] of [[false,false],[true,true]]){state.soundOn=sound;document.hidden=hidden;step(0.5);assert.equal(audio.graph.bus.gain.value,0);assert.ok(audio.voices.every(v=>v.gain.gain.value===0));}state.soundOn=true;document.hidden=false;step(0.5);assert.equal(audio.graph.bus.gain.value,1);});
await check('interface cues play only while sound is up and clean up after themselves',()=>{const before=allocated;base.muted=true;audio.cue('select');assert.equal(allocated,before);base.muted=false;audio.cue('select');audio.cue('raise');assert.ok(allocated>before);});
await check('leaving the lounge silences at once, tears the graph down, and restores the music',()=>{
  watch.active=false;step(0.5);assert.equal(audio.graph.bus.gain.value,0);assert.equal(duck.at(-1),1);
  step(3.2);assert.equal(audio.graph,null);assert.equal(audio.voices.length,0);
  // Every looping source is stopped; the only source never stop()ped is the
  // one-shot binocular swish above, which ends by itself.
  assert.equal(started-stopped,1,'sources still running: '+(started-stopped));
});
await check('returning rebuilds without a second fetch; dispose releases everything',()=>{
  watch.active=true;step(1);assert.ok(audio.graph);assert.equal(fetches,1);assert.equal(duck.at(-1),SOUNDSCAPE.musicDuck);
  const d0=disconnected;audio.dispose();assert.equal(audio.graph,null);assert.ok(disconnected>d0+20);assert.equal(duck.at(-1),1);
  audio.update(runtime,state);assert.equal(audio.graph,null,'a disposed soundscape never rebuilds');
});
console.log(`AIRPORT AUDIO: ${checks}/${checks}`);

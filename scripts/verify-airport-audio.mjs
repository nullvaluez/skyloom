import assert from 'node:assert/strict';
import {AirportAudio} from '../lib/fly/airport-audio.js';
globalThis.document={hidden:false};
let allocated=0,started=0,stopped=0,disconnected=0;
const parameter=()=>({value:0,setTargetAtTime(value){this.value=value;}});
const node=()=>{allocated++;return {gain:parameter(),pan:parameter(),frequency:parameter(),connect(){return this;},disconnect(){disconnected++;},start(){started++;},stop(){stopped++;}};};
const base={ctx:null,master:{}};
const audio=new AirportAudio(base),state={soundOn:true};
const runtime={airportWatch:{active:true,frame:{k:1}},camera:{position:{x:0,y:0,z:0},matrixWorld:{elements:[1,0,0]}},traffic:{items:Array.from({length:100},(_,i)=>({rx:100+i,ry:100,rz:0,stale:0,fix1:{vE:100,vN:0}}))}};
let checks=0;function check(name,fn){fn();checks++;console.log('PASS '+name);}
check('no audio graph before the shared gesture context',()=>{audio.update(runtime,state);assert.equal(allocated,0);});
base.ctx={currentTime:0,createOscillator:node,createGain:node,createBiquadFilter:node,createStereoPanner:node};
check('one hundred contacts use only four positional voices',()=>{for(let i=0;i<100;i++){base.ctx.currentTime+=.25;audio.update(runtime,state);}assert.equal(started,4);assert.equal(allocated,16);assert.ok(audio.voices.every(v=>v.gain.gain.value>0&&v.pan.pan.value>0));});
check('camera distance retires all distant sounds',()=>{runtime.camera.position.x=10000;base.ctx.currentTime+=1;audio.update(runtime,state);assert.ok(audio.voices.every(v=>v.gain.gain.value===0));runtime.camera.position.x=0;});
check('mute and backgrounding silence the bounded pool',()=>{for(const background of [false,true]){state.soundOn=background;document.hidden=background;base.ctx.currentTime+=1;audio.update(runtime,state);assert.ok(audio.voices.every(v=>v.gain.gain.value===0));}document.hidden=false;});
check('leaving observation silences sounds and disposal releases every node',()=>{runtime.airportWatch.active=false;audio.update(runtime,state);assert.ok(audio.voices.every(v=>v.gain.gain.value===0));audio.dispose();assert.equal(stopped,4);assert.equal(disconnected,16);assert.equal(audio.voices.length,0);});
console.log(`AIRPORT AUDIO: ${checks}/${checks}`);

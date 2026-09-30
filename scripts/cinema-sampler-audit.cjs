// Diagnostic only: observe sampler writes/bindings without synchronous getError
// on every draw (which can hide a timing-dependent first-render failure).
module.exports=function installSamplerAudit(){
 const p=WebGL2RenderingContext.prototype,contexts=new WeakMap();
 const state=gl=>{if(!contexts.has(gl))contexts.set(gl,{unit:0,program:null,bindings:[],textures:new WeakMap(),programs:new WeakMap(),locations:new WeakMap(),serial:0});return contexts.get(gl);};
 const wrap=(name,observe)=>{const original=p[name];p[name]=function(...args){const value=original.apply(this,args);observe(this,state(this),args,value);return value;};};
 wrap('activeTexture',(gl,s,[unit])=>{s.unit=unit-gl.TEXTURE0;});
 wrap('bindTexture',(gl,s,[target,texture])=>{
  (s.bindings[s.unit]??={})[target]=texture;
  if(texture&&!s.textures.has(texture))s.textures.set(texture,{id:++s.serial,compare:gl.NONE,target});
 });
 wrap('texParameteri',(gl,s,[target,pname,value])=>{const texture=s.bindings[s.unit]?.[target];if(texture&&pname===gl.TEXTURE_COMPARE_MODE)s.textures.get(texture).compare=value;});
 for(const name of ['texStorage2D','texStorage3D','texImage2D','texImage3D','compressedTexImage2D','compressedTexImage3D'])wrap(name,(gl,s,args)=>{
  const texture=s.bindings[s.unit]?.[args[0]];if(texture)s.textures.get(texture).format=args[2];
 });
 wrap('useProgram',(gl,s,[program])=>{s.program=program;});
 wrap('getUniformLocation',(gl,s,[program,name],location)=>{
  if(!s.programs.has(program))s.programs.set(program,{units:{},samplers:null});
  if(location)s.locations.set(location,{program,name});
 });
 for(const name of ['uniform1i','uniform1iv'])wrap(name,(gl,s,[location,value])=>{
  const info=s.locations.get(location);if(info)s.programs.get(info.program).units[info.name]=typeof value==='number'?[value]:Array.from(value);
 });
 for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced'])wrap(name,(gl,s)=>{
  if(!window.__sampleDrawAudit||gl.isContextLost()||!s.program)return;
  const program=s.programs.get(s.program);if(!program)return;
  if(!program.samplers){
   program.samplers=[];
   for(let i=0;i<gl.getProgramParameter(s.program,gl.ACTIVE_UNIFORMS);i++){
    const u=gl.getActiveUniform(s.program,i);
    const target=u.type===gl.SAMPLER_2D||u.type===gl.SAMPLER_2D_SHADOW?gl.TEXTURE_2D:u.type===gl.SAMPLER_3D?gl.TEXTURE_3D:u.type===gl.SAMPLER_CUBE?gl.TEXTURE_CUBE_MAP:u.type===gl.SAMPLER_2D_ARRAY?gl.TEXTURE_2D_ARRAY:null;
    if(target)program.samplers.push({name:u.name,type:u.type,target,size:u.size});
   }
  }
  const samplers=program.samplers.map(u=>({...u,bindings:(program.units[u.name]??[0]).map(unit=>({unit,...s.textures.get(s.bindings[unit]?.[u.target])}))}));
  const bad=samplers.filter(u=>u.bindings.some(t=>u.type===gl.SAMPLER_2D_SHADOW?t.compare!==gl.COMPARE_REF_TO_TEXTURE:t.compare===gl.COMPARE_REF_TO_TEXTURE));
  if(bad.length){
   window.__sampleDrawAudit=false;
   (window.__sampleBadDraws??=[]).push({name,bad,samplers,shaders:gl.getAttachedShaders(s.program).map(shader=>gl.getShaderSource(shader))});
  }
 });
};

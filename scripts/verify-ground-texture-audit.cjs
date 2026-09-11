const assert=require('node:assert/strict');
const vm=require('node:vm');
const {installGroundTextureAudit}=require('./ground-texture-audit.cjs');

const T=0x0DE1,C=0x8513,F=0x8515,D=0x806F,A=0x8C1A;
const RGBA=0x1908,RGB=0x1907,U8=0x1401,FLOAT=0x1406,HALF=0x140B;
const calls=['deleteTexture','activeTexture','bindTexture','texParameteri','texParameterf','texImage2D','texImage3D','compressedTexImage2D','compressedTexImage3D','copyTexImage2D','texStorage2D','texStorage3D','generateMipmap','bindRenderbuffer','deleteRenderbuffer','renderbufferStorage','renderbufferStorageMultisample'];
function fixture(){
  class GL {
    constructor(){this.listeners={};this.canvas={addEventListener:(name,fn)=>{this.listeners[name]=fn;}};this.nativeCalls=[];}
    createTexture(){const result={kind:'texture'};this.nativeCalls.push(['createTexture',result]);return result;}
    createRenderbuffer(){return {kind:'renderbuffer'};}
    getExtension(name){return name==='WEBGL_multisampled_render_to_texture'?this.extension:null;}
  }
  for(const method of calls)GL.prototype[method]=function(...args){if(this.throwNext){this.throwNext=false;throw new Error('native failure');}this.nativeCalls.push([method,...args]);return this.returnValue;};
  class GL2 extends GL {}
  const realm=vm.createContext({WebGLRenderingContext:GL,WebGL2RenderingContext:GL2});
  vm.runInContext(`(${installGroundTextureAudit.toString()})()`,realm);
  return {gl:new GL2(),GL,GL2,audit:realm.__groundTextureAudit,realm};
}
function bind(gl,target=T){const t=gl.createTexture();gl.bindTexture(target,t);return t;}
function image(gl,w,h,internal=RGBA,type=U8,target=T,level=0){gl.texImage2D(target,level,internal,w,h,0,RGBA,type,null);}
function snap(f){return f.audit.snapshot();}
let passed=0;
function test(name,run){try{run();passed++;console.log(`PASS ${name}`);}catch(error){console.error(`FAIL ${name}`);throw error;}}

test('RGBA8 replacement, deletion and peak are not cumulative uploads',()=>{
  const f=fixture(),t=bind(f.gl);image(f.gl,8,4);assert.equal(snap(f).currentBytes,128);
  image(f.gl,2,2);assert.equal(snap(f).currentBytes,16);assert.equal(snap(f).peakBytes,128);
  f.gl.deleteTexture(t);f.gl.deleteTexture(t);assert.equal(snap(f).currentBytes,0);assert.equal(snap(f).textures,0);assert.equal(snap(f).deleted,1);
});
test('texture units and independent targets preserve ownership',()=>{
  const f=fixture(),g=f.gl,a=bind(g);image(g,2,2);
  g.activeTexture(0x84C1);const b=bind(g);image(g,3,3);g.activeTexture(0x84C0);image(g,1,1);
  const cube=bind(g,C);image(g,2,2,RGBA,U8,F);assert.equal(snap(f).currentBytes,4+36+16);
  g.deleteTexture(a);g.deleteTexture(cube);assert.equal(snap(f).currentBytes,36);g.deleteTexture(b);
});
test('six cube faces and generated mips each counted exactly once',()=>{
  const f=fixture(),g=f.gl;bind(g,C);for(let n=0;n<6;n++)image(g,4,4,RGBA,U8,F+n);
  assert.equal(snap(f).currentBytes,384);g.generateMipmap(C);assert.equal(snap(f).currentBytes,6*(64+16+4));
  g.generateMipmap(C);assert.equal(snap(f).currentBytes,504);
});
test('base/max levels bound generated mips',()=>{
  const f=fixture(),g=f.gl;bind(g);image(g,8,8,RGBA,U8,T,2);g.texParameteri(T,0x813C,2);g.texParameterf(T,0x813D,3);g.generateMipmap(T);
  assert.equal(snap(f).currentBytes,256+64);
});
test('immutable RGBA16F storage includes every mip and replacement stays bounded',()=>{
  const f=fixture(),g=f.gl;bind(g);g.texStorage2D(T,4,0x881A,8,8);assert.equal(snap(f).currentBytes,680);
  g.generateMipmap(T);assert.equal(snap(f).currentBytes,680);assert.equal(snap(f).formats.RGBA16F.bytes,680);
});
test('immutable cube storage allocates six complete chains',()=>{
  const f=fixture(),g=f.gl;bind(g,C);g.texStorage2D(C,3,0x8058,4,4);assert.equal(snap(f).currentBytes,504);
});
test('array mip layers remain constant while 3D depth shrinks',()=>{
  const f=fixture(),g=f.gl;const arr=bind(g,A);g.texStorage3D(A,3,0x8058,4,4,4);assert.equal(snap(f).currentBytes,336);
  g.deleteTexture(arr);bind(g,D);g.texStorage3D(D,3,0x8058,4,4,4);assert.equal(snap(f).currentBytes,292);
});
test('mutable 3D and array generateMipmap follow depth rules',()=>{
  const f=fixture(),g=f.gl;let t=bind(g,D);g.texImage3D(D,0,0x8058,4,4,4,0,RGBA,U8,null);g.generateMipmap(D);assert.equal(snap(f).currentBytes,292);
  g.deleteTexture(t);bind(g,A);g.texImage3D(A,0,0x8058,4,4,4,0,RGBA,U8,null);g.generateMipmap(A);assert.equal(snap(f).currentBytes,336);
});
test('source uploads use intrinsic image/video dimensions',()=>{
  const f=fixture(),g=f.gl;bind(g);g.texImage2D(T,0,RGBA,RGBA,U8,{width:1,height:1,naturalWidth:10,naturalHeight:8});assert.equal(snap(f).currentBytes,320);
  g.texImage2D(T,0,RGBA,RGBA,U8,{width:1,height:1,videoWidth:20,videoHeight:10});assert.equal(snap(f).currentBytes,800);
});
test('half/float, packed and sized internal formats use storage bytes',()=>{
  const f=fixture(),g=f.gl;bind(g);image(g,2,2,RGBA,HALF);assert.equal(snap(f).currentBytes,32);
  image(g,2,2,RGBA,FLOAT);assert.equal(snap(f).currentBytes,64);
  image(g,2,2,RGBA,0x8033);assert.equal(snap(f).currentBytes,8);
  image(g,2,2,0x881A,FLOAT);assert.equal(snap(f).currentBytes,32);
  image(g,2,2,0x8058,FLOAT);assert.equal(snap(f).currentBytes,16);
});
test('depth formats conservatively include depth24 padding',()=>{
  const f=fixture(),g=f.gl;bind(g);g.texStorage2D(T,1,0x81A6,4,4);assert.equal(snap(f).currentBytes,64);assert.equal(snap(f).estimatedAllocations,1);
  const t=bind(g);g.texStorage2D(T,1,0x8CAD,4,4);assert.equal(snap(f).currentBytes,192);g.deleteTexture(t);assert.equal(snap(f).currentBytes,64);
});
test('block compression rounds each mip to whole blocks',()=>{
  const f=fixture(),g=f.gl;bind(g);g.compressedTexImage2D(T,0,0x83F0,5,5,0,new Uint8Array(32));assert.equal(snap(f).currentBytes,32);
  g.compressedTexImage2D(T,1,0x83F0,2,2,0,new Uint8Array(8));assert.equal(snap(f).currentBytes,40);
  g.compressedTexImage2D(T,0,0x93B4,7,7,0,new Uint8Array(64));assert.equal(snap(f).currentBytes,72);
});
test('compressed 3D and PVRTC minimum extents are included',()=>{
  const f=fixture(),g=f.gl,t=bind(g,D);g.compressedTexImage3D(D,0,0x9278,8,8,3,0,new Uint8Array(192));assert.equal(snap(f).currentBytes,192);
  g.deleteTexture(t);bind(g);g.compressedTexImage2D(T,0,0x8C01,4,4,0,new Uint8Array(32));assert.equal(snap(f).currentBytes,32);
});
test('unknown formats cannot inherit a misleading upload byte count',()=>{
  const f=fixture(),g=f.gl;bind(g);image(g,4,4,0xDEAD,U8);assert.equal(snap(f).unknowns,1);assert.equal(snap(f).complete,false);assert.equal(snap(f).currentBytes,0);
  image(g,4,4);assert.equal(snap(f).unknowns,0);assert.equal(snap(f).complete,true);assert.equal(snap(f).peakComplete,false);assert.equal(snap(f).unknownCalls,1);
});
test('unknown source dimensions and compression stay visible until deletion',()=>{
  const f=fixture(),g=f.gl,t=bind(g);g.texImage2D(T,0,RGBA,RGBA,U8,{});g.compressedTexImage2D(T,1,0xDEAD,4,4,0,new Uint8Array(16));
  assert.equal(snap(f).unknowns,2);g.deleteTexture(t);assert.equal(snap(f).unknowns,0);assert.equal(snap(f).peakUnknowns,2);
});
test('copyTexImage2D counts sized storage but unsized conversion is unknown',()=>{
  const f=fixture(),g=f.gl;bind(g);g.copyTexImage2D(T,0,0x8058,0,0,4,4,0);assert.equal(snap(f).currentBytes,64);
  g.copyTexImage2D(T,0,RGB,0,0,4,4,0);assert.equal(snap(f).unknowns,1);assert.equal(snap(f).currentBytes,0);
});
test('offscreen renderbuffers include multisample storage and combined peak',()=>{
  const f=fixture(),g=f.gl;bind(g);image(g,4,4);const r=g.createRenderbuffer();g.bindRenderbuffer(0x8D41,r);g.renderbufferStorageMultisample(0x8D41,4,0x8058,4,4);
  assert.equal(snap(f).renderbufferBytes,256);assert.equal(snap(f).combinedBytes,320);assert.equal(snap(f).peakCombinedBytes,320);
  g.renderbufferStorage(0x8D41,0x81A5,4,4);assert.equal(snap(f).renderbufferBytes,32);g.deleteRenderbuffer(r);assert.equal(snap(f).renderbufferBytes,0);
});
test('multiple contexts are independent and loss releases only owned storage',()=>{
  const f=fixture(),a=f.gl,b=new f.GL();bind(a);image(a,4,4);bind(b);image(b,2,2);assert.equal(snap(f).contexts,2);assert.equal(snap(f).currentBytes,80);
  a.listeners.webglcontextlost();assert.equal(snap(f).currentBytes,16);assert.equal(snap(f).textures,1);assert.equal(snap(f).peakBytes,80);
});
test('extension multisample renderbuffers count and unobservable attachments block green',()=>{
  const f=fixture(),g=f.gl;g.extension={renderbufferStorageMultisampleEXT(){return 19;},framebufferTexture2DMultisampleEXT(){return 23;}};
  const ext=g.getExtension('WEBGL_multisampled_render_to_texture'),r=g.createRenderbuffer();g.bindRenderbuffer(0x8D41,r);
  assert.equal(ext.renderbufferStorageMultisampleEXT(0x8D41,4,0x8058,4,4),19);assert.equal(snap(f).renderbufferBytes,256);
  assert.equal(ext.framebufferTexture2DMultisampleEXT(0,0,T,{},0,4),23);assert.equal(snap(f).untrackedAllocationCalls,1);assert.equal(snap(f).complete,false);
});
test('foreign preinstall texture cannot silently disappear from accounting',()=>{
  const f=fixture(),g=f.gl,t={};g.bindTexture(T,t);assert.equal(snap(f).unknowns,1);image(g,4,4);assert.equal(snap(f).unknowns,1);
  g.deleteTexture(t);assert.equal(snap(f).unknowns,0);assert.equal(snap(f).peakComplete,false);
});
test('foreign preinstall renderbuffer is unknown until storage is observed',()=>{
  const f=fixture(),g=f.gl,r={};g.bindRenderbuffer(0x8D41,r);assert.equal(snap(f).unknowns,1);assert.equal(snap(f).complete,false);
  g.renderbufferStorage(0x8D41,0x8058,4,4);assert.equal(snap(f).unknowns,0);assert.equal(snap(f).renderbufferBytes,64);assert.equal(snap(f).peakComplete,false);
  g.deleteRenderbuffer(r);assert.equal(snap(f).renderbufferBytes,0);
});
test('wrappers preserve exact native results, arguments and thrown errors',()=>{
  const f=fixture(),g=f.gl;bind(g);g.returnValue={native:true};const args=[T,0,RGBA,2,2,0,RGBA,U8,null];assert.equal(g.texImage2D(...args),g.returnValue);
  assert.deepEqual(g.nativeCalls.at(-1),['texImage2D',...args]);g.throwNext=true;assert.throws(()=>image(g,9,9),/native failure/);assert.equal(snap(f).currentBytes,16);assert.equal(snap(f).trackingErrors,0);
});
test('installer is idempotent and inherited methods are not double counted',()=>{
  const f=fixture();vm.runInContext(`(${installGroundTextureAudit.toString()})()`,f.realm);bind(f.gl);image(f.gl,2,2);
  assert.equal(snap(f).created,1);assert.equal(snap(f).currentBytes,16);assert.equal(snap(f).complete,true);assert.equal(snap(f).unwrappedAvailableMethods.length,0);
});
test('largest allocation census and raw WebGLTexture lookup reconcile with totals',()=>{
  const f=fixture(),g=f.gl,a=bind(g);image(g,4,4);g.generateMipmap(T);const b=bind(g);image(g,8,8);
  const s=snap(f);assert.equal(s.topTextures[0].bytes,256);assert.equal(s.topTextures[1].bytes,84);assert.equal(s.topTextures[1].images.length,3);
  assert.equal(f.audit.describeTexture(a).bytes,84);assert.equal(f.audit.describeTexture(b).id,s.topTextures[0].id);
  assert.equal(f.audit.snapshot({topLimit:1}).topTextures.length,1);assert.equal(s.topTextures.reduce((n,t)=>n+t.bytes,0),s.currentBytes);
  g.deleteTexture(a);assert.equal(f.audit.describeTexture(a),null);
});
console.log(`VERIFY: PASS ground texture audit ${passed}/${passed} synthetic GL cases (no browser/GPU claim)`);

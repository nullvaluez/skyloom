/**
 * Optional resource audit, installed BEFORE context creation with:
 *   await page.addInitScript(require('./ground-texture-audit.cjs').installGroundTextureAudit)
 * This changes no GL arguments/results/errors and never reads back pixels.
 * Leave it out of frame benchmarks: binds are intercepted to establish ownership.
 * Bytes are logical GL storage (not driver alignment, tiling, residency or heap).
 * DEPTH24 is conservatively charged 4 bytes. Unknown live/peak allocations must
 * prevent a green memory-budget verdict. Renderbuffers are reported separately.
 */
function installGroundTextureAudit() {
  const root = globalThis;
  if (root.__groundTextureAudit) return;
  const contexts = new WeakMap(), liveTextures = new Map(), liveRenderbuffers = new Map();
  const textures = new WeakMap(), renderbuffers = new WeakMap();
  const formats = new Map();
  let nextId = 1, contextCount = 0, created = 0, deleted = 0, currentBytes = 0, peakBytes = 0;
  let renderbufferBytes = 0, peakRenderbufferBytes = 0, peakCombinedBytes = 0;
  let peakTextures = null, peakFormats = null;
  let unknowns = 0, peakUnknowns = 0, unknownCalls = 0, estimatedAllocations = 0;
  let trackingErrors=0, untrackedAllocationCalls=0;
  const unknownEvents=[];
  const wrappedMethods = [], missingMethods = [], unwrappedAvailableMethods=[], errorMessages=[];
  const FACE0=0x8515, CUBE=0x8513, TEX2D=0x0DE1, TEX3D=0x806F, ARRAY=0x8C1A;
  const sized = new Map();
  const addSized=(bytes, entries, estimated=false)=>entries.forEach(([value,name])=>sized.set(value,{bytes,name,estimated}));
  addSized(1,[[0x8229,'R8'],[0x8F94,'R8_SNORM'],[0x8231,'R8I'],[0x8232,'R8UI']]);
  addSized(2,[[0x822B,'RG8'],[0x8F95,'RG8_SNORM'],[0x822D,'R16F'],[0x8233,'R16I'],[0x8234,'R16UI'],[0x8237,'RG8I'],[0x8238,'RG8UI'],[0x8D62,'RGB565'],[0x8056,'RGBA4'],[0x8057,'RGB5_A1'],[0x81A5,'DEPTH_COMPONENT16']]);
  addSized(3,[[0x8051,'RGB8'],[0x8F96,'RGB8_SNORM'],[0x8C41,'SRGB8'],[0x8D8F,'RGB8I'],[0x8D7D,'RGB8UI']]);
  addSized(4,[[0x8058,'RGBA8'],[0x8F97,'RGBA8_SNORM'],[0x8C43,'SRGB8_ALPHA8'],[0x822E,'R32F'],[0x822F,'RG16F'],[0x8235,'R32I'],[0x8236,'R32UI'],[0x8239,'RG16I'],[0x823A,'RG16UI'],[0x8D8E,'RGBA8I'],[0x8D7C,'RGBA8UI'],[0x8059,'RGB10_A2'],[0x906F,'RGB10_A2UI'],[0x8C3A,'R11F_G11F_B10F'],[0x8C3D,'RGB9_E5'],[0x8CAC,'DEPTH_COMPONENT32F'],[0x88F0,'DEPTH24_STENCIL8']]);
  addSized(4,[[0x81A6,'DEPTH_COMPONENT24']],true);
  addSized(4,[[0x84F9,'DEPTH_STENCIL']]);
  addSized(6,[[0x881B,'RGB16F'],[0x8D89,'RGB16I'],[0x8D77,'RGB16UI']]);
  addSized(8,[[0x881A,'RGBA16F'],[0x8230,'RG32F'],[0x823B,'RG32I'],[0x823C,'RG32UI'],[0x8D88,'RGBA16I'],[0x8D76,'RGBA16UI'],[0x8CAD,'DEPTH32F_STENCIL8']]);
  addSized(12,[[0x8815,'RGB32F'],[0x8D83,'RGB32I'],[0x8D71,'RGB32UI']]);
  addSized(16,[[0x8814,'RGBA32F'],[0x8D82,'RGBA32I'],[0x8D70,'RGBA32UI']]);
  addSized(1,[[0x8D48,'STENCIL_INDEX8']]);
  const channels=new Map([[0x1906,1],[0x1909,1],[0x190A,2],[0x1903,1],[0x8227,2],[0x1907,3],[0x1908,4],[0x8D94,1],[0x8228,2],[0x8D98,3],[0x8D99,4],[0x1902,1]]);
  const scalar=new Map([[0x1400,1],[0x1401,1],[0x1402,2],[0x1403,2],[0x1404,4],[0x1405,4],[0x1406,4],[0x140B,2],[0x8D61,2]]);
  const packed=new Map([[0x8363,2],[0x8033,2],[0x8034,2],[0x8368,4],[0x8C3B,4],[0x8C3E,4],[0x84FA,4],[0x8DAD,8]]);
  const compressed=new Map();
  const blocks=(values,bytes,name)=>values.forEach(v=>compressed.set(v,{w:4,h:4,bytes,name:`${name}:0x${v.toString(16)}`}));
  blocks([0x83F0,0x83F1,0x8C4C,0x8C4D],8,'S3TC_DXT1');
  blocks([0x83F2,0x83F3,0x8C4E,0x8C4F],16,'S3TC_DXT3_5');
  blocks([0x8D64],8,'ETC1');
  blocks([0x9270,0x9271,0x9274,0x9275,0x9276,0x9277],8,'ETC2_EAC');
  blocks([0x9272,0x9273,0x9278,0x9279],16,'ETC2_EAC');
  blocks([0x8DBB,0x8DBC],8,'RGTC'); blocks([0x8DBD,0x8DBE],16,'RGTC');
  blocks([0x8E8C,0x8E8D,0x8E8E,0x8E8F],16,'BPTC');
  [[4,4],[5,4],[5,5],[6,5],[6,6],[8,5],[8,6],[8,8],[10,5],[10,6],[10,8],[10,10],[12,10],[12,12]].forEach(([w,h],i)=>{
    for(const start of [0x93B0,0x93D0])compressed.set(start+i,{w,h,bytes:16,name:`ASTC_${w}x${h}${start===0x93D0?'_SRGB':''}`});
  });
  for(const value of [0x8C00,0x8C01,0x8C02,0x8C03])compressed.set(value,{pvrtc:true,bpp:value%2?2:4,name:`PVRTC:0x${value.toString(16)}`});
  const targetOf=(target)=>target>=FACE0&&target<FACE0+6?CUBE:target;
  const hex=(value)=>Number.isFinite(value)?`0x${value.toString(16)}`:'unknown';
  const peak=()=>{
    if(root.__groundTextureAuditPeakDetails && currentBytes>peakBytes){
      peakTextures=[...liveTextures.values()].map(describeTexture).filter(Boolean).sort((a,b)=>b.bytes-a.bytes).slice(0,20);
      peakFormats=Object.fromEntries([...formats].map(([k,v])=>[k,{...v}]));
    }
    peakBytes=Math.max(peakBytes,currentBytes);peakRenderbufferBytes=Math.max(peakRenderbufferBytes,renderbufferBytes);peakCombinedBytes=Math.max(peakCombinedBytes,currentBytes+renderbufferBytes);peakUnknowns=Math.max(peakUnknowns,unknowns);
  };
  function book(image,direction,renderbuffer=false){
    if(!image)return;
    const f=formats.get(image.name)||{bytes:0,images:0,unknowns:0,estimated:0,renderbufferBytes:0};
    f.images+=direction;
    if(image.bytes===null){unknowns+=direction;f.unknowns+=direction;}
    else if(renderbuffer){renderbufferBytes+=direction*image.bytes;f.renderbufferBytes+=direction*image.bytes;}
    else {currentBytes+=direction*image.bytes;f.bytes+=direction*image.bytes;}
    if(image.estimated){estimatedAllocations+=direction;f.estimated+=direction;}
    formats.set(image.name,f);
  }
  function describe(internal,format,type,width,height,depth=1,isCompressed=false){
    const valid=[width,height,depth].every(n=>Number.isInteger(n)&&n>=0);
    let bytes=null,estimated=false,name=`UNKNOWN_${hex(internal)}_${hex(type)}`;
    const spec=compressed.get(internal);
    if(isCompressed||spec){
      if(spec){name=spec.name;if(valid)bytes=spec.pvrtc?Math.max(width,spec.bpp===2?16:8)*Math.max(height,8)*spec.bpp/8*depth:Math.ceil(width/spec.w)*Math.ceil(height/spec.h)*spec.bytes*depth;}
    }else{
      const s=sized.get(internal);
      // Only unsized formats may derive storage from upload type. A future
      // sized internalformat with a familiar upload format is still unknown.
      const unsized=channels.has(internal)||internal===0x84F9;
      const bpp=s?.bytes??(unsized?(packed.get(type)??(channels.has(format)&&scalar.has(type)?channels.get(format)*scalar.get(type):null)):null);
      if(bpp!==null){name=s?.name??`${hex(format)}/${hex(type)}`;estimated=!!s?.estimated;if(valid)bytes=width*height*depth*bpp;}
    }
    return {internal,format,type,width,height,depth,isCompressed,name,bytes,estimated};
  }
  function releaseTexture(record){
    if(!record||record.deleted)return;
    for(const image of record.images.values())book(image,-1);
    record.images.clear();record.deleted=true;liveTextures.delete(record.id);deleted++;
  }
  function releaseRenderbuffer(record){
    if(!record||record.deleted)return;book(record.image,-1,true);record.deleted=true;liveRenderbuffers.delete(record.id);
  }
  function context(gl){
    let ctx=contexts.get(gl);if(ctx)return ctx;
    ctx={id:++contextCount,unit:0,bindings:new Map(),renderbuffer:null};contexts.set(gl,ctx);
    gl.canvas?.addEventListener?.('webglcontextlost',()=>{
      for(const record of liveTextures.values())if(record.context===ctx.id)releaseTexture(record);
      for(const record of liveRenderbuffers.values())if(record.context===ctx.id)releaseRenderbuffer(record);
      ctx.bindings.clear();ctx.renderbuffer=null;ctx.unit=0;
    });
    return ctx;
  }
  function texture(gl,target){const ctx=context(gl);return ctx.bindings.get(`${ctx.unit}:${targetOf(target)}`);}
  function put(record,target,level,image){
    if(!record||record.deleted)return;
    const key=`${target}:${level}`;book(record.images.get(key),-1);record.images.set(key,image);book(image,1);
    if(image.bytes===null){unknownCalls++;if(unknownEvents.length<16)unknownEvents.push({at:Date.now(),id:record.id,target,level,...image,stack:new Error().stack});}peak();
  }
  function sourceSize(source){
    if(!source)return [NaN,NaN];
    return [source.videoWidth??source.naturalWidth??source.displayWidth??source.width??NaN,
      source.videoHeight??source.naturalHeight??source.displayHeight??source.height??NaN];
  }
  const handlers={
    createTexture(gl,args,result){if(!result)return;const ctx=context(gl),record={id:nextId++,context:ctx.id,images:new Map(),base:0,max:1000,immutableLevels:0,deleted:false};textures.set(result,record);liveTextures.set(record.id,record);created++;},
    deleteTexture(gl,[object]){const record=object&&textures.get(object);if(record?.context===context(gl).id)releaseTexture(record);},
    activeTexture(gl,[unit]){context(gl).unit=unit-0x84C0;},
    bindTexture(gl,[target,object]){
      const ctx=context(gl);let record=object?textures.get(object):null;
      if(object&&!record){
        // XR/extension-owned or pre-install textures cannot silently disappear
        // from the census. Deletion removes this live unknown marker normally.
        record={id:nextId++,context:ctx.id,images:new Map(),base:0,max:1000,immutableLevels:0,deleted:false};
        textures.set(object,record);liveTextures.set(record.id,record);
        put(record,'unobserved',0,{name:'UNOBSERVED_TEXTURE',bytes:null});
      }
      ctx.bindings.set(`${ctx.unit}:${targetOf(target)}`,record?.context===ctx.id?record:null);
    },
    texParameteri(gl,[target,param,value]){const r=texture(gl,target);if(!r)return;if(param===0x813C)r.base=value;if(param===0x813D)r.max=value;},
    texImage2D(gl,a){const [target,level,internal]=a;let width,height,format,type;if(a.length>=9){[width,height]=a.slice(3,5);[format,type]=a.slice(6,8);}else{[format,type]=a.slice(3,5);[width,height]=sourceSize(a[5]);}put(texture(gl,target),target,level,describe(internal,format,type,width,height));},
    texImage3D(gl,a){put(texture(gl,a[0]),a[0],a[1],describe(a[2],a[7],a[8],a[3],a[4],a[5]));},
    compressedTexImage2D(gl,a){put(texture(gl,a[0]),a[0],a[1],describe(a[2],null,null,a[3],a[4],1,true));},
    compressedTexImage3D(gl,a){put(texture(gl,a[0]),a[0],a[1],describe(a[2],null,null,a[3],a[4],a[5],true));},
    copyTexImage2D(gl,a){put(texture(gl,a[0]),a[0],a[1],describe(a[2],null,null,a[5],a[6]));},
    texStorage2D(gl,a){storage(gl,a,false);},texStorage3D(gl,a){storage(gl,a,true);},
    generateMipmap(gl,[target]){
      const r=texture(gl,target);if(!r)return;
      const faces=target===CUBE?Array.from({length:6},(_,i)=>FACE0+i):[target];
      for(const face of faces){const base=r.images.get(`${face}:${r.base}`);if(!base)continue;
        const last=Math.min(r.max,r.base+Math.floor(Math.log2(Math.max(base.width,base.height,target===TEX3D?base.depth:1))),r.immutableLevels?r.immutableLevels-1:1000);
        for(let level=r.base+1;level<=last;level++){const divisor=2**(level-r.base);put(r,face,level,describe(base.internal,base.format,base.type,Math.max(1,Math.floor(base.width/divisor)),Math.max(1,Math.floor(base.height/divisor)),target===TEX3D?Math.max(1,Math.floor(base.depth/divisor)):base.depth,base.isCompressed));}
      }
    },
    createRenderbuffer(gl,args,result){if(!result)return;const r={id:nextId++,context:context(gl).id,image:null,deleted:false};renderbuffers.set(result,r);liveRenderbuffers.set(r.id,r);},
    bindRenderbuffer(gl,[target,object]){
      const ctx=context(gl);let r=object?renderbuffers.get(object):null;
      if(object&&!r){r={id:nextId++,context:ctx.id,image:{name:'UNOBSERVED_RENDERBUFFER',bytes:null},deleted:false};renderbuffers.set(object,r);liveRenderbuffers.set(r.id,r);book(r.image,1,true);unknownCalls++;if(unknownEvents.length<16)unknownEvents.push({at:Date.now(),...r.image,stack:new Error().stack});peak();}
      ctx.renderbuffer=r?.context===ctx.id?r:null;
    },
    deleteRenderbuffer(gl,[object]){const r=object&&renderbuffers.get(object);if(r?.context===context(gl).id)releaseRenderbuffer(r);},
    renderbufferStorage(gl,a){renderbufferStorage(gl,a,false);},
    renderbufferStorageMultisample(gl,a){renderbufferStorage(gl,a,true);},
    getExtension(gl,args,extension){
      if(!extension)return;
      for(const name of ['renderbufferStorageMultisampleEXT','renderbufferStorageMultisampleIMG','framebufferTexture2DMultisampleEXT','framebufferTexture2DMultisampleIMG']){
        const original=extension[name];if(typeof original!=='function'||seen.has(original))continue;
        const wrapped=function(...values){const result=Reflect.apply(original,this,values);
          try{if(name.startsWith('renderbuffer'))renderbufferStorage(gl,values,true);
            else untrackedAllocationCalls++; // extension-owned transient multisample surface
          }catch(error){trackingErrors++;if(errorMessages.length<4)errorMessages.push(String(error));}
          return result;};
        seen.add(wrapped);try{extension[name]=wrapped;if(extension[name]!==wrapped)unwrappedAvailableMethods.push(`extension.${name}`);}catch{unwrappedAvailableMethods.push(`extension.${name}`);}
      }
    },
  };
  handlers.texParameterf=handlers.texParameteri;
  function storage(gl,a,three){
    const [target,levels,internal,width,height,depth=1]=a,r=texture(gl,target);if(!r)return;
    for(const image of r.images.values())book(image,-1);r.images.clear();r.immutableLevels=levels;
    for(const face of target===CUBE?Array.from({length:6},(_,i)=>FACE0+i):[target])for(let level=0;level<levels;level++){
      put(r,face,level,describe(internal,null,null,Math.max(1,Math.floor(width/2**level)),Math.max(1,Math.floor(height/2**level)),three?(target===ARRAY?depth:Math.max(1,Math.floor(depth/2**level))):1));
    }
  }
  function renderbufferStorage(gl,a,multi){
    const r=context(gl).renderbuffer;if(!r||r.deleted)return;
    const samples=multi?a[1]:0,internal=a[multi?2:1],width=a[multi?3:2],height=a[multi?4:3];
    const image=describe(internal,null,null,width,height);if(image.bytes!==null)image.bytes*=Math.max(1,samples);
    image.samples=samples;book(r.image,-1,true);r.image=image;book(image,1,true);if(image.bytes===null){unknownCalls++;if(unknownEvents.length<16)unknownEvents.push({at:Date.now(),...image,stack:new Error().stack});}peak();
  }
  const seen=new Set();
  for(const [name,Constructor] of [['WebGL1',root.WebGLRenderingContext],['WebGL2',root.WebGL2RenderingContext]]){
    if(!Constructor)continue;
    for(const [method,handler] of Object.entries(handlers)){
      const original=Constructor.prototype[method];
      if(typeof original!=='function'){missingMethods.push(`${name}.${method}`);continue;}
      // Some hosts inherit WebGL1 methods. Wrapping an already instrumented
      // inherited function would count every allocation twice.
      if(seen.has(original))continue;
      const wrapped=function(...args){const result=Reflect.apply(original,this,args);
        try{handler(this,args,result);}catch(error){trackingErrors++;if(errorMessages.length<4)errorMessages.push(String(error));}
        return result;};
      seen.add(wrapped);
      try{Constructor.prototype[method]=wrapped;if(Constructor.prototype[method]===wrapped)wrappedMethods.push(`${name}.${method}`);else unwrappedAvailableMethods.push(`${name}.${method}`);}catch{unwrappedAvailableMethods.push(`${name}.${method}`);}
    }
  }
  function describeTexture(record){
    if(!record||record.deleted)return null;
    const images=[...record.images].map(([key,image])=>({target:key.split(':')[0],level:Number(key.split(':')[1]),format:image.name,width:image.width,height:image.height,depth:image.depth,bytes:image.bytes}));
    return {id:record.id,context:record.context,bytes:images.reduce((n,i)=>n+(i.bytes??0),0),unknowns:images.filter(i=>i.bytes===null).length,
      immutableLevels:record.immutableLevels,baseLevel:record.base,maxLevel:record.max,images};
  }
  root.__groundTextureAudit={describeTexture(object){return describeTexture(object&&textures.get(object));},snapshot(options={}){
    const limit=Math.max(0,Math.min(1000,options.topLimit??40));
    const topTextures=[...liveTextures.values()].map(describeTexture).sort((a,b)=>b.bytes-a.bytes||a.id-b.id).slice(0,limit);
    const topRenderbuffers=[...liveRenderbuffers.values()].map(r=>({id:r.id,context:r.context,...r.image})).sort((a,b)=>(b.bytes??0)-(a.bytes??0)).slice(0,limit);
    return {version:2,scope:'Valid WebGL allocation requests in this JavaScript realm, including offscreen contexts. Driver overhead/residency, drawing-buffer swapchain and other worker realms excluded. DEPTH24 conservatively charged 4 bytes.',
      contexts:contextCount,textures:liveTextures.size,renderbuffers:liveRenderbuffers.size,created,deleted,
      currentBytes,peakBytes,renderbufferBytes,peakRenderbufferBytes,combinedBytes:currentBytes+renderbufferBytes,peakCombinedBytes,
      ...(peakTextures?{peakTextures,peakFormats}:{}),
      unknowns,peakUnknowns,unknownCalls,estimatedAllocations,trackingErrors,untrackedAllocationCalls,errorMessages:[...errorMessages],
      unknownEvents:[...unknownEvents],
      complete:unknowns===0&&trackingErrors===0&&untrackedAllocationCalls===0&&unwrappedAvailableMethods.length===0,
      peakComplete:peakUnknowns===0&&trackingErrors===0&&untrackedAllocationCalls===0&&unwrappedAvailableMethods.length===0,
      formats:Object.fromEntries([...formats].filter(([,f])=>f.images||f.unknowns).map(([name,f])=>[name,{...f}])),
      topTextures,topRenderbuffers,
      wrappedMethods:[...wrappedMethods],missingMethods:[...missingMethods],unwrappedAvailableMethods:[...unwrappedAvailableMethods]};
  }};
}
module.exports={installGroundTextureAudit};

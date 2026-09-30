const installed=new WeakMap();
/** Context loss already destroys GPU storage. Three/addon disposal callbacks
 * can outlive that context, and must not delete its obsolete handles after a
 * restore. Track generations at allocation, never in the draw hot path. New
 * handles retain normal deletion; this does not intercept or suppress GL errors.
 * https://registry.khronos.org/webgl/specs/latest/1.0/#5.15.2
 */
export function installContextResourceLifetime(gl){
 if(installed.has(gl))return installed.get(gl);
 const handles=new WeakMap(),stats={generation:0,retiredDeletes:0};
 const pairs=['Buffer','Texture','Renderbuffer','Framebuffer','Program','Shader','VertexArray','Sampler','Query','TransformFeedback'].map(name=>['create'+name,'delete'+name]);
 pairs.push(['fenceSync','deleteSync']);
 for(const [allocate,release]of pairs){
  const create=gl[allocate],remove=gl[release];if(!create||!remove)continue;
  gl[allocate]=function(...args){const handle=create.apply(this,args);if(handle)handles.set(handle,stats.generation);return handle;};
  gl[release]=function(handle){
   // Unknown handles were created by renderer initialization before installation.
   if(handle&&(handles.get(handle)??0)<stats.generation){stats.retiredDeletes++;return;}
   return remove.call(this,handle);
  };
 }
 gl.canvas.addEventListener('webglcontextlost',()=>{stats.generation++;});
 installed.set(gl,stats);return stats;
}

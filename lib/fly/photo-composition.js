const listeners=new Set();
let state={exposure:0,grid:false};
export const photoComposition=()=>state;
export const subscribePhotoComposition=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
export function setPhotoComposition(patch){state={exposure:Number.isFinite(patch.exposure)?Math.max(-2,Math.min(2,patch.exposure)):state.exposure,grid:typeof patch.grid==='boolean'?patch.grid:state.grid};listeners.forEach(fn=>fn());}

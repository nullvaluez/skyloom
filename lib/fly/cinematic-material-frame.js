const period=4096,phase=v=>((v%period)+period)%period;
/** Locally metric coordinates, transported continuously through rebases and latitude changes.
 * Compensating at the aircraft prevents multiplying an absolute Mercator coordinate by
 * a changing cosine (which makes the entire texture slide under a northbound aircraft).
 */
export function advanceMaterialFrame(previous,anchor,k,focus){
  if(!previous)return{x:phase(anchor.x/k),z:phase(anchor.z/k),ax:anchor.x,az:anchor.z,k};
  const correction=1/previous.k-1/k;
  return{x:phase(previous.x+(anchor.x-previous.ax)/previous.k+(focus.x-anchor.x)*correction),
    z:phase(previous.z+(anchor.z-previous.az)/previous.k+(focus.z-anchor.z)*correction),ax:anchor.x,az:anchor.z,k};
}

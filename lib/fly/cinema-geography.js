/**
 * Render inputs are views of the geographic simulation, never replacements.
 * Absolute positions and IDs stay in their existing caches. Only display-space
 * projection and metre conversion belong here. Ground truth and visual DEM
 * interpolation are deliberately separate fields.
 */
import {mercatorScale} from './coords';
export function updateCinemaGeography(out={},runtime){
 const f=runtime.flight,a=runtime.origin?.anchor;if(!f||!a)return null;
 out.epoch=runtime.origin.epoch??0;
 out.worldUnitsPerMetre=mercatorScale(f.latDeg??0);
 out.originX=a.x;out.originZ=a.z;out.x=f.pos.x-a.x;out.z=f.pos.z-a.z;
 out.altitudeM=f.pos.y;out.groundM=f.groundElev;out.groundVisualM=runtime.groundElevVis??f.groundElev;
 out.aglM=f.agl;return out;
}

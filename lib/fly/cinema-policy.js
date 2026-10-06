import { useFlyStore } from '../../stores/fly-store';
import { isMobileGraphicsClass } from './device-class';
import { resolveCinemaProfile } from './cinema-profile';
import { ladderOrderOn } from './device-tiers';

// Enhanced uses the shared HDR environment. Classic and the explicit review
// control retain the prior renderer; hardware budgets still follow the preset.
export const CINEMA_SHIPPING = true;
let lastArtSearch=null,artReview=false;
/** Matched review control; ordinary Enhanced flights always use the art pass. */
export function cinemaArtOn(){
  if(typeof window==='undefined')return true;
  if(lastArtSearch!==window.location.search){lastArtSearch=window.location.search;artReview=new URLSearchParams(lastArtSearch).get('graphicsReview')==='1';}
  if(process.env.NODE_ENV==='development'||artReview)return window.__flyCinemaArt!==0;
  return true;
}
let lastSearch=null,reviewLook=null;
export function cinemaOn(state=useFlyStore.getState()) {
  if(state.mapStyle!=='satellite'||state.visuals!=='enhanced')return false;
  if(typeof window==='undefined')return CINEMA_SHIPPING;
  if(lastSearch!==window.location.search){
    lastSearch=window.location.search;
    const params=new URLSearchParams(lastSearch);
    reviewLook=params.get('graphicsReview')==='1'?params.get('earthLook'):null;
  }
  if(reviewLook==='current')return false;
  if(reviewLook==='cinematic')return true;
  return CINEMA_SHIPPING;
}
let effectiveScale=1;
let effectLevel=0;
const effectListeners=new Set();
export const subscribeCinemaEffects=(listener)=>{effectListeners.add(listener);return()=>effectListeners.delete(listener);};
export const getCinemaEffectLevel=()=>effectLevel;
export function setCinemaEffectLevel(value){
  const next=Math.max(0,Math.min(3,value));if(next===effectLevel)return;
  effectLevel=next;for(const listener of effectListeners)listener();
}
export function setCinemaRenderScale(value){effectiveScale=Number.isFinite(value)?value:1;}
export function cinemaProfile(tier=useFlyStore.getState().qualityTier) {
  return resolveCinemaProfile({preset:useFlyStore.getState().qualityPreset,tier,scale:effectiveScale,phone:isMobileGraphicsClass(),effectLevel,scaleDemotes:!ladderOrderOn()});
}

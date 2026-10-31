import { LIBERTY_DETAIL } from './fly-constants.js';
import { pinned } from './fly-pins.js';
import assets from './liberty-detail-assets.json' with { type: 'json' };

export const libertyDetailOn = () => pinned(LIBERTY_DETAIL, '__flyLibertyDetailOverride').enabled === true;
// A deliberate presentation boost for flyby readability. The POI stays 93 m.
// Both the marquee, procedural fallback and label must use the same multiplier.
export const monumentPresence = name => name === 'Statue of Liberty' && libertyDetailOn() ? 1.4 : 1;

export function resolveLibertyEntry(entry) {
  if (entry.poi !== 'Statue of Liberty' || !libertyDetailOn() || entry.file !== '/models/monument-liberty.glb') return entry;
  return {
    ...entry, file: assets.find(a=>a.level==='far').file,
    detail: Object.fromEntries(assets.filter(a=>a.level!=='far').map(a=>[a.level,a])),
    // Scan faces +Z. Liberty faces southeast in the world; never infer orientation.
    yawFixRad: Math.PI / 4,
    // Flame and stone/copper response are baked per vertex; no radial band can
    // correctly isolate the torch once the wider Fort Wood footprint is included.
    accents: [],
  };
}

// Original Skyloom operators and squadrons. All presets are available at once.
// IDs, rather than labels or user-provided paint data, cross the save boundary.
const skin = (id, name, description, pattern, hull, trim, accent, marking, code) =>
  Object.freeze({ id, name, description, pattern, hull, trim, accent, marking, code });
export const PRESET_LIVERIES = Object.freeze({
  fighter: [
    skin('spectre-01','Spectre 01','Air superiority gray','tactical','#859298','#34444e','#d7dfdc','SPECTRE 01','SP'),
    skin('sandstorm-24','Sandstorm 24','Desert attack camouflage','camo','#baa585','#716447','#e5d4ae','SANDSTORM 24','24'),
    skin('nightwatch-09','Nightwatch 09','Graphite splinter camouflage','splinter','#444e59','#242d36','#8998a4','NIGHTWATCH 09','NW'),
  ],
  military: [
    skin('razor-31','Razor 31','Slate gray with squadron markings','tactical','#a0aaad','#3c4e58','#dbb264','RAZOR 31','RZ'),
    skin('woodland-17','Woodland 17','Forest attack camouflage','camo','#738068','#354b40','#b6b093','WOODLAND 17','17'),
    skin('arctic-52','Arctic 52','Ice and slate splinter camouflage','splinter','#d5dddf','#617887','#93a7b0','ARCTIC 52','52'),
  ],
  'warbird-jet': [
    skin('silver-arrow','Silver Arrow','Polished gray, red squadron bands','tactical','#c5cdcf','#425563','#b54136','SILVER ARROW','08'),
    skin('desert-six','Desert Six','Sand and olive camouflage','camo','#c2ab82','#6a7054','#e6d8b9','DESERT SIX','06'),
    skin('sea-hawk','Sea Hawk','Naval blue with ice markings','tactical','#577586','#253c51','#dfebe8','SEA HAWK 14','SH'),
  ],
  'warbird-prop': [
    skin('ace-twelve','Ace Twelve','Silver fuselage, scarlet tail','tactical','#bfc9ca','#5c686e','#b34337','ACE TWELVE','12'),
    skin('olive-forty','Olive Forty','Olive drab field camouflage','camo','#758064','#38483c','#c2b990','OLIVE FORTY','40'),
    skin('blue-comet','Blue Comet','Midnight blue, ivory recognition bands','tactical','#2d4e6a','#142e47','#e1d9bd','BLUE COMET','BC'),
  ],
  prop: [
    skin('trailblazer','Trailblazer','Ochre and forest expedition paint','sport','#f1dfb6','#355849','#d38831','TRAILBLAZER','TB'),
    skin('coast-runner','Coast Runner','Ivory, deep blue and coral','sport','#ece8dd','#235776','#de754c','COAST RUNNER','CR'),
    skin('rescue-one','Rescue One','White and vermilion utility finish','sport','#ede9dd','#a13530','#e99e45','RESCUE ONE','01'),
  ],
  glider: [
    skin('summit','Summit','White wings with alpine blue tips','sport','#edf1eb','#315c91','#81c3dc','SUMMIT','SM'),
    skin('sunbeam','Sunbeam','Sunflower yellow and graphite','sport','#edc552','#34464d','#f8edbd','SUNBEAM','SB'),
    skin('glacier','Glacier','Pale ice, teal and midnight blue','sport','#bcdedc','#235a6b','#173747','GLACIER','GL'),
  ],
  bizjet: [
    skin('vesper','Vesper Executive','Pearl, charcoal and copper ribbons','executive','#e6e3db','#303a46','#c98d59','VESPER','VE'),
    skin('solstice','Solstice Aviation','Warm ivory with burgundy pinstripes','executive','#eee7d6','#673c4e','#c6a660','SOLSTICE','SA'),
    skin('tidal','Tidal Club','Ice white with ocean blue ribbons','executive','#e0edeb','#22617a','#58b6b6','TIDAL CLUB','TC'),
  ],
  airliner: [
    skin('aurelia','Aurelia Air','Pearl, aubergine and sunrise gold','airline','#efebe2','#59354c','#db9c4b','AURELIA','AA'),
    skin('pelagic','Pelagic Airways','Ocean blue belly and turquoise sweep','airline','#e6eeeb','#204e75','#46aca8','PELAGIC','PA'),
    skin('sunward','Sunward','Coral tail with midnight blue ribbons','airline','#eee9df','#b8493c','#223e63','SUNWARD','SW'),
  ],
  cargo: [
    skin('meridian-freight','Meridian Freight','Midnight blue and signal orange','airline','#dce1dc','#253e5a','#d98335','MERIDIAN FREIGHT','MF'),
    skin('aster-cargo','Aster Cargo','Plum tail with silver-blue cargo bands','airline','#e4e7e1','#5a405c','#87bfc8','ASTER CARGO','AC'),
    skin('boreal-cargo','Boreal Cargo','Arctic white, forest green and gold','airline','#e4ece7','#2f5f55','#c6a35d','BOREAL CARGO','BC'),
  ],
  'flying-wing': [
    skin('raven-01','Raven 01','Charcoal with low-visibility squadron marks','tactical','#47515a','#222c35','#909eaa','RAVEN 01','RV'),
    skin('desert-ghost','Desert Ghost','Sandstone attack camouflage','camo','#a79a7b','#656650','#d3cbb1','DESERT GHOST','06'),
    skin('polar-shadow','Polar Shadow','Polar gray splinter camouflage','splinter','#b6c2c7','#546975','#e5e8e3','POLAR SHADOW','09'),
  ],
  f35: [
    skin('ghost-11','Ghost 11','Air Force gray with AF-011 markings','tactical','#909b9f','#4a5962','#d9dfdb','AF · GHOST 11','011'),
    skin('viper-22','Viper 22','Forest attack camouflage','camo','#738069','#354c41','#bab493','AF · VIPER 22','022'),
    skin('arctic-07','Arctic 07','Arctic splinter camouflage','splinter','#d8dfdf','#627b8b','#9baeb6','AF · ARCTIC 07','007'),
  ],
  c17: [
    skin('atlas-70','Atlas 70','Air mobility gray with wing markings','tactical','#a2adb0','#51626c','#dfe4db','AIR MOBILITY · ATLAS 70','070'),
    skin('sandlift-32','Sandlift 32','Sand and olive expedition camouflage','camo','#b4a583','#676d52','#ded5b8','AIR MOBILITY · SANDLIFT','032'),
    skin('polar-lift','Polar Lift','Ice-gray transport camouflage','splinter','#d1d9d9','#5c737f','#98aeb9','AIR MOBILITY · POLAR LIFT','008'),
  ],
  concorde: [
    skin('aster-supersonic','Aster Supersonic','Pearl with plum and copper sweeps','airline','#f0ece1','#593951','#c88e55','ASTER SUPERSONIC','AS'),
    skin('meridian-sst','Meridian SST','White, midnight blue and scarlet','airline','#ebeeeb','#254264','#bd4d40','MERIDIAN SST','MS'),
    skin('halo-air','Halo Air','Ice white, indigo and turquoise','airline','#e2eeed','#474f86','#51aaa7','HALO AIR','HA'),
  ],
});
for (const rows of Object.values(PRESET_LIVERIES)) Object.freeze(rows);
export function presetLivery(aircraftId, skinId) {
  return Object.hasOwn(PRESET_LIVERIES, aircraftId)
    ? PRESET_LIVERIES[aircraftId].find(s => s.id === skinId) ?? null : null;
}
export function validLiveryChoice(aircraftId, choice) {
  return Object.hasOwn(PRESET_LIVERIES, aircraftId) &&
    (choice === 'standard' || choice === 'earned' || !!presetLivery(aircraftId, choice));
}

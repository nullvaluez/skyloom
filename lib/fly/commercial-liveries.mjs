// Player-selectable representative fleet paint, not registration-specific replicas.
// Keep IDs stable: equipped finishes are part of adventure saves and backups.
import { OPERATOR_LIVERIES } from './operator-liveries.mjs';

const byId = new Map(OPERATOR_LIVERIES.map(s => [s.id, s]));
const passengerIds = [
  'delta', 'southwest', 'united', 'american', 'jetblue', 'air-canada',
  'british-airways', 'lufthansa', 'air-france', 'klm', 'swiss', 'sas',
  'finnair', 'iberia', 'aer-lingus', 'ryanair', 'easyjet', 'spirit',
  'emirates', 'etihad', 'qatar', 'singapore', 'ana', 'japan-airlines',
  'qantas', 'turkish', 'air-india', 'air-new-zealand',
];
const descriptions = {
  delta: 'Midnight blue, red widget and deep blue belly',
  southwest: 'Heart blue with sweeping red and yellow tail',
  united: 'Evo Blue globe, gray belly and blue sweep',
  american: 'Silver fuselage and red, white and blue flag tail',
  jetblue: 'All-blue fuselage with a mosaic blue tail',
  'air-canada': 'Black tail and belly, red maple leaf',
  'british-airways': 'Chatham Dockyard flag and midnight blue belly',
  lufthansa: 'Deep blue tail with the white crane roundel',
  'air-france': 'White fuselage and blue, white and red tail',
  klm: 'Sky-blue crown, white belly and blue engines',
  swiss: 'Swiss red tail with the white cross',
  sas: 'Scandinavian blue tail and silver titles',
  finnair: 'Nordic white with navy titles and tail emblem',
  iberia: 'Red and golden yellow swept tail',
  'aer-lingus': 'Teal tail with a green shamrock',
  ryanair: 'Gold harp, navy belly and gold cheatline',
  easyjet: 'Orange engines and white easyJet tail titles',
  spirit: 'Yellow fuselage with black spirit titles',
  emirates: 'UAE flag tail and gold Emirates titles',
  etihad: 'Pearl fuselage and geometric desert-gold tail',
  qatar: 'Silver-gray fuselage with the burgundy oryx',
  singapore: 'Gold bird, dark blue tail and gold cheatline',
  ana: 'Blue tail and paired blue fuselage stripes',
  'japan-airlines': 'White fuselage and red crane roundel',
  qantas: 'Red tail with the white flying kangaroo',
  turkish: 'Red tail and white wild-goose roundel',
  'air-india': 'Burgundy titles and the gold Vista tail',
  'air-new-zealand': 'Black tail and white koru',
};

function preset(s, suffix = '', label = s.name) {
  return Object.freeze({
    id: `commercial-${s.id}${suffix}`, name: label,
    description: descriptions[s.id] ?? `${s.name} fleet colors`,
    pattern: 'commercial', hull: s.colors.body, trim: s.colors.fin,
    accent: s.colors.accent, marking: s.marking, code: s.code,
    operator: s,
  });
}
const customCargo = (id, name, marking, body, fin, ink, accent) => ({
  id, name, marking, code: marking, bellyStyle: 0, cheat: false,
  colors: { body, belly: body, fin, ink, accent, tailInk: ink,
    nacelle: body, wing: '#bec6cb', radome: body },
});
export const COMMERCIAL_PRESETS = Object.freeze({
  airliner: Object.freeze(passengerIds.map(id => preset(byId.get(id)))),
  cargo: Object.freeze([
    ...['fedex', 'ups', 'atlas', 'cargolux'].map(id => preset(byId.get(id))),
    preset(customCargo('dhl', 'DHL Aviation', 'DHL', '#f4d12c', '#f4d12c', '#d21e2c', '#d21e2c')),
    preset(customCargo('amazon', 'Amazon Air', 'prime air', '#f2f4f5', '#2d9cce', '#233647', '#2d9cce')),
  ]),
  concorde: Object.freeze([
    preset(byId.get('british-airways'), '-concorde', 'British Airways Concorde'),
    preset(byId.get('air-france'), '-concorde', 'Air France Concorde'),
  ]),
});

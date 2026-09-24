/** Appearance revisions travel together; raw geographic caches are unaffected. */
export const PAINTERLY = Object.freeze({
  revision: 5,
  assetVersion: 3,
  appearanceKey: 'painterly-v3-r5',
  size: 256,
  layers: 8,
  nearM: 450,
  farM: 2800,
});

export function painterlyProfile(profile, style) {
  return profile === 'enhanced' && style === 'satellite';
}

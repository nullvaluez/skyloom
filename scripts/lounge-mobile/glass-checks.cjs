// LOUNGE MOBILE — the GLASS stream's checks for scripts/verify-lounge-mobile.cjs
// (portrait binoculars, the phone HUD, sheets, overlap / overflow / 44 px
// targets, safe areas). The GLASS stream owns this file. Each phase receives
// the runner's harness object `h` (see the runner's header for its fields)
// and reports through h.check().
module.exports = {
  name: 'glass',
  async portrait(/* h */) {},
  async landscape(/* h */) {},
};

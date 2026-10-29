// LOUNGE MOBILE — the TOUCH stream's checks for scripts/verify-lounge-mobile.cjs
// (gestures, walk stick, portrait camera, motion look, haptics). The TOUCH
// stream owns this file. Each phase receives the runner's harness object `h`
// (see the runner's header for its fields) and reports through h.check().
module.exports = {
  name: 'touch',
  async portrait(/* h */) {},
  async landscape(/* h */) {},
};

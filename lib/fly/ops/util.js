// Shared scalar helpers for the operations core (lib/fly/ops/*). Kept exactly
// as the pre-split flight-operations.js defined them: verify-ops-golden hashes
// the trajectories these produce.
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const angle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

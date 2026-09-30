// Diagnostic: puppet track state vs scripted pose (run with TRAILER_DIAG=1).
const base = require('./alps-airforce.cjs');
module.exports = { ...base, id: 'probe-airforce', frames: 8, runIn: 10, settle: { maxSec: 240, minSec: 10, streamSec: 5 } };

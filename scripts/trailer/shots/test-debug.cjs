// Fast rig debug shot.
const base = require('./test-chase.cjs');
module.exports = { ...base, id: 'test-debug', frames: 5, runIn: 3, settle: { maxSec: 240, minSec: 5, streamSec: 15 } };

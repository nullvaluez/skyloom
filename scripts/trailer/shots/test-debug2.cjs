const base = require('./test-chase.cjs');
module.exports = { ...base, id: 'test-debug2', frames: 30, runIn: 3, settle: { maxSec: 240, minSec: 5, streamSec: 15 } };

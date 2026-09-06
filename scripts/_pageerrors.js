/**
 * R24 (E CERT) — page errors with STACKS, deduplicated by message.
 *
 * WHY. Pass 2b's ladder-fix row failed "no page errors" with thirty-one copies
 * of `Cannot read properties of undefined (reading 'byteLength')` and nothing
 * else. Thirty-one copies of one message is ONE finding, not thirty-one, and
 * without a stack frame the row can say only that it happened — attribution
 * then becomes guesswork across four owners' merges. The first non-vendor
 * frame is what turns a message into an address.
 *
 * USAGE (drop-in for `page.on('pageerror', e => errors.push(String(e)))`):
 *   const errors = [];
 *   const errNote = attachPageErrors(page, errors);       // optionally (page, errors, 'green: ')
 *   ...
 *   gate('(N) NO PAGE ERRORS', errors.length === 0, errNote());
 *
 * `errors` still fills with one entry per exception, so every existing
 * `errors.length === 0` assertion is unchanged.
 */

/** The first frame that is not node_modules / vendored — i.e. ours. */
function firstOwnFrame(stack) {
  return (
    String(stack || '')
      .split('\n')
      .slice(1)
      .map((l) => l.trim())
      .find((l) => l.startsWith('at ') && !l.includes('node_modules') && !l.includes('<anonymous>')) ||
    String(stack || '')
      .split('\n')
      .slice(1, 2)
      .map((l) => l.trim())[0] ||
    'no stack'
  );
}

function attachPageErrors(page, sink, prefix = '') {
  const seen = new Map(); // message -> { n, stack }
  page.on('pageerror', (e) => {
    const msg = prefix + String(e?.message ?? e).slice(0, 200);
    const prev = seen.get(msg);
    if (prev) prev.n += 1;
    else seen.set(msg, { n: 1, stack: String(e?.stack ?? e) });
    sink.push(msg);
  });
  return function note() {
    if (!seen.size) return 'clean';
    const rows = [...seen.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 3);
    const more = seen.size > 3 ? `\n        …and ${seen.size - 3} more distinct message(s)` : '';
    return (
      `${sink.length} exception(s), ${seen.size} distinct — first 3 unique, with stacks:\n` +
      rows
        .map(([msg, v]) => `        ${v.n}x ${msg}\n            ${firstOwnFrame(v.stack)}`)
        .join('\n') +
      more
    );
  };
}

module.exports = { attachPageErrors, firstOwnFrame };

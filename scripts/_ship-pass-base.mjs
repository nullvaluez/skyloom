/**
 * The Ship Pass base: the W0 commit every stream branched from (940b751,
 * FLY_SHIP_PASS.md 4.1). The pass's identity rows compare against it.
 *
 * They used to take `git merge-base HEAD main`, which is W0 while the streams
 * run, but once the streams are merged into main it is HEAD itself and every
 * "unchanged since W0" row compares the tree with itself. W0 is on main's
 * history now, so the merge-base with it is W0 on a stream branch and on main
 * alike; outside a checkout that has W0 we fall back to the old rule.
 */
import { execFileSync } from 'node:child_process';

export const SHIP_PASS_W0 = '940b751';

export function shipPassBase(root, fallbackRef = 'main') {
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  try {
    return git('merge-base', 'HEAD', SHIP_PASS_W0);
  } catch {
    try {
      return git('merge-base', 'HEAD', fallbackRef);
    } catch {
      return null;
    }
  }
}

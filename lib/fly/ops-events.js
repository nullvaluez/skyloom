/**
 * GATE TO GATE — the one operations event cursor.
 *
 * FlightOperations keeps only the last 32 events and begin() clears them, so a
 * consumer that polls ops.events can miss events or see one twice. The cursor
 * taps the emitter instead (FlightOperations.tapEvents) and hands each event
 * to drain() exactly once, in id order, across the 32-event window and begin()
 * resets. It follows whichever operations object getOps() returns (a FlyScene
 * remount builds a new one).
 *
 * lib/fly/ops-presentation.js owns the single fan-out built on this cursor;
 * other modules subscribe to that fan-out rather than building cursors.
 * Events that happened before the cursor attached are not replayed.
 */
export function createOpsEventCursor(getOps) {
  let ops = null;
  let untap = null;
  let lastId = 0;
  const queue = [];

  const attach = () => {
    const next = getOps() ?? null;
    if (next === ops) return;
    untap?.();
    untap = null;
    ops = next;
    queue.length = 0;
    lastId = ops?.sequence ?? 0;
    if (ops?.tapEvents) untap = ops.tapEvents((event) => queue.push(event));
  };

  return {
    /** Deliver every event not yet delivered, oldest first. Returns the count. */
    drain(fn) {
      attach();
      let n = 0;
      const pending = queue.splice(0);
      for (const event of pending) {
        if (event.id <= lastId) continue;
        lastId = event.id;
        n++;
        fn(event);
      }
      return n;
    },
    /** Id of the last delivered event. */
    get lastId() {
      return lastId;
    },
    release() {
      untap?.();
      untap = null;
      ops = null;
      queue.length = 0;
    },
  };
}

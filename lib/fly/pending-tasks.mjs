/** Share work only while it is pending. Failures are evicted as well, so an
 * offline/transient response can never poison a later retry or retain data. */
export function createPendingTasks() {
  const pending = new Map();
  return function run(key, load) {
    if (pending.has(key)) return pending.get(key);
    const task = Promise.resolve().then(load).finally(() => {
      if (pending.get(key) === task) pending.delete(key);
    });
    pending.set(key, task);
    return task;
  };
}

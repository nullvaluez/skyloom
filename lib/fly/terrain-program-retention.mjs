/** Retain completed terrain warm jobs by their exact renderer program keys.
 * Pending jobs own their materials until polling finishes; destroying one
 * early can invalidate Three's compileAsync material-property lookup. */
export function createTerrainProgramRetention({ capacity = 6 } = {}) {
  const entries = new Map();
  let generation = 0;
  return {
    get size() { return entries.size; },
    retain(key, job) {
      const owner = generation;
      return Promise.resolve(job.promise).then(result => {
        if (owner !== generation) { job.dispose(); return result; }
        const existing = entries.get(key);
        if (existing) {
          entries.delete(key); entries.set(key, existing);
          // The old job still holds these exact programs. Release only the
          // duplicate whose own async compile has now finished polling.
          job.dispose();
        } else {
          entries.set(key, job);
          while (entries.size > capacity) {
            const [oldKey, old] = entries.entries().next().value;
            entries.delete(oldKey); old.dispose();
          }
        }
        return result;
      }, error => { job.dispose(); throw error; });
    },
    clear() {
      generation++;
      for (const job of entries.values()) job.dispose();
      entries.clear();
      // Outstanding jobs dispose on completion; they cannot repopulate this
      // renderer generation after context loss/teardown.
    },
  };
}

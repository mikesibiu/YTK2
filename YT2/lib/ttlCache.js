/**
 * Small in-memory TTL cache with a size cap and in-flight de-duplication.
 */
function createTtlCache({ ttlMs = 60 * 1000, maxEntries = 500, now = Date.now } = {}) {
  const store = new Map(); // key -> { value, expiresAt }
  const inflight = new Map(); // key -> Promise

  function get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  function set(key, value, customTtlMs) {
    if (store.size >= maxEntries && !store.has(key)) {
      // Drop expired first, then oldest insertion.
      const t = now();
      for (const [k, e] of store) {
        if (e.expiresAt <= t) store.delete(k);
      }
      while (store.size >= maxEntries) {
        store.delete(store.keys().next().value);
      }
    }
    store.set(key, { value, expiresAt: now() + (customTtlMs ?? ttlMs) });
  }

  // Concurrent callers for the same key share one loader call. Failures are not cached.
  async function getOrLoad(key, loader, customTtlMs) {
    const cached = get(key);
    if (cached !== undefined) return cached;
    if (inflight.has(key)) return inflight.get(key);

    const promise = (async () => {
      try {
        const value = await loader();
        set(key, value, customTtlMs);
        return value;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, promise);
    return promise;
  }

  return {
    get,
    set,
    getOrLoad,
    delete: key => store.delete(key),
    clear: () => store.clear(),
    size: () => store.size
  };
}

module.exports = { createTtlCache };

type CacheEntry<T> = {
  value?: T;
  expiresAt: number;
  staleAt: number;
  updatedAt: number;
  promise?: Promise<T>;
};

const cache = new Map<string, CacheEntry<unknown>>();

export const cacheTtl = {
  latestSearch: 1000 * 60 * 10,
  search: 1000 * 60 * 5,
  mangaDetail: 1000 * 60 * 60 * 12,
  similarTitles: 1000 * 60 * 60 * 6,
  chapters: 1000 * 60 * 15,
  chapterPages: 1000 * 60 * 30,
  stale: 1000 * 60 * 60 * 24
};

export function cacheKey(namespace: string, parts: Record<string, unknown>) {
  return `${namespace}:${JSON.stringify(Object.entries(parts).sort(([left], [right]) => left.localeCompare(right)))}`;
}

export async function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing?.value !== undefined && existing.expiresAt > now) return existing.value;
  if (existing?.promise) return existing.promise;

  const promise = loader()
    .then((value) => {
      cache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs,
        staleAt: Date.now() + Math.max(ttlMs, cacheTtl.stale),
        updatedAt: Date.now()
      });
      return value;
    })
    .catch((error) => {
      if (existing?.value !== undefined && existing.staleAt > Date.now()) {
        cache.set(key, {
          ...existing,
          promise: undefined
        });
        return existing.value;
      }
      if (existing?.value !== undefined) {
        cache.set(key, {
          ...existing,
          promise: undefined
        });
      } else {
        cache.delete(key);
      }
      throw error;
    });

  cache.set(key, {
    value: existing?.value,
    expiresAt: existing?.expiresAt ?? 0,
    staleAt: existing?.staleAt ?? 0,
    updatedAt: existing?.updatedAt ?? 0,
    promise
  });
  return promise;
}

export async function warmCache<T>(key: string, ttlMs: number, loader: () => Promise<T>) {
  try {
    await cached(key, ttlMs, loader);
    return true;
  } catch {
    return false;
  }
}

export function cacheStats() {
  const now = Date.now();
  let fresh = 0;
  let stale = 0;
  let pending = 0;
  for (const entry of cache.values()) {
    if (entry.promise) pending += 1;
    if (entry.value !== undefined && entry.expiresAt > now) fresh += 1;
    if (entry.value !== undefined && entry.expiresAt <= now && entry.staleAt > now) stale += 1;
  }
  return {
    entries: cache.size,
    fresh,
    stale,
    pending
  };
}

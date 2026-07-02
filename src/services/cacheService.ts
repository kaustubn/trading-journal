// Simple in-memory cache with TTL
interface CacheEntry {
  value: any;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

// Clean up expired entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt < now) {
      cache.delete(key);
    }
  }
}, 10 * 60 * 1000);

export const cacheService = {
  // Get from cache
  get(key: string): any {
    const entry = cache.get(key);
    if (!entry) return null;

    if (entry.expiresAt < Date.now()) {
      cache.delete(key);
      return null;
    }

    return entry.value;
  },

  // Set in cache with TTL in seconds
  set(key: string, value: any, ttlSeconds: number = 300) {
    cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  },

  // Delete from cache
  delete(key: string) {
    cache.delete(key);
  },

  // Clear all cache
  clear() {
    cache.clear();
  },

  // Generate cache key
  key(prefix: string, ...args: any[]): string {
    return `${prefix}:${args.join(':')}`;
  }
};

export default cacheService;

// Simple in-memory cache with 10-minute expiry
interface CacheEntry {
  data: any[];
  timestamp: number;
  lastScrapedAt: string | null;
}

const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
const cache = new Map<string, CacheEntry>();

export function getCachedData(cacheKey: string): { data: any[]; lastScrapedAt: string | null } | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;

  const now = Date.now();
  const age = now - entry.timestamp;

  if (age > CACHE_DURATION) {
    cache.delete(cacheKey);
    return null;
  }

  return {
    data: entry.data,
    lastScrapedAt: entry.lastScrapedAt
  };
}

export function setCachedData(cacheKey: string, data: any[], lastScrapedAt: string | null): void {
  cache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    lastScrapedAt
  });
}

export function clearCache(cacheKey?: string): void {
  if (cacheKey) {
    cache.delete(cacheKey);
    return;
  }

  cache.clear();
}

// Simple in-memory cache with 10-minute expiry
interface CacheEntry {
  data: any[];
  timestamp: number;
  lastScrapedAt: string | null;
}

const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes
let cache: CacheEntry | null = null;

export function getCachedData(): { data: any[]; lastScrapedAt: string | null } | null {
  if (!cache) return null;
  
  const now = Date.now();
  const age = now - cache.timestamp;
  
  if (age > CACHE_DURATION) {
    cache = null;
    return null;
  }
  
  return {
    data: cache.data,
    lastScrapedAt: cache.lastScrapedAt
  };
}

export function setCachedData(data: any[], lastScrapedAt: string | null): void {
  cache = {
    data,
    timestamp: Date.now(),
    lastScrapedAt
  };
}

export function clearCache(): void {
  cache = null;
}

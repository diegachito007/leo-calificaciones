const PREFIX = "eduX_cache_v1:";

interface Entry<T> {
  ts: number;
  data: T;
}

export function cacheGet<T>(key: string, ttlMs: number): T | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (Date.now() - entry.ts > ttlMs) {
      sessionStorage.removeItem(PREFIX + key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, data: T): void {
  try {
    sessionStorage.setItem(
      PREFIX + key,
      JSON.stringify({ ts: Date.now(), data }),
    );
  } catch {
    // silencioso (cuota llena, etc.)
  }
}

export function cacheInvalidate(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    // silencioso
  }
}
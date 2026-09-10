/** Scoped flag so Refresh fetches use `cache: 'no-store'` without coupling fetch code to query layer. */
let bypassHttpCacheDepth = 0;
/** Scoped flag so change probes use `cache: 'no-cache'` (ETag revalidation; 304s are free on GitHub). */
let revalidateHttpCacheDepth = 0;

export async function withBypassHttpCache<T>(fn: () => Promise<T>): Promise<T> {
  bypassHttpCacheDepth++;
  try {
    return await fn();
  } finally {
    bypassHttpCacheDepth--;
  }
}

export async function withRevalidateHttpCache<T>(fn: () => Promise<T>): Promise<T> {
  revalidateHttpCacheDepth++;
  try {
    return await fn();
  } finally {
    revalidateHttpCacheDepth--;
  }
}

function resolveCacheMode(init?: RequestInit): RequestCache {
  if (bypassHttpCacheDepth > 0) {
    return 'no-store';
  }

  if (revalidateHttpCacheDepth > 0) {
    return 'no-cache';
  }

  return init?.cache ?? 'default';
}

export function githubFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, cache: resolveCacheMode(init) });
}

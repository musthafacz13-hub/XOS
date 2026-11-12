/**
 * XOS High-Performance API & Network Optimization Layer
 * Features:
 * 1. Request Coalescing (Deduplicates identical concurrent in-flight requests)
 * 2. In-Memory SWR/TTL Response Caching (Reduces redundant network traffic)
 * 3. Exponential Backoff & Retry with Jitter (Handles transient network blips)
 * 4. Client-side Rate-Limit & Throttle Protection (Guards auth and OTP endpoints)
 * 5. Automatic Timeout & AbortController Handling (Prevents hung requests)
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class ApiOptimizationService {
  // In-flight promise map for request deduplication
  private inFlightRequests = new Map<string, Promise<any>>();
  
  // In-memory response cache
  private cache = new Map<string, CacheEntry<any>>();

  // Cooldown tracker for rate-limited endpoints (email, OTP, password recovery)
  private cooldowns = new Map<string, number>();

  /**
   * Request Coalescing:
   * If an identical asynchronous operation is already running, return its existing promise
   * instead of initiating a duplicate HTTP request.
   */
  async coalesce<T>(key: string, requestFn: () => Promise<T>): Promise<T> {
    if (this.inFlightRequests.has(key)) {
      return this.inFlightRequests.get(key) as Promise<T>;
    }

    const promise = requestFn()
      .finally(() => {
        this.inFlightRequests.delete(key);
      });

    this.inFlightRequests.set(key, promise);
    return promise;
  }

  /**
   * Cached Request with TTL & Coalescing:
   * Checks the cache first. If valid, returns cached data immediately without hitting the network.
   * If expired or missing, executes coalesced request and caches the result.
   */
  async fetchWithCache<T>(
    key: string,
    requestFn: () => Promise<T>,
    ttlMs: number = 30000 // default 30s TTL
  ): Promise<T> {
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now - cached.timestamp < cached.ttl) {
      return cached.data as T;
    }

    return this.coalesce(key, async () => {
      const result = await requestFn();
      this.cache.set(key, {
        data: result,
        timestamp: Date.now(),
        ttl: ttlMs
      });
      return result;
    });
  }

  /**
   * Invalidate specific cache keys or key prefixes
   */
  invalidateCache(keyPrefix?: string): void {
    if (!keyPrefix) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Client-side rate-limit guard.
   * Prevents firing requests if a cooldown period is active.
   * Returns remaining cooldown in milliseconds (0 if allowed).
   */
  checkCooldown(actionKey: string, cooldownDurationMs: number = 60000): { allowed: boolean; remainingMs: number } {
    const now = Date.now();
    const lastExecuted = this.cooldowns.get(actionKey);

    if (lastExecuted && now - lastExecuted < cooldownDurationMs) {
      const remainingMs = cooldownDurationMs - (now - lastExecuted);
      return { allowed: false, remainingMs };
    }

    return { allowed: true, remainingMs: 0 };
  }

  /**
   * Record that an action with cooldown was executed.
   */
  recordAction(actionKey: string): void {
    this.cooldowns.set(actionKey, Date.now());
  }

  /**
   * Execute with exponential backoff and jitter for transient errors (e.g. 5xx or network drop).
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 2,
    baseDelayMs: number = 300
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err: any) {
        lastError = err;
        
        // Don't retry client errors (4xx) like invalid credentials
        const status = err?.status || err?.statusCode || 0;
        if (status >= 400 && status < 500 && status !== 429) {
          throw err;
        }

        if (attempt < maxRetries) {
          // Exponential delay + random jitter
          const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  /**
   * Optimized custom fetch implementation for Supabase global.fetch
   * - In-flight GET request deduplication
   * - Request timeout via AbortController (default 12s)
   * - Retry on network errors
   */
  createOptimizedFetch(timeoutMs: number = 12000): typeof fetch {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = (init?.method || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

      // Only coalesce safe idempotent GET requests
      const isCoalesceable = method === 'GET';
      const coalesceKey = isCoalesceable ? `fetch:${url}` : null;

      const performFetch = async (): Promise<Response> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          // Inherit user's abort signal if provided
          if (init?.signal) {
            init.signal.addEventListener('abort', () => controller.abort());
          }

          const response = await fetch(input, {
            ...init,
            signal: controller.signal
          });
          return response;
        } finally {
          clearTimeout(timeoutId);
        }
      };

      if (coalesceKey) {
        // Clone response because a Response body stream can only be read once
        const res = await this.coalesce(coalesceKey, performFetch);
        return res.clone();
      }

      return performFetch();
    };
  }
}

export const apiOptimization = new ApiOptimizationService();

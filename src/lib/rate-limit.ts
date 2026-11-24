/**
 * Tiny in-memory rate limiter (dev / single-instance).
 * Production note: replace with a Redis-backed limiter when running
 * more than one web instance.
 */

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now >= entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (entry.count >= limit) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }
  entry.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

/** Test helper — clears all counters. */
export function resetRateLimits(): void {
  store.clear();
}

/**
 * Client IP for rate limiting, from the proxy headers Render (and most
 * hosts) set. Falls back to "unknown" for direct local requests — in
 * dev that means all localhost traffic shares one bucket, which is
 * acceptable for the limits used here.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}

/**
 * Rate-limit an API route by client IP. Returns null when the request
 * is allowed, or a 429 Response (with Retry-After) when it is not.
 * Call after the auth check so unauthenticated hammering cannot
 * exhaust a shared (NAT) bucket for legitimate users.
 */
export function apiRateLimit(
  request: { headers: Headers },
  opts: { prefix: string; limit: number; windowMs: number },
): Response | null {
  const ip = clientIpFromHeaders(request.headers);
  const result = checkRateLimit(`${opts.prefix}:${ip}`, opts.limit, opts.windowMs);
  if (result.allowed) return null;
  return new Response("Too many requests. Please try again shortly.", {
    status: 429,
    headers: {
      "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))),
    },
  });
}

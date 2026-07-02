import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: { count: number; resetTime: number };
}

const store: RateLimitStore = {};

// Clean up old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const key in store) {
    if (store[key].resetTime < now) {
      delete store[key];
    }
  }
}, 10 * 60 * 1000);

export function rateLimit(maxRequests: number = 100, windowMs: number = 60 * 1000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'unknown';
    const userId = req.userId ? `user-${req.userId}` : `ip-${ip}`;
    const key = userId;
    const now = Date.now();

    if (!store[key]) {
      store[key] = { count: 0, resetTime: now + windowMs };
    }

    if (store[key].resetTime < now) {
      store[key] = { count: 0, resetTime: now + windowMs };
    }

    store[key].count++;

    const remaining = Math.max(0, maxRequests - store[key].count);
    const resetTime = store[key].resetTime;

    res.set('X-RateLimit-Limit', maxRequests.toString());
    res.set('X-RateLimit-Remaining', remaining.toString());
    res.set('X-RateLimit-Reset', Math.ceil(resetTime / 1000).toString());

    if (store[key].count > maxRequests) {
      return res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil((resetTime - now) / 1000)
      });
    }

    next();
  };
}

export default rateLimit;

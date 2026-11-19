import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

// The server refuses to start without JWT_SECRET (see index.ts); there is no fallback secret.
function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

export function verifyToken(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  const token = h && h.startsWith('Bearer ') ? h.slice(7) : undefined;
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, secret(), { algorithms: ['HS256'] }) as { userId: number };
    if (!Number.isInteger(decoded?.userId) || decoded.userId <= 0) throw new Error('bad payload');
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function generateToken(userId: number): string {
  return jwt.sign({ userId }, secret(), { algorithm: 'HS256', expiresIn: '7d' });
}

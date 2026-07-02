import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export function verifyToken(req: Request, res: Response, next: NextFunction) {
  console.log(`[AUTH] ${req.method} ${req.path}`, req.headers.authorization ? 'has token' : 'no token');
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret') as { userId: number };
    req.userId = decoded.userId;
    console.log(`[AUTH] Token verified for user ${req.userId}`);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

export function generateToken(userId: number): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'secret', {
    expiresIn: '7d'
  });
}

import bcrypt from 'bcryptjs';
import { Request, Response, NextFunction } from 'express';

declare module 'express-session' {
  interface SessionData {
    authenticated: boolean;
    username: string;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.authenticated) {
    next();
    return;
  }
  // API / SSE paths → 401 JSON, pages → redirect
  if (req.path.startsWith('/api/') || req.path.startsWith('/logs/')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.redirect('/login');
}

export function requireApiKey(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.query['api_key'];
    if (key !== apiKey) {
      res.status(401).json({ error: 'Invalid or missing api_key query parameter' });
      return;
    }
    next();
  };
}

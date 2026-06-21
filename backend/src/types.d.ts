// Augment Express Request with the authenticated user (from the JWT).
import 'express';

declare global {
  namespace Express {
    interface Request {
      user?: { id: number; email: string; username: string; role?: string };
    }
  }
}

export {};

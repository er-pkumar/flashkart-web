import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { badRequest } from '../errors';

const userIdSchema = z.string().uuid();

/**
 * Stands in for real authentication: the client sends its user id in a header.
 * Swapping this for JWT verification would not change any service.
 *
 * Only the shape is checked here. Whether the user exists and is allowed to buy
 * is a business rule, so it lives in the services.
 */
export function currentUser(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('x-user-id')?.trim();
  if (!header) {
    next(badRequest('MISSING_USER', 'x-user-id header is required'));
    return;
  }

  const parsed = userIdSchema.safeParse(header);
  if (!parsed.success) {
    next(badRequest('INVALID_USER', 'x-user-id must be a user UUID'));
    return;
  }

  req.userId = parsed.data;
  next();
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/** Reads the id that `currentUser` attached. */
export function requireUserId(req: Request): string {
  if (!req.userId) throw badRequest('MISSING_USER', 'x-user-id header is required');
  return req.userId;
}

import type { Request, Response } from 'express';
import { requireUserId } from '../middleware/current-user';
import { createDemoUser, getUser } from '../services/user.service';

export async function postUser(_req: Request, res: Response): Promise<void> {
  const user = await createDemoUser();
  res.status(201).json({ user: { id: user.id, email: user.email, name: user.name } });
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const user = await getUser(requireUserId(req));
  res.json({ user: { id: user.id, email: user.email, name: user.name, status: user.status } });
}

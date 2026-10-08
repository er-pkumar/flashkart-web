import type { Request, Response } from 'express';
import { listProducts } from '../services/catalog.service';

export async function getProducts(_req: Request, res: Response): Promise<void> {
  res.json({ products: await listProducts() });
}

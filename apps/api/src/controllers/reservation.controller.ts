import type { Request, Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { requireUserId } from '../middleware/current-user';
import { createReservation, releaseReservation } from '../services/reservation.service';

const reserveSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
});

const idSchema = z.object({ reservationId: z.string().uuid() });

/** POST /api/cart/reserve - hold stock for this buyer for a fixed window. */
export async function postReservation(req: Request, res: Response): Promise<void> {
  const { productId, quantity } = reserveSchema.parse(req.body);
  const reservation = await createReservation(requireUserId(req), productId, quantity);

  res.status(201).json({
    reservationId: reservation.reservationId,
    productId: reservation.productId,
    quantity: reservation.quantity,
    expiresAt: reservation.expiresAt.toISOString(),
    expiresInSeconds: env.reservationTtlSeconds,
  });
}

export async function deleteReservation(req: Request, res: Response): Promise<void> {
  const { reservationId } = idSchema.parse(req.params);
  const released = await releaseReservation(reservationId, requireUserId(req));
  res.json({ released });
}

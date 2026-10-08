import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Order } from '../entities/order.entity';
import { badRequest } from '../errors';
import { requireUserId } from '../middleware/current-user';
import { checkout, listOrders } from '../services/order.service';

const checkoutSchema = z.object({ reservationId: z.string().uuid() });

export async function postCheckout(req: Request, res: Response): Promise<void> {
  const idempotencyKey = req.header('idempotency-key')?.trim();
  if (!idempotencyKey) {
    throw badRequest('MISSING_IDEMPOTENCY_KEY', 'Idempotency-Key header is required');
  }
  if (idempotencyKey.length > 128) {
    throw badRequest('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 128 characters or fewer');
  }

  const { reservationId } = checkoutSchema.parse(req.body);
  const { order, replayed } = await checkout({
    userId: requireUserId(req),
    reservationId,
    idempotencyKey,
  });

  res.status(replayed ? 200 : 201).json({ order: toOrderView(order), replayed });
}

export async function getOrders(req: Request, res: Response): Promise<void> {
  const orders = await listOrders(requireUserId(req));
  res.json({ orders: orders.map(toOrderView) });
}

function toOrderView(order: Order) {
  return {
    id: order.id,
    status: order.status,
    totalAmountCents: order.totalAmountCents,
    createdAt: order.createdAt.toISOString(),
    items: (order.items ?? []).map((item) => ({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalPriceCents: item.totalPriceCents,
    })),
  };
}

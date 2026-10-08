import { In } from 'typeorm';
import { AppDataSource } from '../db/data-source';
import { OrderItem } from '../entities/order-item.entity';
import {
  ORDER_IDEMPOTENCY_CONSTRAINT,
  ORDER_RESERVATION_CONSTRAINT,
  Order,
  OrderStatus,
} from '../entities/order.entity';
import { AppError, conflict, gone, notFound } from '../errors';
import { consumeReservation, getReservation, releaseReservation } from './reservation.service';
import { getUser } from './user.service';

const UNIQUE_VIOLATION = '23505';

const orders = () => AppDataSource.getRepository(Order);

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const candidate = error as { code?: string; constraint?: string } | null;
  return candidate?.code === UNIQUE_VIOLATION && candidate.constraint === constraint;
}

export type CheckoutInput = {
  userId: string;
  reservationId: string;
  idempotencyKey: string;
};

export type CheckoutOutcome = {
  order: Order;
  /** True when the request was a retry served from an existing order. */
  replayed: boolean;
};

/**
 * Turns a Redis reservation into a durable order.
 *
 * Correctness rests on four things:
 *
 *  1. The idempotency key is unique, so a retry returns the original order.
 *  2. Stock is decremented with a conditional UPDATE (stock >= quantity).
 *     Postgres re-evaluates that predicate after taking the row lock, so
 *     concurrent checkouts serialise and the losing one sees zero rows
 *     affected rather than driving stock negative.
 *  3. The reservation id is unique on orders, so a reservation can be spent
 *     exactly once.
 *  4. Redis is only told to consume the reservation after the transaction
 *     commits. Committing first means a Redis failure can never lose an order;
 *     the sweeper checks Postgres before returning units to the counter.
 */
export async function checkout(input: CheckoutInput): Promise<CheckoutOutcome> {
  const { userId, reservationId, idempotencyKey } = input;

  const replay = await findByIdempotencyKey(idempotencyKey, userId);
  if (replay) return { order: replay, replayed: true };

  await getUser(userId);

  const reservation = await getReservation(reservationId);
  if (!reservation) {
    // A concurrent request carrying our idempotency key may have consumed it
    // moments ago. Consume only ever happens after a successful commit, so if
    // the reservation is gone that order is already readable.
    const settled = await findByIdempotencyKey(idempotencyKey, userId);
    if (settled) return { order: settled, replayed: true };

    throw gone('RESERVATION_EXPIRED', 'Reservation has expired or was already used');
  }
  if (reservation.userId !== userId) {
    throw notFound('RESERVATION_NOT_FOUND', 'Reservation does not exist');
  }

  let orderId: string;
  try {
    orderId = await AppDataSource.transaction(async (manager) => {
      // TypeORM Postgres driver returns [rows, rowCount] for UPDATE queries.
      const [updatedRows] = (await manager.query(
        `UPDATE products
            SET stock = stock - $1, updated_at = now()
          WHERE id = $2
            AND stock >= $1
        RETURNING name, price_cents`,
        [reservation.quantity, reservation.productId],
      )) as [Array<{ name: string; price_cents: number | string }>, number];

      const updated = updatedRows[0];
      if (!updated) {
        // Either the product vanished or durable stock is genuinely exhausted.
        throw conflict('SOLD_OUT', 'This item sold out before checkout completed');
      }

      const unitPriceCents = Number(updated.price_cents);
      const totalPriceCents = unitPriceCents * reservation.quantity;

      const order = await manager.save(
        manager.create(Order, {
          userId,
          // No payment step in this exercise, so the sale is final on commit.
          status: OrderStatus.Confirmed,
          totalAmountCents: totalPriceCents,
          idempotencyKey,
          reservationId,
        }),
      );

      await manager.save(
        manager.create(OrderItem, {
          orderId: order.id,
          productId: reservation.productId,
          productName: updated.name,
          quantity: reservation.quantity,
          unitPriceCents,
          totalPriceCents,
        }),
      );

      return order.id;
    });
  } catch (error) {
    const lostRace =
      isUniqueViolation(error, ORDER_IDEMPOTENCY_CONSTRAINT) ||
      isUniqueViolation(error, ORDER_RESERVATION_CONSTRAINT);

    if (lostRace) {
      // A concurrent request beat us to it and our transaction rolled back,
      // stock decrement included. Postgres makes the second inserter wait on
      // the unique index until the winner commits, so by the time we see the
      // violation the winning order is readable. If it carries our idempotency
      // key, it is our order, so return it rather than reporting a conflict.
      const existing = await findByIdempotencyKey(idempotencyKey, userId);
      if (existing) return { order: existing, replayed: true };
    }

    // Someone else spent this reservation under a different idempotency key.
    // Their order owns the units, so there is nothing of ours to give back.
    if (isUniqueViolation(error, ORDER_RESERVATION_CONSTRAINT)) {
      throw conflict('RESERVATION_ALREADY_USED', 'This reservation was already checked out');
    }

    await releaseOnFailure(error, reservationId, userId);
    throw error;
  }

  // The order is durable from here on. A failure to clear the Redis reservation
  // is not fatal: the sweeper sees the order in Postgres and leaves the counter
  // alone.
  try {
    await consumeReservation(reservationId);
  } catch (error) {
    console.error('[checkout] failed to consume reservation %s:', reservationId, error);
  }

  const order = await orders().findOne({ where: { id: orderId }, relations: { items: true } });
  if (!order) throw notFound('ORDER_NOT_FOUND', 'Order could not be loaded');
  return { order, replayed: false };
}

/**
 * Decides what to do with the Redis hold after a failed checkout. The
 * transaction has already rolled back, so durable stock is untouched and the
 * only question is what the counter should say.
 *
 * Two different failures need opposite answers:
 *
 * - SOLD_OUT means the conditional UPDATE found no durable stock, so the Redis
 *   counter was ahead of Postgres. Crediting the units back would re-offer
 *   stock that does not exist. The hold is dropped instead, leaving the counter
 *   low. Under-selling is recoverable; overselling is not.
 *
 * - Anything else (a dropped connection, a constraint we did not anticipate)
 *   sold nothing, so the units go back on sale immediately rather than waiting
 *   out the five minute expiry.
 *
 * Cleanup never masks the original error: a failure here is logged, not thrown.
 */
async function releaseOnFailure(
  error: unknown,
  reservationId: string,
  userId: string,
): Promise<void> {
  const soldOut = error instanceof AppError && error.code === 'SOLD_OUT';
  try {
    if (soldOut) {
      await consumeReservation(reservationId);
    } else {
      await releaseReservation(reservationId, userId);
    }
  } catch (cleanupError) {
    // The sweeper is the backstop: it reclaims this hold once it expires.
    console.error('[checkout] could not clean up reservation %s:', reservationId, cleanupError);
  }
}

async function findByIdempotencyKey(idempotencyKey: string, userId: string): Promise<Order | null> {
  const existing = await orders().findOne({
    where: { idempotencyKey },
    relations: { items: true },
  });
  if (!existing) return null;
  // Keys are client-generated; never serve another user order.
  if (existing.userId !== userId) {
    throw conflict('IDEMPOTENCY_KEY_IN_USE', 'Idempotency key already used by another request');
  }
  return existing;
}

export async function listOrders(userId: string): Promise<Order[]> {
  return orders().find({
    where: { userId },
    relations: { items: true },
    order: { createdAt: 'DESC' },
    take: 50,
  });
}

/** Which of these reservations were already turned into orders. */
export async function findSpentReservationIds(reservationIds: string[]): Promise<Set<string>> {
  if (reservationIds.length === 0) return new Set();
  const rows = await orders().find({
    where: { reservationId: In(reservationIds) },
    select: { reservationId: true },
  });
  return new Set(rows.flatMap((row) => (row.reservationId ? [row.reservationId] : [])));
}

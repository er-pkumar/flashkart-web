import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { Product, ProductStatus } from '../entities/product.entity';
import { badRequest, conflict, notFound, unavailable } from '../errors';
import { keys, redis } from '../redis/client';
import { ReleaseResult, ReserveResult } from '../redis/reservation-scripts';
import { findProduct } from './catalog.service';

/**
 * Reservations are the high-concurrency half of the system and live only in
 * Redis. Holding a unit is cheap and atomic; nothing durable is written until
 * the buyer actually checks out.
 *
 * A reservation hash outlives its logical expiry by a grace period so the
 * sweeper can still read the quantity it needs to give back.
 */
const EXPIRY_GRACE_MS = 60_000;

export type Reservation = {
  reservationId: string;
  productId: string;
  userId: string;
  quantity: number;
  expiresAt: Date;
};

/** Status and sale window are what make a product reservable at all. */
function assertOnSale(product: Product): void {
  if (product.status !== ProductStatus.Active) {
    throw conflict('PRODUCT_NOT_ON_SALE', 'This product is not on sale');
  }

  const now = Date.now();
  if (product.saleStartsAt && now < product.saleStartsAt.getTime()) {
    throw conflict('SALE_NOT_STARTED', 'This sale has not started yet');
  }
  if (product.saleEndsAt && now > product.saleEndsAt.getTime()) {
    throw conflict('SALE_ENDED', 'This sale has ended');
  }
}

export async function createReservation(
  userId: string,
  productId: string,
  quantity: number,
): Promise<Reservation> {
  if (quantity < 1 || quantity > env.maxQuantityPerReservation) {
    throw badRequest(
      'INVALID_QUANTITY',
      `Quantity must be between 1 and ${env.maxQuantityPerReservation}`,
    );
  }

  const product = await findProduct(productId);
  if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product does not exist');
  assertOnSale(product);

  const reservationId = randomUUID();
  const expiresAt = Date.now() + env.reservationTtlSeconds * 1000;

  const result = await redis.fkReserve(
    keys.stock(productId),
    keys.reservation(reservationId),
    keys.reservationExpiry,
    reservationId,
    String(quantity),
    productId,
    userId,
    String(expiresAt),
    String(env.reservationTtlSeconds * 1000 + EXPIRY_GRACE_MS),
  );

  switch (result) {
    case ReserveResult.Reserved:
      return { reservationId, productId, userId, quantity, expiresAt: new Date(expiresAt) };
    case ReserveResult.InsufficientStock:
      throw conflict('SOLD_OUT', 'Not enough stock available right now');
    case ReserveResult.StockNotInitialised:
      throw unavailable('SALE_NOT_READY', 'This product is not open for reservations yet');
    default:
      throw conflict('RESERVATION_CONFLICT', 'Could not create reservation, please retry');
  }
}

export async function getReservation(reservationId: string): Promise<Reservation | null> {
  const hash = await redis.hgetall(keys.reservation(reservationId));
  if (!hash || !hash.productId) return null;

  return {
    reservationId,
    productId: hash.productId,
    userId: hash.userId ?? '',
    quantity: Number(hash.quantity),
    expiresAt: new Date(Number(hash.expiresAt)),
  };
}

/** Returns the held units to the counter. Safe to call more than once. */
export async function releaseReservation(
  reservationId: string,
  expectedUserId: string,
): Promise<boolean> {
  const reservation = await getReservation(reservationId);
  if (!reservation) return false;

  const result = await redis.fkRelease(
    keys.stock(reservation.productId),
    keys.reservation(reservationId),
    keys.reservationExpiry,
    reservationId,
    expectedUserId,
  );

  if (result === ReleaseResult.NotOwner) {
    throw notFound('RESERVATION_NOT_FOUND', 'Reservation does not exist');
  }
  return result === ReleaseResult.Released;
}

/**
 * Marks a reservation as spent without returning its units — the decrement from
 * reserve time becomes permanent. Called only after the order is committed.
 */
export async function consumeReservation(reservationId: string): Promise<void> {
  await redis.fkConsume(keys.reservation(reservationId), keys.reservationExpiry, reservationId);
}

export async function findExpiredReservationIds(now: number, limit: number): Promise<string[]> {
  return redis.zrangebyscore(keys.reservationExpiry, '-inf', now, 'LIMIT', 0, limit);
}

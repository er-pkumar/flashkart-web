import { findSpentReservationIds } from '../services/order.service';
import {
  consumeReservation,
  findExpiredReservationIds,
  releaseReservation,
} from '../services/reservation.service';

const SWEEP_INTERVAL_MS = 2_000;
const BATCH_SIZE = 200;

/**
 * Returns abandoned reservations to the Redis counter.
 *
 * Redis key expiry alone cannot do this — a disappearing key takes its quantity
 * with it and the counter would never be credited back. So reservations are
 * tracked in a sorted set by expiry and swept here.
 *
 * Before crediting anything back, the sweeper asks Postgres whether the
 * reservation already became an order. That check is what makes the
 * "commit then consume" ordering in checkout safe: if the Redis consume failed
 * after a successful commit, the units are genuinely sold and must not return.
 */
export async function sweepExpiredReservations(now = Date.now()): Promise<number> {
  const expired = await findExpiredReservationIds(now, BATCH_SIZE);
  if (expired.length === 0) return 0;

  const spent = await findSpentReservationIds(expired);

  let released = 0;
  for (const reservationId of expired) {
    if (spent.has(reservationId)) {
      // Sold. Drop the tracking entry without touching the counter.
      await consumeReservation(reservationId);
      continue;
    }
    if (await releaseReservation(reservationId, '')) released += 1;
  }
  return released;
}

export function startReservationSweeper(): NodeJS.Timeout {
  let running = false;

  const timer = setInterval(() => {
    if (running) return; // Never overlap sweeps.
    running = true;
    sweepExpiredReservations()
      .then((released) => {
        if (released > 0) console.log('[sweeper] returned %d reservation(s) to stock', released);
      })
      .catch((error) => console.error('[sweeper] sweep failed:', error))
      .finally(() => {
        running = false;
      });
  }, SWEEP_INTERVAL_MS);

  timer.unref();
  return timer;
}

import Redis from 'ioredis';
import { env } from '../config/env';

export const redis = new Redis(env.redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

redis.on('error', (err) => {
  console.error('[redis] connection error:', err.message);
});

export const keys = {
  /** Available-to-reserve counter for a product. */
  stock: (productId: string) => `fk:stock:${productId}`,
  /** Hash describing a single in-flight reservation. */
  reservation: (reservationId: string) => `fk:res:${reservationId}`,
  /** Sorted set of reservationId -> expiry timestamp (ms), swept by a background job. */
  reservationExpiry: 'fk:res:expiry',
} as const;

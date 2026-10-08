import path from 'node:path';
import dotenv from 'dotenv';

// Single .env at the monorepo root, regardless of which workspace started the process.
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Env var ${name} must be a positive integer`);
  }
  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: int('PORT', 4000),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: required('REDIS_URL'),
  reservationTtlSeconds: int('RESERVATION_TTL_SECONDS', 300),
  maxQuantityPerReservation: int('MAX_QUANTITY_PER_RESERVATION', 5),
} as const;

export const isProduction = env.nodeEnv === 'production';

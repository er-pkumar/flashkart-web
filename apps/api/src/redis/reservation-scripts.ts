import { redis } from './client';

/**
 * Reservation primitives as Lua scripts. Each one runs atomically inside Redis,
 * which is what lets thousands of concurrent buyers draw down a single counter
 * without ever handing out more units than exist.
 */

const RESERVE = `
local available = redis.call('GET', KEYS[1])
if not available then
  return -1
end
if redis.call('EXISTS', KEYS[2]) == 1 then
  return -2
end

local quantity = tonumber(ARGV[2])
if tonumber(available) < quantity then
  return 0
end

redis.call('DECRBY', KEYS[1], quantity)
redis.call('HSET', KEYS[2],
  'productId', ARGV[3],
  'userId', ARGV[4],
  'quantity', ARGV[2],
  'expiresAt', ARGV[5])
redis.call('PEXPIRE', KEYS[2], tonumber(ARGV[6]))
redis.call('ZADD', KEYS[3], tonumber(ARGV[5]), ARGV[1])
return 1
`;

const RELEASE = `
local quantity = redis.call('HGET', KEYS[2], 'quantity')
if not quantity then
  -- Already consumed, released or expired: nothing to give back.
  redis.call('ZREM', KEYS[3], ARGV[1])
  return 0
end

if ARGV[2] ~= '' and redis.call('HGET', KEYS[2], 'userId') ~= ARGV[2] then
  return -1
end

redis.call('INCRBY', KEYS[1], tonumber(quantity))
redis.call('DEL', KEYS[2])
redis.call('ZREM', KEYS[3], ARGV[1])
return 1
`;

const CONSUME = `
local existed = redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
return existed
`;

redis.defineCommand('fkReserve', { numberOfKeys: 3, lua: RESERVE });
redis.defineCommand('fkRelease', { numberOfKeys: 3, lua: RELEASE });
redis.defineCommand('fkConsume', { numberOfKeys: 2, lua: CONSUME });

declare module 'ioredis' {
  interface RedisCommander<Context> {
    fkReserve(
      stockKey: string,
      reservationKey: string,
      expiryKey: string,
      reservationId: string,
      quantity: string,
      productId: string,
      userId: string,
      expiresAtMs: string,
      holdTtlMs: string,
    ): Promise<number>;

    fkRelease(
      stockKey: string,
      reservationKey: string,
      expiryKey: string,
      reservationId: string,
      expectedUserId: string,
    ): Promise<number>;

    fkConsume(reservationKey: string, expiryKey: string, reservationId: string): Promise<number>;
  }
}

export const ReserveResult = {
  Reserved: 1,
  InsufficientStock: 0,
  StockNotInitialised: -1,
  DuplicateReservationId: -2,
} as const;

export const ReleaseResult = {
  Released: 1,
  NothingToRelease: 0,
  NotOwner: -1,
} as const;

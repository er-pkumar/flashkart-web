import 'reflect-metadata';
import './redis/reservation-scripts';
import { createApp } from './app';
import { env } from './config/env';
import { initDatabase } from './db/data-source';
import { startReservationSweeper } from './jobs/reservation-sweeper';
import { redis } from './redis/client';
import { primeStockCounters } from './services/catalog.service';

async function main(): Promise<void> {
  await initDatabase();
  console.log('[api] database connected');

  await primeStockCounters();
  console.log('[api] stock counters primed');

  const sweeper = startReservationSweeper();
  const server = createApp().listen(env.port, () => {
    console.log('[api] listening on http://localhost:%d', env.port);
  });

  const shutdown = async (signal: string) => {
    console.log('[api] %s received, shutting down', signal);
    clearInterval(sweeper);
    server.close();
    await redis.quit().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[api] failed to start:', error);
  process.exit(1);
});

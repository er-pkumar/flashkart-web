import cors from 'cors';
import express from 'express';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { router } from './routes';

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api', router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

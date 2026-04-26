import 'dotenv/config';
import { createServer } from 'http';
import app from './app.js';
import { initIO } from './sockets/socketServer.js';
import logger from './lib/logger.js';

const PORT = parseInt(process.env['PORT'] ?? '3000', 10);

const httpServer = createServer(app);
initIO(httpServer);

httpServer.listen(PORT, () => {
  logger.info({ port: PORT }, 'server started');
});

await import('./workers/ticketWorker.js');

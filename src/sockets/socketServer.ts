import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import logger from '../lib/logger.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let io: Server | null = null;

export function initIO(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'client connected');

    socket.on('join', (ticketId: string) => {
      if (typeof ticketId !== 'string' || !UUID_REGEX.test(ticketId)) {
        logger.warn({ socketId: socket.id, ticketId }, 'invalid ticketId on join, ignoring');
        return;
      }
      void socket.join(`ticket:${ticketId}`);
      logger.info({ socketId: socket.id, ticketId }, 'client joined room');
    });

    socket.on('disconnect', () => {
      logger.info({ socketId: socket.id }, 'client disconnected');
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
}

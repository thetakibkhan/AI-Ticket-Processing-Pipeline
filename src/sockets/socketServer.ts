import { Server } from 'socket.io';
import type { Server as HttpServer } from 'http';
import logger from '../lib/logger.js';

let io: Server | null = null;

export function initIO(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: '*' },
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'client connected');

    socket.on('join', (ticketId: string) => {
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

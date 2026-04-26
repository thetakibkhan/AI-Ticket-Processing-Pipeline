import { getIO } from './socketServer.js';
import logger from '../lib/logger.js';

function emit(ticketId: string, event: string, payload: Record<string, unknown>): void {
  try {
    getIO().to(`ticket:${ticketId}`).emit(event, { ticketId, ...payload, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.warn({ ticketId, event, err }, 'socket emit failed, continuing');
  }
}

export function emitTicketStarted(ticketId: string): void {
  emit(ticketId, 'ticket.started', {});
}

export function emitTicketProgress(ticketId: string): void {
  emit(ticketId, 'ticket.progress', { completedPhase: 'phase1' });
}

export function emitTicketCompleted(ticketId: string, phase1Output: unknown, phase2Output: unknown): void {
  emit(ticketId, 'ticket.completed', { phase1Output, phase2Output });
}

export function emitTicketFailed(ticketId: string, reason: string): void {
  emit(ticketId, 'ticket.failed', { reason });
}

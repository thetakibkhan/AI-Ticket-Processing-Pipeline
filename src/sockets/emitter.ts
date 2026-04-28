import { getIO } from './socketServer.js';
import logger from '../lib/logger.js';

export const TICKET_EVENTS = {
  STARTED:   'ticket.started',
  PROGRESS:  'ticket.progress',
  COMPLETED: 'ticket.completed',
  FAILED:    'ticket.failed',
} as const;

export type TicketEventType = typeof TICKET_EVENTS[keyof typeof TICKET_EVENTS];

function emit(ticketId: string, event: TicketEventType, payload: Record<string, unknown>): void {
  try {
    getIO().to(`ticket:${ticketId}`).emit(event, { ticketId, ...payload, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.warn({ ticketId, event, err }, 'socket emit failed, continuing');
  }
}

export function emitTicketStarted(ticketId: string, phase: string): void {
  emit(ticketId, TICKET_EVENTS.STARTED, { phase });
}

export function emitTicketProgress(ticketId: string, completedPhase: string): void {
  emit(ticketId, TICKET_EVENTS.PROGRESS, { completedPhase });
}

export function emitTicketCompleted(ticketId: string, phase1Output: unknown, phase2Output: unknown): void {
  emit(ticketId, TICKET_EVENTS.COMPLETED, { phase1Output, phase2Output });
}

export function emitTicketFailed(ticketId: string, reason: string): void {
  emit(ticketId, TICKET_EVENTS.FAILED, { reason });
}

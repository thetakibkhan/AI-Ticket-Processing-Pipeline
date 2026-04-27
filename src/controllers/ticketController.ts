import { type Request, type Response } from 'express';
import { z } from 'zod';
import { createTicket } from '../services/ticketService.js';
import { getTicketById } from '../repositories/ticketRepo.js';
import { getPhase } from '../repositories/phaseRepo.js';
import { getEvents } from '../repositories/eventRepo.js';
import logger from '../lib/logger.js';

const CreateTicketBody = z.object({
  subject: z.string({ error: 'subject is required' }).trim().min(1, 'subject is required'),
  body: z.string({ error: 'body is required' }).trim().min(1, 'body is required'),
});

function badRequest(res: Response, errors: string[]): void {
  res.status(400).json({ errors });
}

function notFound(res: Response, message: string): void {
  res.status(404).json({ errors: [message] });
}

function serverError(res: Response, message: string): void {
  res.status(500).json({ errors: [message] });
}

export async function createTicketHandler(req: Request, res: Response): Promise<void> {
  const parsed = CreateTicketBody.safeParse(req.body);

  if (!parsed.success) {
    badRequest(res, parsed.error.issues.map(i => i.message));
    return;
  }

  const { subject, body } = parsed.data;

  try {
    const ticket = await createTicket(subject, body);
    logger.info({ ticketId: ticket.id }, 'ticket created');
    res.status(202).json({
      ticketId: ticket.id,
      status: 'queued',
      message: 'Your ticket has been received and is being processed',
    });
  } catch (err) {
    logger.error({ err }, 'failed to create ticket');
    serverError(res, 'Failed to create ticket. Please try again.');
  }
}

export async function getTicketHandler(req: Request<{ id: string }>, res: Response): Promise<void> {
  const id = req.params['id'];

  try {
    const ticket = await getTicketById(id!);
    if (!ticket) {
      notFound(res, 'Ticket not found');
      return;
    }

    const [phase1, phase2, events] = await Promise.all([
      getPhase(ticket.id, 'phase1'),
      getPhase(ticket.id, 'phase2'),
      getEvents(ticket.id),
    ]);

    res.status(200).json({
      ticketId: ticket.id,
      status: ticket.status,
      subject: ticket.subject,
      body: ticket.body,
      createdAt: ticket.created_at,
      phases: {
        phase1: phase1 ?? null,
        phase2: phase2 ?? null,
      },
      events,
    });
  } catch (err) {
    logger.error({ ticketId: id, err }, 'failed to fetch ticket');
    serverError(res, 'Failed to fetch ticket. Please try again.');
  }
}

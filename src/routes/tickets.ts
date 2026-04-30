import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createTicketHandler, replayTicketHandler, getTicketHandler, getTicketsHandler } from '../controllers/ticketController.js';

const createTicketLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { errors: ['Too many requests, please try again later.'] },
});

const router = Router();

router.get('/', getTicketsHandler);
router.post('/', createTicketLimiter, createTicketHandler);
router.post('/:id/replay', replayTicketHandler);
router.get('/:id', getTicketHandler);

export default router;

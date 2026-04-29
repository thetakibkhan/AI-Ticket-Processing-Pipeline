import { Router } from 'express';
import { createTicketHandler, replayTicketHandler, getTicketHandler, getTicketsHandler } from '../controllers/ticketController.js';

const router = Router();

router.get('/', getTicketsHandler);
router.post('/', createTicketHandler);
router.post('/:id/replay', replayTicketHandler);
router.get('/:id', getTicketHandler);

export default router;

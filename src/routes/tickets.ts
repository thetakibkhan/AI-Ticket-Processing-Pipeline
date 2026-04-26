import { Router } from 'express';
import { createTicketHandler, getTicketHandler } from '../controllers/ticketController.js';

const router = Router();

router.post('/', createTicketHandler);
router.get('/:id', getTicketHandler);

export default router;

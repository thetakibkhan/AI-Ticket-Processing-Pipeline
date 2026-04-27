import { Router } from 'express';
import { createTicketHandler, createTicketRecordHandler, enqueueTicketHandler, getTicketHandler } from '../controllers/ticketController.js';

const router = Router();

router.post('/', createTicketHandler);
router.post('/record', createTicketRecordHandler);
router.post('/:id/enqueue', enqueueTicketHandler);
router.get('/:id', getTicketHandler);

export default router;

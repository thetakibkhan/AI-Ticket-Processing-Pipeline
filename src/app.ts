import express from 'express';
import helmet from 'helmet';
import ticketRoutes from './routes/tickets.js';

const app = express();

app.use(helmet());

app.use(express.json({ limit: '16kb' }));

app.use('/tickets', ticketRoutes);

export default app;

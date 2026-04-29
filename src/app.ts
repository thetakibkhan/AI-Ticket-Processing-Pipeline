import express from 'express';
import ticketRoutes from './routes/tickets.js';
import helmet from 'helmet';

const app = express();

app.use(helmet());

app.use(express.json());

app.use('/tickets', ticketRoutes);

export default app;

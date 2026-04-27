import { z } from 'zod';

export const CreateTicketBody = z.object({
  subject: z.string({ error: 'subject is required' }).trim().min(1, 'subject is required'),
  body: z.string({ error: 'body is required' }).trim().min(1, 'body is required'),
});

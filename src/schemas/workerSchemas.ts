import { z } from 'zod';

export const MessageSchema = z.object({ ticketId: z.string().uuid() });

import { z } from 'zod';

export const Phase1Schema = z.object({
  category: z.enum(['billing', 'technical', 'account', 'feature_request', 'other']),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  sentiment: z.enum(['positive', 'neutral', 'negative', 'frustrated']),
  escalation: z.boolean(),
  routingTarget: z.enum(['tier1', 'tier2', 'billing_team', 'engineering', 'account_management']),
  summary: z.string().min(10).max(300),
});

export const Phase2Schema = z.object({
  customerReply: z.string().min(50).max(2000),
  internalNote: z.string().min(20).max(1000),
  nextActions: z.array(z.string()).min(1).max(5),
});

export type Phase1Output = z.infer<typeof Phase1Schema>;
export type Phase2Output = z.infer<typeof Phase2Schema>;

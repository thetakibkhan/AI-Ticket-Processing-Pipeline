import { Portkey } from 'portkey-ai';
import { z } from 'zod';
import logger from '../lib/logger.js';

// ─── Schemas ──────────────────────────────────────────────────────────────────

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

export interface TicketInput {
  id: string;
  subject: string;
  body: string;
}

// ─── Error types ─────────────────────────────────────────────────────────────

export class ZodValidationError extends Error {
  constructor(
    public readonly phase: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(`AI output failed validation for ${phase}`);
    this.name = 'ZodValidationError';
  }
}

// ─── Tool schemas ─────────────────────────────────────────────────────────────

const phase1Tool = {
  type: 'function' as const,
  function: {
    name: 'submit_triage',
    description: 'Submit structured triage analysis for a support ticket',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['billing', 'technical', 'account', 'feature_request', 'other'] },
        priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative', 'frustrated'] },
        escalation: { type: 'boolean' },
        routingTarget: { type: 'string', enum: ['tier1', 'tier2', 'billing_team', 'engineering', 'account_management'] },
        summary: { type: 'string', minLength: 10, maxLength: 300 },
      },
      required: ['category', 'priority', 'sentiment', 'escalation', 'routingTarget', 'summary'],
    },
  },
};

const phase2Tool = {
  type: 'function' as const,
  function: {
    name: 'submit_resolution_draft',
    description: 'Submit a resolution draft for a support ticket',
    parameters: {
      type: 'object',
      properties: {
        customerReply: { type: 'string', minLength: 50, maxLength: 2000 },
        internalNote: { type: 'string', minLength: 20, maxLength: 1000 },
        nextActions: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
      },
      required: ['customerReply', 'internalNote', 'nextActions'],
    },
  },
};

// ─── Portkey call options ─────────────────────────────────────────────────────

type PortkeyCallParams = {
  traceID?: string;
  metadata?: Record<string, string>;
};

// ─── AIAdapter class ──────────────────────────────────────────────────────────

export class AIAdapter {
  private readonly client: Portkey;

  constructor() {
    if (!process.env['PORTKEY_API_KEY']) throw new Error('PORTKEY_API_KEY is not set');
    if (!process.env['PORTKEY_CONFIG_ID']) throw new Error('PORTKEY_CONFIG_ID is not set');

    this.client = new Portkey({
      apiKey: process.env['PORTKEY_API_KEY'],
      config: process.env['PORTKEY_CONFIG_ID'],
    });
  }

  async triageTicket(ticket: TicketInput, attempt: number): Promise<Phase1Output> {
    const start = Date.now();

    const response = await this.client.chat.completions.create(
      {
        messages: [
          {
            role: 'system',
            content: 'You are a support ticket triage system. Analyze the ticket and call the submit_triage tool with your analysis.',
          },
          {
            role: 'user',
            content: `Subject: ${ticket.subject}\n\nBody: ${ticket.body}`,
          },
        ],
        tools: [phase1Tool],
        tool_choice: { type: 'function', function: { name: 'submit_triage' } },
      },
      {
        traceID: ticket.id,
        metadata: { ticketId: ticket.id, phase: 'phase1', attempt: String(attempt) },
      } satisfies PortkeyCallParams,
    );

    const durationMs = Date.now() - start;
    const toolCall = response.choices[0]?.message?.tool_calls?.[0];

    if (!toolCall || toolCall.type !== 'function') {
      throw new Error('AI returned no tool call for phase1');
    }

    const raw: unknown = JSON.parse(toolCall.function.arguments);
    const result = Phase1Schema.safeParse(raw);

    logger.info(
      { ticketId: ticket.id, phase: 'phase1', durationMs, model: response.model, promptTokens: response.usage?.prompt_tokens, completionTokens: response.usage?.completion_tokens },
      'AI call completed',
    );

    if (!result.success) throw new ZodValidationError('phase1', result.error.issues);
    return result.data;
  }

  async draftResolution(ticket: TicketInput, triage: Phase1Output, attempt: number): Promise<Phase2Output> {
    const start = Date.now();

    const response = await this.client.chat.completions.create(
      {
        messages: [
          {
            role: 'system',
            content: 'You are a support response drafting system. Using the ticket and its triage analysis, call the submit_resolution_draft tool with a professional draft response.',
          },
          {
            role: 'user',
            content: `Subject: ${ticket.subject}\n\nBody: ${ticket.body}\n\nTriage Analysis:\n${JSON.stringify(triage, null, 2)}`,
          },
        ],
        tools: [phase2Tool],
        tool_choice: { type: 'function', function: { name: 'submit_resolution_draft' } },
      },
      {
        traceID: ticket.id,
        metadata: { ticketId: ticket.id, phase: 'phase2', attempt: String(attempt) },
      } satisfies PortkeyCallParams,
    );

    const durationMs = Date.now() - start;
    const toolCall = response.choices[0]?.message?.tool_calls?.[0];

    if (!toolCall || toolCall.type !== 'function') {
      throw new Error('AI returned no tool call for phase2');
    }

    const raw: unknown = JSON.parse(toolCall.function.arguments);
    const result = Phase2Schema.safeParse(raw);

    logger.info(
      { ticketId: ticket.id, phase: 'phase2', durationMs, model: response.model, promptTokens: response.usage?.prompt_tokens, completionTokens: response.usage?.completion_tokens },
      'AI call completed',
    );

    if (!result.success) throw new ZodValidationError('phase2', result.error.issues);
    return result.data;
  }
}

// ─── Singleton instance + named exports for backward compatibility ────────────

const adapter = new AIAdapter();

export const triageTicket = adapter.triageTicket.bind(adapter);
export const draftResolution = adapter.draftResolution.bind(adapter);

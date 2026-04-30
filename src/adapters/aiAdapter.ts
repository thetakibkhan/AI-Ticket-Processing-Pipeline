import { Portkey } from 'portkey-ai';
import { z } from 'zod';
import logger from '../lib/logger.js';
import { Phase1Schema, Phase2Schema, type Phase1Output, type Phase2Output } from '../schemas/aiSchemas.js';

export { Phase1Schema, Phase2Schema } from '../schemas/aiSchemas.js';
export type { Phase1Output, Phase2Output } from '../schemas/aiSchemas.js';

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

type AITool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

const phase1Tool: AITool = {
  type: 'function',
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

const phase2Tool: AITool = {
  type: 'function',
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

  private async callWithTool<T>(
    phase: string,
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    tool: AITool,
    schema: z.ZodType<T>,
    ticketId: string,
    attempt: number,
  ): Promise<T> {
    const start = Date.now();

    const response = await this.client.chat.completions.create(
      {
        messages,
        tools: [tool],
        tool_choice: { type: 'function', function: { name: tool.function.name } },
      },
      {
        traceID: ticketId,
        metadata: { ticketId, phase, attempt: String(attempt) },
      },
    );

    const durationMs = Date.now() - start;
    const toolCall = response.choices[0]?.message?.tool_calls?.[0];

    if (!toolCall || toolCall.type !== 'function') {
      throw new Error(`AI returned no tool call for ${phase}`);
    }

    const raw: unknown = JSON.parse(toolCall.function.arguments);
    const result = schema.safeParse(raw);

    logger.info(
      { ticketId, phase, durationMs, model: response.model, promptTokens: response.usage?.prompt_tokens, completionTokens: response.usage?.completion_tokens },
      'AI call completed',
    );

    if (!result.success) throw new ZodValidationError(phase, result.error.issues);
    return result.data;
  }

  async triageTicket(ticket: TicketInput, attempt: number): Promise<Phase1Output> {
    return this.callWithTool(
      'phase1',
      [
        {
          role: 'system',
          content: 'You are a support ticket triage system. Analyze the ticket and call the submit_triage tool with your analysis.',
        },
        {
          role: 'user',
          content: `Subject: ${ticket.subject}\n\nBody: ${ticket.body}`,
        },
      ],
      phase1Tool,
      Phase1Schema,
      ticket.id,
      attempt,
    );
  }

  async draftResolution(ticket: TicketInput, triage: Phase1Output, attempt: number): Promise<Phase2Output> {
    return this.callWithTool(
      'phase2',
      [
        {
          role: 'system',
          content: 'You are a support response drafting system. Using the ticket and its triage analysis, call the submit_resolution_draft tool with a professional draft response.',
        },
        {
          role: 'user',
          content: `Subject: ${ticket.subject}\n\nBody: ${ticket.body}\n\nTriage Analysis:\n${JSON.stringify(triage, null, 2)}`,
        },
      ],
      phase2Tool,
      Phase2Schema,
      ticket.id,
      attempt,
    );
  }
}

// ─── Singleton instance + named exports for backward compatibility ────────────

const adapter = new AIAdapter();

export const triageTicket = adapter.triageTicket.bind(adapter);
export const draftResolution = adapter.draftResolution.bind(adapter);

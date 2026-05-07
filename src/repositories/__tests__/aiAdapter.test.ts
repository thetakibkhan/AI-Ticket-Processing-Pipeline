import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodValidationError, type Phase1Output } from '../../adapters/aiAdapter.js';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('portkey-ai', () => {
  function Portkey() {
    return { chat: { completions: { create: mockCreate } } };
  }
  return { Portkey };
});

const { triageTicket, draftResolution } = await import('../../adapters/aiAdapter.js');

const ticket = { id: 'ticket-123', subject: 'Cannot login', body: 'Getting 403 on admin panel' };

function makeToolResponse(args: object) {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            {
              type: 'function' as const,
              function: {
                name: 'submit_triage',
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
    model: 'claude-sonnet-4-5',
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  };
}

const validPhase1Output: Phase1Output = {
  category: 'technical',
  priority: 'high',
  sentiment: 'frustrated',
  escalation: false,
  routingTarget: 'engineering',
  summary: 'User cannot login due to 403 error on admin panel',
};

const validPhase2Output = {
  customerReply:
    'Thank you for reaching out. We have identified the issue with your admin panel access and our engineering team is working on a fix. You should regain access within 2 hours.',
  internalNote:
    'Customer experiencing 403 on admin panel. Likely a permissions configuration issue. Escalate to engineering.',
  nextActions: [
    'Check user permissions in admin console',
    'Review recent permission changes',
    'Follow up in 2 hours',
  ],
};

describe('triageTicket', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('returns validated Phase1Output on valid AI response', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse(validPhase1Output));
    const result = await triageTicket(ticket, 1);
    expect(result.category).toBe('technical');
    expect(result.priority).toBe('high');
    expect(result.sentiment).toBe('frustrated');
    expect(result.escalation).toBe(false);
    expect(result.routingTarget).toBe('engineering');
    expect(result.summary).toBeDefined();
  });

  it('passes ticketId as traceId metadata', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse(validPhase1Output));
    await triageTicket(ticket, 1);
    const callArgs = mockCreate.mock.calls[0];
    expect(callArgs?.[1]).toMatchObject({
      traceID: 'ticket-123',
      metadata: expect.objectContaining({ ticketId: 'ticket-123', phase: 'phase1' }),
    });
  });

  it('throws ZodValidationError when AI returns invalid category', async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({ ...validPhase1Output, category: 'unknown_category' }),
    );
    await expect(triageTicket(ticket, 1)).rejects.toBeInstanceOf(ZodValidationError);
  });

  it('throws ZodValidationError when summary is too short', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse({ ...validPhase1Output, summary: 'short' }));
    await expect(triageTicket(ticket, 1)).rejects.toBeInstanceOf(ZodValidationError);
  });

  it('throws ZodValidationError when required field missing', async () => {
    const { category: _removed, ...withoutCategory } = validPhase1Output;
    mockCreate.mockResolvedValueOnce(makeToolResponse(withoutCategory));
    await expect(triageTicket(ticket, 1)).rejects.toBeInstanceOf(ZodValidationError);
  });

  it('throws Error when AI returns no tool call', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { tool_calls: [] } }],
      model: 'claude-sonnet-4-5',
      usage: {},
    });
    await expect(triageTicket(ticket, 1)).rejects.toThrow('no tool call');
  });

  it('re-throws network error as-is (not ZodValidationError)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Network timeout'));
    const err = await triageTicket(ticket, 1).catch((e) => e);
    expect(err).not.toBeInstanceOf(ZodValidationError);
    expect(err.message).toBe('Network timeout');
  });
});

describe('draftResolution', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('returns validated Phase2Output on valid AI response', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse(validPhase2Output));
    const result = await draftResolution(ticket, validPhase1Output, 1);
    expect(result.customerReply).toBeDefined();
    expect(result.internalNote).toBeDefined();
    expect(Array.isArray(result.nextActions)).toBe(true);
    expect(result.nextActions.length).toBeGreaterThanOrEqual(1);
  });

  it('passes phase1 output as context in prompt', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse(validPhase2Output));
    await draftResolution(ticket, validPhase1Output, 1);
    const messages = mockCreate.mock.calls[0]?.[0].messages;
    const userMessage = messages.find((m: { role: string }) => m.role === 'user');
    expect(userMessage.content).toContain('Triage Analysis');
    expect(userMessage.content).toContain('engineering');
  });

  it('throws ZodValidationError when customerReply too short', async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({ ...validPhase2Output, customerReply: 'Too short' }),
    );
    await expect(draftResolution(ticket, validPhase1Output, 1)).rejects.toBeInstanceOf(
      ZodValidationError,
    );
  });

  it('throws ZodValidationError when nextActions empty array', async () => {
    mockCreate.mockResolvedValueOnce(makeToolResponse({ ...validPhase2Output, nextActions: [] }));
    await expect(draftResolution(ticket, validPhase1Output, 1)).rejects.toBeInstanceOf(
      ZodValidationError,
    );
  });
});
